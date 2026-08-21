import { describe, it, expect, vi, beforeEach } from 'vitest'

// Wider than this task needs on purpose: Task 9 adds peekResetToken and
// completePasswordReset to the same file and would otherwise rewrite these.
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  mintToken: vi.fn(),
  peekToken: vi.fn(),
  consumeToken: vi.fn(),
  invalidateTokens: vi.fn(),
  txUserFindUnique: vi.fn(),
  txUserUpdate: vi.fn(),
  hashPassword: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  afterTasks: [] as Array<() => unknown>,
}))

// DEVIATION from the brief (matches the fix already applied in
// tests/actions/auth-verify.test.ts for the identical race): storing
// `Promise.resolve().then(fn)` schedules fn's synchronous prefix as a
// microtask the instant after() is called, which races the caller's
// `await requestPasswordReset(...)` and can run before the test's
// post-await assertions regardless of the implementation under test.
// Storing the callback itself and only invoking+awaiting it inside
// drainAfter() makes the deferral genuine.
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(fn)
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: h.findFirst },
    $transaction: (fn: (tx: unknown) => unknown) =>
      fn({ user: { findUnique: h.txUserFindUnique, update: h.txUserUpdate } }),
  },
}))
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return {
    ...actual,
    mintToken: h.mintToken,
    peekToken: h.peekToken,
    consumeToken: h.consumeToken,
    invalidateTokens: h.invalidateTokens,
  }
})
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, hashPassword: h.hashPassword }
})
vi.mock('@/lib/mail/send', () => ({ sendPasswordResetEmail: h.sendPasswordResetEmail }))

import {
  requestPasswordReset,
  FORGOT_FIXED_MESSAGE,
  peekResetToken,
  completePasswordReset,
} from '@/actions/auth-reset'

const PASSWORD_USER = {
  id: 'u1',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hash',
}
const OAUTH_ONLY_USER = { id: 'u2', email: 'bob@example.com', passwordHash: null }

async function drainAfter() {
  return Promise.all(h.afterTasks.splice(0).map((fn) => fn()))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  h.mintToken.mockResolvedValue('raw-token')
})

describe('the enumeration invariant', () => {
  it('returns a byte-identical result for a known, an unknown, and an OAuth-only identifier', async () => {
    const results: string[] = []
    for (const row of [PASSWORD_USER, null, OAUTH_ONLY_USER]) {
      h.findFirst.mockResolvedValue(row)
      results.push(JSON.stringify(await requestPasswordReset({ identifier: 'x' })))
    }
    expect(new Set(results).size).toBe(1)
    expect(JSON.parse(results[0])).toEqual({ success: true, data: undefined })
  })

  it('touches the database only inside after(), so the paths cannot be timed apart', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice@example.com' })
    expect(h.findFirst).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.findFirst).toHaveBeenCalled()
  })
})

describe('requestPasswordReset', () => {
  it('mints a password_reset token and mails it to an account that HAS a password', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice@example.com' })
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
    expect(h.sendPasswordResetEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('MUTANT 5: sends nothing to an OAuth-only account', async () => {
    // An OAuth-only account already has a working way in. Mailing it a reset
    // link converts "controls the inbox" into "owns the account" on the
    // strength of an email claim GitHub gave us and we never verified.
    h.findFirst.mockResolvedValue(OAUTH_ONLY_USER)
    await requestPasswordReset({ identifier: 'bob@example.com' })
    await drainAfter()
    expect(h.mintToken).not.toHaveBeenCalled()
    expect(h.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown identifier', async () => {
    h.findFirst.mockResolvedValue(null)
    await requestPasswordReset({ identifier: 'nobody@example.invalid' })
    await drainAfter()
    expect(h.sendPasswordResetEmail).not.toHaveBeenCalled()
  })

  it('accepts a HANDLE, not just an email', async () => {
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'Alice_NG' })
    await drainAfter()
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice_ng' }, { normalizedHandle: 'alice_ng' }],
    })
  })

  it('mails the ACCOUNT address, never the address that was typed', async () => {
    // Otherwise anyone could have a valid token for someone else's account
    // delivered to an inbox they control by signing in with the handle.
    h.findFirst.mockResolvedValue(PASSWORD_USER)
    await requestPasswordReset({ identifier: 'alice_ng' })
    await drainAfter()
    expect(h.sendPasswordResetEmail).toHaveBeenCalledWith('alice@example.com', 'raw-token')
  })

  it('swallows a failure rather than killing the after() callback', async () => {
    h.findFirst.mockRejectedValue(new Error('database is down'))
    await requestPasswordReset({ identifier: 'x' })
    await expect(drainAfter()).resolves.toBeDefined()
  })

  it('exports one fixed message that promises nothing about existence', () => {
    expect(FORGOT_FIXED_MESSAGE).toMatch(/if that account exists/i)
  })
})

