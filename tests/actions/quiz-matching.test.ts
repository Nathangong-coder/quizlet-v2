import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindFirst: vi.fn(),
  attemptUpdate: vi.fn(),
  cardFindMany: vi.fn(),
  answerDeleteMany: vi.fn(),
  answerCreate: vi.fn(),
  txQueryRaw: vi.fn(),
  txEventCount: vi.fn(),
  recordStudyEvent: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findFirst: h.attemptFindFirst, update: h.attemptUpdate },
    card: { findMany: h.cardFindMany },
    quizAnswer: { deleteMany: h.answerDeleteMany, create: h.answerCreate },
    // Used in two shapes in quiz-matching.ts: an array of QuizAnswer creates
    // (Promise.all semantics) for the answer rows, and an interactive
    // callback for the memory-write guard — mirrors match-session.ts's tx
    // shape (row-lock query + scoped event count).
    $transaction: (arg: unknown) => {
      if (typeof arg === 'function') {
        return (arg as (tx: unknown) => unknown)({
          $queryRaw: h.txQueryRaw,
          studyEvent: { count: h.txEventCount },
        })
      }
      return Promise.all(arg as Promise<unknown>[])
    },
  },
}))
vi.mock('@/lib/memory/record', () => ({ recordStudyEvent: h.recordStudyEvent }))

import { submitMatchingAnswers } from '@/actions/quiz-matching'

const OWNER = 'user-owner'

const baseAttempt = {
  id: 'attempt1',
  userId: OWNER,
  setId: 'set1',
  sessionId: 'sess1',
  selectedCardIds: ['c1', 'c2'],
}

// Two matches, one correct (c1->c1) one wrong (c2->c1): correctCount 1 of 2 -> score 50.
const twoMatches = [
  { cardId: 'c1', matchedWithId: 'c1' },
  { cardId: 'c2', matchedWithId: 'c1' },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.cardFindMany.mockResolvedValue([
    { id: 'c1', term: 'A', definition: 'defA' },
    { id: 'c2', term: 'B', definition: 'defB' },
  ])
  h.answerDeleteMany.mockResolvedValue({ count: 0 })
  h.answerCreate.mockResolvedValue({})
  h.attemptUpdate.mockResolvedValue({})
  h.txQueryRaw.mockResolvedValue(undefined)
  h.txEventCount.mockResolvedValue(0)
  h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
})

describe('submitMatchingAnswers', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)

    const result = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(result.success).toBe(false)
    expect(h.attemptFindFirst).not.toHaveBeenCalled()
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('refuses an attempt belonging to someone else (IDOR), scoped by userId', async () => {
    // attemptId arrives from the client — the lookup must be scoped by
    // userId, otherwise a caller could submit against another user's attempt
    // and, since sessionId is read off it, contaminate that user's session.
    h.attemptFindFirst.mockResolvedValue(null)

    const result = await submitMatchingAnswers({ attemptId: 'attempt-other', matches: twoMatches })

    expect(result.success).toBe(false)
    expect(h.attemptFindFirst).toHaveBeenCalledWith({
      where: { id: 'attempt-other', userId: OWNER },
    })
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('records one StudyEvent per matched card on first submit, inside the locked transaction', async () => {
    h.attemptFindFirst.mockResolvedValue(baseAttempt)

    const result = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ score: 50 })

    expect(h.txQueryRaw).toHaveBeenCalledTimes(1)
    expect(h.txEventCount).toHaveBeenCalledWith({
      where: { userId: OWNER, sessionId: 'sess1', source: 'matching' },
    })
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(2)
    expect(h.recordStudyEvent).toHaveBeenCalledWith(
      { userId: OWNER, cardId: 'c1', source: 'matching', outcome: { correct: true }, sessionId: 'sess1' },
      expect.anything(), // the tx client, threaded through so the whole batch is one transaction
    )
  })

  it('is idempotent: a resubmit for a session that already has matching events records nothing more', async () => {
    h.attemptFindFirst.mockResolvedValue(baseAttempt)
    h.txEventCount.mockResolvedValue(2) // events already recorded from a prior submit

    const result = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    // The score is still recomputed and returned on every submit — only the
    // confidence-memory write is guarded against re-submits.
    expect(result.data).toEqual({ score: 50 })
    expect(h.recordStudyEvent).not.toHaveBeenCalled()
  })

  it('a mid-loop memory-write failure still returns the score, and a post-rollback retry records both cards', async () => {
    h.attemptFindFirst.mockResolvedValue(baseAttempt)
    h.recordStudyEvent
      .mockResolvedValueOnce({ confidence: 6, mastery: 0.5, dueAt: new Date() })
      .mockRejectedValueOnce(new Error('db exploded on the second card'))

    const first = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    // Memory writes are supplementary: the inner try/catch swallows the
    // transaction failure, so the user still gets a score even though the
    // confidence write for this submit failed entirely.
    expect(first.success).toBe(true)
    if (!first.success) throw new Error(first.error)
    expect(first.data).toEqual({ score: 50 })

    // In a real transaction, the throw above rolls c1's write back too, so
    // the StudyEvent count is still 0. A retry must see that and record both
    // cards again — not read a phantom "already recorded" from the partial
    // failure, which is what a per-card (rather than one-transaction) write
    // path would have left behind (this is the bug the atomic guard fixes).
    h.recordStudyEvent.mockReset()
    h.recordStudyEvent.mockResolvedValue({ confidence: 6, mastery: 0.5, dueAt: new Date() })
    h.txEventCount.mockResolvedValue(0)

    const retry = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(retry.success).toBe(true)
    if (!retry.success) throw new Error(retry.error)
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(2)
  })

  it('records via the legacy unguarded path when the attempt predates the StudySession envelope (sessionId null)', async () => {
    h.attemptFindFirst.mockResolvedValue({ ...baseAttempt, sessionId: null })

    const result = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ score: 50 })

    // No session to lock or scope a re-submit guard against — these writes
    // must not be silently skipped.
    expect(h.txQueryRaw).not.toHaveBeenCalled()
    expect(h.txEventCount).not.toHaveBeenCalled()
    expect(h.recordStudyEvent).toHaveBeenCalledTimes(2)
    expect(h.recordStudyEvent).toHaveBeenCalledWith({
      userId: OWNER,
      cardId: 'c1',
      source: 'matching',
      outcome: { correct: true },
    })
  })

  it('reports failure without throwing when the database errors', async () => {
    h.attemptFindFirst.mockRejectedValue(new Error('db down'))

    const result = await submitMatchingAnswers({ attemptId: 'attempt1', matches: twoMatches })

    expect(result.success).toBe(false)
  })
})
