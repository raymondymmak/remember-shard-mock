function rowId(row) {
  if (!row) return "";
  if (typeof row === "string") return row;
  if (row.shard?.id) return row.shard.id;
  return row.id || "";
}

export function ordinal(n) {
  const mod = n % 100;
  if (mod >= 11 && mod <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// One place, one pool size. The letter line and the why panel both read this,
// so "4th of 13" and "placing 1st" cannot come from two rankings.
export function describePlacement(index, total) {
  if (!Number.isInteger(index) || index < 0) return null;
  if (!Number.isInteger(total) || total < 1 || index >= total) return null;
  const place = index + 1;
  const word = ordinal(place);
  return {
    index,
    place,
    total,
    ordinal: word,
    ofLabel: `${place} of ${total}`,
    letter: `ranked ${word} of ${total}`,
    teach: `scored among ${total}, placing ${word}`,
  };
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
  const copy = describePlacement(index, total);
  if (!copy) {
    return { index: -1, place: 0, total, label: "", ordinal: "", letter: "", teach: "" };
  }
  return { ...copy, label: copy.ofLabel };
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
