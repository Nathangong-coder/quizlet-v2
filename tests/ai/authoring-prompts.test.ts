import { describe, it, expect } from 'vitest'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { AI_TASKS } from '@/lib/ai/model-routing'
import { KLP_VERDICTS } from '@/lib/klp/verdicts'
import { AuthorDraftSchema, RelationDraftSchema } from '@/lib/ai/schemas'
import { PROBE_KINDS, MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config'

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
    minKlps: 4,
  })

  it('asks for the reference answer FIRST — KLPs are derived from an artifact', () => {
    expect(built.toLowerCase().indexOf('reference answer'))
      .toBeLessThan(built.toLowerCase().indexOf('key learning point'))
  })

  it('names the two adversary archetypes and no longer the confident one', () => {
    for (const k of ['vague', 'template']) {
      expect(built.toLowerCase()).toContain(k)
    }
    expect(built).not.toContain('confident_wrong')
    expect(built).toContain('EXACTLY TWO WRONG ANSWERS')
  })

  it('states the sized floor as a floor, not a quota', () => {
    expect(built).toContain(`AT LEAST 4 KLPs, up to ${MAX_KLPS_AUTHORED}`)
    expect(built.toUpperCase()).toContain('NOT A QUOTA')
  })

  /**
   * Increment A §5: the floor is per-card, computed in TypeScript before the
   * call. A prompt that hardcoded it would make the whole sizing layer inert.
   */
  it('carries the per-card floor it was built with', () => {
    const bigger = AUTHOR_KLPS_PROMPT.build({
      setTitle: 'Accounting', term: 'Depreciation walkthrough',
      definition: 'A $10 depreciation expense, 40% tax rate.',
      minKlps: 7,
    })
    expect(bigger).toContain('AT LEAST 7 KLPs')
  })

  /**
   * Increment A §2. Version 1 let the model write a reference answer freely,
   * which is how inaccurate claims got in; the definition is now the skeleton,
   * and a disagreement with it goes to `concerns` rather than a silent rewrite.
   */
  it('makes the definition the skeleton and routes disagreement to concerns', () => {
    expect(built).toContain('SKELETON')
    expect(built.toLowerCase()).toContain('do not silently correct it')
    expect(built).toContain('"concerns"')
  })

  /** Increment A §3: index means delivery order, and the last KLP lands the answer. */
  it('asks for setup -> mechanism -> payoff ordering', () => {
    const lower = built.toLowerCase()
    expect(lower).toContain('setup first')
    expect(lower).toContain('the final klp must land the answer')
  })

  /**
   * Increment A §4. A concrete contrast pair moves model output; an abstract
   * instruction to "be clear" does not — which is why this is prompt copy and
   * not a validator.
   */
  it("teaches practitioner phrasing with the owner's own contrast pair", () => {
    expect(built).toContain("reducing the calculation's denominator")
    expect(built).toContain('smaller equity base')
  })

  /** The model assesses detail per point; TypeScript does the adding up. */
  it('asks for a per-point detail assessment rather than a total', () => {
    expect(built).toContain('klpsNeeded')
    expect(built.toLowerCase()).toContain('not a total to hit')
  })

  it('is version 4 — promptVersion is persisted, so the change must be visible', () => {
    expect(AUTHOR_KLPS_PROMPT.version).toBe(4)
  })

  it('v3 classifies the question first, defines the term as key point [0], keeps an enumeration as items, and leans the count to floor+1..floor+3', () => {
    const built = AUTHOR_KLPS_PROMPT.build({ setTitle: 'S', term: 'What are 2 ways an acquisition can create value?', definition: 'd', minKlps: 5 })
    expect(built).toContain('QUESTION TYPE')
    expect(built).toContain('"questionType"')
    expect(built).toContain('DEFINING THE TERM the question turns on')
    expect(built).toContain('That definition is the FIRST key point')
    expect(built).toContain('Never dissolve the list into a chain of mechanisms')
    expect(built).toContain('the usual right number is 6 to 8')
    expect(built).toContain('ONE short context clause')
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

  /**
   * Review Fix 1: `authorCard` grades the reference candidate too, in its
   * own call, with `candidateAnswer === referenceAnswer`. Showing the
   * reference block unconditionally would put the identical text in the
   * prompt twice — once labelled "the strong reference answer" and once as
   * "the candidate's answer" — pre-telling the grader the text is the gold
   * standard before asking it to judge that same text. That breaks design
   * §2's first condition (a KLP must genuinely PASS on the reference) and
   * inflates `referenceScore` on every card.
   */
  it('omits the reference block when grading the reference itself, so its text appears exactly once', () => {
    const same = 'EBIT falls 10...'
    const selfGraded = GRADE_CANDIDATE_PROMPT.build({
      question: 'Walk me through it',
      referenceAnswer: same,
      klps: [{ text: 'EBIT falls by the full 10' }],
      candidateAnswer: same,
    })
    const occurrences = selfGraded.split(same).length - 1
    expect(occurrences).toBe(1)
    expect(selfGraded.toLowerCase()).not.toContain('reference answer')
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

  /**
   * Review Fix 3: `analogous_to` is a real member of the general relation
   * vocabulary but is cross-card; this call only ever sees one card's KLPs.
   * The prompt must not offer it, and `RelationDraftSchema` below is the
   * actual enforcement — prompt copy alone is not a defence against a model
   * that ignores it.
   */
  it('does not offer analogous_to — cross-card, not extracted here', () => {
    expect(built).not.toContain('analogous_to')
  })
})

describe('AuthorDraftSchema', () => {
  const validKlps = [{ text: 'a', kind: 'mechanism' as const }]

  const wrongAnswers = (kinds: readonly string[]) =>
    kinds.map((kind, i) => ({ kind, text: `w${i}` }))

  it('accepts exactly three wrong answers, one per archetype', () => {
    const result = AuthorDraftSchema.safeParse({
      referenceAnswer: 'ref',
      klps: validKlps,
      wrongAnswers: wrongAnswers(PROBE_KINDS),
    })
    expect(result.success).toBe(true)
  })

  /**
   * Review Fix 6: `.min(1)` alone let a model return one adversary, and
   * `computeSeparation` reads the BEST wrong answer — so a card with only
   * one (easy) wrong answer silently loses most of its discrimination test.
   */
  it('rejects fewer wrong answers than archetypes', () => {
    const result = AuthorDraftSchema.safeParse({
      referenceAnswer: 'ref',
      klps: validKlps,
      wrongAnswers: wrongAnswers(PROBE_KINDS.slice(0, 1)),
    })
    expect(result.success).toBe(false)
  })

  it('rejects more wrong answers than archetypes', () => {
    const result = AuthorDraftSchema.safeParse({
      referenceAnswer: 'ref',
      klps: validKlps,
      wrongAnswers: wrongAnswers([...PROBE_KINDS, 'vague']),
    })
    expect(result.success).toBe(false)
  })

  /**
   * Three answers of the same archetype pass a bare `.length(3)` but are not
   * the three-archetype design the prompt asks for — distinctness must be
   * checked separately.
   */
  it('rejects three wrong answers of the same archetype', () => {
    const result = AuthorDraftSchema.safeParse({
      referenceAnswer: 'ref',
      klps: validKlps,
      wrongAnswers: wrongAnswers(['vague', 'vague', 'vague']),
    })
    expect(result.success).toBe(false)
  })
})

describe('RelationDraftSchema', () => {
  const base = { from: 0, to: 1, provenance: 'substitution' as const, rationale: 'r', probe: 'p' }

  it('accepts a relatable type', () => {
    const result = RelationDraftSchema.safeParse({ relations: [{ ...base, type: 'confused_with' }] })
    expect(result.success).toBe(true)
  })

  /**
   * Review Fix 3: the schema is the actual enforcement that `analogous_to`
   * — cross-card, not extracted by this call — never reaches persistence,
   * regardless of what the prompt asked for.
   */
  it('rejects a draft containing analogous_to', () => {
    const result = RelationDraftSchema.safeParse({ relations: [{ ...base, type: 'analogous_to' }] })
    expect(result.success).toBe(false)
  })
})

describe('AUTHOR_KLPS_BATCH_PROMPT', () => {
  it('shares the single prompt\'s instruction body and addresses each card by ref with its own floor', async () => {
    const { AUTHOR_KLPS_BATCH_PROMPT, AUTHOR_KLPS_PROMPT: single } = await import('@/lib/ai/prompts/author-klps')
    const batch = AUTHOR_KLPS_BATCH_PROMPT.build({
      setTitle: 'S',
      cards: [
        { ref: 0, term: 'T0', definition: 'D0', minKlps: 4 },
        { ref: 1, term: 'T1', definition: 'D1', minKlps: 6 },
      ],
    })
    expect(batch).toContain('[0] Term: T0')
    expect(batch).toContain('[1] Term: T1')
    expect(batch).toContain('Floor: at least 6 KLPs; the usual right number is 7 to 9')
    expect(batch).toContain('"cards": [ { "ref": number')
    // The judgment text is the same text the single prompt carries.
    const one = single.build({ setTitle: 'S', term: 'T0', definition: 'D0', minKlps: 4 })
    for (const anchor of ['THE DEFINITION IS YOUR SKELETON', 'QUESTION TYPE', 'PHRASE THEM THE WAY A PRACTITIONER WOULD', 'EXACTLY TWO WRONG ANSWERS']) {
      expect(batch).toContain(anchor)
      expect(one).toContain(anchor)
    }
    const { AuthorDraftBatchSchema } = await import('@/lib/ai/schemas')
    expect(AuthorDraftBatchSchema.safeParse({ cards: [] }).success).toBe(false)
  })
})
