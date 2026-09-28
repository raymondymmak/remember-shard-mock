import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { prepareJobs, prepareShards, rankShards } from "./ranker.js";

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

let session = 0;

function resetStorage() {
  memory.clear();
  delete globalThis.__rememberShown;
}

function newStore() {
  session += 1;
  return import(`./store.js?shown=${session}`);
}

describe("shown times", { concurrency: 1 }, () => {
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
});
