import { describe, it, expect } from 'vitest'
import {
  isBlankAnswer,
  blankAnswerGrade,
  diagnosticOutputCap,
  diagnosticReportOutputCap,
  excerptForReport,
  REPORT_ANSWER_EXCERPT,
  averageDiagnosticScore,
  shouldRetryPerQuestion,
  failureKindsOf,
} from '@/lib/diagnostic/grading'
import { DiagnosticGradeSetSchema, DiagnosticReportSchema, REPORT_LIST_MAX } from '@/lib/ai/schemas'

describe('isBlankAnswer', () => {
  it('treats empty and whitespace-only answers as blank', () => {
    expect(isBlankAnswer('')).toBe(true)
    expect(isBlankAnswer('   ')).toBe(true)
    expect(isBlankAnswer('\n\t  \n')).toBe(true)
  })

  it('treats any real content as answered, however poor', () => {
    // A wrong answer is evidence. Only the ABSENCE of one is mechanical.
    expect(isBlankAnswer('no idea')).toBe(false)
    expect(isBlankAnswer('?')).toBe(false)
  })
})

describe('blankAnswerGrade', () => {
  it('grades a blank answer deterministically, with no AI call', () => {
    // A blank answer needs no judgment: there is nothing to read. Sending it
    // to a model is what triggered the degenerate repetition loop that lost a
    // whole sitting — gemini-3.6-flash wrote 15,000 tokens of restated
    // "no response was provided" and returned no parseable object at all.
    const grade = blankAnswerGrade(3)
    expect(grade.questionRef).toBe(3)
    expect(grade.score).toBe(1)
    expect(grade.status).toBe('missed')
    expect(grade.feedback).toMatch(/no answer/i)
  })

  it('records the key point as failed, not merely unobserved', () => {
    // The learner was asked and produced nothing. That is a real negative
    // observation, and `failed` is 0.0 credit in every mode.
    expect(blankAnswerGrade(0).klpResults).toEqual([{ klpRef: 0, status: 'failed' }])
  })

  it('tags nothing', () => {
    // There is no text to tag, and a fabricated tag is indistinguishable from
    // a real one once written.
    expect(blankAnswerGrade(0).errorTags).toEqual([])
  })

  it('is identical for every ref but the ref itself', () => {
    const a = blankAnswerGrade(0)
    const b = blankAnswerGrade(7)
    expect({ ...a, questionRef: 0 }).toEqual({ ...b, questionRef: 0 })
  })
})

describe('diagnosticOutputCap', () => {
  it('scales with the number of questions in the call', () => {
    // The retry path grades ONE question; giving it a four-question budget
    // just lets a runaway run four times as long before failing.
    expect(diagnosticOutputCap(1)).toBeLessThan(diagnosticOutputCap(4))
  })

  it('leaves real headroom over a well-behaved call', () => {
    // Measured on gemini-3.6-flash: a healthy batch of four spent ~2,400
    // output tokens (~1,400 of them reasoning, which is near-constant).
    expect(diagnosticOutputCap(4)).toBeGreaterThan(2400 * 2)
  })

  it('stays well under the runaway, so a loop fails fast instead of expensively', () => {
    // The observed runaway reached 16,369 tokens before the ceiling stopped it.
    expect(diagnosticOutputCap(4)).toBeLessThan(16_000)
  })
})

describe('averageDiagnosticScore', () => {
  it('averages the graded questions and scales to a percentage', () => {
    expect(averageDiagnosticScore([10, 10, 8, 8])).toBe(90)
  })

  it('excludes ungraded questions from the denominator', () => {
    // An ungraded question is not a zero. Counting it as one would report a
    // model failure as a learner failure — the single most misleading thing
    // this function could do.
    expect(averageDiagnosticScore([10, 10, null, null])).toBe(100)
  })

  it('returns null when nothing could be graded', () => {
    expect(averageDiagnosticScore([null, null])).toBeNull()
    expect(averageDiagnosticScore([])).toBeNull()
  })

  it('counts a blank answer as a real 1, not as ungraded', () => {
    // Blank is a deterministic grade, not a failure to grade.
    expect(averageDiagnosticScore([1, 1])).toBe(10)
  })
})

describe('diagnosticReportOutputCap', () => {
  it('caps the largest output in the system, which previously had none', () => {
    // The report asks for an overview plus up to 8 strengths, 12 gaps, 12
    // recommendations and 24 key-point readouts of three text fields each. It
    // was the one call with no ceiling at all.
    expect(diagnosticReportOutputCap(12)).toBeGreaterThan(0)
    expect(diagnosticReportOutputCap(12)).toBeGreaterThan(diagnosticReportOutputCap(4))
  })

  it('is roomier than a grading call, because the report is genuinely bigger', () => {
    expect(diagnosticReportOutputCap(12)).toBeGreaterThan(diagnosticOutputCap(4))
  })
})

