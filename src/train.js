// Supervised learning, tiny on purpose.
// We already have a hand-written mix (the prior). Marks in the log are labels.
// This file fits a linear model: P(keep) from the score parts we stored.
// After a fit we also hide some marks as a quiz — train vs test.
// Each job fits its own logistic. Marks for other jobs are not examples.

import { MIX_KEYS, WEIGHTS } from "./ranker.js";

// Start from the v0 mix. vibe / text are 0 until the data asks for them.
export const PRIOR = Object.fromEntries(MIX_KEYS.map((key) => [key, WEIGHTS[key]]));

export const MIN_KEEP = 2;
export const MIN_NAH = 2;
export const MIN_HOLDOUT = 2;

function sigmoid(z) {
  if (z > 20) return 1;
  if (z < -20) return 0;
  return 1 / (1 + Math.exp(-z));
}

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

function vectorFromScores(scores) {
  return MIX_KEYS.map((key) => {
    const n = Number(scores?.[key]);
    return Number.isFinite(n) ? n : 0;
  });
}

function clampP(p) {
  return Math.min(1 - 1e-9, Math.max(1e-9, p));
}

function bothClasses(examples) {
  return examples.some((row) => row.y === 1) && examples.some((row) => row.y === 0);
}

// "another" is ignored. keep / nah are clean yes / no labels;
// another is "not this, maybe later" — too mushy for a binary teacher.
export function examplesFromLog(log) {
  const examples = [];
  for (const event of log) {
    if (event.action !== "keep" && event.action !== "nah") continue;
    if (!event.scores || typeof event.scores !== "object") continue;
    examples.push({
      x: vectorFromScores(event.scores),
      y: event.action === "keep" ? 1 : 0,
    });
  }
  return examples;
}

export function inspectLog(log) {
  const examples = examplesFromLog(log);
  const keeps = examples.filter((row) => row.y === 1).length;
  const nahs = examples.filter((row) => row.y === 0).length;
  const ok = keeps >= MIN_KEEP && nahs >= MIN_NAH;
  return {
    ok,
    keeps,
    nahs,
    reason: ok
      ? ""
      : "Need a couple of keep and nah marks first — both kinds, so the model can tell them apart.",
  };
}

// Newest ~30% of labeled marks are the quiz. A time split matches how a
// founder actually marks (later marks are "the future"). We don't take
// every k-th: with a short log that can hide only one example, and we'd
// be tempted to invent a score. If the holdout is smaller than
// MIN_HOLDOUT, we refuse the quiz instead of faking one.
export function splitExamples(examples) {
  const n = examples.length;
  const holdoutN = Math.floor(n * 0.3);
  if (holdoutN < MIN_HOLDOUT) {
    return { train: examples, holdout: [], ready: false };
  }
  return {
    train: examples.slice(0, n - holdoutN),
    holdout: examples.slice(n - holdoutN),
    ready: true,
  };
}

export function predictP(weights, x) {
  const w = MIX_KEYS.map((key) => weights[key] ?? 0);
  return sigmoid(dot(w, x));
}

export function scoreMix(weights, examples) {
  if (!examples.length) return null;
  let logLoss = 0;
  let correct = 0;
  for (const { x, y } of examples) {
    const p = clampP(predictP(weights, x));
    logLoss += -(y * Math.log(p) + (1 - y) * Math.log(1 - p));
    if ((p >= 0.5 ? 1 : 0) === y) correct += 1;
  }
  return {
    n: examples.length,
    correct,
    accuracy: correct / examples.length,
    logLoss: logLoss / examples.length,
  };
}

// Logistic regression with a short gradient-descent loop.
// Loss: "how surprised are we by keep vs nah?" plus a tug back toward the prior
// so a handful of marks cannot throw away the hand-written mix.
export function fitExamples(
  examples,
  { steps = 500, lr = 0.4, l2 = 0.12, prior = PRIOR } = {},
) {
  const w = MIX_KEYS.map((key) => prior[key] ?? 0);
  const w0 = MIX_KEYS.map((key) => prior[key] ?? 0);
  if (!examples.length) return Object.fromEntries(MIX_KEYS.map((key, i) => [key, w[i]]));

  for (let step = 0; step < steps; step += 1) {
    const grad = new Array(w.length).fill(0);
    for (const { x, y } of examples) {
      const err = sigmoid(dot(w, x)) - y;
      for (let i = 0; i < w.length; i += 1) {
        grad[i] += err * x[i];
      }
    }
    const n = examples.length;
    for (let i = 0; i < w.length; i += 1) {
      w[i] -= lr * (grad[i] / n + l2 * (w[i] - w0[i]));
    }
  }

  return Object.fromEntries(MIX_KEYS.map((key, i) => [key, w[i]]));
}

