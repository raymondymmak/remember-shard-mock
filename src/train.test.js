import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { JOBS, SHARDS } from "./shards.js";
import { WEIGHTS, mixWeights, prepareJobs, prepareShards, rankShards } from "./ranker.js";
import {
  MIN_KEEP,
  MIN_NAH,
  PRIOR,
  eventsForJob,
  examplesFromLog,
  fit,
  inspectLog,
  jobLearnCopy,
  learnAndEvaluate,
  learnForJob,
  splitExamples,
} from "./train.js";

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

function keepHighVibe() {
  return event("keep", {
    job: 0.72,
    freshness: 0.5,
    recency: 0.12,
    vibe: 0.96,
    text: 0.35,
  });
}

function nahHighRecency() {
  return event("nah", {
    job: 0.38,
    freshness: 0.5,
    recency: 0.94,
    vibe: 0.12,
    text: 0.35,
  });
}

describe("train vs holdout", () => {
  it("does not invent a holdout score when the quiz set is too small", () => {
    const log = [keepHighVibe(), nahHighRecency(), keepHighVibe(), nahHighRecency()];
    const { report } = learnAndEvaluate(log);
    assert.equal(report.holdout, null);
    assert.equal(report.fittedOn, "all");
    assert.ok(report.train.n >= 4);
  });

  it("learned mix beats the prior on train, and fit ignores holdout labels", () => {
    const log = [];
    for (let i = 0; i < 7; i += 1) {
      log.push(keepHighVibe(), nahHighRecency());
    }
    // Newest ~30% flip the rule. A leak would drag vibe back down.
    for (let i = 0; i < 3; i += 1) {
      log.push(
        event("nah", {
          job: 0.72,
          freshness: 0.5,
          recency: 0.12,
          vibe: 0.96,
          text: 0.35,
        }),
        event("keep", {
          job: 0.38,
          freshness: 0.5,
          recency: 0.94,
          vibe: 0.12,
          text: 0.35,
        }),
      );
    }

    const examples = examplesFromLog(log);
    const split = splitExamples(examples);
    assert.equal(split.ready, true);
    assert.ok(split.holdout.length >= 2);
    assert.equal(split.train.length + split.holdout.length, examples.length);

    const { weights, report } = learnAndEvaluate(log);
    const leaked = fit(log);

    assert.equal(report.fittedOn, "train");
    assert.ok(report.holdout);
    assert.ok(report.train.learned.accuracy > report.train.default.accuracy);
    assert.ok(weights.vibe > PRIOR.vibe);
    assert.ok(
      weights.vibe > leaked.vibe,
      "holdout nahs-on-high-vibe must not be used in the fit",
    );
    assert.ok(report.holdout.learned.accuracy < report.train.learned.accuracy);
  });
});

const highVibe = {
  job: 0.72,
  freshness: 0.5,
  recency: 0.12,
  vibe: 0.96,
  text: 0.35,
};

const highRecency = {
  job: 0.38,
  freshness: 0.5,
  recency: 0.94,
  vibe: 0.12,
  text: 0.35,
};

function mark(job, action, scores) {
  return { shardId: `${job}-${action}`, job, action, scores };
}

describe("per-job mix", () => {
  it("marks on one job do not change the other job's mix", () => {
    const log = [];
    for (let i = 0; i < 6; i += 1) {
      log.push(mark("push", "keep", highVibe), mark("push", "nah", highRecency));
      log.push(mark("soft", "keep", highRecency), mark("soft", "nah", highVibe));
      log.push(mark("people", "keep", highVibe));
    }

    const push = learnForJob(log, "push");
    const soft = learnForJob(log, "soft");
    const people = learnForJob(log, "people");

    assert.equal(push.ok, true);
    assert.equal(soft.ok, true);
    assert.equal(people.ok, false);
    assert.equal(people.keeps, 6);
    assert.equal(people.nahs, 0);
    assert.equal(people.weights, null);
    assert.deepEqual(mixWeights(people.weights), WEIGHTS);

    assert.deepEqual(push.weights, learnForJob(eventsForJob(log, "push"), "push").weights);
    assert.deepEqual(soft.weights, learnForJob(eventsForJob(log, "soft"), "soft").weights);
    assert.notDeepEqual(push.weights, soft.weights);
    assert.ok(push.weights.vibe > PRIOR.vibe);
    assert.ok(push.weights.recency < PRIOR.recency);
    assert.ok(soft.weights.vibe < PRIOR.vibe);
    assert.ok(soft.weights.recency > PRIOR.recency);
    assert.equal(push.weights.feedback, undefined);
    assert.equal(push.weights.image, undefined);
    assert.equal(mixWeights(push.weights).feedback, WEIGHTS.feedback);
    assert.equal(mixWeights(push.weights).image, WEIGHTS.image);
    assert.notEqual(mixWeights(push.weights).vibe, mixWeights(soft.weights).vibe);
  });

  it("stays on the prior until this job has two keeps and two nahs of its own", () => {
    const log = [];
    for (let i = 0; i < 6; i += 1) {
      log.push(mark("soft", "keep", highVibe), mark("soft", "nah", highRecency));
    }
    log.push(
      mark("push", "keep", highVibe),
      mark("push", "keep", highVibe),
      mark("push", "nah", highRecency),
      mark("push", "another", highVibe),
    );

    const push = learnForJob(log, "push");
    assert.equal(push.ok, false);
    assert.equal(push.weights, null);
    assert.equal(push.keeps, 2);
    assert.equal(push.nahs, 1);
    assert.match(push.reason, /this job/);
    assert.deepEqual(mixWeights(push.weights), WEIGHTS);

    const soft = learnForJob(log, "soft");
    assert.equal(soft.ok, true);
    assert.ok(soft.weights.vibe > PRIOR.vibe);

    const readyLog = [...log, mark("push", "nah", highRecency)];
    const ready = learnForJob(readyLog, "push");
    assert.equal(ready.ok, true);
    assert.equal(ready.keeps, MIN_KEEP);
    assert.equal(ready.nahs, MIN_NAH);
    assert.ok(ready.weights.vibe > PRIOR.vibe);
    assert.deepEqual(learnForJob(readyLog, "soft").weights, soft.weights);
  });

  it("names the active job in the learn panel", () => {
    assert.match(jobLearnCopy("Need a push", "job"), /Need a push only/);
    assert.match(jobLearnCopy("Soft memory", "fallback"), /Soft memory is still on your earlier shared mix/);
    assert.match(jobLearnCopy("Soft memory", "fallback"), /only this job/);
    assert.match(jobLearnCopy("Prep for people & names", "prior"), /Prep for people & names/);
    assert.match(jobLearnCopy("Prep for people & names", "prior"), /hand-written mix/);
  });
});
