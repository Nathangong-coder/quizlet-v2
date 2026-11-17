import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  relationFindMany: vi.fn(),
  formReqFindMany: vi.fn(),
  authoringFindFirst: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    klpRelation: { findMany: h.relationFindMany },
    cardFormRequirement: { findMany: h.formReqFindMany },
    cardAuthoring: { findFirst: h.authoringFindFirst },
  },
}))

import { loadGradingContext, promptViewOf } from '@/lib/quiz/grading-context'

const klps = [
  { id: 'klp-a', version: 3 },
  { id: 'klp-b', version: 3 },
  { id: 'klp-c', version: 3 },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.relationFindMany.mockResolvedValue([])
  h.formReqFindMany.mockResolvedValue([])
  h.authoringFindFirst.mockResolvedValue(null)
})

describe('loadGradingContext', () => {
  it('returns an empty context without querying when the card has no live key points', async () => {
    const ctx = await loadGradingContext('card-1', [])

    expect(ctx).toEqual({ relations: [], formReqs: [], referenceAnswer: null })
    expect(h.relationFindMany).not.toHaveBeenCalled()
    expect(h.formReqFindMany).not.toHaveBeenCalled()
    expect(h.authoringFindFirst).not.toHaveBeenCalled()
  })

  it('loads relations whose BOTH endpoints are live key points', async () => {
    h.relationFindMany.mockResolvedValue([
      { id: 'rel-1', type: 'causes', fromKlpId: 'klp-a', toKlpId: 'klp-b' },
    ])

    const ctx = await loadGradingContext('card-1', klps)

    const where = h.relationFindMany.mock.calls[0][0].where
    expect(where.fromKlpId).toEqual({ in: ['klp-a', 'klp-b', 'klp-c'] })
    expect(where.toKlpId).toEqual({ in: ['klp-a', 'klp-b', 'klp-c'] })
    expect(ctx.relations).toEqual([{ id: 'rel-1', type: 'causes', fromKlpId: 'klp-a', toKlpId: 'klp-b' }])
  })

  it('drops a relation with a superseded endpoint even if the query returned it', async () => {
    // Belt and braces: the `in` filter should already exclude it, but the
    // prompt ref → id alignment downstream depends on every relation
    // resolving to two live refs, so the loader guarantees it.
    h.relationFindMany.mockResolvedValue([
      { id: 'rel-stale', type: 'causes', fromKlpId: 'klp-a', toKlpId: 'klp-old' },
      { id: 'rel-1', type: 'requires', fromKlpId: 'klp-b', toKlpId: 'klp-c' },
    ])

    const ctx = await loadGradingContext('card-1', klps)

    expect(ctx.relations.map((r) => r.id)).toEqual(['rel-1'])
  })

  it('loads form requirements at the live klpVersion and dedupes by index, first row winning', async () => {
    // No unique index on (cardId, klpVersion, index) yet — an owner click
    // racing the cron can double-write a card. The grader must see each
    // requirement once, or two refs would map to the same shape and the
    // second verdict would land on a duplicate row.
    h.formReqFindMany.mockResolvedValue([
      { id: 'form-0', index: 0, text: 'Names the formula' },
      { id: 'form-0-dup', index: 0, text: 'Names the formula' },
      { id: 'form-1', index: 1, text: 'States the direction' },
    ])

    const ctx = await loadGradingContext('card-1', klps)

    expect(h.formReqFindMany.mock.calls[0][0].where).toEqual({ cardId: 'card-1', klpVersion: 3 })
    expect(ctx.formReqs).toEqual([
      { id: 'form-0', index: 0, text: 'Names the formula' },
      { id: 'form-1', index: 1, text: 'States the direction' },
    ])
  })

  it('reads the reference answer from the latest authoring at the live version', async () => {
    h.authoringFindFirst.mockResolvedValue({ referenceAnswer: 'A strong answer.' })

    const ctx = await loadGradingContext('card-1', klps)

    const args = h.authoringFindFirst.mock.calls[0][0]
    expect(args.where).toEqual({ cardId: 'card-1', klpVersion: 3 })
    expect(args.orderBy).toEqual({ createdAt: 'desc' })
    expect(ctx.referenceAnswer).toBe('A strong answer.')
  })

  it('reads null, not undefined, when the card was never authored', async () => {
    const ctx = await loadGradingContext('card-1', klps)
    expect(ctx.referenceAnswer).toBeNull()
  })
})

describe('promptViewOf', () => {
  it('renders relations by key-point REF, never by id, and form reqs by array position', () => {
    const view = promptViewOf(klps, {
      relations: [
        { id: 'rel-1', type: 'causes', fromKlpId: 'klp-c', toKlpId: 'klp-a' },
        { id: 'rel-2', type: 'requires', fromKlpId: 'klp-a', toKlpId: 'klp-b' },
      ],
      formReqs: [{ id: 'form-7', index: 0, text: 'Names the formula' }],
      referenceAnswer: null,
    })

    expect(view.promptRelations).toEqual([
      { ref: 0, type: 'causes', fromRef: 2, toRef: 0 },
      { ref: 1, type: 'requires', fromRef: 0, toRef: 1 },
    ])
    expect(view.promptFormReqs).toEqual([{ ref: 0, text: 'Names the formula' }])
    expect(JSON.stringify(view)).not.toContain('rel-1')
    expect(JSON.stringify(view)).not.toContain('form-7')
  })

  it('keeps prompt refs aligned with the context arrays the writer resolves against', () => {
    // buildAnalysisWrites resolves `relationRef` / `formRef` as an index into
    // the arrays it is handed. If the prompt view ever skipped or reordered
    // an entry, a verdict on [R1] would land on the wrong row.
    const ctx = {
      relations: [
        { id: 'rel-1', type: 'causes', fromKlpId: 'klp-a', toKlpId: 'klp-b' },
        { id: 'rel-2', type: 'precedes', fromKlpId: 'klp-b', toKlpId: 'klp-c' },
      ],
      formReqs: [
        { id: 'form-0', index: 0, text: 'x' },
        { id: 'form-1', index: 1, text: 'y' },
      ],
      referenceAnswer: null,
    }
    const view = promptViewOf(klps, ctx)
    view.promptRelations.forEach((r, i) => expect(r.ref).toBe(i))
    view.promptFormReqs.forEach((f, i) => expect(f.ref).toBe(i))
    expect(view.promptRelations).toHaveLength(ctx.relations.length)
    expect(view.promptFormReqs).toHaveLength(ctx.formReqs.length)
  })
})
