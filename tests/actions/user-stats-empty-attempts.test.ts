import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Queue item 2b: a `QuizAttempt` with no `QuizAnswer` rows is not a study
 * record, but /profile counted it as one — inflating `totalAttempts`, the
 * per-mode counts, and (for the cascaded population, which keeps a stale score
 * after a card deletion cascades its answers away) the averages too.
 *
 * `getUserStats` runs ONE query feeding all four outputs, so one `where` fixes
 * all four — which is also why a half-fix would be invisible in a test that
 * only checked the recent list.
 *
 * The Prisma mock HONOURS the `where` it is handed rather than returning a
 * pre-filtered fixture. A fixture-only test passes even when the filter is
 * never sent, so it would assert nothing about the change; here the mixed
 * fixture is filtered by the predicate the action actually issues, and the
 * explicit `where` assertion below pins the mechanism on top of that.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindMany: vi.fn(),
  progressFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findMany: h.attemptFindMany },
    cardProgress: { findMany: h.progressFindMany },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import { getUserStats } from '@/actions/user'

/** `answerCount` is fixture bookkeeping — the real column is a relation. */
type Row = {
  id: string
  mode: string
  score: number | null
  sessionId: string | null
  answerCount: number
  createdAt: Date
  set: { id: string; title: string }
}

const at = (min: number) => new Date(Date.UTC(2026, 7, 12, 12, min))

// Newest first, matching the action's own `orderBy: { createdAt: 'desc' }`.
const FIXTURE: Row[] = [
  { id: 'a1', mode: 'multiple-choice', score: 100, sessionId: 's1', answerCount: 2, createdAt: at(50), set: { id: 'set1', title: 'S' } },
  // Cascaded: kept a real score after a card deletion took its evidence. The
  // population that makes this a correctness bug and not just a cosmetic one.
  { id: 'a2', mode: 'multiple-choice', score: 100, sessionId: 's2', answerCount: 0, createdAt: at(40), set: { id: 'set1', title: 'S' } },
  { id: 'a3', mode: 'multiple-choice', score: 50, sessionId: 's3', answerCount: 1, createdAt: at(30), set: { id: 'set1', title: 'S' } },
  // Answered but ungraded — must still COUNT while staying out of the average.
  { id: 'a4', mode: 'short-answer', score: null, sessionId: 's4', answerCount: 1, createdAt: at(20), set: { id: 'set1', title: 'S' } },
  { id: 'a5', mode: 'short-answer', score: 90, sessionId: 's5', answerCount: 0, createdAt: at(10), set: { id: 'set1', title: 'S' } },
  { id: 'a6', mode: 'short-answer', score: 30, sessionId: 's6', answerCount: 0, createdAt: at(0), set: { id: 'set1', title: 'S' } },
]

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: 'u1' } })
  h.progressFindMany.mockResolvedValue([])
  h.attemptFindMany.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const wantsAnswered = args?.where?.answers !== undefined
    return FIXTURE.filter((r) => !wantsAnswered || r.answerCount > 0)
  })
})

describe('getUserStats excludes zero-answer attempts', () => {
  it('sends the predicate to Prisma alongside the owner scope', async () => {
    // The load-bearing assertion. Everything below is downstream of this one
    // line actually reaching the query — and the owner scope has to survive the
    // spread, or a display fix becomes a cross-user leak.
    await getUserStats()
    const where = h.attemptFindMany.mock.calls[0][0].where
    expect(where).toMatchObject({ userId: 'u1', answers: { some: {} } })
  })

  it('omits them from totalAttempts', async () => {
    const res = await getUserStats()
    expect(res.data!.totalAttempts).toBe(3) // a1, a3, a4 — not a2, a5, a6
  })

  it('omits them from the per-mode counts and averages', async () => {
    const res = await getUserStats()
    const byMode = Object.fromEntries(res.data!.modeStats.map((m) => [m.mode, m]))

    expect(byMode['multiple-choice'].count).toBe(2)
    expect(byMode['multiple-choice'].averageScore).toBe(75) // (100 + 50) / 2
    expect(byMode['short-answer'].count).toBe(1)
    // a4 is answered but ungraded; a5/a6 carry scores but no answers. The mode
    // is present with a null average rather than absent or zero.
    expect(byMode['short-answer'].averageScore).toBeNull()
  })

  it('omits their scores from overallAverageScore', async () => {
    const res = await getUserStats()
    // Unfiltered this reads 74 — the stale 100 and the two never-answered
    // scores drag a real 75 down while pretending to be evidence.
    expect(res.data!.overallAverageScore).toBe(75)
  })

  it('omits them from the five-item recent list', async () => {
    const res = await getUserStats()
    expect(res.data!.recentAttempts.map((a) => a.id)).toEqual(['a1', 'a3', 'a4'])
  })

  it('still reports a learner with only empty attempts as having none', async () => {
    // The whole-history case: someone who opened three quizzes and answered
    // nothing has no study history, not three sittings averaging nothing.
    h.attemptFindMany.mockResolvedValue([])
    const res = await getUserStats()
    expect(res.data!.totalAttempts).toBe(0)
    expect(res.data!.overallAverageScore).toBeNull()
    expect(res.data!.modeStats).toEqual([])
    expect(res.data!.recentAttempts).toEqual([])
  })
})
