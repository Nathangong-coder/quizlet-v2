import { describe, it, expect } from 'vitest'
import { rebuildScores, REBUILD_COVERAGE_BAR } from '@/lib/klp/rebuild'
import { WRITE_REBUILD_PROMPT, GRADE_COVERAGE_PROMPT, GRADE_PARITY_PROMPT } from '@/lib/ai/prompts/rebuild'

describe('rebuildScores', () => {
  it('scores coverage over the card points, counting an unverdicted point as missing, and parity over reference claims', () => {
    const s = rebuildScores({
      coverage: [{ index: 0, verdict: 'correct' }, { index: 1, verdict: 'partial' }, { index: 2, verdict: 'missing' }],
      definitionPointCount: 4, // index 3 has no verdict
      parity: [{ verdict: 'present' }, { verdict: 'absent' }, { verdict: 'partial' }, { verdict: 'present' }],
    })
    expect(s.cardCoverage).toBeCloseTo(1.5 / 4)
    expect(s.missingPoints).toEqual([2, 3])
    expect(s.referenceParity).toBeCloseTo(2.5 / 4)
    expect(s.extractionLoss).toBeCloseTo(1.5 / 4)
    expect(s.clearsBar).toBe(false)
  })
  it('null, never NaN, on empty inputs; clears the bar at exactly the bar', () => {
    const s = rebuildScores({ coverage: [], definitionPointCount: 0, parity: [] })
    expect(s.cardCoverage).toBeNull()
    expect(s.referenceParity).toBeNull()
    expect(s.extractionLoss).toBeNull()
    expect(s.clearsBar).toBeNull()
    const five = rebuildScores({ coverage: [0, 1, 2, 3].map((index) => ({ index, verdict: 'correct' as const })), definitionPointCount: 5, parity: [] })
    expect(five.cardCoverage).toBeCloseTo(0.8)
    expect(five.clearsBar).toBe(REBUILD_COVERAGE_BAR <= 0.8)
  })
})

describe('rebuild prompts — isolation', () => {
  it('the rebuild prompt carries the question and points and NOTHING that could leak the reference or definition', () => {
    const p = WRITE_REBUILD_PROMPT.build({ question: 'What is a spin-off?', klps: [{ text: 'A spin-off distributes a subsidiary to shareholders.' }] })
    expect(p).toContain('ONLY the key points given')
    expect(p).toContain('[0] A spin-off distributes')
    expect(p).not.toMatch(/reference|definition/i)
    expect((WRITE_REBUILD_PROMPT.build as (i: unknown) => string).length).toBe(1)
  })
  it('the coverage prompt calls the card points the rubric and keeps disputes rare and separate from the verdict', () => {
    const p = GRADE_COVERAGE_PROMPT.build({ question: 'Q', definitionPoints: [{ point: 'a' }, { point: 'b' }], rebuiltAnswer: 'ans' })
    expect(p).toContain('treat as the rubric')
    expect(p).toContain('[1] b')
    expect(p).toContain('do not soften the verdict on that point')
    expect(p).toContain('Leave "disputes" empty in the normal case')
  })
  it('the parity prompt lists the reference claims first, then marks each in the rebuild', () => {
    const p = GRADE_PARITY_PROMPT.build({ question: 'Q', referenceAnswer: 'ref', rebuiltAnswer: 'ans' })
    expect(p).toContain('First list every distinct substantive claim the reference makes')
    expect(p).toContain('"present" | "partial" | "absent"')
  })
})
