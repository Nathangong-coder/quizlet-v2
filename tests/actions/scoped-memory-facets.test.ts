import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * `bySource` is the OPTION-COUNT list for the activity picker, so it has to be
 * counted with the picker's own dimension removed.
 *
 * Counted under the full scope, choosing "Multiple Choice" would drive every
 * other option's count to 0 — which reads as those activities having been
 * deleted, on the exact interaction that reveals the numbers. The other scope
 * dimensions must still apply, or narrowing to one set would report counts for
 * the whole library.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  eventFindMany: vi.fn(),
  eventAggregate: vi.fn(),
  eventGroupBy: vi.fn(),
  progressFindMany: vi.fn(),
  categoryFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studyEvent: {
      findMany: h.eventFindMany,
      aggregate: h.eventAggregate,
      groupBy: h.eventGroupBy,
    },
    cardProgress: { findMany: h.progressFindMany },
    cardCategory: { findMany: h.categoryFindMany },
  },
}))

import { getScopedMemoryStats } from '@/actions/memory'
import { EMPTY_SCOPE } from '@/lib/memory/scope'

/** The `where` each groupBy/aggregate call was issued with, by call order. */
function groupByWheres() {
  return h.eventGroupBy.mock.calls.map((c) => c[0])
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.eventFindMany.mockResolvedValue([{ cardId: 'c1' }])
  h.eventAggregate.mockResolvedValue({
    _count: { _all: 3 },
    _avg: { confidenceAfter: 6, score: 80 },
  })
  h.eventGroupBy.mockResolvedValue([])
  h.progressFindMany.mockResolvedValue([])
  h.categoryFindMany.mockResolvedValue([])
})

describe('getScopedMemoryStats: bySource is a facet, not a filtered count', () => {
  it('counts sources with the source filter REMOVED', async () => {
    await getScopedMemoryStats({ ...EMPTY_SCOPE, sources: ['quiz-mc'] })

    const bySource = groupByWheres().find((w) => w.by?.includes('source'))
    expect(bySource).toBeDefined()
    // The defining assertion: no `source` predicate on the facet query, even
    // though the scope carries one.
    expect(bySource!.where.source).toBeUndefined()
  })

  it('still applies the OTHER scope dimensions to the facet counts', async () => {
    // Dropping set scope too would report library-wide counts while every tile
    // beside them was scoped to one set.
    await getScopedMemoryStats({ ...EMPTY_SCOPE, setIds: ['s1'], sources: ['quiz-mc'] })

    const bySource = groupByWheres().find((w) => w.by?.includes('source'))
    expect(bySource!.where.card).toEqual({ setId: { in: ['s1'] } })
    expect(bySource!.where.userId).toBe('u1')
  })

  it('keeps the source filter on the totals, which are NOT a facet', async () => {
    // The tiles describe what the learner selected; only the picker's own
    // options are counted unfiltered.
    await getScopedMemoryStats({ ...EMPTY_SCOPE, sources: ['quiz-mc'] })

    const totals = h.eventAggregate.mock.calls[0][0]
    expect(totals.where.source).toEqual({ in: ['quiz-mc'] })
  })

  it('scopes "cards seen" by the source filter as well', async () => {
    await getScopedMemoryStats({ ...EMPTY_SCOPE, sources: ['quiz-mc'] })

    const distinct = h.eventFindMany.mock.calls[0][0]
    expect(distinct.where.source).toEqual({ in: ['quiz-mc'] })
  })

  it('returns the facet rows sorted by count, descending', async () => {
    h.eventGroupBy.mockImplementation((args: { by?: string[] }) =>
      Promise.resolve(
        args.by?.includes('source')
          ? [
              { source: 'review', _count: { _all: 2 } },
              { source: 'quiz-mc', _count: { _all: 9 } },
            ]
          : [],
      ),
    )

    const result = await getScopedMemoryStats(EMPTY_SCOPE)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.bySource).toEqual([
      { source: 'quiz-mc', count: 9 },
      { source: 'review', count: 2 },
    ])
  })
})
