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
 *  3 — 2026-09-18 (evening): grade-short-answer v7 — the SUBSTANCE FLOOR in
 *      the shared strict block (a gestured-at point is `incomplete`, a
 *      compound point needs both halves, an implied opposite is
 *      `contradicted`) and the mechanical communication checklist
 *      (`src/lib/analysis/rubric.ts`, RUBRIC_VERSION 1) scored in TS.
 */
export const GRADER_VERSION = 3
