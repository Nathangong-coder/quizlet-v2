import { describe, it, expect } from 'vitest'
import {
  KLP_STATUSES, STATUS_CREDIT, EVIDENCE_STRENGTH, klpCredit,
} from '@/lib/errors/klp-credit'

describe('klpCredit', () => {
  it('weights a correct answer by how much the mode proves', () => {
    // 1 - guessRate. Short answer is near-certain; true/false is a coin flip.
    expect(klpCredit('passed', 'quiz-sa')).toBeCloseTo(0.95)
    expect(klpCredit('passed', 'quiz-mc')).toBeCloseTo(0.75)
    expect(klpCredit('passed', 'quiz-tf')).toBeCloseTo(0.5)
  })

  it('halves a partial', () => {
    expect(klpCredit('partial', 'quiz-sa')).toBeCloseTo(0.475)
  })

  it('gives a FAILED status zero in EVERY mode', () => {
    // The one place mode weighting must NOT apply. Guess rate discounts a
    // correct answer because luck can produce one; a wrong answer is not luck,
    // so an easy mode does not make failing it less of a failure.
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      expect(klpCredit('failed', mode)).toBe(0)
    }
  })

  it('is defined for every status/mode pair', () => {
    for (const status of KLP_STATUSES) {
      for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
        const c = klpCredit(status, mode)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })

  it('orders evidence strength SA > MC > TF', () => {
    expect(EVIDENCE_STRENGTH['quiz-sa']).toBeGreaterThan(EVIDENCE_STRENGTH['quiz-mc'])
    expect(EVIDENCE_STRENGTH['quiz-mc']).toBeGreaterThan(EVIDENCE_STRENGTH['quiz-tf'])
    expect(STATUS_CREDIT.passed).toBe(1)
  })

  it('only carries entries for the three modes Spec 2a actually grades', () => {
    // review/matching/lesson intentionally have no entry — nothing calls
    // klpCredit with them today, and a guessed number for a mode nobody has
    // reasoned about is worse than the documented DEFAULT_STRENGTH fallback.
    expect(Object.keys(EVIDENCE_STRENGTH).sort()).toEqual(['quiz-mc', 'quiz-sa', 'quiz-tf'])
  })

  it('falls back to a default strength for a StudySource with no explicit entry', () => {
    // klpCredit's `mode` param is typed as the full StudySource (matching the
    // callers it flows through), so it must not throw or return NaN for a
    // mode outside the three explicit entries.
    expect(klpCredit('passed', 'review')).toBeGreaterThan(0)
    expect(klpCredit('passed', 'matching')).toBeGreaterThan(0)
    expect(klpCredit('passed', 'lesson')).toBeGreaterThan(0)
    expect(klpCredit('failed', 'review')).toBe(0)
  })
})
