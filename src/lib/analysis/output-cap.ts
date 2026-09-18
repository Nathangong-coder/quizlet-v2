/**
 * The grading call's `maxOutputTokens` ceiling.
 *
 * THE CEILING IS FLUID, not a single constant: reasoning tokens are invisible
 * in the visible text (a diagnostic grading call once spent ~92% of its output
 * budget on reasoning) and the grader's output — one verdict per key point,
 * per relation, per form requirement, plus error tags and unwarranted claims —
 * grows with how many of those a card has. A fixed cap sized for a 4-KLP card
 * starves a 9-KLP one, and the SDK surfaces that starvation as
 * `NoObjectGeneratedError` with `finishReason: 'length'` — classified
 * `output_truncated` in `src/lib/errors/classify.ts`, NEVER `schema_invalid`:
 * a model that ran out of room is not a model that cannot follow a schema.
 *
 * `GRADE_TOKENS_BASE` covers the fixed cost (reasoning plus the rubric and
 * whole-answer fields); `GRADE_TOKENS_PER_ITEM` is the per-graded-item slope
 * (key points + relations + form requirements). Both are PROVISIONAL —
 * `scripts/probe-grade-tokens.ts` measures real output-token usage across a
 * sample of stored short-answer grades, fits the slope by least squares, and
 * prints the pair to set here at roughly 2x the observed p95. Until that probe
 * is run (it needs raw provider keys not available in every environment),
 * these are the controller-ruled placeholders 2048 / 600.
 */
export const GRADE_TOKENS_BASE = 2048
export const GRADE_TOKENS_PER_ITEM = 600

/** `maxOutputTokens` for a grading call whose prompt carries `itemCount` graded items. */
export function gradeMaxOutputTokens(itemCount: number): number {
  return GRADE_TOKENS_BASE + itemCount * GRADE_TOKENS_PER_ITEM
}
