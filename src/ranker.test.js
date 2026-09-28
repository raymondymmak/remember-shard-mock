import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import {
  cosine,
  embedText,
  feedbackScore,
  prepareJobs,
  prepareShards,
  rankShards,
} from "./ranker.js";

const jobs = prepareJobs(JOBS);
const shards = prepareShards(SHARDS);

function job(id) {
  return jobs.find((item) => item.id === id);
}

describe("representations", () => {
  it("cosine is 1 for the same vector and ~0 for opposite vibes", () => {
    assert.equal(cosine([1, 0, 0], [1, 0, 0]), 1);
    assert.ok(Math.abs(cosine([1, 0, 0], [0, 1, 0])) < 1e-9);
  });

  it("hashed embeddings are stable and prefer overlapping words", () => {
    const a = embedText("keep going when the day feels heavy");
    const b = embedText("keep going when the day feels heavy");
    const c = embedText("quiet rain and ordinary sunday light");
    assert.ok(cosine(a, b) > 0.99);
    assert.ok(cosine(a, a) > cosine(a, c));
  });
});

describe("retrieve then rank", () => {
  it("each job's winner comes from scores over the full pool", () => {
    const push = rankShards({ shards, job: job("push") });
    const soft = rankShards({ shards, job: job("soft") });
    const people = rankShards({ shards, job: job("people") });

    assert.equal(push.length, SHARDS.length);
    assert.equal(soft.length, SHARDS.length);
    assert.equal(people.length, SHARDS.length);

    assert.match(push[0].shard.id, /^push-/);
    assert.match(soft[0].shard.id, /^soft-/);
    assert.match(people[0].shard.id, /^people-/);

    assert.ok(push[0].total > push[push.length - 1].total);
    assert.notEqual(push[0].shard.id, soft[0].shard.id);
  });

  it("another walks the next unused candidate, not a shuffle", () => {
    const first = rankShards({ shards, job: job("push") });
    const second = rankShards({
      shards,
      job: job("push"),
      excludeIds: [first[0].shard.id],
    });
    assert.equal(second[0].shard.id, first[1].shard.id);
    assert.notEqual(second[0].shard.id, first[0].shard.id);
  });

  it("keep boosts and nah demotes that shard for that job", () => {
    const winner = rankShards({ shards, job: job("push") })[0].shard;
    const kept = rankShards({
      shards,
      job: job("push"),
      log: [{ shardId: winner.id, job: "push", action: "keep" }],
    });
    const nixed = rankShards({
      shards,
      job: job("push"),
      log: [
        { shardId: winner.id, job: "push", action: "nah" },
        { shardId: winner.id, job: "push", action: "nah" },
      ],
    });

    assert.ok(kept[0].parts.feedback > 0);
    assert.equal(kept[0].shard.id, winner.id);
    assert.ok(nixed.find((row) => row.shard.id === winner.id).total < kept[0].total);
    assert.notEqual(nixed[0].shard.id, winner.id);
  });

  it("feedback is per job", () => {
    const softWinner = rankShards({ shards, job: job("soft") })[0].shard;
    const score = feedbackScore(
      [{ shardId: softWinner.id, job: "soft", action: "keep" }],
      softWinner.id,
      "push",
    );
    assert.equal(score, 0);
  });
});