describe('excerptForReport', () => {
  it('passes a normal answer through untouched', () => {
    expect(excerptForReport('a short answer')).toBe('a short answer')
  })

  it('excerpts a very long answer', () => {
    // An answer may be 10,000 characters and the report repeats every one of
    // them. Grading is NOT truncated — only the summary sees an excerpt.
    const long = 'x'.repeat(10_000)
    const out = excerptForReport(long)
    expect(out.length).toBeLessThanOrEqual(REPORT_ANSWER_EXCERPT + 1)
    expect(out.endsWith('…')).toBe(true)
  })
})

describe('response length is truncated, never rejected', () => {
  it('keeps a grade whose feedback overshoots the limit', () => {
    // Length is not a correctness property. Rejecting a 1,250-character
    // feedback discards a real judgment, and after the retry path that costs
    // the learner the question entirely.
    const parsed = DiagnosticGradeSetSchema.safeParse({
      grades: [{
        questionRef: 0, score: 6, status: 'partial',
        feedback: 'f'.repeat(5000),
        mistake: 'm'.repeat(5000),
        klpResults: [{ klpRef: 0, status: 'partial' }],
      }],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.grades[0].feedback.length).toBe(1200)
      expect(parsed.data.grades[0].mistake?.length).toBe(800)
    }
  })

  it('still rejects an empty required field', () => {
    // Truncation must not turn "the model said nothing" into a valid grade.
    expect(DiagnosticGradeSetSchema.safeParse({
      grades: [{ questionRef: 0, score: 6, status: 'partial', feedback: '   ' }],
    }).success).toBe(false)
  })

  it('truncates an over-long report rather than falling back unnecessarily', () => {
    const parsed = DiagnosticReportSchema.safeParse({
      overview: 'o'.repeat(9000),
      strengths: ['s'.repeat(9000)],
      gaps: [],
      recommendations: ['r'.repeat(9000)],
      learningPoints: [],
    })
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.overview.length).toBe(1600)
      expect(parsed.data.recommendations[0].length).toBe(700)
    }
  })
})

describe('shouldRetryPerQuestion', () => {
  it('retries a response that could not be parsed', () => {
    // schema_invalid is what an over-long response looks like, and asking for
    // less genuinely fixes it.
    expect(shouldRetryPerQuestion(['schema_invalid'])).toBe(true)
  })

  it('does NOT retry an exhausted quota', () => {
    // Four per-question retries would be four guaranteed failures burning four
    // more requests from a budget that is already empty — and would then mark
    // four questions permanently ungraded for a problem that fixes itself
    // tomorrow.
    expect(shouldRetryPerQuestion(['quota_exhausted'])).toBe(false)
    expect(shouldRetryPerQuestion(['quota_exhausted', 'quota_exhausted'])).toBe(false)
  })

  it('does NOT retry a missing or invalid credential', () => {
    // Asking for less does not make an absent key present.
    expect(shouldRetryPerQuestion(['no_credentials'])).toBe(false)
    expect(shouldRetryPerQuestion(['invalid_key'])).toBe(false)
    expect(shouldRetryPerQuestion(['rate_limited'])).toBe(false)
  })

  it('retries when ANY credential produced an unparseable response', () => {
    // A mixed pool: one key out of quota, another rambling. The second is
    // still worth a smaller call.
    expect(shouldRetryPerQuestion(['quota_exhausted', 'schema_invalid'])).toBe(true)
  })

  it('does not retry an unclassifiable error', () => {
    expect(shouldRetryPerQuestion([])).toBe(false)
  })
})

describe('failureKindsOf', () => {
  it('reads every attempt, not just the last', () => {
    // A pool where one key hit quota and another produced garbage needs both
    // facts to be routed correctly.
    const error = { detail: { attempts: [{ kind: 'quota_exhausted' }, { kind: 'schema_invalid' }] } }
    expect(failureKindsOf(error)).toEqual(['quota_exhausted', 'schema_invalid'])
  })

  it('returns nothing for an error that is not an AI generation failure', () => {
    expect(failureKindsOf(new Error('boom'))).toEqual([])
    expect(failureKindsOf(undefined)).toEqual([])
  })
})

describe('report list caps', () => {
  it('keeps the summary lists short enough to be a ranking', () => {
    // Twelve gaps from a twelve-question sitting is one gap per question: the
    // results list restated, which the question review already shows in full.
    // A generous cap invites the model to pad to it.
    expect(REPORT_LIST_MAX).toBeLessThanOrEqual(3)
  })

  it('rejects more entries than the cap', () => {
    const tooMany = Array.from({ length: REPORT_LIST_MAX + 1 }, (_, i) => `gap ${i}`)
    expect(DiagnosticReportSchema.safeParse({
      overview: 'o', strengths: [], gaps: tooMany, recommendations: ['r'], learningPoints: [],
    }).success).toBe(false)
  })

  it('does NOT cap learningPoints the same way', () => {
    // That field is the per-key-point readout, one entry per point tested —
    // a detail list, not a synthesis. Capping it at three would silently drop
    // most of a twelve-question sitting's evidence.
    const many = Array.from({ length: 12 }, (_, i) => ({
      text: `point ${i}`, score: 5, evidence: 'e', nextAction: 'n',
    }))
    expect(DiagnosticReportSchema.safeParse({
      overview: 'o', strengths: [], gaps: [], recommendations: ['r'], learningPoints: many,
    }).success).toBe(true)
  })
})
