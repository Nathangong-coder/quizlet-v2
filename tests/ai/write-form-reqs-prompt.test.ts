import { describe, it, expect } from 'vitest'
import { WRITE_FORM_REQS_PROMPT } from '@/lib/ai/prompts/write-form-reqs'
import { FormRequirementsSchema } from '@/lib/ai/schemas'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'

/**
 * Spec 5 §5: a form requirement is a SHAPE rule, distinct from the content the
 * key points require. The prompt has to say so in the words the spec uses,
 * because the failure it exists to catch — a fluent answer to a slightly
 * different question — is invisible to every content metric.
 */
describe('WRITE_FORM_REQS_PROMPT', () => {
  it('asks for 3-5 shape rules, names the four archetypes, forbids content restatement', () => {
    const p = WRITE_FORM_REQS_PROMPT.build({ question: 'Q', definition: 'D', referenceAnswer: 'R', klps: [{ text: 'K', kind: 'causal' }] })
    for (const s of ['answers the question asked', 'direction and magnitude', 'causal order', 'closes the loop']) expect(p.toLowerCase()).toContain(s)
    expect(p).toMatch(/3.{0,5}5/)
    expect(p).toMatch(/not restate|never restate|do not restate/i)
  })

  it('lists every key point with its kind so the writer can avoid restating it', () => {
    const p = WRITE_FORM_REQS_PROMPT.build({
      question: 'Walk me through an LBO',
      definition: 'D',
      referenceAnswer: 'R',
      klps: [
        { text: 'Sponsor funds the purchase mostly with debt', kind: 'mechanism' },
        { text: 'Returns come from deleveraging', kind: 'causal' },
      ],
    })
    expect(p).toContain('[0] (mechanism) Sponsor funds the purchase mostly with debt')
    expect(p).toContain('[1] (causal) Returns come from deleveraging')
    expect(p).toContain('Walk me through an LBO')
  })

  it('is version 1, carries the schema, and is registered', () => {
    expect(WRITE_FORM_REQS_PROMPT.id).toBe('write-form-reqs')
    expect(WRITE_FORM_REQS_PROMPT.version).toBe(1)
    expect(WRITE_FORM_REQS_PROMPT.schema).toBe(FormRequirementsSchema)
    expect(PROMPT_REGISTRY['write-form-reqs']).toBe(WRITE_FORM_REQS_PROMPT)
  })
})

describe('FormRequirementsSchema', () => {
  const req = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Requirement number ${i} of the shape` }))

  it('accepts 3 to 5 requirements of 8-160 characters', () => {
    expect(FormRequirementsSchema.safeParse({ requirements: req(3) }).success).toBe(true)
    expect(FormRequirementsSchema.safeParse({ requirements: req(5) }).success).toBe(true)
  })

  it('rejects fewer than 3, more than 5, and a requirement too short to be a rule', () => {
    expect(FormRequirementsSchema.safeParse({ requirements: req(2) }).success).toBe(false)
    expect(FormRequirementsSchema.safeParse({ requirements: req(6) }).success).toBe(false)
    expect(FormRequirementsSchema.safeParse({ requirements: [...req(2), { text: 'short' }] }).success).toBe(false)
    expect(FormRequirementsSchema.safeParse({ requirements: [...req(2), { text: 'x'.repeat(161) }] }).success).toBe(false)
  })
})
