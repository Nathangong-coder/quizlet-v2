import { describe, it, expect, vi } from 'vitest'
import {
  DEFAULT_SHARED_TOKEN_BUDGET,
  isExhausted,
  remaining,
  loadSpendByCredential,
  loadBorrowableCredentials,
} from '@/lib/ai/shared-budget'
import type { PrismaClient } from '@prisma/client'

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
    expect(await loadBorrowableCredentials(prisma, 'u1')).toEqual([
      {
        credentialId: 'lent',
        label: 'Shared DeepSeek',
        provider: 'deepseek',
        used: 1_000_000,
        budget: 1_000_000,
        remaining: 0,
        exhausted: true,
      },
    ])
  })
})
