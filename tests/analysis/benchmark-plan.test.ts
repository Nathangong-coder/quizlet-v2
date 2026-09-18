import { describe, it, expect } from 'vitest'
import { planPanels, planBench, buildPanelVerdicts } from '@/lib/analysis/benchmark-plan'
import type { ShortAnswerGrade } from '@/lib/ai/schemas'

/**
 * `npm run bench-grader`'s PURE pieces (Spec 5 §8, "Re-runnable"):
 *
 *  - `planPanels`: which cards need a panel — `--author` writes one only for
 *    a card lacking a panel at its current `klpVersion` and the run's `kind`.
 *  - `planBench`: which panel answers need grading — idempotent per
 *    `(answerId, graderVersion, model)`; a panel on a superseded klpVersion is
 *    stale and never graded (a re-authored card invalidates its panel).
 *  - `buildPanelVerdicts`: the grader's reply → the persisted entry shapes,
 *    with spans resolved in TypeScript and the unresolved count.
 *
 * The AI seam and Prisma are elsewhere (`benchmark-run.ts`); nothing here
 * needs a mock.
 */
describe('planPanels', () => {
  const cards = [
    { cardId: 'a', liveKlpVersion: 2, hasReference: true },
    { cardId: 'b', liveKlpVersion: 1, hasReference: true },
    { cardId: 'c', liveKlpVersion: null, hasReference: false },
    { cardId: 'd', liveKlpVersion: 1, hasReference: false },
  ]

  it('authors a panel only for a card with live key points, a reference, and no panel at (klpVersion, kind)', () => {
    const plan = planPanels(cards, [{ cardId: 'a', klpVersion: 2, kind: 'levels' }], { kind: 'levels' })
    expect(plan.toAuthor).toEqual(['b'])
    expect(plan.skipped).toEqual([
      { cardId: 'a', reason: 'has_panel' },
      { cardId: 'c', reason: 'no_live_klps' },
      { cardId: 'd', reason: 'no_reference' },
    ])
  })

  it('a panel at an OLD klpVersion does not count — the re-authored card gets a new one', () => {
    const plan = planPanels(cards, [{ cardId: 'a', klpVersion: 1, kind: 'levels' }], { kind: 'levels' })
    expect(plan.toAuthor).toEqual(['a', 'b'])
  })

  it('a panel of the OTHER kind does not count', () => {
    const plan = planPanels(cards, [{ cardId: 'a', klpVersion: 2, kind: 'modes' }], { kind: 'levels' })
    expect(plan.toAuthor).toEqual(['a', 'b'])
    expect(planPanels(cards, [{ cardId: 'a', klpVersion: 2, kind: 'modes' }], { kind: 'modes' }).toAuthor).toEqual(['b'])
  })

  it('preserves card order', () => {
    const plan = planPanels([cards[1], cards[0]], [], { kind: 'levels' })
    expect(plan.toAuthor).toEqual(['b', 'a'])
  })
})

describe('planBench', () => {
  const panels = [
    { id: 'p1', cardId: 'a', klpVersion: 2, liveKlpVersion: 2, answers: [{ id: 'a1' }, { id: 'a2' }] },
    { id: 'p2', cardId: 'b', klpVersion: 1, liveKlpVersion: 2, answers: [{ id: 'b1' }] },
  ]

  it('grades every answer of a live panel that has no result at (graderVersion, model)', () => {
    const plan = planBench(panels, [], { graderVersion: 1, model: 'deepseek-v4-flash' })
    expect(plan.toGrade).toEqual([
      { answerId: 'a1', panelId: 'p1', cardId: 'a' },
      { answerId: 'a2', panelId: 'p1', cardId: 'a' },
    ])
    expect(plan.skipped).toEqual([{ answerId: 'b1', reason: 'panel_stale' }])
  })

  it('is idempotent per (answerId, graderVersion, model): a matching result skips the answer', () => {
    const results = [{ answerId: 'a1', graderVersion: 1, model: 'deepseek-v4-flash' }]
    const plan = planBench(panels, results, { graderVersion: 1, model: 'deepseek-v4-flash' })
    expect(plan.toGrade.map((g) => g.answerId)).toEqual(['a2'])
    expect(plan.skipped).toContainEqual({ answerId: 'a1', reason: 'already_graded' })
  })

  it('a result under another model or another grader version does not satisfy the key', () => {
    const results = [
      { answerId: 'a1', graderVersion: 1, model: 'glm-5.3-flash' },
      { answerId: 'a2', graderVersion: 0, model: 'deepseek-v4-flash' },
    ]
    const plan = planBench(panels, results, { graderVersion: 1, model: 'deepseek-v4-flash' })
    expect(plan.toGrade.map((g) => g.answerId)).toEqual(['a1', 'a2'])
  })

  it('with the model unknown in advance (a rotating pool), any result at the grader version counts', () => {
    const results = [{ answerId: 'a1', graderVersion: 1, model: 'glm-5.3-flash' }]
    const plan = planBench(panels, results, { graderVersion: 1, model: null })
    expect(plan.toGrade.map((g) => g.answerId)).toEqual(['a2'])
  })
})

