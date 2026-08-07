import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * B4: the card-grain profile honoured only `setIds`.
 *
 * `getLearnerMetrics` returns `profile.cards` and `profile.topics` in one
 * object, and `topics` honours all four scope dimensions. `cards` accepted only
 * `setIds`, so `categoryKeys`, `cardId` and `source` were silently dropped: a
 * request scoped to ONE CARD came back with that card's topics sitting beside
 * weak/strong/starred terms and a streak computed over the learner's entire
 * library — two populations presented as one profile.
 *
 * Asserted against the `where` clauses actually issued, because the defect is
 * in the DB shell, not in the pure shaper. This file mocks `@/lib/db` at module
 * scope (the precedent set by tests/actions/quiz-resubmit-state.test.ts) rather
 * than appending to tests/memory/scope.test.ts, which must stay DB-free.
 */
const h = vi.hoisted(() => ({
  progressFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  setFindUnique: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    cardProgress: { findMany: h.progressFindMany },
    studyEvent: { findMany: h.eventFindMany },
    set: { findUnique: h.setFindUnique },
  },
}))

import { buildLearnerProfile } from '@/lib/memory/profile'
import { EMPTY_SCOPE, type HistoryScope } from '@/lib/memory/scope'

const scope = (over: Partial<HistoryScope> = {}): HistoryScope => ({
  ...EMPTY_SCOPE,
  ...over,
})

/** The `where` each half of the profile query was issued with. */
async function wheres(input: { scope: HistoryScope; categoryIds?: string[] }) {
  await buildLearnerProfile({
    userId: 'u1',
    scope: input.scope,
    categoryIds: input.categoryIds ?? [],
  })
  return {
    progress: h.progressFindMany.mock.calls[0][0].where,
    events: h.eventFindMany.mock.calls[0][0].where,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.progressFindMany.mockResolvedValue([])
  h.eventFindMany.mockResolvedValue([])
  h.setFindUnique.mockResolvedValue(null)
})

describe('the card-grain profile honours every scope dimension (B4)', () => {
  it('narrows by category, not only by set', async () => {
    const w = await wheres({
      scope: scope({ categoryKeys: ['valuation'] }),
      categoryIds: ['cat1'],
    })

    // Both halves, not just events: weak/strong/starred come from cardProgress,
    // and those are exactly the fields a category-scoped view is asked for.
    expect(JSON.stringify(w.progress)).toContain('cat1')
    expect(JSON.stringify(w.events)).toContain('cat1')
  })

  it('narrows by card, which subsumes set and category', async () => {
    const w = await wheres({ scope: scope({ setIds: ['s1'], cardId: 'c1' }) })

    expect(JSON.stringify(w.progress)).toContain('c1')
    expect(JSON.stringify(w.events)).toContain('c1')
    // A single card's own events ARE its set's events for this purpose; the
    // narrower filter subsumes the wider one, matching buildStudyEventWhere.
    expect(JSON.stringify(w.events)).not.toContain('s1')
  })

  it('narrows by source, so a review-scoped streak is not a whole-library streak', async () => {
    const w = await wheres({ scope: scope({ source: 'review' }) })

    expect(w.events.source).toBe('review')
    // CardProgress has no source column of its own — it is a per-card
    // aggregate — so it reaches one through the card's events.
    expect(JSON.stringify(w.progress)).toContain('review')
  })

  it('still scopes by set, and still resolves a single set title', async () => {
    h.setFindUnique.mockResolvedValue({ title: 'Valuation' })
    const profile = await buildLearnerProfile({
      userId: 'u1',
      scope: scope({ setIds: ['s1'] }),
      categoryIds: [],
    })

    expect(profile.setId).toBe('s1')
    expect(profile.setTitle).toBe('Valuation')
    expect(JSON.stringify(h.progressFindMany.mock.calls[0][0].where)).toContain('s1')
  })

  it('stays unscoped for the consolidated view', async () => {
    const w = await wheres({ scope: EMPTY_SCOPE })

    // The zero value must remain "everything", or the consolidated view breaks.
    expect(w.progress).toEqual({ userId: 'u1' })
    expect(w.events).toEqual({ userId: 'u1' })
  })
})
