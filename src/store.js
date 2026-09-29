import { canonicalMark, isMarkAction, placeMark, undoActiveKeep, undoActiveNah } from "./marks.js";
import { MIX_KEYS } from "./ranker.js";

const KEY = "remember.feedback.v0";
const WEIGHTS_KEY = "remember.weights.v0";
const LOG_CAP = 200;

// Last shown time per shard. Persisted so freshness still moves after a reload.
const SHOWN_KEY = "remember.shown.v0";
export const SHOWN_CAP = 400;
const shownAt = new Map();

function emptyLog() {
  return [];
}

function memoryFallback() {
  if (!globalThis.__rememberFeedback) {
    globalThis.__rememberFeedback = emptyLog();
  }
  return globalThis.__rememberFeedback;
}

function canUseStorage() {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

export function load() {
  if (!canUseStorage()) return memoryFallback();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyLog();
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    if (data && data.v === 1 && Array.isArray(data.log)) return data.log;
    return emptyLog();
  } catch {
    return emptyLog();
  }
}

function save(log) {
  const next = log.slice(-LOG_CAP);
  if (!canUseStorage()) {
    globalThis.__rememberFeedback = next;
    return next;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, log: next }));
  } catch {
    // Private mode / full storage — keep going with what we have.
  }
  return next;
}

export function recordFeedback({ shardId, job, action, scores, timestamp = Date.now() }) {
  const stored = canonicalMark(action);
  const event = { shardId, job, action: stored, timestamp, scores };
  const log = load();
  // Like and dislike replace each other. A skip, if one is still recorded, stays an append.
  const next = isMarkAction(stored) ? placeMark(log, event) : [...log, event];
  return save(next);
}

function undoTrailing(shardId, job, strip) {
  const log = load();
  const next = strip(log, shardId, job);
  if (next === log) return log;
  return save(next);
}

// Second tap on like. Clears that like, and any dislike it replaced,
// so the letter is unmarked. Other shards and jobs stay put.
export function undoKeep(shardId, job) {
  return undoTrailing(shardId, job, undoActiveKeep);
}

// Second tap on dislike. Same rule as undoKeep.
export function undoNah(shardId, job) {
  return undoTrailing(shardId, job, undoActiveNah);
}

function cappedShownEntries(pairs) {
  const clean = [];
  for (const [id, ts] of pairs) {
    if (typeof id !== "string" || !id) continue;
    if (typeof ts !== "number" || !Number.isFinite(ts)) continue;
    clean.push([id, ts]);
  }
  clean.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return clean.length > SHOWN_CAP ? clean.slice(-SHOWN_CAP) : clean;
}

function rememberShown(entries) {
  shownAt.clear();
  for (const [id, ts] of entries) shownAt.set(id, ts);
}

function readShownPayload() {
  if (!canUseStorage()) return globalThis.__rememberShown ?? null;
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

// Fill the in-memory map from storage. Call this before the first rank.
export function loadShown() {
  const data = readShownPayload();
  const record =
    data && data.v === 1 && data.shown && typeof data.shown === "object" && !Array.isArray(data.shown)
      ? data.shown
      : {};
  rememberShown(cappedShownEntries(Object.entries(record)));
  return shown();
}

export function saveShown() {
  const entries = cappedShownEntries(shownAt.entries());
  rememberShown(entries);
  const payload = { v: 1, shown: Object.fromEntries(entries) };
  if (!canUseStorage()) {
    globalThis.__rememberShown = payload;
    return payload;
  }
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify(payload));
  } catch {
    // Private mode / full storage — this tab still has the times.
  }
  return payload;
}

export function markShown(shardId, timestamp = Date.now()) {
  if (typeof shardId !== "string" || !shardId) return;
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return;
  shownAt.set(shardId, timestamp);
  saveShown();
}

export function log() {
  return load();
}

export function shown() {
  return Object.fromEntries(shownAt);
}

function readWeightsRecord() {
  if (!canUseStorage()) return globalThis.__rememberWeights ?? null;
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeWeightsRecord(payload) {
  if (!canUseStorage()) {
    globalThis.__rememberWeights = payload;
    return payload;
  }
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / private mode
  }
  return payload;
}

