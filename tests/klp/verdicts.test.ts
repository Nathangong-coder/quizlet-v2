import { describe, it, expect } from 'vitest'
import { KLP_VERDICTS, isKlpVerdict, VERDICT_CREDIT } from '@/lib/klp/verdicts'
import { ACCURACY_TYPES } from '@/lib/errors/taxonomy'
import { CORRUPTIONS } from '@/lib/quiz/options'

describe('KLP_VERDICTS', () => {
  it('is exactly thirteen labels', () => {
    expect(KLP_VERDICTS).toHaveLength(13)
    expect(new Set(KLP_VERDICTS).size).toBe(13)
  })

  /**
   * The nine accuracy types are PROMOTED into this vocabulary, not renamed
   * beside it. Their spellings are persisted on AnswerErrorTag rows.
   */
  it('contains every ACCURACY_TYPE verbatim', () => {
    for (const t of ACCURACY_TYPES) expect(KLP_VERDICTS).toContain(t)
  })

  /**
   * The load-bearing one. CORRUPTIONS strings are written onto generated
   * distractors as provenance and persisted. If a verdict label were renamed,
   * every existing distractor row would lose its diagnosis.
   */
  it('contains every CORRUPTION verbatim', () => {
    for (const c of CORRUPTIONS) expect(KLP_VERDICTS).toContain(c)
  })

  it('adds exactly the four non-accuracy members', () => {
    const extra = KLP_VERDICTS.filter((v) => !(ACCURACY_TYPES as readonly string[]).includes(v))
    expect([...extra].sort()).toEqual(['contradicted', 'correct', 'failed', 'partial'])
  })
})

describe('isKlpVerdict', () => {
  it('narrows only real members', () => {
    expect(isKlpVerdict('inversion')).toBe(true)
    expect(isKlpVerdict('correct')).toBe(true)
    expect(isKlpVerdict('inverted')).toBe(false)
    expect(isKlpVerdict('')).toBe(false)
    expect(isKlpVerdict(undefined)).toBe(false)
    expect(isKlpVerdict(3)).toBe(false)
  })
})

describe('VERDICT_CREDIT', () => {
  it('assigns credit to every verdict, with no gaps', () => {
    for (const v of KLP_VERDICTS) expect(typeof VERDICT_CREDIT[v]).toBe('number')
  })

  it('keeps the three existing credit values — the labels are not ordered', () => {
    expect(VERDICT_CREDIT.correct).toBe(1)
    expect(VERDICT_CREDIT.incomplete).toBe(0.5)
    expect(VERDICT_CREDIT.partial).toBe(0.5)
    expect(VERDICT_CREDIT.inversion).toBe(0)
    expect(VERDICT_CREDIT.omission).toBe(0)
    expect(new Set(Object.values(VERDICT_CREDIT))).toEqual(new Set([1, 0.5, 0]))
  })
})
