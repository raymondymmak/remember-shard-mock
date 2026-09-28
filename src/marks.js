// Like and dislike follow the latest mark for this shard and this job.
// Like fills on "keep", dislike fills on "nah". Any other latest action
// (an older skip still in the log) fills neither.
//
// The two marks are one state: like, dislike, or unmarked. Placing one
// removes the other for that shard and job. Undoing the mark that is
// showing clears both, so a dislike that was replaced by like cannot
// come back.

export function latestAction(log, shardId, jobId) {
  if (!shardId || !jobId || !Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i];
    if (event?.shardId === shardId && event?.job === jobId) return event.action ?? null;
  }
  return null;
}

export function isKept(log, shardId, jobId) {
  return latestAction(log, shardId, jobId) === "keep";
}

export function isNixed(log, shardId, jobId) {
  return latestAction(log, shardId, jobId) === "nah";
}

// What the letter should paint. Like and dislike are the keep and nah marks.
export function markFace(log, shardId, jobId) {
  return {
    like: isKept(log, shardId, jobId),
    dislike: isNixed(log, shardId, jobId),
  };
}

// Drop the trailing run of one action for this pair so one tap clears the
// fill. A double-recorded mark (the old sticky race) clears in the same tap.
// Marks for other shards or jobs stay put.
function withoutTrailing(log, shardId, jobId, action) {
  if (!Array.isArray(log) || !shardId || !jobId) return Array.isArray(log) ? log : [];
  const drop = new Set();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i];
    if (event?.shardId !== shardId || event?.job !== jobId) continue;
    if (event.action !== action) break;
    drop.add(i);
  }
  if (!drop.size) return log;
  return log.filter((_, i) => !drop.has(i));
}

export function withoutLatestKeep(log, shardId, jobId) {
  return withoutTrailing(log, shardId, jobId, "keep");
}

export function withoutLatestNah(log, shardId, jobId) {
  return withoutTrailing(log, shardId, jobId, "nah");
}

// Drop every keep and nah for this shard and job. Other shards, other jobs,
// and an older skip stay put.
export function withoutPairMarks(log, shardId, jobId) {
  if (!Array.isArray(log) || !shardId || !jobId) return Array.isArray(log) ? log : [];
  let changed = false;
  const next = [];
  for (const event of log) {
    const mine = event?.shardId === shardId && event?.job === jobId;
    if (mine && (event.action === "keep" || event.action === "nah")) {
      changed = true;
      continue;
    }
    next.push(event);
  }
  return changed ? next : log;
}

// The letter's mark. keep replaces nah, and nah replaces keep.
export function placeMark(log, event) {
  const base = withoutPairMarks(Array.isArray(log) ? log : [], event?.shardId, event?.job);
  const next = base === log ? (Array.isArray(log) ? log.slice() : []) : base.slice();
  if (event) next.push(event);
  return next;
}

// Second tap on the filled like. Clears that keep and any nah still under it.
export function undoActiveKeep(log, shardId, jobId) {
  if (!isKept(log, shardId, jobId)) return Array.isArray(log) ? log : [];
  return withoutPairMarks(log, shardId, jobId);
}

// Second tap on the filled dislike. Clears that nah and any keep still under it.
export function undoActiveNah(log, shardId, jobId) {
  if (!isNixed(log, shardId, jobId)) return Array.isArray(log) ? log : [];
  return withoutPairMarks(log, shardId, jobId);
}
