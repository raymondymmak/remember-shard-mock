// Tiny retrieve → rank loop. Not a neural net.
// We score every shard for the current job, then the letter is whoever wins.

export const EMBED_DIM = 48;

// How the final score is mixed. Job closeness does most of the work.
// vibe / text start at 0 — they already live inside `job`. Training may
// give them their own voice later.
export const WEIGHTS = {
  job: 0.58,
  freshness: 0.14,
  recency: 0.08,
  vibe: 0,
  text: 0,
  feedback: 0.2,
};

export const MIX_KEYS = ["job", "freshness", "recency", "vibe", "text"];

export function mixWeights(learned) {
  return {
    ...WEIGHTS,
    ...(learned && typeof learned === "object" ? learned : {}),
    feedback: WEIGHTS.feedback,
  };
}

// Inside "job closeness": the hand-authored vibe vs the words in the note.
const VIBE_SHARE = 0.72;
const TEXT_SHARE = 0.28;

const STOP = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "the",
  "this",
  "that",
  "to",
  "was",
  "we",
  "you",
  "your",
]);

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9']+/g)
    ?.filter((token) => token.length > 1 && !STOP.has(token)) ?? [];
}

// djb2 — just a way to scatter words into EMBED_DIM buckets.
function hashToken(token) {
  let h = 5381;
  for (let i = 0; i < token.length; i += 1) {
    h = (h * 33) ^ token.charCodeAt(i);
  }
  return Math.abs(h) % EMBED_DIM;
}

// Hashed term-frequency vector, then L2-normalized so cosine is well-behaved.
export function embedText(text) {
  const vec = new Array(EMBED_DIM).fill(0);
  const tokens = tokenize(text);
  if (!tokens.length) return vec;

  for (const token of tokens) {
    vec[hashToken(token)] += 1;
  }

  const norm = Math.hypot(...vec) || 1;
  return vec.map((n) => n / norm);
}

// Cosine similarity: 1 means same direction, 0 means unrelated, -1 opposite.
export function cosine(a, b) {
  if (!a?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function prepareJobs(jobs) {
  return jobs.map((job) => ({
    ...job,
    textVec: embedText(`${job.label} ${job.hint} ${job.query}`),
  }));
}

export function prepareShards(shards) {
  return shards.map((shard) => ({
    ...shard,
    textVec: embedText(`${shard.note} ${shard.why}`),
  }));
}

// Newer memories get a small lift. Optional on purpose — this is not On This Day.
export function recencyScore(dateIso, now) {
  const then = new Date(`${dateIso}T12:00:00`).getTime();
  if (Number.isNaN(then)) return 0.5;
  const years = Math.max(0, (now - then) / (365.25 * 24 * 60 * 60 * 1000));
  return 1 / (1 + years);
}

// 1 if we haven't shown it in a while, 0 if we just did.
export function freshnessScore(lastShownAt, now) {
  if (!lastShownAt) return 1;
  const hours = Math.max(0, (now - lastShownAt) / (60 * 60 * 1000));
  return 1 - Math.exp(-hours / 8);
}

export function feedbackMarks(log, shardId, jobId) {
  let marks = 0;
  for (const event of log) {
    if (event.shardId !== shardId || event.job !== jobId) continue;
    if (event.action === "keep") marks += 1;
    else if (event.action === "nah") marks -= 1.2;
    else if (event.action === "another") marks -= 0.25;
  }
  return marks;
}

// tanh keeps a few marks meaningful without letting one shard run away.
export function feedbackScore(log, shardId, jobId) {
  return Math.tanh(feedbackMarks(log, shardId, jobId));
}

export function explainShard(shard, { job, now, shown, log, weights = WEIGHTS }) {
  const vibe = cosine(shard.vibe, job.vibe);
  const text = cosine(shard.textVec, job.textVec);
  const jobSim = VIBE_SHARE * vibe + TEXT_SHARE * text;
  const freshness = freshnessScore(shown[shard.id], now);
  const recency = recencyScore(shard.date, now);
  const feedback = feedbackScore(log, shard.id, job.id);
  const w = mixWeights(weights);

  const parts = { job: jobSim, freshness, recency, feedback };
  const total =
    w.job * parts.job +
    w.freshness * parts.freshness +
    w.recency * parts.recency +
    w.vibe * vibe +
    w.text * text +
    w.feedback * parts.feedback;

  return { total, parts, vibe, text };
}

export function rankShards({
  shards,
  job,
  now = Date.now(),
  shown = {},
  log = [],
  excludeIds = [],
  weights = WEIGHTS,
}) {
  const skip = new Set(excludeIds);
  const ctx = { job, now, shown, log, weights };

  return shards
    .filter((shard) => !skip.has(shard.id))
    .map((shard) => ({ shard, ...explainShard(shard, ctx) }))
    .sort((a, b) => b.total - a.total || a.shard.id.localeCompare(b.shard.id));
}
