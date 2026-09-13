import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { WEIGHTS, prepareJobs, prepareShards, rankShards } from "./ranker.js";
import { PRIOR, examplesFromLog, fit, inspectLog } from "./train.js";

function event(action, scores) {
  return { shardId: "x", job: "push", action, scores };
}

describe("supervised mix", () => {
  it("ignores another so keep / nah stay clean labels", () => {
    const log = [
      event("another", { job: 0.9, freshness: 1, recency: 0.2, vibe: 0.9, text: 0.4 }),
      event("keep", { job: 0.8, freshness: 1, recency: 0.2, vibe: 0.9, text: 0.4 }),
      event("nah", { job: 0.3, freshness: 1, recency: 0.9, vibe: 0.1, text: 0.2 }),
    ];
    const examples = examplesFromLog(log);
    assert.equal(examples.length, 2);
    assert.deepEqual(
      examples.map((row) => row.y),
      [1, 0],
    );
  });

  it("needs both keep and nah before it will fit", () => {
    const onlyKeep = inspectLog([
      event("keep", { job: 0.8, freshness: 1, recency: 0.2, vibe: 0.9, text: 0.4 }),
      event("keep", { job: 0.7, freshness: 1, recency: 0.2, vibe: 0.8, text: 0.3 }),
    ]);
    assert.equal(onlyKeep.ok, false);
  });

  it("after keep-on-high-vibe and nah-on-high-recency, vibe weight rises", () => {
    const log = [];
    for (let i = 0; i < 6; i += 1) {
      log.push(
        event("keep", {
          job: 0.72,
          freshness: 0.5,
          recency: 0.12,
          vibe: 0.96,
          text: 0.35,
        }),
      );
      log.push(
        event("nah", {
          job: 0.38,
          freshness: 0.5,
          recency: 0.94,
          vibe: 0.12,
          text: 0.35,
        }),
      );
    }

    const learned = fit(log);
    assert.ok(learned.vibe > PRIOR.vibe);
    assert.ok(learned.recency < PRIOR.recency);
  });

  it("a learned mix can change who wins", () => {
    const jobs = prepareJobs(JOBS);
    const shards = prepareShards(SHARDS);
    const job = jobs.find((item) => item.id === "push");
    const byVibe = rankShards({
      shards,
      job,
      weights: { ...WEIGHTS, job: 0.1, vibe: 2, recency: 0, freshness: 0, text: 0 },
    });
    const byRecency = rankShards({
      shards,
      job,
      weights: { ...WEIGHTS, job: 0.1, vibe: 0, recency: 2, freshness: 0, text: 0 },
    });
    assert.notEqual(byVibe[0].shard.id, byRecency[0].shard.id);
  });
});
