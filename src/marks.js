// Like and dislike follow the latest mark for this shard and this job.
// Like fills on "keep", dislike fills on "nah". "another" fills neither,
// even when an earlier keep or nah still sits in the log and still scores.

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
