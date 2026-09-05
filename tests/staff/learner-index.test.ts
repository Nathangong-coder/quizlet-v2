import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  userFindMany: vi.fn(),
  klpStateGroupBy: vi.fn(),
  quizAnswerGroupBy: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findMany: h.userFindMany },
    klpState: { groupBy: h.klpStateGroupBy },
    quizAnswer: { groupBy: h.quizAnswerGroupBy },
  },
}))

import { loadLearnerIndex, isActiveAt, INACTIVE_AFTER_DAYS } from '@/lib/staff/queries'

const NOW = new Date('2026-09-04T00:00:00Z')

interface UserRowInput {
  id: string
  handle?: string | null
  name?: string | null
  email?: string | null
  role?: string
  createdAt?: Date
  provider?: string | null
  answers?: number
}

function userRow(u: UserRowInput) {
  return {
    id: u.id,
    handle: u.handle ?? null,
    name: u.name ?? null,
    email: u.email ?? null,
    role: u.role ?? 'learner',
    createdAt: u.createdAt ?? new Date('2026-01-01'),
    accounts: u.provider ? [{ provider: u.provider }] : [],
    _count: { quizAnswers: u.answers ?? 0 },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.klpStateGroupBy.mockResolvedValue([])
  h.quizAnswerGroupBy.mockResolvedValue([])
})

describe('loadLearnerIndex', () => {
  /**
   * THE BUG THIS PAGE HAD. The query used to start from `KlpState.groupBy`, so
   * it listed only people with measured knowledge. On the live database that
   * was 2 rows out of 10 accounts — a real GitHub user who had signed up and
   * not yet answered anything was invisible here while being perfectly
   * findable on /staff/roles.
   */
  it('includes an account with no evidence at all', async () => {
    h.userFindMany.mockResolvedValue([
      userRow({ id: 'u1', name: 'Minihotpot', email: 'james@example.com', provider: 'github' }),
    ])

    const rows = await loadLearnerIndex(NOW)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ userId: 'u1', label: 'Minihotpot', klpStates: 0, answers: 0 })
  })

  it('returns every account, not only those with KlpState rows', async () => {
    h.userFindMany.mockResolvedValue([
      userRow({ id: 'u1', handle: 'active' }),
      userRow({ id: 'u2', handle: 'idle' }),
      userRow({ id: 'u3', handle: 'alsoidle' }),
    ])
    h.klpStateGroupBy.mockResolvedValue([
      { userId: 'u1', _count: { _all: 4 }, _max: { lastObservedAt: new Date('2026-09-01') } },
    ])

    const rows = await loadLearnerIndex(NOW)
    expect(rows.map((r) => r.userId).sort()).toEqual(['u1', 'u2', 'u3'])
    expect(rows.find((r) => r.userId === 'u1')?.klpStates).toBe(4)
    expect(rows.find((r) => r.userId === 'u2')?.klpStates).toBe(0)
  })

  /** An empty account table is the only reason to render nothing. */
  it('is empty only when there are no accounts', async () => {
    h.userFindMany.mockResolvedValue([])
    expect(await loadLearnerIndex(NOW)).toEqual([])
  })

  describe('identity', () => {
    it('prefers handle, then name, then email', async () => {
      h.userFindMany.mockResolvedValue([
        userRow({ id: 'u1', handle: 'h', name: 'n', email: 'e@x.com' }),
        userRow({ id: 'u2', name: 'n', email: 'e@x.com' }),
        userRow({ id: 'u3', email: 'e@x.com' }),
      ])
      const rows = await loadLearnerIndex(NOW)
      expect(rows.find((r) => r.userId === 'u1')?.label).toBe('h')
      expect(rows.find((r) => r.userId === 'u2')?.label).toBe('n')
      expect(rows.find((r) => r.userId === 'u3')?.label).toBe('e@x.com')
    })

    /** Otherwise the row renders blank and unclickable. The schema permits it. */
    it('falls back to the id when a row has no handle, name or email', async () => {
      h.userFindMany.mockResolvedValue([userRow({ id: 'u-blank' })])
      expect((await loadLearnerIndex(NOW))[0].label).toBe('u-blank')
    })

    it('carries the email separately so a row is findable by either identity', async () => {
      h.userFindMany.mockResolvedValue([userRow({ id: 'u1', handle: 'h', email: 'e@x.com' })])
      expect((await loadLearnerIndex(NOW))[0].email).toBe('e@x.com')
    })

    /**
     * An OAuth user has an `Account` row naming the provider; a credentials
     * user has none, because the password lives on `User`. Absence is the
     * signal, so it must not read as "unknown".
     */
    it('reports how each person signs in', async () => {
      h.userFindMany.mockResolvedValue([
        userRow({ id: 'u1', handle: 'gh', provider: 'github' }),
        userRow({ id: 'u2', handle: 'pw' }),
      ])
      const rows = await loadLearnerIndex(NOW)
      expect(rows.find((r) => r.userId === 'u1')?.signIn).toBe('github')
      expect(rows.find((r) => r.userId === 'u2')?.signIn).toBe('credentials')
    })
  })

  describe('ordering', () => {
    it('puts measured learners first, most recently active leading', async () => {
      h.userFindMany.mockResolvedValue([
        userRow({ id: 'idle', handle: 'idle', createdAt: new Date('2026-05-01') }),
        userRow({ id: 'old', handle: 'old' }),
        userRow({ id: 'recent', handle: 'recent' }),
      ])
      h.klpStateGroupBy.mockResolvedValue([
        { userId: 'old', _count: { _all: 2 }, _max: { lastObservedAt: new Date('2026-01-01') } },
        { userId: 'recent', _count: { _all: 2 }, _max: { lastObservedAt: new Date('2026-09-01') } },
      ])

      expect((await loadLearnerIndex(NOW)).map((r) => r.userId)).toEqual(['recent', 'old', 'idle'])
    })

    /** Newest signup first among the inactive — "did the person I invited get in?" */
    it('orders accounts with no activity by newest signup', async () => {
      h.userFindMany.mockResolvedValue([
        userRow({ id: 'older', handle: 'older', createdAt: new Date('2026-01-01') }),
        userRow({ id: 'newer', handle: 'newer', createdAt: new Date('2026-08-01') }),
      ])
      expect((await loadLearnerIndex(NOW)).map((r) => r.userId)).toEqual(['newer', 'older'])
    })
  })
})

