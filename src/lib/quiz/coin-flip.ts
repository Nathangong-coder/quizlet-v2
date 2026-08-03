/**
 * Chooses whether a true/false question shows the card's real definition or a
 * KLP-corrupted one.
 *
 * `rng` is injectable so generation is deterministic in tests. The flip runs
 * SERVER-SIDE only: the client must never learn which variant it received.
 */
export function pickTfVariant(rng: () => number = Math.random): 'true' | 'false' {
  return rng() < 0.5 ? 'true' : 'false';
}
