/**
 * Which INSTRUMENT produced a QuizAnswer's analysis rows. Bumped on any change
 * to the content prompt, the expression prompt, the span resolver, or the
 * metrics code — a lexicon edit changes numbers without touching a prompt.
 * `ANALYSIS_VERSION` (persist.ts) describes the CONTRACT (what rows exist);
 * this describes the grader. Both persist on QuizAnswer.
 */
export const GRADER_VERSION = 1