describe('buildPanelVerdicts', () => {
  const ctx = {
    answerText: 'Debt is repaid from free cash flow, which raises equity value at exit.',
    klps: [
      { id: 'k0', weight: 3 },
      { id: 'k1', weight: 1 },
    ],
    relations: [{ id: 'r0' }],
    formReqs: [{ id: 'f0' }],
  }
  const grade = {
    klpResults: [
      { klpRef: 0, status: 'correct', quote: 'repaid from free cash flow' },
      { klpRef: 1, status: 'passed', quote: 'RAISES equity value' },
    ],
    relationResults: [{ relationRef: 0, status: 'omission', quote: 'not in the answer at all' }],
    formResults: [{ formRef: 0, status: 'met' }],
  } as unknown as ShortAnswerGrade

  it('writes the persisted entry shapes with ids and weights from the context and spans resolved in TS', () => {
    const out = buildPanelVerdicts(grade, ctx)
    expect(out.verdicts).toEqual([
      { klpRef: 0, klpId: 'k0', status: 'correct', weight: 3, quote: 'repaid from free cash flow', spanStart: 8, spanEnd: 34 },
      // `passed` is the legacy alias; nothing is written with it any more.
      // The normalised pass resolves the case difference.
      { klpRef: 1, klpId: 'k1', status: 'correct', weight: 1, quote: 'RAISES equity value', spanStart: 42, spanEnd: 61 },
    ])
    expect(out.relationVerdicts).toEqual([
      { relationRef: 0, relationId: 'r0', status: 'omission', quote: 'not in the answer at all', spanStart: null, spanEnd: null },
    ])
    expect(out.formVerdicts).toEqual([{ formRef: 0, formRequirementId: 'f0', status: 'met', spanStart: null, spanEnd: null }])
    expect(out.unresolvedQuotes).toBe(1)
    expect(out.warnings).toEqual([{ reason: 'quote_unresolved', value: 'rel:0' }])
  })

  it('drops an out-of-range or duplicate ref with a warning, never inventing a verdict', () => {
    const out = buildPanelVerdicts(
      {
        klpResults: [
          { klpRef: 5, status: 'correct' },
          { klpRef: 0, status: 'omission' },
          { klpRef: 0, status: 'correct' },
        ],
        relationResults: [{ relationRef: 3, status: 'correct' }],
        formResults: [{ formRef: 0, status: 'not_met' }, { formRef: 0, status: 'met' }],
      } as unknown as ShortAnswerGrade,
      ctx,
    )
    expect(out.verdicts.map((v) => [v.klpId, v.status])).toEqual([['k0', 'omission']])
    expect(out.relationVerdicts).toEqual([])
    expect(out.formVerdicts.map((f) => f.status)).toEqual(['not_met'])
    expect(out.warnings.map((w) => w.reason)).toEqual([
      'unresolved_klp_ref',
      'duplicate_klp_ref',
      'unresolved_relation_ref',
      'duplicate_form_ref',
    ])
  })

  it('an empty or blank quote is "no quote" — no span, nothing unresolved', () => {
    const out = buildPanelVerdicts(
      { klpResults: [{ klpRef: 0, status: 'correct', quote: '  ' }] } as unknown as ShortAnswerGrade,
      ctx,
    )
    expect(out.verdicts[0]).toEqual({ klpRef: 0, klpId: 'k0', status: 'correct', weight: 3, spanStart: null, spanEnd: null })
    expect(out.unresolvedQuotes).toBe(0)
  })

  it('a grade with no per-point lists at all yields empty lists', () => {
    const out = buildPanelVerdicts({} as unknown as ShortAnswerGrade, ctx)
    expect(out).toEqual({ verdicts: [], relationVerdicts: [], formVerdicts: [], unresolvedQuotes: 0, warnings: [] })
  })
})
