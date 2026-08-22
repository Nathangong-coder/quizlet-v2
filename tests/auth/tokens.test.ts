import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  TOKEN_PURPOSES,
  TOKEN_TTL_MS,
  generateRawToken,
  hashToken,
  expiresAtFor,
  invalidateTokens,
  mintToken,
  peekToken,
  consumeToken,
  type TokenDb,
} from '@/lib/auth/tokens'

function fakeDb() {
  const userToken = {
    create: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    findUnique: vi.fn().mockResolvedValue({ userId: 'u1' }),
  }
  // `TokenDb` is `Pick<Prisma.TransactionClient, 'userToken'>` deliberately
  // (see tokens.ts) rather than a hand-rolled shape, so only a real Prisma
  // client/tx structurally satisfies it — a plain 3-method mock does not
  // (the real delegate has ~14 methods). `as unknown as` opts this fixture
  // out of that check on purpose; the intersection keeps the concrete mock
  // type too, so `.mock.calls` assertions below still type-check.
  return { userToken } as unknown as TokenDb & { userToken: typeof userToken }
}

describe('the purpose is bound into the hash', () => {
  it('produces DIFFERENT hashes for the same raw string under different purposes', () => {
    // This is the whole point of the binding: a verification token cannot be
    // presented at the reset endpoint even if every query filter is dropped.
    const raw = 'the-same-secret'
    expect(hashToken('email_verify', raw)).not.toBe(hashToken('password_reset', raw))
  })

  it('is deterministic and hex', () => {
    const a = hashToken('email_verify', 'abc')
    expect(a).toBe(hashToken('email_verify', 'abc'))
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('never returns the raw token inside the hash', () => {
    expect(hashToken('password_reset', 'plaintext-secret')).not.toContain('plaintext-secret')
  })
})

describe('generateRawToken', () => {
  it('is 32 bytes of base64url — URL-path safe, no + or /', () => {
    const raw = generateRawToken()
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/)
    // 32 bytes base64url-encodes to 43 characters, unpadded.
    expect(raw).toHaveLength(43)
  })

  it('does not repeat', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateRawToken()))
    expect(seen.size).toBe(200)
  })
})

describe('TTLs', () => {
  it('gives reset one hour and verification 24', () => {
    expect(TOKEN_TTL_MS.password_reset).toBe(60 * 60 * 1000)
    expect(TOKEN_TTL_MS.email_verify).toBe(24 * 60 * 60 * 1000)
  })

  it('covers every purpose in the vocabulary', () => {
    for (const purpose of TOKEN_PURPOSES) {
      expect(typeof TOKEN_TTL_MS[purpose]).toBe('number')
    }
  })

  it('expiresAtFor adds the purpose TTL to the given instant', () => {
    const now = new Date('2026-08-20T12:00:00.000Z')
    expect(expiresAtFor('password_reset', now).toISOString()).toBe('2026-08-20T13:00:00.000Z')
    expect(expiresAtFor('email_verify', now).toISOString()).toBe('2026-08-21T12:00:00.000Z')
  })
})

