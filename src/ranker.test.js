import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { fingerprintFromPixels } from "./image.js";
import {
  EMBED_DIM,
  MIX_KEYS,
  WEIGHTS,
  cosine,
  embedText,
  feedbackScore,
  jobDocument,
  prepareJobs,
  prepareShards,
  rankShards,
  shardDocument,
  withTextVectors,
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
    assert.equal(a.length, EMBED_DIM);
    assert.equal(b.length, EMBED_DIM);
    assert.ok(cosine(a, b) > 0.99);
    assert.ok(cosine(a, a) > cosine(a, c));
  });

  it("prepare uses the hash unless a caller passes another embedder", () => {
    const hashed = prepareShards(SHARDS);
    assert.deepEqual(hashed[0].textVec, embedText(shardDocument(SHARDS[0])));
    assert.equal(hashed[0].textVec.length, EMBED_DIM);

    const jobs = prepareJobs(JOBS, () => [1, 0, 0]);
    assert.deepEqual(jobs[0].textVec, [1, 0, 0]);
    assert.equal(jobs[0].textVec.length, 3);
  });
});

// A stand-in for the sentence model: shared ideas land on the same axis,
// even when the words do not match. The hash cannot see that.
function toyMeaning(text) {
  const t = String(text).toLowerCase();
  const axes = [
    ["push", "heavy", "keep going", "kept going", "anyway", "continued", "motivation"],
    ["rain", "quiet", "sunday", "gentle", "ordinary", "window"],
    ["friend", "dinner", "laugh", "names", "people", "together"],
  ];
  const vec = axes.map((words) => words.reduce((n, word) => n + (t.includes(word) ? 1 : 0), 0));
  vec.push(0.05);
  const norm = Math.hypot(...vec) || 1;
  return vec.map((n) => n / norm);
}

