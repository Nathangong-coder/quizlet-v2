import { describe, it, expect } from 'vitest'
import { classifyPointRoles, substanceSeparation, FRAMING_KINDS } from '@/lib/klp/framing'
import { computeSeparation } from '@/lib/klp/separation'
import { revisionFindings } from '@/lib/klp/authoring'
import { GRADE_CANDIDATE_PROMPT, KIND_STRICTNESS_CLAUSE, RELAXED_KINDS, STRICT_GRADING_CLAUSE } from '@/lib/ai/prompts/grade-candidate'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const V = (...vs: string[]) => vs as KlpVerdict[]
const W = (kind: string, ...vs: string[]) => ({ kind: kind as 'vague', text: kind, verdicts: V(...vs), score: 0 })

// A "define X, how does it link" card: [0] definition, [1] mechanism, [2] causal, [3] contrast.
const KLPS = [{ kind: 'definition' }, { kind: 'mechanism' }, { kind: 'causal' }, { kind: 'contrast' }]
const REF = { kind: 'reference' as const, verdicts: V('correct', 'correct', 'correct', 'correct') }

describe('classifyPointRoles', () => {
  it('is framing only for a definition/contrast point the memorized_template answer was credited on', () => {
    const wrong = [
      W('memorized_template', 'correct', 'partial', 'omission', 'correct'),
      W('vague', 'correct', 'omission', 'omission', 'omission'),
      W('confident_wrong', 'correct', 'contradicted', 'contradicted', 'correct'),
    ]
    expect(classifyPointRoles(KLPS, wrong)).toEqual(['framing', 'substance', 'substance', 'framing'])
  })

  it('a mechanism the template recites is still substance — the KIND gates it, not the trap alone', () => {
    const wrong = [W('memorized_template', 'omission', 'correct', 'correct', 'partial')]
    expect(classifyPointRoles(KLPS, wrong)).toEqual(['substance', 'substance', 'substance', 'substance'])
  })

  it('a definition only the vague answer passes is substance — that is a loose definition, a real defect', () => {
    const wrong = [W('memorized_template', 'partial', 'omission', 'omission', 'omission'), W('vague', 'correct', 'omission', 'omission', 'omission')]
    expect(classifyPointRoles(KLPS, wrong)[0]).toBe('substance')
  })

  it('with no template trap every point is substance', () => {
    expect(classifyPointRoles(KLPS, [W('vague', 'correct', 'correct', 'correct', 'correct')])).toEqual(Array(4).fill('substance'))
    expect(FRAMING_KINDS).toEqual(['definition', 'contrast'])
  })
})

describe('substanceSeparation', () => {
  const wrong = [W('memorized_template', 'correct', 'partial', 'omission', 'correct'), W('vague', 'omission', 'omission', 'omission', 'omission')]
  const grades = wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))

  it('drops the framing points from both sides of the subtraction', () => {
    const roles = classifyPointRoles(KLPS, wrong)
    const full = computeSeparation(REF, grades)
    const sub = substanceSeparation(REF, grades, roles)
    // full: template scores (1 + .5 + 0 + 1)/4 = 0.625 -> separation 0.375
    // substance [1],[2]: template scores (.5 + 0)/2 = 0.25 -> separation 0.75
    expect(full.separation).toBeCloseTo(0.375)
    expect(sub.separation).toBeCloseTo(0.75)
    expect(sub.separated).toBe(true)
    expect(full.separated).toBe(false)
  })

  it('keeps perKlp on the card\'s own indices, with framing points marked non-discriminating', () => {
    const sub = substanceSeparation(REF, grades, classifyPointRoles(KLPS, wrong))
    expect(sub.perKlp.map((p) => p.index)).toEqual([0, 1, 2, 3])
    expect(sub.perKlp[0]).toMatchObject({ discriminates: false, failsSomeWrong: false, passesReference: true })
    expect(sub.perKlp[2]).toMatchObject({ discriminates: true })
  })

  it('falls back to the full computation when every point is framing or none is', () => {
    const allFraming = substanceSeparation(REF, grades, ['framing', 'framing', 'framing', 'framing'])
    expect(allFraming).toEqual(computeSeparation(REF, grades))
    const none = substanceSeparation(REF, grades, ['substance', 'substance', 'substance', 'substance'])
    expect(none).toEqual(computeSeparation(REF, grades))
  })
})

