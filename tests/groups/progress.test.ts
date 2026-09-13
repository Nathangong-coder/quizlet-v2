import { describe, it, expect } from 'vitest'
import { shapeSetLeaderboard, formatStudyTime, MASTERED_CONFIDENCE } from '@/lib/groups/progress'
import { generateInviteCode, isInviteCode, inviteUrl, INVITE_CODE_LENGTH } from '@/lib/groups/invite'

const d = (s: string) => new Date(s)
const alice = { userId: 'a', handle: 'alice' }
const bob = { userId: 'b', handle: 'bob' }
const cara = { userId: 'c', handle: null }

describe('shapeSetLeaderboard', () => {
  const base = {
    setId: 's1',
    cardIds: ['c1', 'c2', 'c3', 'c4'],
    members: [alice, bob, cara],
    sessions: [],
  }

  it('counts mastered at the threshold, studied, unstudied, and a null average for the unstudied member', () => {
    const lb = shapeSetLeaderboard({
      ...base,
      progress: [
        { userId: 'a', cardId: 'c1', confidence: MASTERED_CONFIDENCE, updatedAt: d('2026-09-10') },
        { userId: 'a', cardId: 'c2', confidence: MASTERED_CONFIDENCE - 1, updatedAt: d('2026-09-11') },
        { userId: 'b', cardId: 'c1', confidence: 9, updatedAt: d('2026-09-01') },
        { userId: 'b', cardId: 'c2', confidence: 9, updatedAt: d('2026-09-01') },
        { userId: 'b', cardId: 'c3', confidence: 3, updatedAt: d('2026-09-01') },
      ],
    })
    const [first, second, third] = lb.standings
    expect(first).toMatchObject({ userId: 'b', mastered: 2, studied: 3, unstudied: 1, averageConfidence: 7, rank: 1 })
    expect(second).toMatchObject({ userId: 'a', mastered: 1, studied: 2, unstudied: 2, averageConfidence: 6.5, rank: 2 })
    expect(second.lastStudiedAt).toEqual(d('2026-09-11'))
    // Never 0 for someone who has not opened the set.
    expect(third).toMatchObject({ userId: 'c', mastered: 0, studied: 0, unstudied: 4, averageConfidence: null, rank: 3, timeMs: 0 })
  })

  it('shares a rank on identical work (1, 1, 3)', () => {
    const lb = shapeSetLeaderboard({
      ...base,
      progress: [
        { userId: 'a', cardId: 'c1', confidence: 8, updatedAt: d('2026-09-10') },
        { userId: 'b', cardId: 'c2', confidence: 8, updatedAt: d('2026-09-10') },
      ],
    })
    expect(lb.standings.map((s) => [s.userId, s.rank])).toEqual([['a', 1], ['b', 1], ['c', 3]])
  })

  it('sums session time and lets a session move last-studied forward', () => {
    const lb = shapeSetLeaderboard({
      ...base,
      progress: [{ userId: 'a', cardId: 'c1', confidence: 8, updatedAt: d('2026-09-01') }],
      sessions: [
        { userId: 'a', setId: 's1', durationMs: 600000, startedAt: d('2026-09-12') },
        { userId: 'a', setId: 's1', durationMs: null, startedAt: d('2026-09-02') },
        { userId: 'a', setId: 'OTHER', durationMs: 999999, startedAt: d('2026-09-13') },
      ],
    })
    const a = lb.standings.find((s) => s.userId === 'a')!
    expect(a.timeMs).toBe(600000)
    expect(a.lastStudiedAt).toEqual(d('2026-09-12'))
  })

  it('ignores rows for non-members and for cards outside the set', () => {
    // The loader filters both; this is the belt to that brace. A stranger's
    // row must never become a member's number.
    const lb = shapeSetLeaderboard({
      ...base,
      progress: [
        { userId: 'stranger', cardId: 'c1', confidence: 10, updatedAt: d('2026-09-01') },
        { userId: 'a', cardId: 'not-in-set', confidence: 10, updatedAt: d('2026-09-01') },
      ],
    })
    expect(lb.standings.every((s) => s.studied === 0)).toBe(true)
    expect(lb.cards.every((c) => c.masteredBy.length === 0 && c.learningBy.length === 0)).toBe(true)
  })

  it('lists who has mastered and who is learning each card, sorted by handle', () => {
    const lb = shapeSetLeaderboard({
      ...base,
      progress: [
        { userId: 'b', cardId: 'c1', confidence: 9, updatedAt: d('2026-09-01') },
        { userId: 'a', cardId: 'c1', confidence: 8, updatedAt: d('2026-09-01') },
        { userId: 'c', cardId: 'c1', confidence: 2, updatedAt: d('2026-09-01') },
      ],
    })
    const c1 = lb.cards.find((c) => c.cardId === 'c1')!
    expect(c1.masteredBy.map((m) => m.userId)).toEqual(['a', 'b'])
    expect(c1.learningBy.map((m) => m.userId)).toEqual(['c'])
    expect(lb.cards.find((c) => c.cardId === 'c2')!.masteredBy).toEqual([])
  })
})

describe('formatStudyTime', () => {
  it('renders hours and minutes, and a dash for nothing', () => {
    expect(formatStudyTime(0)).toBe('—')
    expect(formatStudyTime(20000)).toBe('<1m')
    expect(formatStudyTime(45 * 60000)).toBe('45m')
    expect(formatStudyTime(200 * 60000)).toBe('3h 20m')
  })
})

describe('invite codes', () => {
  it('generates codes of the right shape that differ from each other', () => {
    const a = generateInviteCode()
    const b = generateInviteCode()
    expect(a).toHaveLength(INVITE_CODE_LENGTH)
    expect(isInviteCode(a)).toBe(true)
    expect(a).not.toBe(b)
  })
  it('rejects anything not shaped like a code before it reaches a query', () => {
    for (const bad of ['', 'short', 'ABCDEFGHJKMNPQRS', "x'; drop table", 'abcdefghjkmnpqrs0']) {
      expect(isInviteCode(bad), bad).toBe(false)
    }
  })
  it('builds the join link', () => {
    expect(inviteUrl('abcdefghjkmnpqrs', 'https://x.app')).toBe('https://x.app/groups/join/abcdefghjkmnpqrs')
  })
})