describe('mintToken', () => {
  let db: ReturnType<typeof fakeDb>
  beforeEach(() => {
    db = fakeDb()
  })

  it('invalidates the user’s other outstanding tokens of the SAME purpose first', async () => {
    // Otherwise a second "resend" leaves the first link live.
    await mintToken(db, { userId: 'u1', purpose: 'email_verify' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', purpose: 'email_verify', usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
    // And the invalidate comes FIRST. If create ran first, the invalidate's
    // `usedAt: null` where-clause would sweep up the row just minted, and
    // every freshly issued link would be dead on arrival.
    expect(db.userToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.userToken.create.mock.invocationCallOrder[0],
    )
  })

  it('stores the HASH and never the raw token', async () => {
    const raw = await mintToken(db, { userId: 'u1', purpose: 'password_reset' })
    const data = db.userToken.create.mock.calls[0][0].data
    expect(data.tokenHash).toBe(hashToken('password_reset', raw))
    expect(JSON.stringify(data)).not.toContain(raw)
  })

  it('stores the purpose and a future expiry', async () => {
    await mintToken(db, { userId: 'u1', purpose: 'password_reset' })
    const data = db.userToken.create.mock.calls[0][0].data
    expect(data.purpose).toBe('password_reset')
    expect(data.userId).toBe('u1')
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })
})

describe('consumeToken', () => {
  let db: ReturnType<typeof fakeDb>
  beforeEach(() => {
    db = fakeDb()
  })

  it('claims the row with ONE atomic conditional update, not a read-then-write', async () => {
    // MUTANT 2/3/4 GUARD. The mock cannot evaluate a `where`, so the shape is
    // asserted directly: dropping `usedAt: null`, `purpose`, or the expiry
    // comparison fails here. The live gate (spec §12 steps 4 and 8) is what
    // proves the semantics against real Postgres.
    await consumeToken(db, { purpose: 'password_reset', raw: 'r' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashToken('password_reset', 'r'),
        purpose: 'password_reset',
        usedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { usedAt: expect.any(Date) },
    })
    // And the claim comes FIRST. A read-then-write would look up the row
    // before deciding, which is exactly the race two clicks on one link win.
    expect(db.userToken.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.userToken.findUnique.mock.invocationCallOrder[0],
    )
    expect(db.userToken.create).not.toHaveBeenCalled()
  })

  it('returns the userId when exactly one row was claimed', async () => {
    const res = await consumeToken(db, { purpose: 'email_verify', raw: 'r' })
    expect(res).toEqual({ ok: true, userId: 'u1' })
  })

  it('refuses when zero rows were claimed — used, expired, or unknown', async () => {
    db.userToken.updateMany.mockResolvedValue({ count: 0 })
    const res = await consumeToken(db, { purpose: 'email_verify', raw: 'r' })
    expect(res).toEqual({ ok: false, reason: 'invalid_or_expired' })
    expect(db.userToken.findUnique).not.toHaveBeenCalled()
  })

  it('a token minted for one purpose is rejected at the other', async () => {
    // The hash binding, end to end: the same raw string produces a different
    // lookup key, so the row is simply not found.
    const raw = await mintToken(db, { userId: 'u1', purpose: 'email_verify' })
    const mintedHash = db.userToken.create.mock.calls[0][0].data.tokenHash
    await consumeToken(db, { purpose: 'password_reset', raw })
    const lookedUp = db.userToken.updateMany.mock.calls.at(-1)![0].where.tokenHash
    expect(lookedUp).not.toBe(mintedHash)
  })
})

describe('peekToken', () => {
  it('validates without consuming — no write of any kind', async () => {
    const db = fakeDb()
    // peekToken selects { usedAt, expiresAt }, not { userId } — the fixture
    // must match the shape the implementation actually reads.
    db.userToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    })
    const ok = await peekToken(db, { purpose: 'password_reset', raw: 'r' })
    expect(ok).toBe(true)
    expect(db.userToken.updateMany).not.toHaveBeenCalled()
    expect(db.userToken.create).not.toHaveBeenCalled()
  })

  it('is false for a token that does not resolve', async () => {
    const db = fakeDb()
    db.userToken.findUnique.mockResolvedValue(null)
    expect(await peekToken(db, { purpose: 'password_reset', raw: 'r' })).toBe(false)
  })

  it('is false for a token that has already been used', async () => {
    const db = fakeDb()
    db.userToken.findUnique.mockResolvedValue({
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    })
    expect(await peekToken(db, { purpose: 'password_reset', raw: 'r' })).toBe(false)
  })

  it('is false for an expired token', async () => {
    const db = fakeDb()
    db.userToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() - 1),
    })
    expect(await peekToken(db, { purpose: 'password_reset', raw: 'r' })).toBe(false)
  })
})

describe('invalidateTokens', () => {
  it('marks every outstanding token of that purpose used', async () => {
    const db = fakeDb()
    await invalidateTokens(db, { userId: 'u9', purpose: 'password_reset' })
    expect(db.userToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u9', purpose: 'password_reset', usedAt: null },
      data: { usedAt: expect.any(Date) },
    })
  })
})
