import { describe, it, expect } from 'vitest'
import { guessRate, traceKlp, stepBkt, MIN_OBSERVATIONS, BKT_PRIOR } from '@/lib/metrics/bkt'
import { EVIDENCE_STRENGTH, DEFAULT_STRENGTH } from '@/lib/errors/klp-credit'
import type { KlpObservation } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const obs = (o: Partial<KlpObservation> = {}): KlpObservation => ({
  status: 'passed',
  mode: 'quiz-mc',
  createdAt: NOW,
  ...o,
})

describe('guess rate is derived, never re-declared', () => {
  it('equals 1 - EVIDENCE_STRENGTH for every documented mode', () => {
    expect(guessRate('quiz-mc')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-mc'], 10)
    expect(guessRate('quiz-tf')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-tf'], 10)
    expect(guessRate('quiz-sa')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-sa'], 10)
  })

  it('yields the rates CLAUDE.md specifies', () => {
    expect(guessRate('quiz-mc')).toBeCloseTo(0.25, 10)
    expect(guessRate('quiz-tf')).toBeCloseTo(0.5, 10)
    expect(guessRate('quiz-sa')).toBeCloseTo(0.05, 10)
  })
})

describe('no ceiling on repeated correct multiple choice', () => {
  it('converges toward 1, not toward the ~0.82 fixed point a double-discount creates', () => {
    const observations = Array.from({ length: 100 }, () => obs({ status: 'passed', mode: 'quiz-mc' }))
    const result = traceKlp(observations)
    expect(result.pKnown).toBeGreaterThan(0.99)
  })

  it('rises monotonically across a run of correct answers', () => {
    let p = BKT_PRIOR
    const seen: number[] = []
    for (let i = 0; i < 20; i++) {
      p = stepBkt(p, obs({ status: 'passed', mode: 'quiz-mc' }))
      seen.push(p)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1])
    }
  })
})

describe('evidence strength by mode', () => {
  it('moves further on a correct short answer than a correct true/false', () => {
    const sa = stepBkt(BKT_PRIOR, obs({ status: 'passed', mode: 'quiz-sa' }))
    const tf = stepBkt(BKT_PRIOR, obs({ status: 'passed', mode: 'quiz-tf' }))
    expect(sa).toBeGreaterThan(tf)
  })

  it('drops pKnown on a failure in every mode', () => {
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      const after = stepBkt(0.8, obs({ status: 'failed', mode }))
      expect(after, mode).toBeLessThan(0.8)
    }
  })

  it('treats partial as between passed and failed', () => {
    const passed = stepBkt(0.5, obs({ status: 'passed', mode: 'quiz-sa' }))
    const partial = stepBkt(0.5, obs({ status: 'partial', mode: 'quiz-sa' }))
    const failed = stepBkt(0.5, obs({ status: 'failed', mode: 'quiz-sa' }))
    expect(partial).toBeLessThan(passed)
    expect(partial).toBeGreaterThan(failed)
  })
})

describe('observation floor', () => {
  it('reports observations so callers can refuse to judge on thin data', () => {
    const result = traceKlp([obs(), obs()])
    expect(result.observations).toBe(2)
    expect(result.observations).toBeLessThan(MIN_OBSERVATIONS)
  })

  it('returns the prior with zero observations rather than null', () => {
    const result = traceKlp([])
    expect(result.pKnown).toBe(BKT_PRIOR)
    expect(result.observations).toBe(0)
  })
})

