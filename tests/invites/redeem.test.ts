import { describe, it, expect, vi } from 'vitest'
import {
  previewInviteCode,
  redeemInviteCode,
  InviteUnavailableError,
  type InviteDb,
} from '@/lib/invites/redeem'

function fakeDb(overrides: Record<string, unknown> = {}) {
  const inviteCode = {
    findUnique: vi.fn().mockResolvedValue({
      usesRemaining: 3,
      revokedAt: null,
      expiresAt: null,
    }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findFirst: vi.fn().mockResolvedValue({ id: 'inv1' }),
    ...overrides,
  }
  // `InviteDb` is `Pick<Prisma.TransactionClient, 'inviteCode'>` deliberately
  // (see redeem.ts), following the same convention as `TokenDb` in
  // tokens.test.ts — so only a real Prisma client/tx structurally satisfies
  // it, not a hand-rolled 3-method mock (the real delegate has ~14 methods).
  // `as unknown as` opts this fixture out of that check on purpose; the
  // intersection keeps the concrete mock type too, so `.mock.calls`
  // assertions below still type-check.
  return { inviteCode } as unknown as InviteDb & { inviteCode: typeof inviteCode }
}

describe('previewInviteCode — the cheap filter, NOT the gate', () => {
  it('normalises before querying, so a hyphenated code works', async () => {
    const db = fakeDb()
    await previewInviteCode(db, 'ABCDE-FG234')
    expect(db.inviteCode.findUnique).toHaveBeenCalledWith({
      where: { code: 'ABCDEFG234' },
      select: { usesRemaining: true, revokedAt: true, expiresAt: true },
    })
  })

  it('rejects an unknown code', async () => {
    const db = fakeDb({ findUnique: vi.fn().mockResolvedValue(null) })
    expect(await previewInviteCode(db, 'ABCDEFG234')).toBe(false)
  })

  it('rejects an exhausted, a revoked, and an expired code', async () => {
    const exhausted = fakeDb({
      findUnique: vi.fn().mockResolvedValue({ usesRemaining: 0, revokedAt: null, expiresAt: null }),
    })
    expect(await previewInviteCode(exhausted, 'X')).toBe(false)

    const revoked = fakeDb({
      findUnique: vi.fn().mockResolvedValue({ usesRemaining: 5, revokedAt: new Date(), expiresAt: null }),
    })
    expect(await previewInviteCode(revoked, 'X')).toBe(false)

    const expired = fakeDb({
      findUnique: vi.fn().mockResolvedValue({
        usesRemaining: 5,
        revokedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      }),
    })
    expect(await previewInviteCode(expired, 'X')).toBe(false)
  })

  it('accepts a live code with a future expiry', async () => {
    const db = fakeDb({
      findUnique: vi.fn().mockResolvedValue({
        usesRemaining: 1,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      }),
    })
    expect(await previewInviteCode(db, 'X')).toBe(true)
  })
})

describe('redeemInviteCode — the gate', () => {
  it('decrements with ONE atomic conditional update carrying every guard', async () => {
    // MUTANT 1 GUARD. A mock cannot evaluate a `where`, so the clause set is
    // asserted directly — removing `usesRemaining: { gt: 0 }` (or the revoked
    // or expiry clause) fails here. Spec §12 step 5 proves the semantics live.
    const db = fakeDb()
    await redeemInviteCode(db, 'abcde-fg234')
    const call = db.inviteCode.updateMany.mock.calls[0][0]
    expect(call.where.code).toBe('ABCDEFG234')
    expect(call.where.usesRemaining).toEqual({ gt: 0 })
    expect(call.where.revokedAt).toBeNull()
    expect(call.where.OR).toEqual([
      { expiresAt: null },
      { expiresAt: { gt: expect.any(Date) } },
    ])
    expect(call.data).toEqual({ usesRemaining: { decrement: 1 } })
  })

  it('returns the invite id so the caller can record the audit trail', async () => {
    const db = fakeDb()
    expect(await redeemInviteCode(db, 'ABCDEFG234')).toBe('inv1')
  })

  it('throws InviteUnavailableError when the decrement claimed nothing', async () => {
    // count === 0 means dead, revoked, expired — or its last slot was taken by
    // someone else between the pre-check and here. Two people racing for the
    // final slot cannot both get in.
    const db = fakeDb({ updateMany: vi.fn().mockResolvedValue({ count: 0 }) })
    await expect(redeemInviteCode(db, 'X')).rejects.toBeInstanceOf(InviteUnavailableError)
  })

  it('never reads before it writes', async () => {
    const db = fakeDb()
    await redeemInviteCode(db, 'ABCDEFG234')
    const order = [
      db.inviteCode.updateMany.mock.invocationCallOrder[0],
      db.inviteCode.findFirst.mock.invocationCallOrder[0],
    ]
    expect(order[0]).toBeLessThan(order[1])
  })
})
