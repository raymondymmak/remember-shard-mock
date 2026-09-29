import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { WEIGHTS, mixWeights, prepareJobs, prepareShards, rankShards } from "./ranker.js";
import { learnForJob } from "./train.js";

const memory = new Map();
globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
};

const SHOWN_KEY = "remember.shown.v0";
const FEEDBACK_KEY = "remember.feedback.v0";
const WEIGHTS_KEY = "remember.weights.v0";

let session = 0;

function resetStorage() {
  memory.clear();
  delete globalThis.__rememberShown;
  delete globalThis.__rememberWeights;
}

function newStore() {
  session += 1;
  return import(`./store.js?shown=${session}`);
}

describe("device storage", { concurrency: 1 }, () => {
  it("round-trips last-shown timestamps through a versioned record", async () => {
    resetStorage();
    const first = await newStore();
    first.markShown("people-dinner", 1_700_000_000_000);
    first.markShown("soft-rain", 1_700_000_100_000);
    const payload = first.saveShown();

    assert.equal(payload.v, 1);
    assert.deepEqual(payload.shown, {
      "people-dinner": 1_700_000_000_000,
      "soft-rain": 1_700_000_100_000,
    });
    assert.deepEqual(JSON.parse(localStorage.getItem(SHOWN_KEY)), payload);

    const second = await newStore();
    assert.deepEqual(second.shown(), {});
    assert.deepEqual(second.loadShown(), payload.shown);
    assert.equal(second.shown()["soft-rain"], 1_700_000_100_000);

    second.markShown("soft-rain", 1_700_000_200_000);
    second.markShown("push-run", 1_700_000_300_000);
    const third = await newStore();
    third.loadShown();
    assert.deepEqual(third.shown(), {
      "people-dinner": 1_700_000_000_000,
      "soft-rain": 1_700_000_200_000,
      "push-run": 1_700_000_300_000,
    });
  });

  it("ignores a broken shown record and drops entries that are not timestamps", async () => {
    resetStorage();
    memory.set(SHOWN_KEY, "{");
    const store = await newStore();
    assert.deepEqual(store.loadShown(), {});

    memory.set(SHOWN_KEY, JSON.stringify({ v: 2, shown: { a: 1 } }));
    assert.deepEqual(store.loadShown(), {});

    memory.set(
      SHOWN_KEY,
      JSON.stringify({ v: 1, shown: { kept: 5, bad: "no", empty: null, "": 3 } }),
    );
    assert.deepEqual(store.loadShown(), { kept: 5 });
  });

  it("drops the oldest shown times once the map passes the cap", async () => {
    resetStorage();
    const store = await newStore();
    const cap = store.SHOWN_CAP;
    for (let i = 0; i < cap + 2; i += 1) {
      store.markShown(`shard-${String(i).padStart(4, "0")}`, 1_000 + i);
    }

    const oldestSurvivor = "shard-0002";
    const newest = `shard-${String(cap + 1).padStart(4, "0")}`;
    const kept = store.shown();
    assert.equal(Object.keys(kept).length, cap);
    assert.equal(kept["shard-0000"], undefined);
    assert.equal(kept["shard-0001"], undefined);
    assert.equal(kept[oldestSurvivor], 1_002);
    assert.equal(kept[newest], 1_000 + cap + 1);

    const persisted = JSON.parse(localStorage.getItem(SHOWN_KEY));
    assert.equal(persisted.v, 1);
    assert.equal(Object.keys(persisted.shown).length, cap);

    store.markShown(oldestSurvivor, 9_000);
    store.markShown("shard-extra", 9_001);
    const next = store.shown();
    assert.equal(Object.keys(next).length, cap);
    assert.equal(next[oldestSurvivor], 9_000);
    assert.equal(next["shard-extra"], 9_001);
    assert.equal(next["shard-0003"], undefined);

    const reloaded = await newStore();
    reloaded.loadShown();
    assert.equal(Object.keys(reloaded.shown()).length, cap);
    assert.equal(reloaded.shown()[oldestSurvivor], 9_000);
    assert.equal(reloaded.shown()["shard-0003"], undefined);
    assert.equal(reloaded.shown()["shard-extra"], 9_001);
  });

  it("does not touch the feedback log when a shown time is saved", async () => {
    resetStorage();
    const store = await newStore();
    store.recordFeedback({
      shardId: "folio-a",
      job: "push",
      action: "keep",
      scores: { job: 0.5 },
    });
    const feedback = localStorage.getItem(FEEDBACK_KEY);
    assert.equal(store.log().length, 1);

    store.markShown("folio-a", 50);
    assert.equal(localStorage.getItem(FEEDBACK_KEY), feedback);
    assert.equal(store.log().length, 1);
    assert.equal(store.log()[0].action, "keep");
    assert.equal(store.shown()["folio-a"], 50);
  });

  it("drops ranking freshness after a recent shown time survives a reload", async () => {
    resetStorage();
    const now = Date.parse("2026-09-28T12:00:00Z");
    const job = prepareJobs(JOBS).find((item) => item.id === "push");
    const seed = SHARDS.find((shard) => shard.id === "push-desk");
    const shards = prepareShards([
      { ...seed, id: "shown-one" },
      { ...seed, id: "still-new" },
    ]);

    const first = await newStore();
    const cold = rankShards({ shards, job, now, shown: first.shown() });
    assert.equal(cold[0].shard.id, "shown-one");
    assert.equal(cold[0].parts.freshness, 1);
    assert.equal(cold[1].parts.freshness, 1);

    first.markShown("shown-one", now);

    const second = await newStore();
    assert.deepEqual(second.shown(), {});
    second.loadShown();
    assert.equal(second.shown()["shown-one"], now);
    assert.equal(second.shown()["still-new"], undefined);

    const warm = rankShards({ shards, job, now, shown: second.shown() });
    const shownRow = warm.find((row) => row.shard.id === "shown-one");
    const freshRow = warm.find((row) => row.shard.id === "still-new");
    assert.equal(shownRow.parts.freshness, 0);
    assert.equal(freshRow.parts.freshness, 1);
    assert.ok(shownRow.total < freshRow.total);
    assert.equal(warm[0].shard.id, "still-new");
  });

  it("migrates a flat v0 mix into a shared fallback without dropping it", async () => {
    resetStorage();
    const flat = {
      job: 0.2,
      freshness: 0.5,
      recency: 0.9,
      vibe: 1.2,
      text: 0.05,
      feedback: 9,
      image: 9,
    };
    memory.set(WEIGHTS_KEY, JSON.stringify(flat));
    const first = await newStore();
    const expected = {
      job: 0.2,
      freshness: 0.5,
      recency: 0.9,
      vibe: 1.2,
      text: 0.05,
    };

    assert.deepEqual(first.mixForJob("push"), expected);
    assert.deepEqual(first.mixForJob("soft"), expected);
    assert.equal(first.mixSource("people"), "fallback");
    assert.equal(mixWeights(first.mixForJob("push")).feedback, WEIGHTS.feedback);
    assert.equal(mixWeights(first.mixForJob("push")).image, WEIGHTS.image);

    const persisted = JSON.parse(localStorage.getItem(WEIGHTS_KEY));
    assert.equal(persisted.v, 3);
    assert.deepEqual(persisted.fallback, expected);
    assert.equal(persisted.fallback.image, undefined);
    assert.equal(persisted.fallback.feedback, undefined);
    assert.deepEqual(persisted.jobs, {});

    const second = await newStore();
    assert.deepEqual(second.mixForJob("people"), expected);
    assert.equal(JSON.parse(localStorage.getItem(WEIGHTS_KEY)).v, 3);
  });

  it("migrates a wrapped v2 mix and lets one job specialize or reset", async () => {
    resetStorage();
    const mix = { job: 0.4, freshness: 0.2, recency: 0.2, vibe: 0.3, text: 0.1 };
    const oldEval = { fittedOn: "all", train: { n: 4 } };
    memory.set(
      WEIGHTS_KEY,
      JSON.stringify({ v: 2, mix: { ...mix, image: 4, feedback: 4 }, eval: oldEval }),
    );
    const store = await newStore();

    assert.deepEqual(store.mixForJob("push"), mix);
    assert.deepEqual(store.evalForJob("soft"), oldEval);
    assert.equal(store.mixSource("people"), "fallback");

    const learned = { job: 0.1, freshness: 0.1, recency: 0.1, vibe: 2, text: 0, image: 8 };
    store.saveJobMix("push", learned, { fittedOn: "train" });
    assert.deepEqual(store.mixForJob("push"), {
      job: 0.1,
      freshness: 0.1,
      recency: 0.1,
      vibe: 2,
      text: 0,
    });
    assert.equal(store.mixSource("push"), "job");
    assert.deepEqual(store.evalForJob("push"), { fittedOn: "train" });
    assert.deepEqual(store.mixForJob("soft"), mix);
    assert.deepEqual(store.evalForJob("soft"), oldEval);
    assert.equal(store.mixSource("soft"), "fallback");

    store.clearJobMix("push");
    assert.equal(store.mixForJob("push"), null);
    assert.equal(store.mixSource("push"), "prior");
    assert.equal(store.evalForJob("push"), null);
    assert.deepEqual(store.mixForJob("people"), mix);

    const saved = JSON.parse(localStorage.getItem(WEIGHTS_KEY));
    assert.deepEqual(saved.fallback, mix);
    assert.equal(saved.jobs.push, undefined);
    assert.equal(saved.prior.push, true);

    const reloaded = await newStore();
    assert.equal(reloaded.mixForJob("push"), null);
    assert.deepEqual(reloaded.mixForJob("soft"), mix);

    reloaded.saveJobMix("push", learned, { fittedOn: "train" });
    assert.equal(reloaded.mixSource("push"), "job");
    assert.equal(reloaded.mixForJob("push").vibe, 2);
    assert.deepEqual(reloaded.mixForJob("soft"), mix);
  });

  it("saving one job's mix does not move another job", async () => {
    resetStorage();
    const store = await newStore();
    const highVibe = { job: 0.72, freshness: 0.5, recency: 0.12, vibe: 0.96, text: 0.35 };
    const highRecency = { job: 0.38, freshness: 0.5, recency: 0.94, vibe: 0.12, text: 0.35 };
    for (let i = 0; i < 4; i += 1) {
      store.recordFeedback({
        shardId: `push-keep-${i}`,
        job: "push",
        action: "keep",
        scores: highVibe,
        timestamp: 1000 + i,
      });
      store.recordFeedback({
        shardId: `push-nah-${i}`,
        job: "push",
        action: "nah",
        scores: highRecency,
        timestamp: 2000 + i,
      });
      store.recordFeedback({
        shardId: `soft-keep-${i}`,
        job: "soft",
        action: "keep",
        scores: highRecency,
        timestamp: 3000 + i,
      });
      store.recordFeedback({
        shardId: `soft-nah-${i}`,
        job: "soft",
        action: "nah",
        scores: highVibe,
        timestamp: 4000 + i,
      });
    }

    const push = learnForJob(store.log(), "push");
    const soft = learnForJob(store.log(), "soft");
    const people = learnForJob(store.log(), "people");
    assert.equal(push.ok, true);
    assert.equal(soft.ok, true);
    assert.equal(people.ok, false);
    assert.equal(people.weights, null);

    store.saveJobMix("push", push.weights, push.report);
    store.saveJobMix("soft", soft.weights, soft.report);
    const softMix = store.mixForJob("soft");
    assert.equal(store.mixSource("people"), "prior");
    assert.equal(store.mixForJob("people"), null);

    for (let i = 0; i < 3; i += 1) {
      store.recordFeedback({
        shardId: `push-again-keep-${i}`,
        job: "push",
        action: "keep",
        scores: highVibe,
        timestamp: 5000 + i,
      });
      store.recordFeedback({
        shardId: `push-again-nah-${i}`,
        job: "push",
        action: "nah",
        scores: highRecency,
        timestamp: 6000 + i,
      });
    }
    const pushAgain = learnForJob(store.log(), "push");
    store.saveJobMix("push", pushAgain.weights, pushAgain.report);
    assert.deepEqual(store.mixForJob("soft"), softMix);
    assert.notDeepEqual(store.mixForJob("push"), softMix);
    assert.equal(store.mixForJob("people"), null);
  });
});
