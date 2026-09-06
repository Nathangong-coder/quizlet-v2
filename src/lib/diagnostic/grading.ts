import type { DiagnosticGradeSet } from '@/lib/ai/schemas'

type Grade = DiagnosticGradeSet['grades'][number]

/**
 * An answer with nothing in it. Whitespace counts as nothing.
 *
 * This is the ONE thing about a diagnostic answer that can be decided without
 * reading it, which is why it is worth deciding here rather than paying a model
 * to notice.
 */
export function isBlankAnswer(answer: string): boolean {
  return answer.trim().length === 0
}

/**
 * The grade for an unanswered question, computed rather than requested.
 *
 * WHY THIS EXISTS. A blank answer needs no judgment — there is no text to
 * read — and asking for one turned out to be actively dangerous. Measured on
 * gemini-3.6-flash, 2026-09-06: given an empty answer the model fell into a
 * degenerate repetition loop in `mistake` ("The answer was left blank. Both
 * destination locations were omitted. The student did not answer. No response
 * was provided. No response ...", eventually code-switching mid-sentence),
 * spent **15,001 text tokens**, hit the output ceiling, and returned NO
 * parseable object. The SDK raises `NoObjectGeneratedError` for that, which
 * classifies as `schema_invalid` — so it reads as a model that cannot follow a
 * schema rather than one with nothing to say. Both of the user's credentials
 * failed the same batch, so rotation did not help, and the whole twelve-question
 * sitting was thrown away.
 *
 * Prompt-level length limits reduced it (text tokens fell from ~15,000 to 132)
 * but did NOT eliminate it — consecutive identical runs differed. So the input
 * is removed instead of the behaviour being asked away.
 *
 * The values are the same ones the grader is told to use: 1/10 is the bottom of
 * the `missed` band. `failed` on the key point is a real negative observation,
 * not an absence of one — the learner was asked and produced nothing — and
 * `klpCredit` scores `failed` at 0.0 in every mode. No error tags: there is no
 * text to tag, and a fabricated tag is indistinguishable from a real one.
 */
export function blankAnswerGrade(questionRef: number): Grade {
  return {
    questionRef,
    score: 1,
    status: 'missed',
    feedback: 'No answer was submitted for this question.',
    klpResults: [{ klpRef: 0, status: 'failed' }],
    errorTags: [],
  }
}

/**
 * Reasoning tokens a grading call spends regardless of how many questions it
 * carries. Measured at ~1,400 on gemini-3.6-flash and near-constant across
 * batch sizes, so it is a floor rather than a per-question cost.
 */
const OUTPUT_TOKENS_OVERHEAD = 1800

/** Output tokens each additional question in the call may spend. */
const OUTPUT_TOKENS_PER_QUESTION = 1200

/**
 * The output-token ceiling for a grading call of `questionCount` questions.
 *
 * SCALED, not constant, because the retry path grades one question at a time:
 * handing a single question a four-question budget just lets a runaway run four
 * times as long before it fails.
 *
 * Sized DOWN from the flat 16,384 this used to be. A high ceiling does not
 * prevent a repetition loop, it only makes one expensive — the observed runaway
 * happily filled 16,369 tokens. Now that a failed call degrades to a
 * per-question retry instead of discarding the sitting, failing fast is
 * strictly better than failing late. A healthy batch of four measured ~2,400
 * output tokens, so a four-question call still gets roughly 2.7x headroom.
 */
export function diagnosticOutputCap(questionCount: number): number {
  return OUTPUT_TOKENS_OVERHEAD + OUTPUT_TOKENS_PER_QUESTION * Math.max(1, questionCount)
}

/**
 * The sitting's percentage score, over the questions that actually got a grade.
 *
 * `null` entries are questions the grader could not grade even one at a time.
 * They are EXCLUDED from the denominator rather than counted as zero: an
 * ungraded question is a model failure, and scoring it as a miss would report
 * that failure as the learner's. A blank answer is NOT one of these — it has a
 * real, deterministic grade of 1.
 *
 * Returns `null` when nothing could be graded, so the caller writes no score
 * rather than a misleading 0.
 */
export function averageDiagnosticScore(scores: Array<number | null>): number | null {
  const graded = scores.filter((score): score is number => score !== null)
  if (graded.length === 0) return null
  return Math.round((graded.reduce((sum, score) => sum + score, 0) / graded.length) * 10)
}

/**
 * The output-token ceiling for the end-of-run report call.
 *
 * The report is the LARGEST output the diagnostic asks for — an overview, up to
 * 8 strengths, 12 gaps, 12 recommendations and 24 key-point readouts of three
 * text fields each — and until now it was the one call with no ceiling at all,
 * which made it the most likely place for the next runaway.
 *
 * It degrades better than grading does (`fallbackReport` composes a real report
 * from the grades already in hand), so this is sized generously: the job is to
 * stop an endless loop, not to police a long report.
 */
export function diagnosticReportOutputCap(questionCount: number): number {
  return 3000 + 1000 * Math.max(1, questionCount)
}

/**
 * How much of a learner's answer the REPORT prompt carries per question.
 *
 * The report summarises a whole sitting, so it repeats every answer — and an
 * answer may be up to 10,000 characters. Twelve of those is ~120,000 characters
 * of input for a call whose job is to generalise, and every one of those tokens
 * also gives the model more to ramble about.
 *
 * GRADING is deliberately NOT truncated: a grade must be made on what the
 * learner actually wrote. Only the summary sees an excerpt.
 */
export const REPORT_ANSWER_EXCERPT = 600

export function excerptForReport(answer: string): string {
  return answer.length <= REPORT_ANSWER_EXCERPT
    ? answer
    : `${answer.slice(0, REPORT_ANSWER_EXCERPT)}…`
}

/**
 * Is a failed grading call worth retrying one question at a time?
 *
 * ONLY when something failed with `schema_invalid`. That is the kind produced
 * by a response too large to parse — the degenerate repetition loop — and it is
 * the one failure a SMALLER call genuinely fixes.
 *
 * Everything else must not be retried, and the reason is not politeness about
 * load. `quota_exhausted` means the daily cap is gone: four per-question
 * retries are four guaranteed failures that burn four more requests from a
 * budget that is already empty, and they would then mark four questions
 * permanently ungraded for a problem that fixes itself tomorrow. The same
 * argument applies to `no_credentials`, `invalid_key` and `rate_limited` —
 * asking for less does not make an absent key present.
 *
 * `some`, not `every`: with several credentials in the pool one may hit quota
 * while another returns an unparseable response, and the second is still worth
 * a smaller retry.
 */
export function shouldRetryPerQuestion(failureKinds: readonly string[]): boolean {
  return failureKinds.some((kind) => kind === 'schema_invalid')
}

/**
 * The failure kinds behind an `AiGenerationError`, or `[]` for any other error.
 *
 * Reads `detail.attempts` — the aggregate of EVERY credential tried, not just
 * the last — because a pool where one key hit quota and another produced
 * garbage needs both facts to be routed correctly.
 *
 * Typed structurally rather than importing `AiGenerationError`, so this module
 * stays free of the generation stack and remains unit-testable without it.
 */
export function failureKindsOf(error: unknown): string[] {
  const detail = (error as { detail?: { attempts?: Array<{ kind?: string }> } })?.detail
  if (!detail?.attempts) return []
  return detail.attempts.map((attempt) => attempt.kind).filter((kind): kind is string => Boolean(kind))
}
