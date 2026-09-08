import { describe, it, expect } from 'vitest'
import {
  PANEL_LEVELS,
  PASSING_LEVELS,
  FAILING_LEVELS,
  PANEL_SEPARATION_FLOOR,
  computePanelCurve,
  diagnoseKlpCurves,
  findNonMonotonicKlps,
  formatPanelCurve,
  type GradedPanelMember,
  type PanelLevel,
} from '@/lib/klp/panel'
import { SEPARATION_FLOOR, USE_COMPETENCE_PANEL } from '@/lib/klp/authoring-config'
import { PROBE_KINDS } from '@/lib/klp/authoring-config'
import { WRITE_PANEL_PROMPT } from '@/lib/ai/prompts/write-panel'
import { PanelSchema } from '@/lib/ai/schemas'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const no: KlpVerdict = 'omission'

/** Builds a graded panel from a per-level verdict pattern. */
const panel = (rows: Partial<Record<PanelLevel, KlpVerdict[]>>): GradedPanelMember[] =>
  (Object.entries(rows) as [PanelLevel, KlpVerdict[]][]).map(([level, verdicts]) => ({
    level,
    verdicts,
  }))

describe('the panel vocabulary', () => {
  it('is ordered strongest to weakest — every curve statistic reads position as competence', () => {
    expect(PANEL_LEVELS).toEqual(['L4', 'L3', 'L2', 'L1', 'L0'])
  })

  it('partitions the levels into passing and failing with none left over', () => {
    expect([...PASSING_LEVELS, ...FAILING_LEVELS].sort()).toEqual([...PANEL_LEVELS].sort())
  })

  it('counts L3 as PASSING — it is the near-miss the old test had no room for', () => {
    // Measured across 130 runs, AUC is 1.000 on 129: the reference outscores
    // every adversary every time, so the discrimination test is saturated.
    // L3 is the candidate that can actually fail to separate.
    expect(PASSING_LEVELS).toContain('L3')
  })

  it('replaces the failure-kind archetypes rather than joining them', () => {
    for (const kind of PROBE_KINDS) {
      expect(PANEL_LEVELS as readonly string[]).not.toContain(kind)
    }
  })

  it('keeps its own floor, NOT comparable to the old separation floor', () => {
    // The quantities differ: `min(passing) - max(failing)` versus
    // `referenceScore - max(weak)`. Reusing the old floor would retune the
    // pipeline while looking like a refactor.
    expect(PANEL_SEPARATION_FLOOR).not.toBe(SEPARATION_FLOOR)
  })

  it('is off by default, so the corpus stays comparable while it is evaluated', () => {
    expect(USE_COMPETENCE_PANEL).toBe(false)
  })
})

describe('computePanelCurve', () => {
  it('takes the WEAKEST passing level and the STRONGEST failing one', () => {
    // Both ends take the hardest available comparison. `max` over failing
    // catches a set one strong-ish bad answer slips through; `min` over passing
    // catches a set so strict a genuinely competent answer fails it.
    const curve = computePanelCurve(panel({
      L4: [ok, ok],
      L3: [ok, no], // 0.5 — the weakest passing
      L2: [no, no],
      L1: [no, no],
      L0: [no, no],
    }))
    expect(curve.separation).toBeCloseTo(0.5)
  })

  it('is 0, not a pass, when one side of the panel is missing', () => {
    // No candidate on one side means the test did not run — the same posture
    // computeSeparation takes toward an empty adversary list.
    const curve = computePanelCurve(panel({ L4: [ok], L3: [ok] }))
    expect(curve.separation).toBe(0)
    expect(curve.separated).toBe(false)
  })

  it('reports scores strongest-first regardless of the input order', () => {
    const curve = computePanelCurve(panel({ L0: [no], L4: [ok], L2: [no] }))
    expect(curve.scores.map((s) => s.level)).toEqual(['L4', 'L2', 'L0'])
  })

  it('detects a non-monotonic curve, which the single-gap test cannot express', () => {
    const curve = computePanelCurve(panel({
      L4: [ok, no],
      L3: [no, no],
      L2: [ok, ok], // partial outscores competent
      L1: [no, no],
      L0: [no, no],
    }))
    expect(curve.monotonic).toBe(false)
    expect(curve.inversions[0]).toMatchObject({ stronger: 'L3', weaker: 'L2' })
  })

  it('calls a properly ordered curve monotonic', () => {
    const curve = computePanelCurve(panel({
      L4: [ok, ok], L3: [ok, no], L2: [no, no], L1: [no, no], L0: [no, no],
    }))
    expect(curve.monotonic).toBe(true)
    expect(curve.inversions).toEqual([])
  })
})

