import { describe, it, expect, vi } from 'vitest'
import { authorCard } from '@/lib/klp/authoring'

/**
 * SLOT TEMPLATES IN THE LOOP (2026-09-19): the writer's questionType chooses
 * the form; TypeScript checks it every round and sends unfilled slots to the
 * same revise call as every other finding; the template's implied edges join
 * the relate candidates; slot / structure / definition mapping survive a
 * revision and reach the outcome.
 */
const whyKlps = [
  { text: 'Leverage boosts equity returns', kind: 'causal', slot: 'claim', subject: 'leverage', claim: 'boosts equity returns', qualifier: null, fromDefinition: 0 },
  { text: 'A smaller equity check makes the same gain a larger percentage', kind: 'mechanism', slot: 'mechanism', subject: 'equity check', claim: 'same gain, larger percentage', qualifier: null, fromDefinition: 0 },
  { text: 'So the sponsor IRR rises', kind: 'causal', slot: 'consequence', subject: 'sponsor IRR', claim: 'rises', qualifier: null, fromDefinition: 1 },
  { text: 'Only if value grows and debt is repaid', kind: 'condition', slot: 'condition', subject: 'return boost', claim: 'holds only if value grows and debt is repaid', qualifier: null, fromDefinition: 1 },
]

function gen(klps: typeof whyKlps, opts: { relations?: { from: number; to: number; type: string }[]; revised?: typeof whyKlps } = {}) {
  const grade = vi.fn().mockImplementation(({ candidateAnswer, klps: shown, relations }: { candidateAnswer: string; klps: { text: string }[]; relations?: unknown[] }) => ({
    verdicts: shown.map((_, i) => ({ klpIndex: i, verdict: candidateAnswer === 'ref' ? 'correct' : 'omission' })),
    ...(relations ? { relationVerdicts: relations.map((_, i) => ({ relationIndex: i, verdict: candidateAnswer === 'ref' ? 'correct' : 'omission' })) } : {}),
  }))
  return {
    grade,
    author: vi.fn().mockResolvedValue({ questionType: 'why', referenceAnswer: 'ref', klps, wrongAnswers: [{ kind: 'vague', text: 'w2' }, { kind: 'memorized_template', text: 'w3' }] }),
    revise: vi.fn().mockResolvedValue({ klps: opts.revised ?? klps }),
    relate: vi.fn().mockResolvedValue({ relations: (opts.relations ?? []).map((r) => ({ ...r, provenance: 'perturbation', rationale: 'r', probe: 'p' })) }),
  }
}

describe('slot templates in authorCard', () => {
  it('a filled why form: no template defects, structure and slots reach the outcome, implied edges are added with provenance template', async () => {
    const g = gen(whyKlps)
    const out = await authorCard({ question: 'Why do LBOs use leverage?', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.templateDefects).toEqual([])
    expect(out.klps.map((k) => k.slot)).toEqual(['claim', 'mechanism', 'consequence', 'condition'])
    expect(out.klps[1].structured).toEqual({ subject: 'equity check', claim: 'same gain, larger percentage', qualifier: null })
    expect(out.klps[2].definitionRef).toBe(1)
    // mechanism causes consequence; condition applies_within consequence
    expect(out.relations.map((r) => [r.from, r.to, r.type, r.provenance])).toEqual(expect.arrayContaining([[1, 2, 'causes', 'template'], [3, 2, 'applies_within', 'template']]))
    expect(g.revise).not.toHaveBeenCalled()
  })

  it('an unfilled slot is a finding that triggers a revision; the revised set keeps its structure', async () => {
    const missingConsequence = whyKlps.filter((k) => k.slot !== 'consequence')
    const g = gen(missingConsequence, { revised: whyKlps })
    const out = await authorCard({ question: 'Why?', definition: 'D', setTitle: 'S' }, g as never)
    expect(g.revise).toHaveBeenCalled()
    const findings = (g.revise.mock.calls[0][0] as { findings: { issue: string; fix: string }[] }).findings
    expect(findings.some((f) => f.issue === 'slot_unfilled' && /"consequence"/.test(f.fix))).toBe(true)
    // after revision the form is filled and the structure is present
    expect(out.templateDefects).toEqual([])
    expect(out.klps.map((k) => k.slot)).toContain('consequence')
  })

  it('a template-implied edge already proposed by the relate call is not duplicated', async () => {
    const g = gen(whyKlps, { relations: [{ from: 1, to: 2, type: 'causes' }] })
    const out = await authorCard({ question: 'Why?', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.relations.filter((r) => r.from === 1 && r.to === 2 && r.type === 'causes')).toHaveLength(1)
    expect(out.relationStats.candidates).toBe(2) // the relate call's one + the implied applies_within
  })

  it('a pre-v8 reply (no slots, no questionType) authors as before: no template, no defects, no structure', async () => {
    const plain = whyKlps.map((k) => ({ text: k.text, kind: k.kind }))
    const g = gen(plain as never)
    g.author.mockResolvedValue({ referenceAnswer: 'ref', klps: plain, wrongAnswers: [{ kind: 'vague', text: 'w2' }, { kind: 'memorized_template', text: 'w3' }] })
    const out = await authorCard({ question: 'Why?', definition: 'D', setTitle: 'S' }, g as never)
    expect(out.templateDefects).toEqual([])
    expect(out.klps.every((k) => k.slot === null && k.structured === null && k.definitionRef === null)).toBe(true)
  })
})
