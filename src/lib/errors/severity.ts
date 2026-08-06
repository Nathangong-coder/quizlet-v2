import type { Corruption } from '@/lib/quiz/options';

/**
 * How deep a misunderstanding each corruption implies, 1-5.
 *
 * Ranked by what picking it reveals: a conflation or inversion means the
 * concept is misfiled or runs backwards in the learner's model, while a
 * factual_error is a retrieval slip on an otherwise-sound idea.
 *
 * Kept even though `severityFromCorruption` (the function that consumed it
 * directly) is gone: `tests/errors/bands.test.ts` imports this constant to
 * prove `resolveSeverity` reproduces these exact ceilings at
 * `MC_TF_MAGNITUDE` — the only proof that the band model is a no-op on
 * existing MC/TF quiz data rather than silently rescoring it.
 */
export const CORRUPTION_SEVERITY: Record<Corruption, number> = {
  conflation: 5,
  inversion: 5,
  misapplication: 4,
  overgeneralization: 3,
  factual_error: 2,
};
