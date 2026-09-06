import { describe, it, expect } from 'vitest'
import {
  KLP_STATUSES, STATUS_CREDIT, EVIDENCE_STRENGTH, GRADED_KLP_MODES, klpCredit,
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

  it('carries entries for exactly the modes that write AnswerKlpResult', () => {
    // review/matching/lesson intentionally have no entry — nothing calls
    // klpCredit with them today, and a guessed number for a mode nobody has
    // reasoned about is worse than the documented DEFAULT_STRENGTH fallback.
    //
    // Pinned to GRADED_KLP_MODES rather than a literal list, so the two facts
    // this test asserts — "no unreasoned mode has a number" and "every graded
    // mode does" — cannot drift apart. Adding 'diagnostic' to STUDY_SOURCES
    // without adding it here is exactly what gap G8 was.
    expect(Object.keys(EVIDENCE_STRENGTH).sort()).toEqual([...GRADED_KLP_MODES].sort())
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

describe('EVIDENCE_STRENGTH coverage', () => {
  it('has an explicit entry for every mode that can reach klpCredit', () => {
    // G8: 'diagnostic' was added to STUDY_SOURCES and not here, so it took
    // DEFAULT_STRENGTH (0.75 — a four-option-MC guess rate) for a free-text
    // mode, silently. Nothing failed. This is the thing that should fail.
    for (const mode of GRADED_KLP_MODES) {
      expect(EVIDENCE_STRENGTH[mode]).toBeDefined()
    }
  })

  it('treats a diagnostic answer as free-text evidence, like short answer', () => {
    expect(EVIDENCE_STRENGTH.diagnostic).toBe(EVIDENCE_STRENGTH['quiz-sa'])
    expect(klpCredit('passed', 'diagnostic')).toBeCloseTo(0.95)
    expect(klpCredit('partial', 'diagnostic')).toBeCloseTo(0.475)
  })

  it('still scores a failed diagnostic answer at zero, like every other mode', () => {
    expect(klpCredit('failed', 'diagnostic')).toBe(0)
  })
})
