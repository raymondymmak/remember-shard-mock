const KEY = "remember.feedback.v0";
const WEIGHTS_KEY = "remember.weights.v0";
const LOG_CAP = 200;

// Shown-recently stays in this tab so a reload can teach feedback, not freshness.
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
  const log = load();
  log.push({ shardId, job, action, timestamp, scores });
  return save(log);
}

export function markShown(shardId, timestamp = Date.now()) {
  shownAt.set(shardId, timestamp);
}

export function log() {
  return load();
}

export function shown() {
  return Object.fromEntries(shownAt);
}

export function loadWeights() {
  if (!canUseStorage()) return globalThis.__rememberWeights ?? null;
  try {
    const raw = localStorage.getItem(WEIGHTS_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") return null;
    return data;
  } catch {
    return null;
  }
}

export function saveWeights(weights) {
  if (!canUseStorage()) {
    globalThis.__rememberWeights = weights;
    return weights;
  }
  try {
    localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
  } catch {
    // ignore quota / private mode
  }
  return weights;
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
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}
