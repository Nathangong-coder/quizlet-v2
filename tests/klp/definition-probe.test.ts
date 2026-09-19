import { describe, it, expect } from 'vitest'
import {
  DEFINITION_PASS,
  DEFINITION_HARD_FAIL,
  SUPERVISION_PASSES,
  probeOutcome,
  scoreDefinition,
  supervisionDecision,
  findingsFromSupervision,
  findingsFromHardFail,
  formatProbeLine,
  type SupervisionPoint,
} from '@/lib/klp/definition-probe'

const klps = [
  { index: 0, text: 'a', weight: 1, kind: 'definition' },
  { index: 1, text: 'b', weight: 3, kind: 'mechanism' },
  { index: 2, text: 'c', weight: 4, kind: 'mechanism' },
  { index: 3, text: 'd', weight: 2, kind: 'causal' },
]

describe('probeOutcome', () => {
  it('pass at the floor, hard fail below its floor, supervise between', () => {
    expect(DEFINITION_PASS).toBeGreaterThan(DEFINITION_HARD_FAIL)
    expect(probeOutcome(DEFINITION_PASS)).toBe('pass')
    expect(probeOutcome(DEFINITION_PASS - 0.01)).toBe('supervise')
    expect(probeOutcome(DEFINITION_HARD_FAIL)).toBe('supervise')
    expect(probeOutcome(DEFINITION_HARD_FAIL - 0.01)).toBe('hard_fail')
    expect(probeOutcome(1)).toBe('pass')
    expect(probeOutcome(0)).toBe('hard_fail')
  })
})

describe('scoreDefinition', () => {
  it('is STATUS_CREDIT weighted by the card weights; omitted / partial / wrong / unjudged are listed by index', () => {
    const s = scoreDefinition(
      [
        { klpRef: 0, status: 'correct' },
        { klpRef: 1, status: 'partial' },
        { klpRef: 2, status: 'omission' },
      ],
      klps,
    )
    // 1×1 + 0.5×3 + 0×4 + unjudged 0×2 = 2.5 of 10
    expect(s.earned).toBe(2.5)
    expect(s.total).toBe(10)
    expect(s.score).toBeCloseTo(0.25)
    expect(s.omitted).toEqual([2])
    expect(s.partial).toEqual([1])
    expect(s.unjudged).toEqual([3])
    expect(s.wrong).toEqual([])
  })
  it('a contradicted point is WRONG, worth zero, and separate from a hole', () => {
    const s = scoreDefinition([{ klpRef: 0, status: 'correct' }, { klpRef: 1, status: 'contradicted' }, { klpRef: 2, status: 'correct' }, { klpRef: 3, status: 'correct' }], klps)
    expect(s.wrong).toEqual([1])
    expect(s.omitted).toEqual([])
    expect(s.score).toBeCloseTo(0.7)
  })
  it('a legacy passed reads as full credit; an unknown label as zero; no points is zero not NaN', () => {
    expect(scoreDefinition([{ klpRef: 0, status: 'passed' }], klps.slice(0, 1)).score).toBe(1)
    expect(scoreDefinition([{ klpRef: 0, status: 'vibes' }], klps.slice(0, 1)).score).toBe(0)
    expect(scoreDefinition([], []).score).toBe(0)
  })
})

describe('supervisionDecision', () => {
  const keep = (ref: number): SupervisionPoint => ({ klpRef: ref, verdict: 'keep', reason: 'r' })
  it('any narrow or cut in any pass → revise', () => {
    expect(supervisionDecision([[keep(0), { klpRef: 1, verdict: 'narrow', reason: 'r', wording: 'w' }]])).toBe('revise')
    expect(supervisionDecision([[keep(0)], [{ klpRef: 1, verdict: 'cut', reason: 'r' }]])).toBe('revise')
  })
  it('grader_wrong with no defect → the instrument is at fault, not the card', () => {
    expect(supervisionDecision([[keep(0), { klpRef: 1, verdict: 'grader_wrong', reason: 'r' }]])).toBe('grader_wrong')
  })
  it('all keep → a second pass first; escalate only after SUPERVISION_PASSES passes all hold the card at fault', () => {
    expect(supervisionDecision([[keep(0), keep(1)]])).toBe('second_pass')
    const passes = Array.from({ length: SUPERVISION_PASSES }, () => [keep(0), keep(1)])
    expect(supervisionDecision(passes)).toBe('escalate')
  })
  it('no passes yet → a pass is needed', () => {
    expect(supervisionDecision([])).toBe('second_pass')
  })
})

describe('findings', () => {
  it('supervision: narrow carries the wording, cut says cut, keep and grader_wrong produce nothing', () => {
    const f = findingsFromSupervision([
      { klpRef: 0, verdict: 'keep', reason: 'r' },
      { klpRef: 1, verdict: 'narrow', reason: 'r', wording: 'FCF after interest' },
      { klpRef: 2, verdict: 'cut', reason: 'r' },
      { klpRef: 3, verdict: 'grader_wrong', reason: 'r' },
    ])
    expect(f).toEqual([
      { index: 1, issue: 'over_reach', fix: 'Narrow to what the definition states: "FCF after interest"' },
      { index: 2, issue: 'not_on_card', fix: 'Cut: the card does not make this point.' },
    ])
  })
  it('hard fail: omitted → not_on_card, partial → over_reach, unknown indexes dropped', () => {
    const score = scoreDefinition([{ klpRef: 0, status: 'omission' }, { klpRef: 1, status: 'incomplete' }, { klpRef: 2, status: 'correct' }], klps)
    const f = findingsFromHardFail({ ...score, omitted: [0, 9] }, klps)
    expect(f.map((x) => [x.index, x.issue])).toEqual([
      [0, 'not_on_card'],
      [1, 'over_reach'],
    ])
  })
})

describe('formatProbeLine', () => {
  it('names the score, the outcome, both word counts, and the omitted / partial / wrong indexes', () => {
    const score = scoreDefinition([{ klpRef: 0, status: 'correct' }, { klpRef: 1, status: 'partial' }, { klpRef: 2, status: 'omission' }, { klpRef: 3, status: 'contradicted' }], klps)
    const line = formatProbeLine({ term: 'How do you project debt paydown in an LBO?', score, definitionWords: 38, referenceWords: 127, outcome: 'hard_fail' })
    expect(line).toContain(' 25/100 hard_fail')
    expect(line).toContain('def  38w')
    expect(line).toContain('ref 127w')
    expect(line).toContain('omitted [2]')
    expect(line).toContain('partial [1]')
    expect(line).toContain('WRONG [3]')
    expect(line).toContain('project debt paydown')
    expect(formatProbeLine({ term: 't', score, definitionWords: 1, referenceWords: null, outcome: 'pass' })).toContain('ref   -w')
  })
})
