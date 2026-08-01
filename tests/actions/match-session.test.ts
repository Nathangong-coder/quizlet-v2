import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionFindFirst: vi.fn(),
  cardFindMany: vi.fn(),
  txQueryRaw: vi.fn(),
  txEventCount: vi.fn(),
  recordStudyEvent: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studySession: { findFirst: h.sessionFindFirst },
    card: { findMany: h.cardFindMany },
    // Stands in for a real transaction: just invokes the callback with a tx
    // client exposing the row-lock query and the scoped event count. A
    // rejection inside `fn` propagates out here exactly as a real rolled-back
    // transaction would reject the caller's await.
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({
        $queryRaw: h.txQueryRaw,
        studyEvent: { count: h.txEventCount },
      }),
  },
}))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { submitMatchSession } from '@/actions/match-session'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.cardFindMany.mockResolvedValue([])
  h.txQueryRaw.mockResolvedValue(undefined)
  h.txEventCount.mockResolvedValue(0)
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

  it('takes a row lock on the session before checking for existing events', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.cardFindMany.mockResolvedValue([{ id: 'c1' }])

    await submitMatchSession({ sessionId: 'sess1', results: [{ cardId: 'c1', correct: true }] })

    expect(h.txQueryRaw).toHaveBeenCalledTimes(1)
    expect(h.txEventCount).toHaveBeenCalledWith({ where: { userId: OWNER, sessionId: 'sess1' } })
  })

  it('is idempotent: a resubmit for a session that already has events records nothing more', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.cardFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    h.txEventCount.mockResolvedValue(2) // events already recorded from a prior submit

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
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('only records cards that actually belong to the session set, dropping foreign ids', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
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
    expect(h.recordStudyEvent).toHaveBeenCalledWith(
      {
        userId: OWNER,
        cardId: 'c1',
        source: 'matching',
        outcome: { correct: true },
        sessionId: 'sess1',
      },
      expect.anything(), // the tx client, threaded through so the whole batch is one transaction
    )
  })

  it('records one StudyEvent per valid card via the single write path, inside the transaction', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
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

  it('rolls the whole submit back when a card write fails partway through, so a retry is not permanently short-circuited', async () => {
    h.sessionFindFirst.mockResolvedValue({ id: 'sess1', userId: OWNER, setId: 'set1', kind: 'matching' })
    h.cardFindMany.mockResolvedValue([{ id: 'c1' }, { id: 'c2' }])
    h.recordStudyEvent
      .mockResolvedValueOnce({ confidence: 6, mastery: 0.5, dueAt: new Date() })
      .mockRejectedValueOnce(new Error('db exploded on the second card'))

    const first = await submitMatchSession({
      sessionId: 'sess1',
      results: [
        { cardId: 'c1', correct: true },
        { cardId: 'c2', correct: false },
      ],
    })

    expect(first.success).toBe(false)

    // In a real transaction, the throw above rolls back c1's write too, so
    // the StudyEvent count is still 0. A retry must see that and record both
    // cards again — not read a phantom "already recorded" from the partial
    // failure, which is what a per-card (rather than one-transaction) write
    // path would have left behind.
    h.recordStudyEvent.mockReset()
    h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
    h.txEventCount.mockResolvedValue(0)

    const retry = await submitMatchSession({
      sessionId: 'sess1',
      results: [
        { cardId: 'c1', correct: true },
        { cardId: 'c2', correct: false },
      ],
    })

    expect(retry.success).toBe(true)
    if (!retry.success) throw new Error(retry.error)
    expect(retry.data).toEqual({ recorded: 2 })
  })
})