export function fit(log, opts) {
  return fitExamples(examplesFromLog(log), opts);
}

// Keep / nah for this job only. A mark on another job is not an example.
export function eventsForJob(log, jobId) {
  if (typeof jobId !== "string" || !jobId || !Array.isArray(log)) return [];
  return log.filter((event) => event && event.job === jobId);
}

// Cold until this job has enough of its own keeps and nahs. The caller
// then keeps the hand-written prior. Other jobs' marks do not count.
export function learnForJob(log, jobId, opts) {
  const scoped = eventsForJob(log, jobId);
  const check = inspectLog(scoped);
  if (!check.ok) {
    return {
      ok: false,
      jobId: typeof jobId === "string" ? jobId : null,
      keeps: check.keeps,
      nahs: check.nahs,
      reason:
        "Need a couple of keep and nah marks on this job first — both kinds, so the model can tell them apart.",
      weights: null,
      report: null,
    };
  }
  const { weights, report } = learnAndEvaluate(scoped, opts);
  return {
    ok: true,
    jobId,
    keeps: check.keeps,
    nahs: check.nahs,
    reason: "",
    weights,
    report,
  };
}

// Short line for the why panel. source is "job", "fallback", or "prior".
export function jobLearnCopy(label, source) {
  const name = String(label || "This job").trim() || "This job";
  if (source === "job") {
    return `${name} only. Default on the left, learned on the right.`;
  }
  if (source === "fallback") {
    return `${name} is still on your earlier shared mix. Learning here changes only this job.`;
  }
  return `${name} uses the hand-written mix until this job has a few keeps and nahs of its own.`;
}

// Fit only on the train split when the holdout is big enough and still
// leaves both classes in train. Otherwise fit on everything and skip
// the quiz numbers — we do not invent a holdout score.
export function learnAndEvaluate(log, opts) {
  const examples = examplesFromLog(log);
  const split = splitExamples(examples);
  let train = split.train;
  let holdout = split.holdout;
  let holdoutReady = split.ready && bothClasses(split.train);

  if (split.ready && !bothClasses(split.train)) {
    holdoutReady = false;
    holdout = [];
    train = examples;
  }
  if (!holdoutReady) {
    train = examples;
    holdout = [];
  }

  const weights = fitExamples(train, opts);
  return {
    weights,
    report: {
      fittedOn: holdoutReady ? "train" : "all",
      train: {
        n: train.length,
        default: scoreMix(PRIOR, train),
        learned: scoreMix(weights, train),
      },
      holdout: holdoutReady
        ? {
            n: holdout.length,
            default: scoreMix(PRIOR, holdout),
            learned: scoreMix(weights, holdout),
          }
        : null,
    },
  };
}

export function explainEval(report) {
  if (!report?.train) return [];
  const lines = [];
  const t = report.train;
  lines.push(
    `On the marks it studied, the learned mix was right on ${t.learned.correct}/${t.n}; default was ${t.default.correct}/${t.n}.`,
  );

  if (!report.holdout) {
    lines.push(
      "Need a few more keep and nah marks before we can hide some as a test. We don’t invent a score.",
    );
    return lines;
  }

  const h = report.holdout;
  let hidden = `On ${h.n} we hid, learned was right on ${h.learned.correct}/${h.n}; default was ${h.default.correct}/${h.n}.`;
  if (h.learned.accuracy < h.default.accuracy) {
    hidden +=
      " Worse than the default — that’s overfitting: the mix fit the marks it studied more than the ones we hid.";
  }
  lines.push(hidden);
  lines.push(
    `Surprise on the hidden marks (lower is better): learned ${h.learned.logLoss.toFixed(2)}, default ${h.default.logLoss.toFixed(2)}.`,
  );
  return lines;
}
