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

describe('the revision veto', () => {
  it('refuses a version that falls below the floor when the old one was at or above it; allows everything else', async () => {
    const { revisionVeto, carriedSeparation } = await import('@/lib/klp/definition-probe')
    const { SEPARATION_FLOOR } = await import('@/lib/klp/authoring-config')
    expect(revisionVeto({ combinedSeparation: 0.86 }, { combinedSeparation: 0.0 }).veto).toBe(true)
    expect(revisionVeto({ combinedSeparation: 0.86 }, { combinedSeparation: SEPARATION_FLOOR }).veto).toBe(false)
    // an old version already below the floor cannot be made worse by the rule — the re-author is the fix
    expect(revisionVeto({ combinedSeparation: 0.1 }, { combinedSeparation: 0.0 }).veto).toBe(false)
    expect(revisionVeto(null, { combinedSeparation: 0.0 }).veto).toBe(false)
    // combined wins over substance when the pass ran; substance stands in otherwise
    expect(carriedSeparation({ combinedSeparation: 0.7, substanceSeparation: 0.1 })).toBe(0.7)
    expect(carriedSeparation({ combinedSeparation: null, substanceSeparation: 0.3 })).toBe(0.3)
    expect(revisionVeto({ combinedSeparation: null, substanceSeparation: 0.5 }, { combinedSeparation: null, substanceSeparation: 0.2 }).veto).toBe(true)
  })
})

describe('discrimination-aware supervision', () => {
  it('a point the reference passes and some trap fails is load-bearing', async () => {
    const { loadBearingIndexes } = await import('@/lib/klp/definition-probe')
    const lb = loadBearingIndexes(['correct', 'correct', 'omission', 'correct'], [{ '0': 'omission', '1': 'correct', '2': 'omission', '3': 'correct' }, { '0': 'correct', '1': 'correct', '2': 'omission', '3': 'partial' }])
    expect([...lb]).toEqual([0]) // [1] nobody fails; [2] reference fails; [3] partial is credit, not a failure
  })
  it('narrow/cut on a load-bearing point reads as keep, recorded; other points untouched', async () => {
    const { applyLoadBearing, supervisionDecision } = await import('@/lib/klp/definition-probe')
    const pts = [
      { klpRef: 0, verdict: 'narrow' as const, reason: 'r0', wording: 'w' },
      { klpRef: 1, verdict: 'cut' as const, reason: 'r1' },
      { klpRef: 2, verdict: 'grader_wrong' as const, reason: 'r2' },
    ]
    const { points, overridden } = applyLoadBearing(pts, new Set([0, 2]))
    expect(overridden).toEqual([0])
    expect(points[0]).toMatchObject({ verdict: 'keep', wording: undefined })
    expect(points[0].reason).toMatch(/^\[load-bearing: separates a wrong answer; supervisor said narrow\] r0/)
    expect(points[1].verdict).toBe('cut')
    expect(points[2].verdict).toBe('grader_wrong')
    // once every narrow is load-bearing, the decision is a second pass, not a revision
    const allLb = applyLoadBearing(pts.slice(0, 2), new Set([0, 1])).points
    expect(supervisionDecision([allLb])).toBe('second_pass')
  })
})
