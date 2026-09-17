import { describe, it, expect } from 'vitest'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas'
import { RUNTIME_VERDICTS } from '@/lib/klp/verdicts'
import { verdictInstructionBlock } from '@/lib/ai/prompts/verdict-block'

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

/**
 * Spec 5 Phase A, Task 3: the runtime grader is written against ONE shared
 * verdict block, offers every runtime verdict verbatim, and never sees the
 * learner.
 */
describe('GRADE_SHORT_ANSWER_PROMPT v5 (shared verdict block)', () => {
  const klps = [{ ref: 0, text: 'D&A is added back because it is non-cash', kind: 'mechanism' }]
  const card = { term: 'Walk me through D&A', definition: '...' } as never

  it('offers every runtime verdict verbatim and never "passed"', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    for (const v of RUNTIME_VERDICTS) expect(p).toContain(`"${v}"`)
    expect(p).not.toMatch(/"passed"/)
  })

  it('is written against the shared block (mutation check)', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).toContain(verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS }))
  })

  it('carries the strict and kind clauses', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).toContain('GRADE STRICTLY')
    expect(p).toContain('Strictness by kind')
  })

  it('lists relations and form requirements when given', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({
      card, answer: 'x', klps: [...klps, { ref: 1, text: 'FCF rises', kind: 'causal' }],
      relations: [{ ref: 0, type: 'causes', fromRef: 0, toRef: 1 }],
      formReqs: [{ ref: 0, text: 'States direction and magnitude' }],
    })
    expect(p).toContain('[R0] (causes) [0] → [1]')
    expect(p).toContain('[F0] States direction and magnitude')
    expect(p).toContain('"relationResults"'); expect(p).toContain('"formResults"'); expect(p).toContain('"unwarranted"')
  })

  /**
   * Spec 5 §3 (fix round): the shared block says "omit quote on correct" —
   * right for a key point, wrong for a relation or a form requirement, whose
   * `correct` / `met` is the only record of WHERE the link was asserted. The
   * sentence follows the output lines and is present whenever either list is.
   */
  const QUOTE_EVERY = 'For relations and form requirements, include "quote" on EVERY verdict, including "correct" and "met".'

  it('asks for a quote on every relation verdict, "correct" included', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({
      card, answer: 'x', klps: [...klps, { ref: 1, text: 'FCF rises', kind: 'causal' }],
      relations: [{ ref: 0, type: 'causes', fromRef: 0, toRef: 1 }],
    })
    expect(p).toContain(QUOTE_EVERY)
    expect(p.indexOf(QUOTE_EVERY)).toBeGreaterThan(p.indexOf('"relationResults"'))
    expect(p.indexOf(QUOTE_EVERY)).toBeLessThan(p.indexOf('"unwarranted"'))
  })

  it('asks for a quote on every form result, "met" included', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({
      card, answer: 'x', klps, formReqs: [{ ref: 0, text: 'States direction and magnitude' }],
    })
    expect(p).toContain(QUOTE_EVERY)
    expect(p.indexOf(QUOTE_EVERY)).toBeGreaterThan(p.indexOf('"formResults"'))
  })

  it('says nothing about relation or form quotes when the card has neither', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).not.toContain(QUOTE_EVERY)
  })

  it('shows the reference answer after the key points and before the answer', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'THE ANSWER', klps, referenceAnswer: 'THE REFERENCE' })
    expect(p.indexOf('THE REFERENCE')).toBeGreaterThan(p.indexOf(klps[0].text))
    expect(p.indexOf('THE REFERENCE')).toBeLessThan(p.indexOf('THE ANSWER'))
  })

  it('buildParts carries the same shared block and the reference answer', () => {
    const { promptText } = GRADE_SHORT_ANSWER_PROMPT.buildParts({
      card, promptBlocks: [], answer: 'THE ANSWER', klps, referenceAnswer: 'THE REFERENCE',
    })
    expect(promptText).toContain(verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS }))
    expect(promptText.indexOf('THE REFERENCE')).toBeLessThan(promptText.indexOf('THE ANSWER'))
  })

  it('is version 5 — promptVersion is persisted on every grade', () => {
    expect(GRADE_SHORT_ANSWER_PROMPT.version).toBe(5)
  })
})

describe('ShortAnswerGradeSchema v5 (runtime vocabulary)', () => {
  const base = {
    clarity: { score: 5, pros: [], cons: [] },
    conciseness: { score: 5, pros: [], cons: [] },
    correctness: { score: 5, pros: [], cons: [] },
    overall: 5,
    summary: 's',
    suggestedImprovement: 'i',
  }

  it('accepts every runtime verdict and a verbatim quote', () => {
    for (const status of RUNTIME_VERDICTS) {
      expect(ShortAnswerGradeSchema.safeParse({ ...base, klpResults: [{ klpRef: 0, status, quote: 'q' }] }).success).toBe(true)
    }
  })

  it('still accepts `evidence` as an alias for one version', () => {
    expect(ShortAnswerGradeSchema.safeParse({ ...base, klpResults: [{ klpRef: 0, status: 'omission', evidence: 'e' }] }).success).toBe(true)
  })

  it('rejects "passed" — the grader is never offered it (D1) — and the two add-only labels', () => {
    for (const status of ['passed', 'fabrication', 'unsupported_leap']) {
      expect(ShortAnswerGradeSchema.safeParse({ ...base, klpResults: [{ klpRef: 0, status }] }).success).toBe(false)
    }
  })

  it('accepts relationResults, formResults and unwarranted', () => {
    expect(ShortAnswerGradeSchema.safeParse({
      ...base,
      relationResults: [{ relationRef: 0, status: 'inversion', quote: 'q' }],
      formResults: [{ formRef: 0, status: 'not_met', quote: 'q' }],
      unwarranted: [{ text: 'claims D&A is cash', quote: 'D&A is a cash cost', magnitude: 7 }],
    }).success).toBe(true)
  })

  it('rejects a form status outside met | not_met and an unwarranted magnitude outside 1-10', () => {
    expect(ShortAnswerGradeSchema.safeParse({ ...base, formResults: [{ formRef: 0, status: 'partial' }] }).success).toBe(false)
    expect(ShortAnswerGradeSchema.safeParse({ ...base, unwarranted: [{ text: 't', quote: 'q', magnitude: 11 }] }).success).toBe(false)
  })
})
