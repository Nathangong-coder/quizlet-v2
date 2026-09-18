import { describe, it, expect } from 'vitest'
import { WRITE_GRADER_PANEL_PROMPT, type WriteGraderPanelBuildInput } from '@/lib/ai/prompts/write-grader-panel'
import { GraderPanelSchema } from '@/lib/ai/schemas'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { GRADER_PANEL_LEVELS, GRADER_PANEL_MODES } from '@/lib/analysis/benchmark'

/**
 * Spec 5 §8: the adversary writes the panel with a STATED intent per answer
 * — its level or failure shape, its intended rank, and a rationale naming
 * which points it nails, fudges, omits or inverts and which form rules it
 * breaks. The grader then grades each answer alone and TypeScript computes
 * agreement. The prompt is the only place the intent is put into words, so
 * its constraints are pinned here.
 */
const base: WriteGraderPanelBuildInput = {
  question: 'Walk me through an LBO',
  definition: 'A sponsor buys a company mostly with debt',
  referenceAnswer: 'The sponsor funds the purchase mostly with debt and returns come from deleveraging.',
  klps: [
    { ref: 0, text: 'Sponsor funds the purchase mostly with debt', kind: 'mechanism' },
    { ref: 1, text: 'Returns come from deleveraging', kind: 'causal' },
  ],
  relations: [{ ref: 0, type: 'causes', fromRef: 0, toRef: 1 }],
  formReqs: [{ ref: 0, text: 'Answers the LBO question, not the DCF one' }],
  kind: 'levels',
}

describe('WRITE_GRADER_PANEL_PROMPT', () => {
  it('levels: names the four levels, asks for intendedRank and a rationale, and forbids copying the reference', () => {
    const p = WRITE_GRADER_PANEL_PROMPT.build(base)
    for (const level of GRADER_PANEL_LEVELS) expect(p).toContain(`"${level}"`)
    expect(p).toContain('intendedRank')
    expect(p).toContain('rationale')
    expect(p).toMatch(/expert[\s\S]{0,200}(must not|never|do not) (copy|reproduce)[\s\S]{0,80}verbatim/i)
  })

  it('levels: states the wrong and weak constraints in the spec’s words', () => {
    const p = WRITE_GRADER_PANEL_PROMPT.build(base)
    expect(p).toMatch(/"wrong"[\s\S]{0,200}confidently wrong on at least one causal point/i)
    expect(p).toMatch(/"weak"[\s\S]{0,200}omits at least two[\s\S]{0,80}contradicts none/i)
  })

  it('modes: names the four failure shapes and states each shape’s constraint', () => {
    const p = WRITE_GRADER_PANEL_PROMPT.build({ ...base, kind: 'modes' })
    for (const mode of GRADER_PANEL_MODES) expect(p).toContain(`"${mode}"`)
    expect(p).toContain('intendedRank')
    expect(p).toContain('rationale')
    expect(p).toMatch(/"gap"[\s\S]{0,160}omits[\s\S]{0,80}never contradicts/i)
    expect(p).toMatch(/"misconception"[\s\S]{0,160}contradicts at least one/i)
    expect(p).toMatch(/"connectivity"[\s\S]{0,200}every endpoint correctly[\s\S]{0,80}never the link/i)
    expect(p).toMatch(/"template"[\s\S]{0,300}neighbouring question/i)
    // A modes panel does not ask for competence levels.
    expect(p).not.toContain('"competent"')
  })

  it('asks for four self-contained answers of 60-200 words and a one-paragraph rationale naming the points and form rules', () => {
    for (const kind of ['levels', 'modes'] as const) {
      const p = WRITE_GRADER_PANEL_PROMPT.build({ ...base, kind })
      expect(p).toMatch(/60.{0,5}200 words/)
      expect(p).toMatch(/self-contained/i)
      expect(p).toMatch(/nails|fudges|omits|inverts/)
      expect(p).toMatch(/form (rules|requirements)[\s\S]{0,60}breaks/i)
    }
  })

  it('lists the card, reference answer, key points with kinds, relations and form requirements by ref', () => {
    const p = WRITE_GRADER_PANEL_PROMPT.build(base)
    expect(p).toContain('Walk me through an LBO')
    expect(p).toContain('A sponsor buys a company mostly with debt')
    expect(p).toContain('The sponsor funds the purchase mostly with debt and returns come from deleveraging.')
    expect(p).toContain('[0] (mechanism) Sponsor funds the purchase mostly with debt')
    expect(p).toContain('[1] (causal) Returns come from deleveraging')
    expect(p).toContain('[R0] (causes) [0] → [1]')
    expect(p).toContain('[F0] Answers the LBO question, not the DCF one')
  })

  it('omits the relation and form sections when a card has none', () => {
    const p = WRITE_GRADER_PANEL_PROMPT.build({ ...base, relations: [], formReqs: [] })
    expect(p).not.toContain('[R0]')
    expect(p).not.toContain('[F0]')
  })

  it('is version 1, carries the schema, and is registered', () => {
    expect(WRITE_GRADER_PANEL_PROMPT.id).toBe('write-grader-panel')
    expect(WRITE_GRADER_PANEL_PROMPT.version).toBe(1)
    expect(WRITE_GRADER_PANEL_PROMPT.schema).toBe(GraderPanelSchema)
    expect(PROMPT_REGISTRY['write-grader-panel']).toBe(WRITE_GRADER_PANEL_PROMPT)
  })
})

