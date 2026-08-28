import { describe, it, expect } from 'vitest'
import { shapeRecents, RECENTS_LIMIT, type RecentRow } from '@/lib/sets/recents'

const row = (over: Partial<RecentRow> = {}): RecentRow => ({
  viewedAt: new Date('2026-08-27T10:00:00Z'),
  set: {
    id: 's1',
    title: 'Merger Model',
    description: null,
    visibility: 'link',
    userId: 'owner',
    user: { handle: 'alice' },
    _count: { cards: 12 },
  },
  ...over,
})

describe('shapeRecents', () => {
  it('flattens a joined row into a RecentSet', () => {
    const [r] = shapeRecents([row()], 'viewer')
    expect(r).toEqual({
      id: 's1',
      title: 'Merger Model',
      description: null,
      cardCount: 12,
      visibility: 'link',
      ownerHandle: 'alice',
      isOwn: false,
      viewedAt: new Date('2026-08-27T10:00:00Z'),
    })
  })

  it('marks the viewer’s own set', () => {
    const [r] = shapeRecents([row({ set: { ...row().set, userId: 'viewer' } })], 'viewer')
    expect(r.isOwn).toBe(true)
  })

  it('carries a null handle rather than inventing one', () => {
    // User.name is the OAuth provider's REAL-NAME field and must never reach a
    // surface where it can be read as a public credit. No handle means no
    // credit line, not a fallback to a real name.
    const [r] = shapeRecents([row({ set: { ...row().set, user: { handle: null } } })], 'viewer')
    expect(r.ownerHandle).toBeNull()
  })

  it('preserves input order', () => {
    // The query orders by viewedAt desc; re-sorting here would be a second
    // notion of recency that can disagree with the index the query uses.
    const out = shapeRecents(
      [row({ set: { ...row().set, id: 'a' } }), row({ set: { ...row().set, id: 'b' } })],
      'viewer',
    )
    expect(out.map((r) => r.id)).toEqual(['a', 'b'])
  })

  it('returns an empty array for no rows', () => {
    expect(shapeRecents([], 'viewer')).toEqual([])
  })
})

describe('RECENTS_LIMIT', () => {
  it('is small enough to be one scannable strip', () => {
    expect(RECENTS_LIMIT).toBeGreaterThan(0)
    expect(RECENTS_LIMIT).toBeLessThanOrEqual(12)
  })
})
