const KEY = "remember.feedback.v0";
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