describe('GraderPanelSchema', () => {
  const answer = (over: Record<string, unknown>) => ({
    text: 'An answer of some length that the schema does not measure in words.',
    rationale: 'It nails point 0 and omits point 1.',
    ...over,
  })
  const levels = GRADER_PANEL_LEVELS.map((level, i) => answer({ level, intendedRank: i + 1 }))
  const modes = GRADER_PANEL_MODES.map((mode, i) => answer({ mode, intendedRank: i + 1 }))

  it('accepts a levels panel — each level once, intendedRank matching its position', () => {
    expect(GraderPanelSchema.safeParse({ answers: levels }).success).toBe(true)
  })

  it('accepts a modes panel — each shape once, ranks 1-4 distinct in any order', () => {
    expect(GraderPanelSchema.safeParse({ answers: modes }).success).toBe(true)
    const reranked = GRADER_PANEL_MODES.map((mode, i) => answer({ mode, intendedRank: 4 - i }))
    expect(GraderPanelSchema.safeParse({ answers: reranked }).success).toBe(true)
  })

  it('rejects three answers, five answers, and a duplicated level', () => {
    expect(GraderPanelSchema.safeParse({ answers: levels.slice(0, 3) }).success).toBe(false)
    expect(GraderPanelSchema.safeParse({ answers: [...levels, levels[0]] }).success).toBe(false)
    const dup = [...levels.slice(0, 3), answer({ level: 'expert', intendedRank: 4 })]
    expect(GraderPanelSchema.safeParse({ answers: dup }).success).toBe(false)
  })

  it('rejects a levels panel whose ranks contradict its levels', () => {
    // The adversary calling its "wrong" answer rank 1 is contradicting itself.
    const swapped = levels.map((a, i) => ({ ...a, intendedRank: 4 - i }))
    expect(GraderPanelSchema.safeParse({ answers: swapped }).success).toBe(false)
  })

  it('rejects a duplicated rank on a modes panel', () => {
    const dup = modes.map((a) => ({ ...a, intendedRank: 1 }))
    expect(GraderPanelSchema.safeParse({ answers: dup }).success).toBe(false)
  })

  it('rejects a mixed panel, an answer with both a level and a mode, and one with neither', () => {
    const mixed = [...levels.slice(0, 2), ...modes.slice(2)]
    expect(GraderPanelSchema.safeParse({ answers: mixed }).success).toBe(false)
    const both = levels.map((a) => ({ ...a, mode: 'gap' }))
    expect(GraderPanelSchema.safeParse({ answers: both }).success).toBe(false)
    const neither = levels.map((_a, i) => answer({ intendedRank: i + 1 }))
    expect(GraderPanelSchema.safeParse({ answers: neither }).success).toBe(false)
  })

  it('rejects an empty text or rationale', () => {
    expect(GraderPanelSchema.safeParse({ answers: [...levels.slice(0, 3), { ...levels[3], text: '' }] }).success).toBe(false)
    expect(GraderPanelSchema.safeParse({ answers: [...levels.slice(0, 3), { ...levels[3], rationale: '' }] }).success).toBe(false)
  })
})
