import { describe, it, expect } from 'vitest'
import { QUESTION_TEMPLATES, TEMPLATE_OVERFLOW, templateFor, templateMinimum, templateCeiling, validateTemplate, templateEdges, templatePromptBlock, allTemplatesPromptBlock } from '@/lib/klp/templates'
import { QUESTION_TYPES, KLP_KINDS } from '@/lib/ai/schemas'

describe('the seven templates', () => {
  it('one per question type; every slot kind is a real KLP kind; every relation rule names real slots', () => {
    expect(Object.keys(QUESTION_TEMPLATES).sort()).toEqual([...QUESTION_TYPES].sort())
    for (const t of Object.values(QUESTION_TEMPLATES)) {
      const ids = new Set(t.slots.map((s) => s.id))
      expect(ids.size).toBe(t.slots.length)
      for (const s of t.slots) {
        expect(s.min).toBeLessThanOrEqual(s.max)
        for (const k of s.kinds) expect(KLP_KINDS).toContain(k)
      }
      for (const r of t.relations) {
        if (r.rule === 'chain') expect(ids.has(r.slot)).toBe(true)
        else { expect(ids.has(r.from)).toBe(true); expect(ids.has(r.to)).toBe(true) }
      }
      expect(templateMinimum(t)).toBeGreaterThanOrEqual(2)
      expect(templateCeiling(t)).toBe(templateMinimum(t) + TEMPLATE_OVERFLOW)
    }
    expect(templateFor('why')?.type).toBe('why')
    expect(templateFor('vibes')).toBeNull()
    expect(templateFor(undefined)).toBeNull()
  })
})

describe('validateTemplate', () => {
  const why = QUESTION_TEMPLATES.why
  it('a filled form passes; overflow up to the ceiling is fine', () => {
    const pts = [
      { index: 0, slot: 'claim', kind: 'causal' },
      { index: 1, slot: 'mechanism', kind: 'mechanism' },
      { index: 2, slot: 'consequence', kind: 'causal' },
      { index: 3, slot: null, kind: 'example' },
    ]
    const d = validateTemplate(why, pts)
    expect(d.map((x) => x.rule)).toEqual(['unslotted'])
  })
  it('an unfilled required slot, an over-full slot, a wrong kind, an unknown slot and a set over the ceiling are each named', () => {
    const pts = [
      { index: 0, slot: 'claim', kind: 'causal' },
      { index: 1, slot: 'claim', kind: 'causal' }, // overfull
      { index: 2, slot: 'mechanism', kind: 'condition' }, // wrong kind
      { index: 3, slot: 'payoff', kind: 'causal' }, // unknown
      { index: 4, slot: null, kind: 'example' },
      { index: 5, slot: null, kind: 'example' },
      { index: 6, slot: null, kind: 'example' },
    ]
    const rules = validateTemplate(why, pts).map((x) => x.rule)
    expect(rules).toContain('slot_unfilled') // consequence
    expect(rules).toContain('slot_overfull')
    expect(rules).toContain('slot_kind')
    expect(rules).toContain('slot_unknown')
    expect(rules).toContain('over_ceiling') // 7 > 3 + 3
  })
  it('an enumeration takes its item count from the question: exactly N items, ceiling N + overflow', () => {
    const en = QUESTION_TEMPLATES.enumerate
    const five = Array.from({ length: 5 }, (_, i) => ({ index: i, slot: 'item', kind: 'definition' }))
    expect(validateTemplate(en, five, { listCount: 5 })).toEqual([])
    expect(validateTemplate(en, five.slice(0, 4), { listCount: 5 }).map((d) => d.rule)).toEqual(['slot_unfilled'])
    expect(templateCeiling(en, { listCount: 5 })).toBe(5 + TEMPLATE_OVERFLOW)
    expect(templatePromptBlock(en, { listCount: 5 })).toContain('exactly 5 point(s)')
    // without a count the static bounds apply
    expect(validateTemplate(en, five)).toEqual([])
  })

  it('a walkthrough needs three steps and an endpoint', () => {
    const d = validateTemplate(QUESTION_TEMPLATES.walkthrough, [{ index: 0, slot: 'step', kind: 'mechanism' }, { index: 1, slot: 'step', kind: 'mechanism' }])
    expect(d.map((x) => `${x.rule}:${'slot' in x ? x.slot : ''}`)).toEqual(['slot_unfilled:step', 'slot_unfilled:endpoint'])
  })
})

describe('templateEdges', () => {
  it('a walkthrough chains its steps in index order; a why links mechanism → consequence and condition applies_within', () => {
    const wt = templateEdges(QUESTION_TEMPLATES.walkthrough, [{ index: 2, slot: 'step', kind: 'mechanism' }, { index: 0, slot: 'step', kind: 'mechanism' }, { index: 1, slot: 'step', kind: 'mechanism' }, { index: 3, slot: 'endpoint', kind: 'causal' }])
    expect(wt).toEqual([{ from: 0, to: 1, type: 'precedes' }, { from: 1, to: 2, type: 'precedes' }])
    const why = templateEdges(QUESTION_TEMPLATES.why, [{ index: 0, slot: 'claim', kind: 'causal' }, { index: 1, slot: 'mechanism', kind: 'mechanism' }, { index: 2, slot: 'mechanism', kind: 'mechanism' }, { index: 3, slot: 'consequence', kind: 'causal' }, { index: 4, slot: 'condition', kind: 'condition' }])
    expect(why).toEqual([
      { from: 1, to: 3, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
      { from: 4, to: 3, type: 'applies_within' },
    ])
    // an enumeration implies no edges — never force them
    expect(templateEdges(QUESTION_TEMPLATES.enumerate, [{ index: 0, slot: 'item', kind: 'definition' }, { index: 1, slot: 'item', kind: 'definition' }])).toEqual([])
  })
})

describe('the prompt blocks', () => {
  it('render every slot with its count and kinds, the overflow rule, and the unfilled-slot concern', () => {
    const b = templatePromptBlock(QUESTION_TEMPLATES.why)
    expect(b).toContain('THE WHY TEMPLATE')
    expect(b).toContain('"mechanism": how it works')
    expect(b).toContain('1-2 point(s), kind mechanism | causal')
    expect(b).toContain('"condition" (optional)')
    expect(b).toContain(`Up to ${TEMPLATE_OVERFLOW} further points`)
    expect(b).toContain('UNFILLED SLOT:')
    const all = allTemplatesPromptBlock()
    for (const t of QUESTION_TYPES) expect(all).toContain(`${t}:`)
    expect(all).toContain('step ×3-7')
  })
})
