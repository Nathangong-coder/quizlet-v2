import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionFindFirst: vi.fn(),
  eventCount: vi.fn(),
  cardFindMany: vi.fn(),
  recordStudyEvent: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studySession: { findFirst: h.sessionFindFirst },
    studyEvent: { count: h.eventCount },
    card: { findMany: h.cardFindMany },
  },
}))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { submitMatchSession } from '@/actions/match-session'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
})

describe('submitMatchSession', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)

    const result = await submitMatchSession({
      sessionId: 'sess1',
      results: [{ cardId: 'c1', correct: true }],
    })

    expect(result.success).toBe(false)
    expect(h.sessionFindFirst).not.toHaveBeenCalled()
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('refuses a session belonging to someone else, scoped by userId and kind', async () => {
    // The id (and cardIds) arrive from the client, so the session lookup
    // must be scoped by userId — and to matching sessions specifically.
    h.sessionFindFirst.mockResolvedValue(null)

    const result = await submitMatchSession({
      sessionId: 'sess-other',
      results: [{ cardId: 'c1', correct: true }],
    })

    expect(result.success).toBe(false)
    expect(h.sessionFindFirst).toHaveBeenCalledWith({
      where: { id: 'sess-other', userId: OWNER, kind: 'matching' },
    })
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('is idempotent: a second submit for the same session records nothing more', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.eventCount.mockResolvedValue(2) // events already recorded from a prior submit

    const result = await submitMatchSession({
      sessionId: 'sess1',
      results: [
        { cardId: 'c1', correct: true },
        { cardId: 'c2', correct: false },
      ],
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ recorded: 0 })
    expect(h.eventCount).toHaveBeenCalledWith({ where: { userId: OWNER, sessionId: 'sess1' } })
    expect(h.cardFindMany).not.toHaveBeenCalled()
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('only records cards that actually belong to the session set, dropping foreign ids', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.eventCount.mockResolvedValue(0)
    // Only c1 actually belongs to this set — c-foreign does not, even though
    // the client submitted a result for it.
    h.cardFindMany.mockResolvedValue([{ id: 'c1' }])

    const result = await submitMatchSession({
      sessionId: 'sess1',
      results: [
        { cardId: 'c1', correct: true },
        { cardId: 'c-foreign', correct: false },
      ],
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ recorded: 1 })
    expect(h.cardFindMany).toHaveBeenCalledWith({
      where: { setId: 'set1', id: { in: ['c1', 'c-foreign'] } },
      select: { id: true },
    })
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(1)
    expect(h.recordStudyEvent).toHaveBeenCalledWith({
      userId: OWNER,
      cardId: 'c1',
      source: 'matching',
      outcome: { correct: true },
      sessionId: 'sess1',
    })
  })

  it('records one StudyEvent per valid card via the single write path', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.eventCount.mockResolvedValue(0)
    h.cardFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])

    const result = await submitMatchSession({
      sessionId: 'sess1',
      results: [
        { cardId: 'c1', correct: true },
        { cardId: 'c2', correct: false },
      ],
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ recorded: 2 })
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(2)
  })

  it('reports failure without throwing when the database errors', async () => {
    h.sessionFindFirst.mockRejectedValue(new Error('db down'))

    const result = await submitMatchSession({
      sessionId: 'sess1',
      results: [{ cardId: 'c1', correct: true }],
    })

    expect(result.success).toBe(false)
  })
})
