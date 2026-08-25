import { describe, it, expect } from 'vitest'
import { SUMMARIZE_KLTS_PROMPT } from '@/lib/ai/prompts/summarize-klts'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { KltSummarySchema, MAX_KLTS_PER_KLP } from '@/lib/ai/schemas'
import { MAX_LABEL_WORDS, MAX_KLT_WORDS } from '@/lib/klt/normalize'

const input = {
  setTitle: 'Valuation',
  klps: [
    { ref: 0, text: 'WACC weights each capital source by market value.', kind: 'mechanism' },
    {
      ref: 1,
      text: 'Interest is tax-deductible, lowering the after-tax cost of debt.',
      kind: 'causal',
    },
  ],
  candidates: ['WACC', 'Tax Shield'],
}

describe('SUMMARIZE_KLTS_PROMPT', () => {
  it('is in the registry under its id', () => {
    expect(PROMPT_REGISTRY['summarize-klts']).toBe(SUMMARIZE_KLTS_PROMPT)
  })

  it('carries a version so a wording change and its version stay in lockstep', () => {
    expect(SUMMARIZE_KLTS_PROMPT.version).toBe(2)
  })

  it('addresses KLPs by ref and never leaks a cuid', () => {
    const out = SUMMARIZE_KLTS_PROMPT.build(input)
    expect(out).toContain('[0]')
    expect(out).toContain('[1]')
    expect(out).not.toMatch(/c[a-z0-9]{24}/)
  })

  it('shows the candidate vocabulary and asks for reuse', () => {
    const out = SUMMARIZE_KLTS_PROMPT.build(input)
    expect(out).toContain('- WACC')
    expect(out).toContain('- Tax Shield')
    expect(out).toMatch(/REUSE/)
  })

  it('says so explicitly when there is no vocabulary yet', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build({ ...input, candidates: [] })).toContain(
      'no existing topics yet',
    )
  })

  it('states the topic cap it will actually be validated against', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toContain(`1 to ${MAX_KLTS_PER_KLP}`)
  })

  it('tells the model an empty topic list beats a wrong one', () => {
    // The prompt half of "degradation never fabricates" — the resolver drops
    // bad topics, but it is cheaper not to generate them.
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toMatch(/empty list is acceptable/i)
  })

  it('accepts a well-formed reply, including an empty topic list', () => {
    const parsed = KltSummarySchema.safeParse({
      klps: [
        { ref: 0, label: 'Market value weighting', topics: ['WACC'] },
        { ref: 1, label: 'Tax shield on debt', topics: [] },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects more topics than the cap', () => {
    const parsed = KltSummarySchema.safeParse({
      klps: [{ ref: 0, label: 'x', topics: ['a', 'b', 'c', 'd'] }],
    })
    expect(parsed.success).toBe(false)
  })

  it('rejects a negative ref', () => {
    expect(KltSummarySchema.safeParse({ klps: [{ ref: -1, label: 'x', topics: [] }] }).success).toBe(
      false,
    )
  })
})

describe('SUMMARIZE_KLTS_PROMPT — stated limits match enforced ones', () => {
  it('quotes the label cap that parseKltLabel actually applies', () => {
    // Drift here is invisible and expensive: the model is told one limit and
    // judged against another, so labels are silently discarded at a rate
    // nobody can explain from the prompt.
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toContain(`HARD LIMIT: ${MAX_LABEL_WORDS} words`)
  })

  it('quotes the topic cap that parseKltName actually applies', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toContain(`At most ${MAX_KLT_WORDS} words`)
  })

  it('warns against the specific failure mode that shipped', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toMatch(/copying or lightly rewording/)
  })
})
