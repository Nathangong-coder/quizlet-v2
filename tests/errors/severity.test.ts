import { describe, it, expect } from 'vitest'
import { CORRUPTIONS } from '@/lib/quiz/options'
import { CORRUPTION_SEVERITY, severityFromCorruption } from '@/lib/errors/severity'

describe('CORRUPTION_SEVERITY', () => {
  it('ranks every corruption within 1-5', () => {
    for (const c of CORRUPTIONS) {
      expect(CORRUPTION_SEVERITY[c]).toBeGreaterThanOrEqual(1)
      expect(CORRUPTION_SEVERITY[c]).toBeLessThanOrEqual(5)
    }
  })

  it('ranks a wrong mental model above a retrieval slip', () => {
    // conflation/inversion mean the concept is misfiled or backwards;
    // factual_error is forgetting a number. Not the same problem.
    expect(CORRUPTION_SEVERITY.conflation).toBe(5)
    expect(CORRUPTION_SEVERITY.inversion).toBe(5)
    expect(CORRUPTION_SEVERITY.factual_error).toBe(2)
    expect(CORRUPTION_SEVERITY.conflation).toBeGreaterThan(CORRUPTION_SEVERITY.factual_error)
  })
})

describe('severityFromCorruption', () => {
  it('uses the rank as-is for multiple choice', () => {
    expect(severityFromCorruption('conflation', 'quiz-mc')).toBe(5)
    expect(severityFromCorruption('factual_error', 'quiz-mc')).toBe(2)
  })

  it('subtracts one for true/false', () => {
    // Choosing among four named alternatives narrows down a learner's model
    // more than flipping one bit does. This is NOT a guess-rate adjustment:
    // guess rate discounts CORRECT answers (see klp-credit), not wrong ones.
    expect(severityFromCorruption('conflation', 'quiz-tf')).toBe(4)
    expect(severityFromCorruption('misapplication', 'quiz-tf')).toBe(3)
  })

  it('never drops below 1 on true/false', () => {
    expect(severityFromCorruption('factual_error', 'quiz-tf')).toBe(1)
  })

  it('is defined for every corruption in both modes', () => {
    for (const c of CORRUPTIONS) {
      expect(severityFromCorruption(c, 'quiz-mc')).toBeGreaterThanOrEqual(1)
      expect(severityFromCorruption(c, 'quiz-tf')).toBeGreaterThanOrEqual(1)
    }
  })
})
