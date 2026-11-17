import { describe, it, expect } from 'vitest'
import { answerScore, compositionOf, GRADER_SCORING, isContradiction } from '@/lib/analysis/scoring-rules'
import { coverageScore } from '@/lib/analysis/benchmark'

const V = (status: string, weight = 1) => ({ status, weight })
const R = (status: string) => ({ status })

describe('answerScore — coverage minus the contradiction term', () => {
  it('equals coverage when nothing is contradicted', () => {
    const vs = [V('correct', 3), V('partial', 2), V('omission', 1)]
    expect(answerScore(vs, [])).toBeCloseTo(coverageScore(vs))
    expect(answerScore(vs, [])).toBeCloseTo((3 + 1) / 6)
  })
  it('a contradicted point SUBTRACTS its weight instead of scoring zero', () => {
    const wrong = [V('correct', 3), V('contradicted', 3)]
    expect(coverageScore(wrong)).toBeCloseTo(0.5)
    expect(answerScore(wrong, [])).toBeCloseTo(0)
    expect(answerScore(wrong, [], [], { contradictionPenalty: 0.5, relationContradictionPenalty: 0 })).toBeCloseTo(0.25)
  })
  it('a wrong answer that states most points now scores below a thin answer with only holes', () => {
    // The LBO "walk me through" shape: 7 right, 2 contradicted, 5 relations contradicted.
    const wrong = [...Array(7).fill(V('correct', 2)), V('contradicted', 2), V('contradicted', 2)]
    const wrongRel = Array(5).fill(R('contradicted'))
    const weak = [...Array(4).fill(V('correct', 2)), ...Array(3).fill(V('partial', 2)), V('omission', 2), V('omission', 2)]
    expect(coverageScore(wrong)).toBeGreaterThan(coverageScore(weak)) // the inversion coverage alone produces
    expect(answerScore(wrong, wrongRel)).toBeLessThan(answerScore(weak, []))
    expect(answerScore(wrong, wrongRel)).toBeLessThanOrEqual(0.3)
  })
  it('never goes below zero, and unjudged points widen the denominator', () => {
    expect(answerScore([V('contradicted', 5)], [R('contradicted'), R('contradicted')])).toBe(0)
    expect(answerScore([V('correct', 1)], [], [{ weight: 1 }])).toBeCloseTo(0.5)
  })
  it('the defaults are the measured ones', () => {
    expect(GRADER_SCORING).toEqual({ contradictionPenalty: 1, relationContradictionPenalty: 0.5 })
  })
  it('failed is a hole, not a contradiction', () => {
    expect(isContradiction('failed')).toBe(false)
    expect(isContradiction('omission')).toBe(false)
    for (const s of ['contradicted', 'inversion', 'conflation', 'misapplication', 'factual_error', 'overgeneralization']) expect(isContradiction(s)).toBe(true)
  })
})

describe('compositionOf — the axis beside the score', () => {
  it('counts each verdict class, unjudged as missing, relations separately', () => {
    const c = compositionOf(
      [V('correct'), V('passed'), V('partial'), V('incomplete'), V('omission'), V('failed'), V('inversion')],
      [R('correct'), R('omission'), R('contradicted')],
      [{}],
    )
    expect(c).toEqual({ correct: 2, partial: 2, missing: 3, wrong: 1, relationsWrong: 1, relationsMissing: 1 })
  })
})
