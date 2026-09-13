// Supervised learning, tiny on purpose.
// We already have a hand-written mix (the prior). Marks in the log are labels.
// This file fits a linear model: P(keep) from the score parts we stored.

import { MIX_KEYS, WEIGHTS } from "./ranker.js";

// Start from the v0 mix. vibe / text are 0 until the data asks for them.
export const PRIOR = Object.fromEntries(MIX_KEYS.map((key) => [key, WEIGHTS[key]]));

const MIN_KEEP = 2;
const MIN_NAH = 2;

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

// Logistic regression with a short gradient-descent loop.
// Loss: "how surprised are we by keep vs nah?" plus a tug back toward the prior
// so a handful of marks cannot throw away the hand-written mix.
export function fit(
  log,
  { steps = 500, lr = 0.4, l2 = 0.12, prior = PRIOR } = {},
) {
  const examples = examplesFromLog(log);
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