describe("sentence vectors", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const collision = {
    id: "collision",
    date: "2020-01-01",
    note: "I opened the door to finish.",
    why: "A small errand.",
    vibe: [0.5, 0.5, 0.5],
  };
  const paraphrase = {
    id: "paraphrase",
    date: "2020-01-01",
    note: "I continued anyway.",
    why: "It was hard, and I kept moving.",
    vibe: [0.5, 0.5, 0.5],
  };

  it("ranks a paraphrase above a keyword collision, and the hash does the opposite", () => {
    const semantic = withTextVectors(
      JOBS,
      [collision, paraphrase],
      JOBS.map((job) => toyMeaning(jobDocument(job))),
      [collision, paraphrase].map((shard) => toyMeaning(shardDocument(shard))),
      "semantic",
    );
    assert.equal(semantic.mode, "semantic");
    assert.equal(semantic.jobs[0].textVec.length, semantic.shards[0].textVec.length);
    assert.notEqual(semantic.shards[0].textVec.length, EMBED_DIM);

    const ranked = rankShards({
      shards: semantic.shards,
      job: semantic.jobs.find((job) => job.id === "push"),
      now,
    });
    assert.equal(ranked[0].shard.id, "paraphrase");
    assert.ok(ranked[0].text > ranked[1].text);
    assert.equal(typeof ranked[0].text, "number");
    assert.equal(typeof ranked[0].vibe, "number");
    assert.equal(typeof ranked[0].parts.job, "number");
    assert.equal(typeof ranked[0].parts.freshness, "number");
    assert.equal(typeof ranked[0].parts.recency, "number");
    assert.deepEqual(Object.keys(ranked[0].parts).sort(), [
      "feedback",
      "freshness",
      "image",
      "job",
      "recency",
    ]);
    assert.deepEqual(MIX_KEYS, ["job", "freshness", "recency", "vibe", "text"]);

    const hashed = withTextVectors(JOBS, [collision, paraphrase], null, null, "hash");
    assert.equal(hashed.mode, "hash");
    assert.equal(hashed.shards[0].textVec.length, EMBED_DIM);
    const hashRanked = rankShards({
      shards: hashed.shards,
      job: hashed.jobs.find((job) => job.id === "push"),
      now,
    });
    assert.equal(hashRanked[0].shard.id, "collision");
  });

  it("refuses to mix vector widths and keeps the hash", () => {
    const mixed = withTextVectors(JOBS, [collision], [[1, 0]], [[1, 0, 0]], "semantic");
    assert.equal(mixed.mode, "hash");
    assert.equal(mixed.jobs[0].textVec.length, EMBED_DIM);
    assert.equal(mixed.shards[0].textVec.length, EMBED_DIM);
    assert.equal(mixed.shards[0].note, collision.note);
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

function solid(r, g, b, n = 4) {
  const data = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i += 1) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return fingerprintFromPixels(data, n, n);
}

describe("photo feel", () => {
  const now = Date.parse("2026-09-28T12:00:00Z");
  const daylight = solid(214, 220, 228);
  const lamp = solid(120, 64, 36);

  function twins(feelA, feelB) {
    const seed = SHARDS.find((shard) => shard.id === "push-desk");
    return prepareShards([
      { ...seed, id: "outdoor", imageVec: feelA },
      { ...seed, id: "lamp", imageVec: feelB },
    ]);
  }

  it("nudges two otherwise identical letters toward the job's picture", () => {
    const onPush = rankShards({
      shards: twins(daylight, lamp),
      job: job("push"),
      now,
    });
    const onSoft = rankShards({
      shards: twins(daylight, lamp),
      job: job("soft"),
      now,
    });

    assert.equal(onPush[0].shard.id, "outdoor");
    assert.equal(onSoft[0].shard.id, "lamp");
    assert.ok(onPush[0].image > onPush[1].image);
    assert.ok(onSoft[0].image > onSoft[1].image);

    const gap = onPush[0].total - onPush[1].total;
    assert.ok(gap > 0.005 && gap < 0.1, `photo gap should be slight, was ${gap}`);
    assert.ok(Math.abs(gap - WEIGHTS.image * (onPush[0].image - onPush[1].image)) < 1e-9);
  });

  it("does not let the photograph overrule the job", () => {
    const pushSeed = SHARDS.find((shard) => shard.id === "push-ridge");
    const softSeed = SHARDS.find((shard) => shard.id === "soft-rain");
    const mixed = prepareShards([
      { ...pushSeed, imageVec: lamp },
      { ...softSeed, imageVec: daylight },
    ]);
    const onPush = rankShards({ shards: mixed, job: job("push"), now });
    assert.equal(onPush[0].shard.id, "push-ridge");
    assert.ok(onPush[0].image < onPush[1].image);
  });

  it("adds nothing when the shard has no fingerprint", () => {
    const row = rankShards({ shards, job: job("push"), now })[0];
    assert.equal(row.image, null);
    assert.equal(row.parts.image, null);
  });

  it("moves a close call when the photograph matches the job", () => {
    // Same shape the 16×16 read produces. push-run is dark and cool;
    // push-desk is brighter. soft-path is dim; soft-page is blown bright.
    const feel = {
      "push-run": [0.281, 0.275, 0.44, 0.46, 0.09, 0.01],
      "push-desk": [0.57, 0.483, 0.16, 0.25, 0.27, 0.32],
      "push-ridge": [0.485, 0.526, 0.14, 0.51, 0.09, 0.25],
      "push-water": [0.284, 0.32, 0.37, 0.57, 0.06, 0],
      "soft-coffee": [0.678, 0.534, 0.11, 0.08, 0.35, 0.46],
      "soft-rain": [0.436, 0.438, 0.14, 0.57, 0.17, 0.12],
      "soft-path": [0.266, 0.535, 0.49, 0.44, 0.07, 0],
      "soft-page": [0.8, 0.506, 0, 0.01, 0.18, 0.81],
      "people-dinner": [0.518, 0.534, 0.13, 0.31, 0.45, 0.11],
      "people-cafe": [0.409, 0.513, 0.11, 0.62, 0.27, 0],
      "people-table": [0.584, 0.526, 0, 0.29, 0.6, 0.11],
      "people-porch": [0.66, 0.551, 0.02, 0.25, 0.29, 0.45],
    };
    const felt = prepareShards(SHARDS.map((shard) => ({ ...shard, imageVec: feel[shard.id] })));
    const pushPlain = rankShards({ shards, job: job("push"), now });
    const pushFelt = rankShards({ shards: felt, job: job("push"), now });
    assert.equal(pushPlain[0].shard.id, "push-run");
    assert.equal(pushFelt[0].shard.id, "push-desk");
    assert.match(pushFelt[0].shard.id, /^push-/);

    const total = (rows, id) => rows.find((row) => row.shard.id === id).total;
    const softPlain = rankShards({ shards, job: job("soft"), now });
    const softFelt = rankShards({ shards: felt, job: job("soft"), now });
    const plainGap = total(softPlain, "soft-page") - total(softPlain, "soft-path");
    const feltGap = total(softFelt, "soft-page") - total(softFelt, "soft-path");
    assert.ok(feltGap > 0, "the dimmer frame nudges soft-path up, it does not take the letter");
    assert.ok(feltGap < plainGap);
    const path = softFelt.find((row) => row.shard.id === "soft-path");
    const page = softFelt.find((row) => row.shard.id === "soft-page");
    assert.ok(path.image > page.image);
  });
});