describe('diagnoseKlpCurves', () => {
  const shapeOf = (rows: Partial<Record<PanelLevel, KlpVerdict[]>>) =>
    diagnoseKlpCurves(panel(rows), 1)[0].shape

  it('calls a point that fires on the off-target answer keyword_matching', () => {
    // The worst case: an off-target answer cannot support a point about this
    // question, so the point is matching surface vocabulary, not content.
    expect(shapeOf({ L4: [ok], L3: [ok], L2: [ok], L1: [ok], L0: [ok] })).toBe('keyword_matching')
  })

  it('calls a point the expert answer fails too_strict — a FIDELITY alarm', () => {
    expect(shapeOf({ L4: [no], L3: [no], L2: [no], L1: [no], L0: [no] })).toBe('too_strict')
  })

  it('calls a point the confused answer satisfies too_loose', () => {
    expect(shapeOf({ L4: [ok], L3: [ok], L2: [ok], L1: [ok], L0: [no] })).toBe('too_loose')
  })

  it('reports the WORST shape only, not every one that applies', () => {
    // A point firing at L0 is also, necessarily, too loose. Reporting both
    // buries the worse finding under the milder one.
    expect(diagnoseKlpCurves(panel({
      L4: [ok], L3: [ok], L2: [ok], L1: [ok], L0: [ok],
    }), 1)).toHaveLength(1)
  })

  it('names the case the old test structurally could not see', () => {
    // Identical on competent and partial: the point does not measure what
    // separates them, which is the band most learners are actually in.
    expect(shapeOf({ L4: [ok], L3: [ok], L2: [ok], L1: [no], L0: [no] }))
      .toBe('blind_to_competence')
  })

  it('calls a well-behaved point healthy', () => {
    expect(shapeOf({ L4: [ok], L3: [ok], L2: [no], L1: [no], L0: [no] })).toBe('healthy')
  })

  it('diagnoses every key point, not just the first', () => {
    const out = diagnoseKlpCurves(panel({
      L4: [ok, no], L3: [ok, no], L2: [no, no], L1: [no, no], L0: [no, no],
    }), 2)
    expect(out.map((d) => d.shape)).toEqual(['healthy', 'too_strict'])
  })
})

describe('findNonMonotonicKlps', () => {
  it('is reported SEPARATELY, because the fix is not knowable from the shape', () => {
    // An inversion is EITHER ambiguous wording OR an unstable grader, and only
    // re-grading the same panel tells you which. Rolling it into the shape
    // diagnosis would send someone to reword a point that was fine.
    const out = findNonMonotonicKlps(panel({
      L4: [ok], L3: [no], L2: [ok], L1: [no], L0: [no],
    }), 1)
    expect(out).toHaveLength(1)
    expect(out[0].shape).toBe('non_monotonic')
    expect(out[0].detail).toContain('unstable grader')
  })

  it('says nothing about a point that only ever stops firing', () => {
    expect(findNonMonotonicKlps(panel({
      L4: [ok], L3: [ok], L2: [no], L1: [no], L0: [no],
    }), 1)).toEqual([])
  })
})

describe('formatPanelCurve', () => {
  it('names the floor it was judged against, so two runs are comparable', () => {
    const out = formatPanelCurve(computePanelCurve(panel({
      L4: [ok], L3: [ok], L2: [no], L1: [no], L0: [no],
    })))
    expect(out).toContain(String(PANEL_SEPARATION_FLOOR))
    expect(out).toContain('monotonic')
  })
})

describe('WRITE_PANEL_PROMPT', () => {
  const built = WRITE_PANEL_PROMPT.build({
    question: 'Why is the after-tax cost of debt lower than its coupon?',
    referenceAnswer: 'Interest is tax-deductible, so each dollar of interest saves the tax rate.',
  })

  it('NEVER sees the key points — otherwise every number from it is circular', () => {
    // A model shown the key points writes answers that hit or miss them on
    // purpose, and the panel then measures instruction-following rather than
    // whether the key points discriminate.
    expect(built.toLowerCase()).not.toContain('key learning point')
    expect(built.toLowerCase()).not.toContain('key point')
  })

  it('spends its words on L3, the level that is hard to write and easy to collapse', () => {
    const l3 = built.indexOf('L3 —')
    const l2 = built.indexOf('L2 —')
    expect(l3).toBeGreaterThan(-1)
    expect(built.slice(l3, l2).length).toBeGreaterThan(300)
  })

  it('forbids L3 being a shortened L4, and forbids it containing an error', () => {
    expect(built).toContain('must NOT be a shortened L4')
    expect(built).toContain('that is L1')
  })

  it('requires comparable length, so the grader cannot cheat on word count', () => {
    expect(built).toContain('comparable LENGTH')
  })

  it('names every level in the closed vocabulary', () => {
    for (const l of PANEL_LEVELS) expect(built).toContain(l)
  })
})

describe('PanelSchema', () => {
  const member = (level: string) => ({ level, text: 'an answer', weakness: 'a gap' })

  it('requires ALL five levels — a partial panel is useless, not merely reduced', () => {
    // The measurement is a curve across ordered levels; a missing L3 removes
    // exactly the near-miss the panel exists to add. Better to fail and retry
    // than to report a number computed from a curve with a hole in it.
    expect(PanelSchema.safeParse({ members: PANEL_LEVELS.map(member) }).success).toBe(true)
    expect(PanelSchema.safeParse({ members: [member('L4'), member('L0')] }).success).toBe(false)
  })

  it('rejects a level outside the vocabulary', () => {
    expect(PanelSchema.safeParse({
      members: [...PANEL_LEVELS.slice(1).map(member), member('L5')],
    }).success).toBe(false)
  })
})