describe('revisionFindings with roles', () => {
  it('does not report a framing point the template passed, but still reports every other trap on it', () => {
    const wrong = [W('memorized_template', 'correct', 'omission', 'omission', 'omission'), W('vague', 'correct', 'omission', 'omission', 'omission')]
    const roles = classifyPointRoles(KLPS, wrong)
    const grades = wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))
    const f = revisionFindings({ separation: substanceSeparation(REF, grades, roles), roles, referenceVerdicts: REF.verdicts, wrong, defects: [] })
    const onZero = f.filter((x) => x.index === 0).map((x) => x.issue)
    expect(onZero).toEqual(['accepted by the vague answer'])
  })

  it('without roles the template acceptance is a finding exactly as before', () => {
    const wrong = [W('memorized_template', 'correct', 'omission', 'omission', 'omission')]
    const grades = wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))
    const f = revisionFindings({ separation: computeSeparation(REF, grades), referenceVerdicts: REF.verdicts, wrong, defects: [] })
    expect(f.some((x) => x.index === 0 && x.issue === 'accepted by the memorized_template answer')).toBe(true)
  })
})

describe('REVISE_KLPS_PROMPT with roles', () => {
  it('renders a framing point as FRAMING to keep, never as CARRIES NO INFORMATION', () => {
    const p = REVISE_KLPS_PROMPT.build({
      question: 'Q',
      klps: [{ text: 'X is Y', kind: 'definition' }, { text: 'A drives B', kind: 'causal' }],
      discrimination: [
        { index: 0, passesReference: true, failsSomeWrong: false, discriminates: false },
        { index: 1, passesReference: true, failsSomeWrong: false, discriminates: false },
      ],
      roles: ['framing', 'substance'],
      targetCount: 3,
    })
    const zero = p.slice(p.indexOf('[0]'), p.indexOf('[1]'))
    expect(zero).toContain('FRAMING')
    expect(zero).not.toContain('CARRIES NO INFORMATION')
    expect(p.slice(p.indexOf('[1]'))).toContain('CARRIES NO INFORMATION')
  })
})

describe('GRADE_CANDIDATE_PROMPT kind-aware strictness', () => {
  const base = { question: 'Q', referenceAnswer: 'R', candidateAnswer: 'C', klps: [{ text: 'a', kind: 'mechanism' }, { text: 'b', kind: 'causal' }] }

  it('in strict mode tags each point with its kind and names the relaxed kinds', () => {
    const p = GRADE_CANDIDATE_PROMPT.build({ ...base, strict: true })
    expect(p).toContain('[0] (mechanism) a')
    expect(p).toContain('[1] (causal) b')
    expect(p).toContain(STRICT_GRADING_CLAUSE)
    expect(p).toContain(KIND_STRICTNESS_CLAUSE)
    for (const k of RELAXED_KINDS) expect(KIND_STRICTNESS_CLAUSE).toContain(k)
    expect(RELAXED_KINDS).not.toContain('causal')
    expect(KIND_STRICTNESS_CLAUSE).toContain('causal')
  })

  it('outside strict mode shows neither the kinds nor the clause, so stored scores stay on one prompt', () => {
    const p = GRADE_CANDIDATE_PROMPT.build(base)
    expect(p).toContain('[0] a')
    expect(p).not.toContain('(mechanism)')
    expect(p).not.toContain(KIND_STRICTNESS_CLAUSE)
  })

  it('strict without kinds is the plain strict clause', () => {
    const p = GRADE_CANDIDATE_PROMPT.build({ ...base, klps: [{ text: 'a' }], strict: true })
    expect(p).toContain(STRICT_GRADING_CLAUSE)
    expect(p).not.toContain(KIND_STRICTNESS_CLAUSE)
  })
})