describe('peekResetToken', () => {
  it('checks a PASSWORD_RESET token and consumes nothing', async () => {
    h.peekToken.mockResolvedValue(true)
    expect(await peekResetToken('raw')).toBe(true)
    expect(h.peekToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'password_reset',
      raw: 'raw',
    })
    expect(h.consumeToken).not.toHaveBeenCalled()
  })
})

describe('completePasswordReset', () => {
  beforeEach(() => {
    h.consumeToken.mockResolvedValue({ ok: true, userId: 'u1' })
    h.txUserFindUnique.mockResolvedValue({ sessionVersion: 4, emailVerified: null })
    h.txUserUpdate.mockResolvedValue({ id: 'u1' })
    h.invalidateTokens.mockResolvedValue(undefined)
    h.hashPassword.mockResolvedValue('$2b$12$new')
  })

  const VALID = { token: 'raw', password: 'a'.repeat(12) }

  it('rejects a password that fails policy BEFORE consuming the token', async () => {
    // Burning the token on a too-short password would make the user request a
    // whole new link to fix a typo.
    const res = await completePasswordReset({ token: 'raw', password: 'short' })
    expect(res.success).toBe(false)
    expect(h.consumeToken).not.toHaveBeenCalled()
  })

  it('hashes OUTSIDE the transaction', async () => {
    // Holding a Postgres transaction open across ~250ms of bcrypt is how a
    // serverless app exhausts its connection pool.
    await completePasswordReset(VALID)
    expect(h.hashPassword.mock.invocationCallOrder[0]).toBeLessThan(
      h.consumeToken.mock.invocationCallOrder[0],
    )
  })

  it('consumes the token atomically and writes the new password', async () => {
    const res = await completePasswordReset(VALID)
    expect(res.success).toBe(true)
    expect(h.consumeToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'password_reset',
      raw: 'raw',
    })
    const data = h.txUserUpdate.mock.calls[0][0].data
    expect(data.passwordHash).toBe('$2b$12$new')
    expect(data.passwordSetAt).toBeInstanceOf(Date)
  })

  it('BUMPS sessionVersion — it is a password change, so every JWT must die', async () => {
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.sessionVersion).toBe(5)
  })

  it('sets emailVerified when it was null — the inbox proved itself', async () => {
    // This is what gives an unverified, locked-out user exactly one path back.
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.emailVerified).toBeInstanceOf(Date)
  })

  it('does NOT move an emailVerified that already exists', async () => {
    const original = new Date('2026-01-01T00:00:00.000Z')
    h.txUserFindUnique.mockResolvedValue({ sessionVersion: 1, emailVerified: original })
    await completePasswordReset(VALID)
    expect(h.txUserUpdate.mock.calls[0][0].data.emailVerified).toBeUndefined()
  })

  it('invalidates the user’s other outstanding reset tokens', async () => {
    await completePasswordReset(VALID)
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'password_reset',
    })
  })

  it('refuses a used or expired token and writes nothing', async () => {
    h.consumeToken.mockResolvedValue({ ok: false, reason: 'invalid_or_expired' })
    const res = await completePasswordReset(VALID)
    expect(res.success).toBe(false)
    expect(h.txUserUpdate).not.toHaveBeenCalled()
  })

  it('refuses the SECOND use of the same link', async () => {
    h.consumeToken.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    h.consumeToken.mockResolvedValueOnce({ ok: false, reason: 'invalid_or_expired' })
    expect((await completePasswordReset(VALID)).success).toBe(true)
    expect((await completePasswordReset(VALID)).success).toBe(false)
  })
})
