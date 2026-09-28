// The keep button follows the latest mark for this shard and this job.
// "another" and "nah" are later marks, so the button reads "keep" again
// even though an earlier keep still sits in the log and still scores.

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

// Drop the trailing run of keep marks for this pair so one tap returns the
// label to "keep". A double-recorded keep (the old sticky race) clears in
// the same tap. Marks for other shards or jobs stay put.
export function withoutLatestKeep(log, shardId, jobId) {
  if (!Array.isArray(log) || !shardId || !jobId) return Array.isArray(log) ? log : [];
  const drop = new Set();
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const event = log[i];
    if (event?.shardId !== shardId || event?.job !== jobId) continue;
    if (event.action !== "keep") break;
    drop.add(i);
  }
  if (!drop.size) return log;
  return log.filter((_, i) => !drop.has(i));
}
