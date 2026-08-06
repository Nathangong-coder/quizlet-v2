import { describe, it, expect } from 'vitest'
import { guessRate, traceKlp, stepBkt, MIN_OBSERVATIONS, BKT_PRIOR } from '@/lib/metrics/bkt'
import { EVIDENCE_STRENGTH } from '@/lib/errors/klp-credit'
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
  it('converges toward 1, not toward the ~0.76 fixed point credit would create', () => {
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

describe('chronological replay', () => {
  it('is order-independent at the input boundary — unsorted input is sorted first', () => {
    const early = obs({ status: 'failed', createdAt: new Date('2026-08-01T00:00:00Z') })
    const late = obs({ status: 'passed', createdAt: new Date('2026-08-04T00:00:00Z') })
    expect(traceKlp([late, early]).pKnown).toBeCloseTo(traceKlp([early, late]).pKnown, 10)
  })
})
