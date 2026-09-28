// Once a real shard is in the library, ranking should feel like the user's.
// Samples stay on disk; this only decides whether they are in the pool.

export const EMPTY_POOL_INVITE =
  "Take a photo, choose one, or drop it here. A note if you want.";

export function poolFace({ ownCount = 0, includeSamples = true } = {}) {
  const own = ownCount > 0;
  let cue = "Ranking my shards.";
  if (includeSamples) {
    cue = own ? "Ranking the samples with yours." : "Ranking the samples.";
  }
  return {
    invite: own ? "" : EMPTY_POOL_INVITE,
    cue,
  };
}

// The first shard that actually lands steps the demo library out.
// A later import leaves the toggle where the user put it.
export function samplesAsideAfterIntake({ ownBefore = 0, added = 0 } = {}) {
  return ownBefore === 0 && added > 0;
}
