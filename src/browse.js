function rowId(row) {
  if (!row) return "";
  if (typeof row === "string") return row;
  if (row.shard?.id) return row.shard.id;
  return row.id || "";
}

export function rankIds(ranking) {
  if (!Array.isArray(ranking)) return [];
  return ranking.map(rowId).filter(Boolean);
}

// Where this letter sits in the ranked pool. "3 of 12".
export function rankPlace(ranking, shardId) {
  const ids = rankIds(ranking);
  const total = ids.length;
  const index = shardId ? ids.indexOf(shardId) : -1;
  if (!total || index < 0) {
    return { index: -1, place: 0, total, label: "" };
  }
  return { index, place: index + 1, total, label: `${index + 1} of ${total}` };
}

// Step through ranked order. Ends do not wrap — the pool has a first and a last.
export function stepRank(ranking, shardId, delta) {
  if (!delta) return null;
  const ids = rankIds(ranking);
  const index = ids.indexOf(shardId);
  if (index < 0) return null;
  const next = index + delta;
  if (next < 0 || next >= ids.length) return null;
  return { index: next, id: ids[next] };
}
