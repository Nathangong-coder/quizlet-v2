import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionCreate: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdate: vi.fn(),
  eventFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studySession: {
      create: h.sessionCreate,
      findFirst: h.sessionFindFirst,
      update: h.sessionUpdate,
    },
    studyEvent: { findMany: h.eventFindMany },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { startStudySession, finishStudySession } from '@/actions/study-session'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.eventFindMany.mockResolvedValue([])
})

describe('startStudySession', () => {
  it('refuses an unauthenticated caller', async () => {
    h.auth.mockResolvedValue(null)
    const result = await startStudySession({ setId: 's1', kind: 'quiz', itemCount: 5 })
    expect(result.success).toBe(false)
    expect(h.sessionCreate).not.toHaveBeenCalled()
  })

  it('rejects an unknown kind rather than writing a junk row', async () => {
    const result = await startStudySession({
      setId: 's1',
      // @ts-expect-error deliberately invalid
      kind: 'freestyle',
      itemCount: 5,
    })
    expect(result.success).toBe(false)
    expect(h.sessionCreate).not.toHaveBeenCalled()
  })

  it('creates the session owned by the session user', async () => {
    h.sessionCreate.mockResolvedValue({ id: 'sess1' })
    const result = await startStudySession({
      setId: 's1',
      kind: 'matching',
      itemCount: 12,
      categoryIds: ['cat1'],
    })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ sessionId: 'sess1' })
    expect(h.sessionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: OWNER,
        setId: 's1',
        kind: 'matching',
        itemCount: 12,
        categoryIds: ['cat1'],
      }),
    })
  })
})

describe('finishStudySession', () => {
  it('refuses a session belonging to someone else', async () => {
    // The id arrives from the client, so the lookup must be scoped by userId.
    h.sessionFindFirst.mockResolvedValue(null)
    const result = await finishStudySession({ sessionId: 'sess-other' })

    expect(result.success).toBe(false)
    expect(h.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-other', userId: OWNER } }),
    )
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent: a second finish does not rewrite the duration', async () => {
    const endedAt = new Date('2026-07-30T10:05:00Z')
    h.sessionFindFirst.mockResolvedValue({
      id: 'sess1',
      userId: OWNER,
      setId: 's1',
      kind: 'quiz',
      startedAt: new Date('2026-07-30T10:00:00Z'),
      endedAt,
      durationMs: 300000,
    })

    const result = await finishStudySession({ sessionId: 'sess1' })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ durationMs: 300000 })
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('closes an open session and persists a computed-only insight', async () => {
    h.sessionFindFirst.mockResolvedValue({
      id: 'sess1',
      userId: OWNER,
      setId: 's1',
      kind: 'matching',
      startedAt: new Date(Date.now() - 60000),
      endedAt: null,
      durationMs: null,
    })
    h.eventFindMany.mockResolvedValue([
      {
        cardId: 'c1',
        source: 'matching',
        correct: true,
        score: null,
        confidenceBefore: 5,
        confidenceAfter: 6,
        latencyMs: 1000,
        card: { term: 'WACC', categoryAssignments: [] },
      },
    ])
    h.sessionUpdate.mockResolvedValue({})

    const result = await finishStudySession({ sessionId: 'sess1' })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.durationMs).toBeGreaterThan(0)

    const payload = h.sessionUpdate.mock.calls[0][0].data
    expect(payload.insight.version).toBe(1)
    expect(payload.insight.computed.itemCount).toBe(1)
    // Proves a real summarizeSession result, not just any object with an
    // itemCount: the single matching event rolls up into byMode.
    expect(payload.insight.computed.byMode).toContainEqual(
      expect.objectContaining({ mode: 'matching', total: 1 }),
    )
    // Matching sessions get no AI narrative, by design.
    expect(payload.insight.ai).toBeNull()
  })
})