// A learned mix is only the trained parts. Feedback and image stay fixed.
function weightVector(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  if (!Number.isFinite(Number(obj.job))) return null;
  const mix = {};
  for (const key of MIX_KEYS) {
    const n = Number(obj[key]);
    if (Number.isFinite(n)) mix[key] = n;
  }
  return Object.keys(mix).length ? mix : null;
}

function blankModel() {
  return { v: 3, jobs: {}, fallback: null, fallbackEval: null, prior: {} };
}

function isPerJobModel(data) {
  return Boolean(
    data &&
      data.v === 3 &&
      data.jobs &&
      typeof data.jobs === "object" &&
      !Array.isArray(data.jobs),
  );
}

function evalOrNull(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeModel(data) {
  const model = blankModel();
  const rawJobs = data.jobs && typeof data.jobs === "object" ? data.jobs : {};
  for (const [id, entry] of Object.entries(rawJobs)) {
    if (typeof id !== "string" || !id) continue;
    const mix = weightVector(entry?.mix ?? entry);
    if (!mix) continue;
    model.jobs[id] = { mix, eval: evalOrNull(entry?.eval) };
  }
  const rawPrior = data.prior;
  if (rawPrior && typeof rawPrior === "object" && !Array.isArray(rawPrior)) {
    for (const [id, flag] of Object.entries(rawPrior)) {
      if (typeof id === "string" && id && flag) model.prior[id] = true;
    }
  }
  model.fallback = weightVector(data.fallback);
  model.fallbackEval = evalOrNull(data.fallbackEval);
  return model;
}

// Old saves were one flat mix: either { job, freshness, ... } or
// { v: 2, mix, eval }. Keep that mix as a shared fallback so a reload
// still ranks with it. Jobs learn their own mixes on top.
function migrateFlat(data) {
  const wrapped = weightVector(data.mix);
  const flat = wrapped || weightVector(data);
  if (!flat) return null;
  const model = blankModel();
  model.fallback = flat;
  model.fallbackEval = wrapped ? evalOrNull(data.eval) : null;
  return model;
}

// Read the per-job record. A flat v0 / v2 mix is rewritten once.
function readModel() {
  const data = readWeightsRecord();
  if (!data) return blankModel();
  if (isPerJobModel(data)) return normalizeModel(data);
  const migrated = migrateFlat(data);
  if (!migrated) return blankModel();
  writeWeightsRecord(migrated);
  return migrated;
}

function knownJob(jobId) {
  return typeof jobId === "string" && jobId ? jobId : "";
}

// "job" — this job has its own mix.
// "fallback" — still the older shared mix.
// "prior" — hand-written weights (never learned, or reset).
export function mixSource(jobId) {
  const id = knownJob(jobId);
  if (!id) return "prior";
  const model = readModel();
  if (model.jobs[id]) return "job";
  if (model.prior[id]) return "prior";
  if (model.fallback) return "fallback";
  return "prior";
}

export function mixForJob(jobId) {
  const id = knownJob(jobId);
  if (!id) return null;
  const model = readModel();
  if (model.jobs[id]) return model.jobs[id].mix;
  if (model.prior[id]) return null;
  return model.fallback;
}

export function evalForJob(jobId) {
  const id = knownJob(jobId);
  if (!id) return null;
  const model = readModel();
  if (model.jobs[id]) return model.jobs[id].eval;
  if (model.prior[id]) return null;
  return model.fallbackEval;
}

export function saveJobMix(jobId, weights, evalReport = null) {
  const id = knownJob(jobId);
  const mix = weightVector(weights);
  const model = readModel();
  if (!id || !mix) return model;
  model.jobs[id] = { mix, eval: evalOrNull(evalReport) };
  delete model.prior[id];
  return writeWeightsRecord(model);
}

// Clears this job only. An older shared mix stays for jobs not reset.
export function clearJobMix(jobId) {
  const id = knownJob(jobId);
  const model = readModel();
  if (!id) return model;
  delete model.jobs[id];
  model.prior[id] = true;
  return writeWeightsRecord(model);
}

export function clearWeights() {
  if (!canUseStorage()) {
    globalThis.__rememberWeights = null;
    return;
  }
  try {
    localStorage.removeItem(WEIGHTS_KEY);
  } catch {
    // ignore
  }
}

export function downloadLog() {
  const payload = JSON.stringify({ v: 1, log: load() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = "remember-marks.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
