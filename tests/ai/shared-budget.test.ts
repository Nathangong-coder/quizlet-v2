import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_SHARED_TOKEN_BUDGET,
  budgetWindowStart,
  budgetWindowEnd,
  isExhausted,
  remaining,
  loadSpendByCredential,
  loadBorrowableCredentials,
} from '@/lib/ai/shared-budget'
import type { PrismaClient } from '@prisma/client'

/**
 * The weekly window. Fixed, resetting Monday 00:00 UTC — not a rolling seven
 * days, so the UI can name the date the allowance comes back.
 */
describe('budgetWindowStart', () => {
  it('returns the current Monday at midnight UTC', () => {
    // Wednesday 2026-09-09, mid-afternoon.
    expect(budgetWindowStart(new Date('2026-09-09T14:33:07.412Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    )
  })

  it('treats Monday 00:00 itself as the start of its own week, not the previous one', () => {
    expect(budgetWindowStart(new Date('2026-09-07T00:00:00.000Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    )
  })

  it('puts SUNDAY at the end of its week, not the start of the next', () => {
    // The one that off-by-one arithmetic gets wrong: getUTCDay() calls Sunday
    // 0, so a naive `- getUTCDay() + 1` moves Sunday FORWARD a day and resets
    // the allowance 24 hours early, every week.
    expect(budgetWindowStart(new Date('2026-09-13T23:59:59.999Z')).toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    )
  })

  it('does not mutate the date it was given', () => {
    const now = new Date('2026-09-09T14:00:00.000Z')
    budgetWindowStart(now)
    expect(now.toISOString()).toBe('2026-09-09T14:00:00.000Z')
  })
})

describe('budgetWindowEnd', () => {
  it('is exactly seven days after the start', () => {
    const now = new Date('2026-09-09T14:00:00.000Z')
    expect(budgetWindowEnd(now).toISOString()).toBe('2026-09-14T00:00:00.000Z')
    expect(budgetWindowEnd(now).getTime() - budgetWindowStart(now).getTime()).toBe(
      7 * 24 * 60 * 60 * 1000,
    )
  })

  it('crosses a month boundary without drifting', () => {
    // Monday 2026-09-28 -> Monday 2026-10-05. `setUTCDate` past the end of the
    // month is what makes this work; adding 7*86400000 to a wall-clock date
    // would not survive a DST-shifted local zone.
    expect(budgetWindowEnd(new Date('2026-09-30T12:00:00.000Z')).toISOString()).toBe(
      '2026-10-05T00:00:00.000Z',
    )
  })
})

/**
 * The per-borrower cap on a shared key. Its enforcement point is the pool
 * (tests/ai/generate-pool.test.ts); these are the arithmetic and the query
 * shape underneath it.
 */
describe('isExhausted', () => {
  it('treats spending EXACTLY the budget as exhausted', () => {
    // The boundary is the whole decision. `>` would hand every borrower who
    // lands on it one more free call, and on a per-model daily cap that is
    // precisely the call that fails.
    expect(isExhausted(1_000_000, 1_000_000)).toBe(true)
    expect(isExhausted(999_999, 1_000_000)).toBe(false)
  })

  it('never exhausts a null budget', () => {
    expect(isExhausted(Number.MAX_SAFE_INTEGER, null)).toBe(false)
  })

  it('exhausts a zero budget immediately', () => {
    // Setting the cap to 0 is how a lender stops new borrowing without
    // deleting the key or breaking anyone mid-session.
    expect(isExhausted(0, 0)).toBe(true)
  })
})

describe('remaining', () => {
  it('never goes negative', () => {
    // An overshoot is normal: the cap is checked before a call, not during
    // one, so the last call always lands slightly over. Reporting "-4,213
    // tokens left" would read as a bug to the user.
    expect(remaining(1_000_500, 1_000_000)).toBe(0)
  })

  it('is null for an uncapped credential', () => {
    expect(remaining(50, null)).toBeNull()
  })
})

describe('loadSpendByCredential', () => {
  function prismaWith(rows: unknown[]) {
    const groupBy = vi.fn().mockResolvedValue(rows)
    return { prisma: { aiCallLog: { groupBy } } as unknown as PrismaClient, groupBy }
  }

  it('sums input and output together', async () => {
    const { prisma } = prismaWith([
      { credentialId: 'c1', _sum: { inputTokens: 400, outputTokens: 600 } },
    ])
    const spend = await loadSpendByCredential(prisma, 'u1')
    expect(spend.get('c1')).toBe(1_000)
  })

  it('counts a row whose token columns are null as zero rather than dropping it', async () => {
    // Rows predating token accounting (2026-09-06) cannot be recovered. They
    // make the earliest budgets slightly generous, which is the safe direction.
    const { prisma } = prismaWith([
      { credentialId: 'c1', _sum: { inputTokens: null, outputTokens: null } },
    ])
    expect((await loadSpendByCredential(prisma, 'u1')).get('c1')).toBe(0)
  })

  it('scopes the query to the user and skips rows with no credential', async () => {
    const { prisma, groupBy } = prismaWith([
      { credentialId: null, _sum: { inputTokens: 999, outputTokens: 999 } },
    ])
    const spend = await loadSpendByCredential(prisma, 'u1')
    expect(spend.size).toBe(0)
    expect(groupBy.mock.calls[0][0].where).toMatchObject({ userId: 'u1' })
  })

  it('counts only calls made since the window start', async () => {
    // The whole of "weekly": spend from a previous week must not reach the
    // query at all. Filtering in TypeScript after the fact would still be
    // correct but would drag every historical row across the wire forever.
    const { prisma, groupBy } = prismaWith([])
    await loadSpendByCredential(prisma, 'u1', new Date('2026-09-07T00:00:00.000Z'))
    expect(groupBy.mock.calls[0][0].where.createdAt).toEqual({
      gte: new Date('2026-09-07T00:00:00.000Z'),
    })
  })

  it('defaults to the current week when no window is given', async () => {
    const { prisma, groupBy } = prismaWith([])
    await loadSpendByCredential(prisma, 'u1')
    expect(groupBy.mock.calls[0][0].where.createdAt.gte).toEqual(budgetWindowStart())
  })
})

describe('loadBorrowableCredentials', () => {
  function prismaWith(credentials: unknown[], spendRows: unknown[] = []) {
    const findMany = vi.fn().mockResolvedValue(credentials)
    const groupBy = vi.fn().mockResolvedValue(spendRows)
    return {
      prisma: {
        aiCredential: { findMany },
        aiCallLog: { groupBy },
      } as unknown as PrismaClient,
      findMany,
    }
  }

  it('excludes the caller own credentials from what they can borrow', async () => {
    const { prisma, findMany } = prismaWith([])
    await loadBorrowableCredentials(prisma, 'u1')
    // An owner spending their own key is not borrowing, and metering them
    // against a lending budget would be nonsense.
    expect(findMany.mock.calls[0][0].where).toMatchObject({
      shared: true,
      enabled: true,
      userId: { not: 'u1' },
    })
  })

  it('reports standing per credential', async () => {
    const { prisma } = prismaWith(
      [
        {
          id: 'lent',
          label: 'Shared DeepSeek',
          provider: 'deepseek',
          sharedTokenBudget: DEFAULT_SHARED_TOKEN_BUDGET,
        },
      ],
      [{ credentialId: 'lent', _sum: { inputTokens: 900_000, outputTokens: 100_000 } }],
    )
    expect(await loadBorrowableCredentials(prisma, 'u1', new Date('2026-09-09T14:00:00Z'))).toEqual([
      {
        credentialId: 'lent',
        label: 'Shared DeepSeek',
        provider: 'deepseek',
        used: 1_000_000,
        budget: 1_000_000,
        remaining: 0,
        exhausted: true,
        // Named so the UI can say WHEN the allowance comes back rather than
        // leaving an exhausted learner with no next step.
        resetsAt: new Date('2026-09-14T00:00:00.000Z'),
      },
    ])
  })
})
