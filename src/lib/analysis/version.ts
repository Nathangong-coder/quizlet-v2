/**
 * Which INSTRUMENT produced a QuizAnswer's analysis rows. Bumped on any change
 * to the content prompt, the expression prompt, the span resolver, or the
 * metrics code — a lexicon edit changes numbers without touching a prompt.
 * `ANALYSIS_VERSION` (persist.ts) describes the CONTRACT (what rows exist);
 * this describes the grader. Both persist on QuizAnswer.
 */
/**
 * History:
 *  1 — Phase A as built (grade-short-answer v5).
 *  2 — 2026-09-18: grade-short-answer v6, ONE output schema on the KLP path
 *      and `klpResults` required (ShortAnswerGradeWithAnalysisSchema). Found
 *      by the first benchmark run: DeepSeek dropped the analysis section on a
 *      9-point card and the optional field let it parse as zero verdicts.
 */
export const GRADER_VERSION = 2