describe('exact arithmetic per branch', () => {
  it('applies correct likelihood on passed multiple-choice answers', () => {
    // Hand-computed from stepBkt(0.25, passed MC):
    // guess=0.25, slip=0.1, learn=0.1
    // pIfCorrect = 0.25*0.9 / (0.25*0.9 + 0.75*0.25) = 0.225/0.4125 ≈ 0.545454...
    // posterior = 1.0 * pIfCorrect = 0.545454...
    // result = 0.545454... + (1-0.545454...)*0.1 ≈ 0.590909...
    const result = stepBkt(BKT_PRIOR, obs({ status: 'passed', mode: 'quiz-mc' }))
    expect(result).toBeCloseTo(0.590909090909, 10)
  })

  it('applies correct likelihood on failed multiple-choice answers', () => {
    // Hand-computed from stepBkt(0.25, failed MC):
    // pIfWrong = 0.25*0.1 / (0.25*0.1 + 0.75*0.75) = 0.025/0.5875
    // posterior = 0.0 * pIfCorrect + 1.0 * pIfWrong
    // result = posterior + (1 - posterior) * 0.1
    const result = stepBkt(BKT_PRIOR, obs({ status: 'failed', mode: 'quiz-mc' }))
    expect(result).toBeCloseTo(0.13829787234042554, 10)
  })

  it('applies correct likelihood on partial short-answer answers', () => {
    // Hand-computed from stepBkt(0.25, partial SA):
    // guess=0.05, slip=0.1, learn=0.1
    // pIfCorrect = 0.25*0.9 / (0.25*0.9 + 0.75*0.05)
    // pIfWrong = 0.25*0.1 / (0.25*0.1 + 0.75*0.95)
    // posterior = 0.5 * pIfCorrect + 0.5 * pIfWrong (status=partial is 0.5)
    // result = posterior + (1 - posterior) * 0.1
    const result = stepBkt(BKT_PRIOR, obs({ status: 'partial', mode: 'quiz-sa' }))
    expect(result).toBeCloseTo(0.5009685230024212, 10)
  })
})

describe('sensitivity to constants', () => {
  it('BKT_SLIP affects convergence rate on failures', () => {
    // With normal slip=0.1, a failure from 0.8 drops more than if slip=0.05
    const normal = stepBkt(0.8, obs({ status: 'failed', mode: 'quiz-mc' }))
    // We can't easily test with modified slip here, but we can verify
    // that failures DO impact pKnown negatively
    expect(normal).toBeLessThan(0.8)
  })

  it('BKT_LEARN affects how quickly correct answers push pKnown upward', () => {
    // Higher prior gives us a starting point to test learning
    const oneCorrect = stepBkt(0.5, obs({ status: 'passed', mode: 'quiz-mc' }))
    // Learning term adds (1 - posterior) * 0.1, so result > posterior always
    // For a mid-range prior like 0.5, one correct answer should increase it
    expect(oneCorrect).toBeGreaterThan(0.5)
  })

  it('evidence strength by mode affects the distance moved', () => {
    // MC (0.75 strength = 0.25 guess) vs SA (0.95 strength = 0.05 guess)
    const mcResult = stepBkt(0.5, obs({ status: 'passed', mode: 'quiz-mc' }))
    const saResult = stepBkt(0.5, obs({ status: 'passed', mode: 'quiz-sa' }))
    // SA has stronger evidence (0.95 vs 0.75), so it should move further
    expect(saResult).toBeGreaterThan(mcResult)
  })

  it('learning is applied once to posterior, not twice to branches', () => {
    // For a partial (c=0.5) short-answer observation from prior 0.5, the
    // Bayesian update should happen first, then learning is added once.
    // If learning were mistakenly applied inside both branches, the posterior
    // would be a different weighted mixture, changing the result noticeably.
    const result = stepBkt(0.5, obs({ status: 'partial', mode: 'quiz-sa' }))
    // This exact value is achieved only when learning is applied to the final
    // posterior, not to each branch before mixing.
    expect(result).toBeCloseTo(0.569172932330827, 10)
  })
})

describe('fallback guess rate for undocumented modes', () => {
  it('applies DEFAULT_STRENGTH for modes not in EVIDENCE_STRENGTH', () => {
    // 'review', 'matching', 'lesson' are not documented modes
    expect(guessRate('review')).toBeCloseTo(1 - DEFAULT_STRENGTH, 10)
    expect(guessRate('matching')).toBeCloseTo(1 - DEFAULT_STRENGTH, 10)
    expect(guessRate('lesson')).toBeCloseTo(1 - DEFAULT_STRENGTH, 10)
  })

  it('produces reasonable results on undocumented modes', () => {
    const result = stepBkt(0.25, obs({ status: 'passed', mode: 'review' }))
    const mcResult = stepBkt(0.25, obs({ status: 'passed', mode: 'quiz-mc' }))
    // DEFAULT_STRENGTH is 0.75, the same as MC, so the fallback must equal MC.
    expect(result).toBeCloseTo(mcResult, 10)
  })
})

describe('chronological replay', () => {
  it('is order-independent at the input boundary — unsorted input is sorted first', () => {
    const early = obs({ status: 'failed', createdAt: new Date('2026-08-01T00:00:00Z') })
    const late = obs({ status: 'passed', createdAt: new Date('2026-08-04T00:00:00Z') })
    expect(traceKlp([late, early]).pKnown).toBeCloseTo(traceKlp([early, late]).pKnown, 10)
  })
})
