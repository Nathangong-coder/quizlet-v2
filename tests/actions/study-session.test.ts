import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  sessionCreate: vi.fn(),
  sessionFindFirst: vi.fn(),
  sessionUpdate: vi.fn(),
  eventFindMany: vi.fn(),
  generateJson: vi.fn(),
  safeProfileBlock: vi.fn(),
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
vi.mock('@/lib/ai/generate', () => ({ generateJson: h.generateJson }))
vi.mock('@/lib/ai/context', () => ({ safeProfileBlock: h.safeProfileBlock }))

import { startStudySession, finishStudySession, generateSessionInsight } from '@/actions/study-session'

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

describe('generateSessionInsight', () => {
  const openSession = {
    id: 'sess1',
    userId: OWNER,
    setId: 's1',
    kind: 'quiz',
    startedAt: new Date(),
    endedAt: new Date(),
    durationMs: 1000,
    insight: {
      version: 1,
      // Filled in with a schema-valid shape (not the bare `{}` sub-objects
      // used as shorthand in the plan) so SessionInsightSchema.safeParse
      // actually succeeds — the nested pacing/confidence/outliers fields are
      // required, not optional.
      computed: {
        itemCount: 1,
        byCategory: [],
        byMode: [],
        pacing: { medianLatencyMs: null, fastest: null, slowest: null, byMode: [] },
        confidence: { avgDelta: null, newlyMastered: [], dropped: [] },
        outliers: { rushed: [], laboured: [] },
      },
      ai: null,
    },
    set: { title: 'Finance 101' },
  }

  it('writes the validated AI block onto the existing insight', async () => {
    h.sessionFindFirst.mockResolvedValue(openSession)
    h.safeProfileBlock.mockResolvedValue('')
    h.generateJson.mockResolvedValue({
      focusAreas: [
        {
          title: 'DCF terminal value',
          severity: 'high',
          evidence: 'Missed 3 of 3.',
          action: 'Re-read the terminal-value cards.',
          cardIds: ['c1'],
        },
      ],
      strengths: 'Accounting was solid.',
    })
    h.sessionUpdate.mockResolvedValue({})

    const result = await generateSessionInsight({ sessionId: 'sess1' })

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual({ generated: true })
    const payload = h.sessionUpdate.mock.calls[0][0].data
    expect(payload.insight.ai.focusAreas).toHaveLength(1)
    // The computed block must survive untouched — the AI never rewrites
    // numbers. Whole-object equality so a future refactor that rebuilds
    // `computed` field-by-field cannot slip a mangled sub-object through
    // while still getting itemCount right.
    expect(payload.insight.computed).toEqual(openSession.insight.computed)
  })

  it('reports failure without throwing when generation fails', async () => {
    h.sessionFindFirst.mockResolvedValue(openSession)
    h.safeProfileBlock.mockResolvedValue('')
    h.generateJson.mockRejectedValue(new Error('no credentials'))

    const result = await generateSessionInsight({ sessionId: 'sess1' })

    expect(result.success).toBe(false)
    expect(h.sessionUpdate).not.toHaveBeenCalled()
  })

  it('refuses a session owned by someone else', async () => {
    h.sessionFindFirst.mockResolvedValue(null)
    const result = await generateSessionInsight({ sessionId: 'sess-other' })
    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
    // The id comes from the client, so the lookup must be scoped by userId —
    // otherwise this test would keep passing even if a future edit dropped
    // that scoping, since the mock returns null unconditionally.
    expect(h.sessionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'sess-other', userId: OWNER } }),
    )
  })

  it('does nothing when the session has no computed insight to build on', async () => {
    h.sessionFindFirst.mockResolvedValue({ ...openSession, insight: null })
    const result = await generateSessionInsight({ sessionId: 'sess1' })
    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })

  it('refuses a blob written by an older schema version', async () => {
    h.sessionFindFirst.mockResolvedValue({
      ...openSession,
      insight: { ...openSession.insight, version: 0 },
    })

    const result = await generateSessionInsight({ sessionId: 'sess1' })

    expect(result.success).toBe(false)
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})
