import { describe, it, expect } from 'vitest'
import {
  isBlankAnswer,
  blankAnswerGrade,
  diagnosticOutputCap,
  averageDiagnosticScore,
} from '@/lib/diagnostic/grading'

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
