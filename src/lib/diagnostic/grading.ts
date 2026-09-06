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
