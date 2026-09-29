// Like and dislike follow the latest mark for this shard and this job.
// Like fills on "like", dislike fills on "dislike". A log already on this
// device may still say "keep" and "nah"; those are the same two marks.
// Any other latest action (an older skip still in the log) fills neither.
//
// The two marks are one state: like, dislike, or unmarked. Placing one
// removes the other for that shard and job. Undoing the mark that is
// showing clears both, so a dislike that was replaced by like cannot
// come back.

export function isLikeAction(action) {
  return action === "like" || action === "keep";
}

export function isDislikeAction(action) {
  return action === "dislike" || action === "nah";
}

export function isMarkAction(action) {
  return isLikeAction(action) || isDislikeAction(action);
}

// New rows say like / dislike. Older rows may still say keep / nah.
export function canonicalMark(action) {
  if (isLikeAction(action)) return "like";
  if (isDislikeAction(action)) return "dislike";
  return action;
}

function markFamily(action) {
  if (isLikeAction(action)) return "like";
  if (isDislikeAction(action)) return "dislike";
  return action ?? null;
}

export function latestAction(log, shardId, jobId) {
  if (!shardId || !jobId || !Array.isArray(log)) return null;
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i];
    if (event?.shardId === shardId && event?.job === jobId) return event.action ?? null;
  }
  return null;
}

export function isKept(log, shardId, jobId) {
  return isLikeAction(latestAction(log, shardId, jobId));
}

export function isNixed(log, shardId, jobId) {
  return isDislikeAction(latestAction(log, shardId, jobId));
}

// What the letter should paint.
export function markFace(log, shardId, jobId) {
  return {
    like: isKept(log, shardId, jobId),
    dislike: isNixed(log, shardId, jobId),
  };
}

// Drop the trailing run of one mark for this pair so one tap clears the
// fill. A double-recorded mark (the old sticky race) clears in the same tap,
// including a run that mixes the older word with the current one.
// Marks for other shards or jobs stay put.
function withoutTrailing(log, shardId, jobId, action) {
  if (!Array.isArray(log) || !shardId || !jobId) return Array.isArray(log) ? log : [];
  const family = markFamily(action);
  const drop = new Set();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i];
    if (event?.shardId !== shardId || event?.job !== jobId) continue;
    if (markFamily(event.action) !== family) break;
    drop.add(i);
  }
  if (!drop.size) return log;
  return log.filter((_, i) => !drop.has(i));
}

export function withoutLatestKeep(log, shardId, jobId) {
  return withoutTrailing(log, shardId, jobId, "like");
}

export function withoutLatestNah(log, shardId, jobId) {
  return withoutTrailing(log, shardId, jobId, "dislike");
}

// Drop every like and dislike for this shard and job. Other shards, other
// jobs, and an older skip stay put.
export function withoutPairMarks(log, shardId, jobId) {
  if (!Array.isArray(log) || !shardId || !jobId) return Array.isArray(log) ? log : [];
  let changed = false;
  const next = [];
  for (const event of log) {
    const mine = event?.shardId === shardId && event?.job === jobId;
    if (mine && isMarkAction(event.action)) {
      changed = true;
      continue;
    }
    next.push(event);
  }
  return changed ? next : log;
}

// The letter's mark. A like replaces a dislike, and a dislike replaces a like.
export function placeMark(log, event) {
  const base = withoutPairMarks(Array.isArray(log) ? log : [], event?.shardId, event?.job);
  const next = base === log ? (Array.isArray(log) ? log.slice() : []) : base.slice();
  if (event) next.push(event);
  return next;
}

// Second tap on the filled like. Clears that like and any dislike still under it.
export function undoActiveKeep(log, shardId, jobId) {
  if (!isKept(log, shardId, jobId)) return Array.isArray(log) ? log : [];
  return withoutPairMarks(log, shardId, jobId);
}

// Second tap on the filled dislike. Clears that dislike and any like still under it.
export function undoActiveNah(log, shardId, jobId) {
  if (!isNixed(log, shardId, jobId)) return Array.isArray(log) ? log : [];
  return withoutPairMarks(log, shardId, jobId);
}
