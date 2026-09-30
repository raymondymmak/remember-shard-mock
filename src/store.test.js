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
    assert.equal(store.log()[0].action, "like");
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

  it("merges marks without duplicating or letting an older one cover a newer local mark", async () => {
    resetStorage();
    const store = await newStore();
    store.recordFeedback({
      shardId: "import-1",
      job: "push",
      action: "like",
      scores: { job: 0.4 },
      timestamp: 50,
    });
    const before = localStorage.getItem(FEEDBACK_KEY);

    store.importMarksMerge({
      v: 1,
      log: [
        { shardId: "import-1", job: "push", action: "keep", timestamp: 50, scores: { job: 0.4 } },
        { shardId: "import-1", job: "push", action: "dislike", timestamp: 40, scores: { job: 0.2 } },
        { shardId: "import-2", job: "soft", action: "like", timestamp: 80, scores: { job: 0.3 } },
        { shardId: "nope", job: "push", action: "like" },
      ],
    });

    assert.notEqual(localStorage.getItem(FEEDBACK_KEY), before);
    const log = store.log();
    assert.equal(log.filter((event) => event.shardId === "import-1" && event.timestamp === 50).length, 1);
    const face = [...log].reverse().find((event) => event.shardId === "import-1" && event.job === "push");
    assert.equal(face.action, "like");
    assert.equal(face.timestamp, 50);
    assert.equal(log.some((event) => event.shardId === "import-2" && event.action === "like"), true);
    assert.equal(log.some((event) => event.shardId === "nope"), false);

    const settled = localStorage.getItem(FEEDBACK_KEY);
    store.importMarksMerge({
      v: 1,
      log: [
        { shardId: "import-1", job: "push", action: "like", timestamp: 50, scores: { job: 0.4 } },
        { shardId: "import-2", job: "soft", action: "like", timestamp: 80, scores: { job: 0.3 } },
      ],
    });
    assert.equal(localStorage.getItem(FEEDBACK_KEY), settled);
    assert.equal(store.log().length, log.length);
    assert.equal(store.exportMarksPayload().v, 1);
    assert.equal(store.exportMarksPayload().log.length, log.length);
  });

  it("fills job mixes that are still missing and leaves a learned job alone", async () => {
    resetStorage();
    const store = await newStore();
    assert.equal(store.exportWeightsPayload(), null);

    const localMix = { job: 0.9, freshness: 0.1, recency: 0.1, vibe: 0.1, text: 0.1 };
    const packMix = { job: 0.1, freshness: 0.9, recency: 0.1, vibe: 0.4, text: 0.2, image: 4 };
    const softMix = { job: 0.3, freshness: 0.3, recency: 0.3, vibe: 0.8, text: 0.1 };
    const fallback = { job: 0.55, freshness: 0.14, recency: 0.08, vibe: 0, text: 0 };
    store.saveJobMix("push", localMix, { fittedOn: "train", at: 1 });
    store.clearJobMix("people");
    const saved = JSON.parse(localStorage.getItem(WEIGHTS_KEY));
    saved.fallback = fallback;
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(saved));

    const untouched = localStorage.getItem(WEIGHTS_KEY);
    store.importWeightsFillGaps({
      v: 3,
      jobs: {
        push: { mix: packMix, eval: { fittedOn: "all", at: 9999 } },
      },
      fallback: { job: 0.1, freshness: 0.1, recency: 0.1, vibe: 0.1, text: 0.1 },
      prior: { people: false, guests: true },
    });
    assert.equal(localStorage.getItem(WEIGHTS_KEY), untouched);
    assert.deepEqual(store.mixForJob("push"), localMix);
    assert.equal(store.evalForJob("push").at, 1);

    store.importWeightsFillGaps({
      v: 2,
      jobs: { soft: { mix: softMix } },
    });
    assert.equal(store.mixSource("soft"), "fallback");
    assert.deepEqual(store.mixForJob("soft"), fallback);

    store.importWeightsFillGaps({
      v: 3,
      jobs: {
        push: { mix: packMix, eval: { fittedOn: "all", at: 9999 } },
        soft: { mix: softMix, eval: { fittedOn: "all", at: 3 } },
      },
      fallback: { job: 0.2, freshness: 0.2, recency: 0.2, vibe: 0.2, text: 0.2 },
      fallbackEval: { fittedOn: "all" },
      prior: { guests: true },
    });

    assert.deepEqual(store.mixForJob("push"), localMix);
    assert.equal(store.mixSource("push"), "job");
    assert.equal(store.mixSource("soft"), "job");
    assert.deepEqual(store.mixForJob("soft"), softMix);
    assert.equal(store.mixForJob("soft").image, undefined);
    assert.deepEqual(store.evalForJob("soft"), { fittedOn: "all", at: 3 });
    assert.equal(store.mixSource("people"), "prior");
    assert.equal(store.mixForJob("people"), null);
    assert.deepEqual(store.mixForJob("guests"), fallback);
    assert.equal(store.mixSource("guests"), "fallback");

    const persisted = JSON.parse(localStorage.getItem(WEIGHTS_KEY));
    assert.equal(persisted.prior.people, true);
    assert.equal(persisted.prior.guests, undefined);
    assert.deepEqual(persisted.fallback, fallback);
    assert.equal(store.exportWeightsPayload().v, 3);
  });

  it("unions shown times by the later stamp and does not mark them as just shown", async () => {
    resetStorage();
    const store = await newStore();
    assert.equal(store.exportShownPayload(), null);

    const raw = JSON.stringify({ v: 1, shown: { "import-1": 500, "import-2": 100 } });
    memory.set(SHOWN_KEY, raw);
    store.loadShown();
    const same = store.importShownUnion({ v: 1, shown: { "import-1": 500 } });
    assert.equal(localStorage.getItem(SHOWN_KEY), raw);
    assert.equal(same["import-1"], 500);

    const now = Date.now();
    store.importShownUnion({
      v: 1,
      shown: { "import-1": 200, "import-2": 800, "import-9": 10, bad: "no", "": 4 },
    });
    assert.equal(store.shown()["import-1"], 500);
    assert.equal(store.shown()["import-2"], 800);
    assert.equal(store.shown()["import-9"], 10);
    assert.equal(store.shown().bad, undefined);
    assert.ok(store.shown()["import-1"] < now);
    assert.equal(store.exportShownPayload().shown["import-2"], 800);

    store.importShownUnion({ v: 2, shown: { "import-1": 99999 } });
    assert.equal(store.shown()["import-1"], 500);
  });
});
