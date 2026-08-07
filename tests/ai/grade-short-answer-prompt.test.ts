import { describe, it, expect } from 'vitest'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas'

const card = { term: 'WACC', definition: 'Weighted average cost of capital' } as any

describe('magnitude replaces severity in the grading contract', () => {
  it('asks for a 1-10 magnitude and never a 1-5 severity', () => {
    const text = GRADE_SHORT_ANSWER_PROMPT.build({
      card,
      answer: 'something',
      klps: [{ ref: 0, kind: 'definition', text: 'WACC weights by market value' }],
    })
    expect(text).toContain('magnitude')
    expect(text).not.toContain('"severity"')
  })

  it('accepts a magnitude of 10 and rejects 11', () => {
    const base = {
      clarity: { score: 5, pros: [], cons: [] },
      conciseness: { score: 5, pros: [], cons: [] },
      correctness: { score: 5, pros: [], cons: [] },
      overall: 5,
      summary: 's',
      suggestedImprovement: 'i',
    }
    const tag = { dimension: 'accuracy' as const, type: 'inversion', magnitude: 10 }

    expect(ShortAnswerGradeSchema.safeParse({ ...base, errorTags: [tag] }).success).toBe(true)
    expect(
      ShortAnswerGradeSchema.safeParse({ ...base, errorTags: [{ ...tag, magnitude: 11 }] }).success,
    ).toBe(false)
  })

  it('omits the analysis body entirely when no KLPs are supplied', () => {
    const text = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'a' })
    expect(text).not.toContain('magnitude')
  })
})
