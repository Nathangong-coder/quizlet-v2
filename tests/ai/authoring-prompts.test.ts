import { describe, it, expect } from 'vitest'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { AI_TASKS } from '@/lib/ai/model-routing'
import { KLP_VERDICTS } from '@/lib/klp/verdicts'

describe('AI_TASKS', () => {
  it('has an author task, separate from grade', () => {
    expect(AI_TASKS).toContain('author')
    expect(AI_TASKS).toContain('grade')
  })
})

describe('AUTHOR_KLPS_PROMPT', () => {
  const built = AUTHOR_KLPS_PROMPT.build({
    setTitle: 'Accounting', term: 'Depreciation walkthrough',
    definition: 'A $10 depreciation expense, 40% tax rate.',
  })

  it('asks for the reference answer FIRST — KLPs are derived from an artifact', () => {
    expect(built.toLowerCase().indexOf('reference answer'))
      .toBeLessThan(built.toLowerCase().indexOf('key learning point'))
  })

  it('names all three adversary archetypes', () => {
    for (const k of ['confident', 'vague', 'template']) {
      expect(built.toLowerCase()).toContain(k)
    }
  })

  it('states the 5-9 range as a smell test, not a quota', () => {
    expect(built).toMatch(/5\D{0,4}9/)
    expect(built.toLowerCase()).toContain('not a quota')
  })
})

describe('GRADE_CANDIDATE_PROMPT', () => {
  const built = GRADE_CANDIDATE_PROMPT.build({
    question: 'Walk me through it',
    referenceAnswer: 'EBIT falls 10...',
    klps: [{ text: 'EBIT falls by the full 10' }, { text: 'Net income falls 6' }],
    candidateAnswer: 'Uh, something goes down.',
  })

  it('offers the full verdict vocabulary', () => {
    for (const v of KLP_VERDICTS) expect(built).toContain(v)
  })

  /**
   * THE ISOLATION RULE. The grader must not learn which archetype it is
   * looking at, or it grades the label instead of the answer.
   */
  it('never reveals which adversary archetype the candidate is', () => {
    const lower = built.toLowerCase()
    for (const k of ['confident_wrong', 'vague', 'memorized_template', 'deliberately wrong']) {
      expect(lower).not.toContain(k)
    }
  })

  it('grades exactly one candidate', () => {
    expect(built).toContain('Uh, something goes down.')
    expect(built.toLowerCase()).not.toContain('candidate 2')
  })
})

describe('RELATE_KLPS_PROMPT', () => {
  const built = RELATE_KLPS_PROMPT.build({
    question: 'Walk me through it',
    klps: [{ text: 'a' }, { text: 'b' }],
  })

  /**
   * "K3 is false" cannot be propagated; "depreciation is a cash charge" can.
   * This distinction decides whether perturbation works at all.
   */
  it('asks for a counterfactual premise, not a negation', () => {
    expect(built.toLowerCase()).toContain('counterfactual')
    expect(built.toLowerCase()).not.toMatch(/assume .{0,20}is false/)
  })

  it('demands the adversarial artifact that proves an edge informative', () => {
    expect(built.toLowerCase()).toContain('both endpoints')
  })

  it('does not offer part_of — that is the concept tree', () => {
    expect(built).not.toContain('part_of')
  })
})
