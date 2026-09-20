import { describe, it, expect } from 'vitest'
import { evaluateRelations, relationPass, combinedSeparation } from '@/lib/klp/relation-separation'
import { computeSeparation } from '@/lib/klp/separation'
import { SEPARATION_FLOOR } from '@/lib/klp/authoring-config'

const ref = { kind: 'reference' as const, verdicts: ['correct', 'correct', 'omission', 'correct'] as const }
const vague = { kind: 'vague' as const, verdicts: ['omission', 'omission', 'omission', 'omission'] as const }
const template = { kind: 'memorized_template' as const, verdicts: ['correct', 'contradicted', 'correct', 'correct'] as const }
const r = (g: { kind: 'reference' | 'vague' | 'memorized_template'; verdicts: readonly string[] }) => ({ kind: g.kind, verdicts: [...g.verdicts] as never[] })

describe('evaluateRelations', () => {
  it('an edge discriminates when the reference asserts it and some trap fails it', () => {
    const e = evaluateRelations(r(ref), [r(vague), r(template)])
    expect(e.map((x) => x.discriminates)).toEqual([true, true, false, true])
    expect(e[2]).toMatchObject({ passesReference: false })
  })
})

describe('relationPass', () => {
  it('prunes edges the reference fails and separates over the rest', () => {
    const p = relationPass(r(ref), [r(vague), r(template)])
    expect(p.kept).toEqual([0, 1, 3])
    expect(p.droppedForReference).toEqual([2])
    // kept: ref 1,1,1 → 1.0; vague 0,0,0 → 0; template 1,0,1 → 0.667; separation 0.333
    expect(p.relationSeparation?.referenceScore).toBe(1)
    expect(p.relationSeparation?.bestWrongScore).toBeCloseTo(2 / 3)
    expect(p.relationSeparation?.separation).toBeCloseTo(1 / 3)
  })
  it('nothing kept → no separation, never NaN', () => {
    const p = relationPass({ kind: 'reference', verdicts: ['omission', 'failed'] as never[] }, [r(vague)])
    expect(p.kept).toEqual([])
    expect(p.relationSeparation).toBeNull()
  })
})

describe('combinedSeparation', () => {
  const pRef = { kind: 'reference' as const, verdicts: ['correct', 'correct', 'correct'] as never[] }
  // The template recites every point (points separation 0) …
  const pTemplate = { kind: 'memorized_template' as const, verdicts: ['correct', 'correct', 'correct'] as never[] }
  const pVague = { kind: 'vague' as const, verdicts: ['omission', 'omission', 'partial'] as never[] }
  const roles = ['framing', 'substance', 'substance'] as const

  it('links rescue a card whose points a template recites', () => {
    const pointsOnly = computeSeparation({ kind: 'reference', verdicts: pRef.verdicts.slice(1) }, [{ kind: 'memorized_template', verdicts: pTemplate.verdicts.slice(1) }, { kind: 'vague', verdicts: pVague.verdicts.slice(1) }])
    expect(pointsOnly.separation).toBe(0)
    // … but contradicts both links.
    const rels = {
      reference: { kind: 'reference' as const, verdicts: ['correct', 'correct'] as never[] },
      wrong: [
        { kind: 'memorized_template' as const, verdicts: ['contradicted', 'omission'] as never[] },
        { kind: 'vague' as const, verdicts: ['omission', 'omission'] as never[] },
      ],
      kept: [0, 1],
    }
    const c = combinedSeparation({ reference: pRef, wrong: [pTemplate, pVague], roles: [...roles] }, rels)
    // substance points 2 + links 2: ref 4/4; template 2/4; vague 0.5/4 → 1 − 0.5 = 0.5
    expect(c.referenceScore).toBe(1)
    expect(c.bestWrongScore).toBeCloseTo(0.5)
    expect(c.separation).toBeCloseTo(0.5)
    expect(c.separated).toBe(0.5 >= SEPARATION_FLOOR)
  })

  it('with no kept relations it equals the substance separation', () => {
    const c = combinedSeparation({ reference: pRef, wrong: [pTemplate, pVague], roles: [...roles] }, null)
    expect(c.separation).toBe(0)
    expect(c.perKlp).toHaveLength(2)
  })

  it('a trap with no relation grade is read as failing every link, never as passing', () => {
    const rels = { reference: { kind: 'reference' as const, verdicts: ['correct'] as never[] }, wrong: [], kept: [0] }
    const c = combinedSeparation({ reference: pRef, wrong: [pTemplate], roles: [...roles] }, rels)
    // template: 2 points right, link missing → 2/3
    expect(c.bestWrongScore).toBeCloseTo(2 / 3)
  })
})