describe('active vs inactive', () => {
  /**
   * A year, per the owner. The column looks broken at first glance and is not:
   * the app has not been live for a year, so nobody can age out yet, and every
   * inactive account today is one that has never studied at all.
   */
  it('uses a one-year window', () => {
    expect(INACTIVE_AFTER_DAYS).toBe(365)
    expect(isActiveAt(new Date('2026-09-03'), NOW)).toBe(true)
    expect(isActiveAt(new Date('2025-09-05'), NOW)).toBe(true)
    expect(isActiveAt(new Date('2025-08-01'), NOW)).toBe(false)
  })

  it('treats never having done anything as inactive, not as recent', () => {
    expect(isActiveAt(null, NOW)).toBe(false)
  })

  it('marks an account with no activity inactive', async () => {
    h.userFindMany.mockResolvedValue([userRow({ id: 'u1', handle: 'idle' })])
    const [row] = await loadLearnerIndex(NOW)
    expect(row).toMatchObject({ active: false, lastActiveAt: null })
  })

  /**
   * BOTH signals are needed. `KlpState.lastObservedAt` misses anyone who
   * answered on a card that has no key points yet — which is the entire legacy
   * corpus — so an answer alone has to count as activity.
   */
  it('counts a recent answer as activity even with no measured knowledge', async () => {
    h.userFindMany.mockResolvedValue([userRow({ id: 'u1', handle: 'answered', answers: 3 })])
    h.quizAnswerGroupBy.mockResolvedValue([{ userId: 'u1', _max: { createdAt: new Date('2026-09-01') } }])

    const [row] = await loadLearnerIndex(NOW)
    expect(row.active).toBe(true)
    expect(row.lastActiveAt).toEqual(new Date('2026-09-01'))
    expect(row.klpStates).toBe(0)
  })

  it('takes the later of the two signals', async () => {
    h.userFindMany.mockResolvedValue([userRow({ id: 'u1', handle: 'both' })])
    h.klpStateGroupBy.mockResolvedValue([
      { userId: 'u1', _count: { _all: 2 }, _max: { lastObservedAt: new Date('2026-03-01') } },
    ])
    h.quizAnswerGroupBy.mockResolvedValue([{ userId: 'u1', _max: { createdAt: new Date('2026-08-01') } }])

    expect((await loadLearnerIndex(NOW))[0].lastActiveAt).toEqual(new Date('2026-08-01'))
  })

  it('sorts by real activity, so an answer with no measurement still leads', async () => {
    h.userFindMany.mockResolvedValue([
      userRow({ id: 'measured', handle: 'measured' }),
      userRow({ id: 'answered', handle: 'answered' }),
    ])
    h.klpStateGroupBy.mockResolvedValue([
      { userId: 'measured', _count: { _all: 9 }, _max: { lastObservedAt: new Date('2026-01-01') } },
    ])
    h.quizAnswerGroupBy.mockResolvedValue([{ userId: 'answered', _max: { createdAt: new Date('2026-08-01') } }])

    expect((await loadLearnerIndex(NOW)).map((r) => r.userId)).toEqual(['answered', 'measured'])
  })
})
