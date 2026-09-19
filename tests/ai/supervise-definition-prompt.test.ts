import { describe, it, expect } from 'vitest'
import { SUPERVISE_DEFINITION_PROMPT } from '@/lib/ai/prompts/supervise-definition'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { DefinitionSupervisionSchema } from '@/lib/ai/schemas'
import { SUPERVISION_VERDICTS } from '@/lib/klp/definition-probe'

const input = {
  question: 'How do you project debt paydown in an LBO?',
  definition: 'Start with FCF (after interest) & allocate to mandatory repayments. If allowed, optional repayments beyond the minimum.',
  referenceAnswer: 'REF',
  klps: [
    { ref: 0, text: 'Debt paydown is projected in a schedule off FCF.', kind: 'definition', weight: 1 },
    { ref: 5, text: 'Repaying debt lowers next year\'s interest, accelerating paydown.', kind: 'causal', weight: 3 },
  ],
  graderVerdicts: [
    { ref: 0, status: 'partial', quote: 'Start with FCF' },
    { ref: 5, status: 'omission' },
  ],
  score: 53,
}

describe('SUPERVISE_DEFINITION_PROMPT', () => {
  const built = SUPERVISE_DEFINITION_PROMPT.build(input)

  it('is registered, version 1, on the supervision schema', () => {
    expect(PROMPT_REGISTRY['supervise-definition']).toBe(SUPERVISE_DEFINITION_PROMPT)
    expect(SUPERVISE_DEFINITION_PROMPT.version).toBe(1)
    expect(SUPERVISE_DEFINITION_PROMPT.schema).toBe(DefinitionSupervisionSchema)
  })

  it('shows the definition as the vetted ceiling, every point with its weight, and the grader verdict with its quote', () => {
    expect(built).toContain("Owner's definition: Start with FCF")
    expect(built).toContain('terseness is NOT a defect')
    expect(built).toContain('[5] (causal, weight 3) Repaying debt')
    expect(built).toContain('[0] partial — "Start with FCF"')
    expect(built).toContain('[5] omission')
    expect(built).toContain('scored 53/100')
  })

  it('offers exactly the closed vocabulary TypeScript decides on, and never asks for a decision', () => {
    for (const v of SUPERVISION_VERDICTS) expect(built).toContain(`"${v}"`)
    expect(built).not.toMatch(/"revise"|"escalate"/)
    expect(built).toContain('"wording": string | null')
  })

  it('the schema takes the four verdicts only and wants at least one point', () => {
    const ok = { points: [{ klpRef: 5, verdict: 'cut', reason: 'r', wording: null }], summary: 's' }
    expect(DefinitionSupervisionSchema.safeParse(ok).success).toBe(true)
    expect(DefinitionSupervisionSchema.safeParse({ ...ok, points: [{ ...ok.points[0], verdict: 'revise' }] }).success).toBe(false)
    expect(DefinitionSupervisionSchema.safeParse({ ...ok, points: [] }).success).toBe(false)
  })
})
