import { describe, it, expect } from 'vitest'
import { carryVerdicts, mergePartial, trapsToReplace } from '@/lib/klp/regrade-plan'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const V = (...vs: string[]) => vs as KlpVerdict[]

describe('carryVerdicts', () => {
  it('carries by exact text, not by index — a split shifts positions and must not shift verdicts', () => {
    const prev = [{ text: 'A' }, { text: 'B and C' }, { text: 'D' }]
    const next = [{ text: 'A' }, { text: 'B' }, { text: 'C' }, { text: 'D' }]
    const r = carryVerdicts(prev, V('correct', 'partial', 'omission'), next)
    expect(r.verdicts).toEqual(['correct', undefined, undefined, 'omission'])
    expect(r.pending).toEqual([1, 2])
  })

  it('an identical set carries everything and leaves nothing pending', () => {
    const k = [{ text: 'A' }, { text: 'B' }]
    const r = carryVerdicts(k, V('correct', 'failed'), k)
    expect(r.pending).toEqual([])
    expect(r.verdicts).toEqual(['correct', 'failed'])
  })
})

describe('mergePartial', () => {
  it('fills pending slots from the partial grade by position, and never invents a verdict for a carried slot', () => {
    const merged = mergePartial(['correct', undefined, undefined, 'omission'], [1, 2], [
      { klpIndex: 0, verdict: 'partial' },
      { klpIndex: 1, verdict: 'contradicted' },
    ])
    expect(merged).toEqual(['correct', 'partial', 'contradicted', 'omission'])
  })

  it('a skipped pending index falls back to failed, like the full grader', () => {
    expect(mergePartial([undefined, 'correct'], [0], [])).toEqual(['failed', 'correct'])
  })
})

describe('trapsToReplace', () => {
  const roles = ['framing', 'substance', 'substance'] as const
  it('rewrites a trap credited on a substance point; a framing pass does not count', () => {
    const out = trapsToReplace(
      [
        { kind: 'vague', verdicts: V('omission', 'omission', 'omission') },
        { kind: 'memorized_template', verdicts: V('correct', 'correct', 'omission') },
      ],
      [...roles],
      true,
    )
    expect(out).toEqual(['memorized_template'])
  })

  it('a template that only passed the framing point is kept', () => {
    const out = trapsToReplace(
      [
        { kind: 'vague', verdicts: V('omission', 'omission', 'omission') },
        { kind: 'memorized_template', verdicts: V('correct', 'omission', 'omission') },
      ],
      [...roles],
      true,
    )
    expect(out).toEqual([])
  })

  it('when the bar is not cleared, the best wrong answer is rewritten even with no full pass (partials)', () => {
    const out = trapsToReplace(
      [
        { kind: 'vague', verdicts: V('partial', 'partial', 'partial') },
        { kind: 'memorized_template', verdicts: V('omission', 'omission', 'partial') },
      ],
      ['substance', 'substance', 'substance'],
      false,
    )
    expect(out).toEqual(['vague'])
  })

  it('both traps failing everything under a cleared bar rewrites nothing', () => {
    const out = trapsToReplace(
      [
        { kind: 'vague', verdicts: V('omission', 'omission') },
        { kind: 'memorized_template', verdicts: V('failed', 'omission') },
      ],
      ['substance', 'substance'],
      true,
    )
    expect(out).toEqual([])
  })
})

describe('GRADE_CANDIDATE_PROMPT v2 layout', () => {
  it('puts the candidate answer LAST, after the shared instructions, and asks for evidence only off a correct verdict', () => {
    const p = GRADE_CANDIDATE_PROMPT.build({ question: 'Q', referenceAnswer: 'REF TEXT', klps: [{ text: 'a' }], candidateAnswer: 'CAND TEXT', strict: true })
    const iInstr = p.indexOf('Output JSON')
    const iRef = p.indexOf('REF TEXT')
    const iCand = p.indexOf('CAND TEXT')
    expect(iInstr).toBeGreaterThan(0)
    expect(iRef).toBeGreaterThan(iInstr)
    expect(iCand).toBeGreaterThan(iRef)
    expect(p.lastIndexOf('GRADE STRICTLY')).toBeLessThan(iRef)
    expect(p).toContain('OMIT it entirely when the verdict is "correct"')
    expect(GRADE_CANDIDATE_PROMPT.version).toBe(3)
  })
})
