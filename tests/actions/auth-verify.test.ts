import { describe, it, expect, vi, beforeEach } from 'vitest'

// The mock set is deliberately wider than this task needs: Task 7 adds
// consumeEmailVerification to the same file and would otherwise have to
// rewrite these blocks.
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  mintToken: vi.fn(),
  consumeToken: vi.fn(),
  invalidateTokens: vi.fn(),
  txUserUpdate: vi.fn(),
  sendVerificationEmail: vi.fn(),
  afterTasks: [] as Array<() => unknown>,
}))

// DEVIATION from the brief: `after` here stores the callback itself, not
// `Promise.resolve().then(fn)`. The latter schedules fn's synchronous prefix
// (everything up to its first internal await) as a microtask the instant
// after() is called — which races the caller's `await resendVerification(...)`
// and can run BEFORE the test's post-await assertions, independent of the
// implementation under test (confirmed empirically: any implementation that
// calls after() synchronously and returns synchronously hits this). Storing
// the function and only invoking+awaiting it inside drainAfter() makes the
// deferral genuine, matching the test's stated intent.
vi.mock('next/server', () => ({
  after: (fn: () => unknown) => {
    h.afterTasks.push(fn)
  },
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findFirst: h.findFirst },
    $transaction: (fn: (tx: unknown) => unknown) => fn({ user: { update: h.txUserUpdate } }),
  },
}))
vi.mock('@/lib/auth/tokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/tokens')>()
  return {
    ...actual,
    mintToken: h.mintToken,
    consumeToken: h.consumeToken,
    invalidateTokens: h.invalidateTokens,
  }
})
vi.mock('@/lib/mail/send', () => ({ sendVerificationEmail: h.sendVerificationEmail }))

import { resendVerification, RESEND_FIXED_MESSAGE, consumeEmailVerification } from '@/actions/auth-verify'

async function drainAfter() {
  return Promise.all(h.afterTasks.splice(0).map((fn) => fn()))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.afterTasks.length = 0
  h.mintToken.mockResolvedValue('raw-token')
})

describe('the enumeration invariant', () => {
  const CASES: Array<[string, unknown]> = [
    ['an unverified account', { id: 'u1', email: 'a@example.com', emailVerified: null }],
    ['an ALREADY verified account', { id: 'u1', email: 'a@example.com', emailVerified: new Date() }],
    ['no account at all', null],
  ]

  it('returns a byte-identical result for every input', async () => {
    const results: string[] = []
    for (const [, row] of CASES) {
      h.findFirst.mockResolvedValue(row)
      const res = await resendVerification({ identifier: 'whatever' })
      results.push(JSON.stringify(res))
    }
    expect(new Set(results).size).toBe(1)
    expect(JSON.parse(results[0])).toEqual({ success: true, data: undefined })
  })

  it('does ALL of its work inside after(), so the two paths cannot be timed apart', async () => {
    // Identical text is not sufficient. Sending mail takes a couple of hundred
    // milliseconds and not sending takes none, so a caller can time the
    // difference and learn which addresses have accounts.
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'a@example.com' })
    expect(h.findFirst).not.toHaveBeenCalled()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
    await drainAfter()
    expect(h.sendVerificationEmail).toHaveBeenCalled()
  })
})

describe('resendVerification', () => {
  it('mints and sends for an unverified account', async () => {
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'a@example.com' })
    await drainAfter()
    expect(h.mintToken).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
    expect(h.sendVerificationEmail).toHaveBeenCalledWith('a@example.com', 'raw-token')
  })

  it('sends NOTHING to an already-verified account', async () => {
    // Otherwise "resend" is a way to make the app send unlimited messages to
    // any address that has ever registered.
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: new Date() })
    await resendVerification({ identifier: 'a@example.com' })
    await drainAfter()
    expect(h.mintToken).not.toHaveBeenCalled()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('sends nothing for an unknown identifier', async () => {
    h.findFirst.mockResolvedValue(null)
    await resendVerification({ identifier: 'nobody@example.invalid' })
    await drainAfter()
    expect(h.sendVerificationEmail).not.toHaveBeenCalled()
  })

  it('accepts a handle as well as an email', async () => {
    h.findFirst.mockResolvedValue({ id: 'u1', email: 'a@example.com', emailVerified: null })
    await resendVerification({ identifier: 'Alice_NG' })
    await drainAfter()
    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice_ng' }, { normalizedHandle: 'alice_ng' }],
    })
    expect(h.sendVerificationEmail).toHaveBeenCalledWith('a@example.com', 'raw-token')
  })

  it('never lets a mail failure escape into the after() callback', async () => {
    h.findFirst.mockRejectedValue(new Error('database is down'))
    await resendVerification({ identifier: 'a@example.com' })
    await expect(drainAfter()).resolves.toBeDefined()
  })

  it('exports the fixed message so the UI cannot invent a second one', () => {
    expect(RESEND_FIXED_MESSAGE).toMatch(/if that account/i)
  })
})

describe('consumeEmailVerification', () => {
  beforeEach(() => {
    h.consumeToken.mockResolvedValue({ ok: true, userId: 'u1' })
    h.txUserUpdate.mockResolvedValue({ id: 'u1' })
    h.invalidateTokens.mockResolvedValue(undefined)
  })

  it('consumes an EMAIL_VERIFY token — never a reset one', async () => {
    await consumeEmailVerification('raw')
    expect(h.consumeToken).toHaveBeenCalledWith(expect.anything(), {
      purpose: 'email_verify',
      raw: 'raw',
    })
  })

  it('stamps emailVerified and reports success', async () => {
    const res = await consumeEmailVerification('raw')
    expect(res).toEqual({ ok: true })
    expect(h.txUserUpdate).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { emailVerified: expect.any(Date) },
    })
  })

  it('invalidates the user’s other outstanding verify links', async () => {
    await consumeEmailVerification('raw')
    expect(h.invalidateTokens).toHaveBeenCalledWith(expect.anything(), {
      userId: 'u1',
      purpose: 'email_verify',
    })
  })

  it('refuses an invalid or expired token WITHOUT writing anything', async () => {
    h.consumeToken.mockResolvedValue({ ok: false, reason: 'invalid_or_expired' })
    const res = await consumeEmailVerification('raw')
    expect(res).toEqual({ ok: false })
    expect(h.txUserUpdate).not.toHaveBeenCalled()
    expect(h.invalidateTokens).not.toHaveBeenCalled()
  })

  it('refuses a REUSED token — the atomic claim is what decides', async () => {
    h.consumeToken.mockResolvedValueOnce({ ok: true, userId: 'u1' })
    h.consumeToken.mockResolvedValueOnce({ ok: false, reason: 'invalid_or_expired' })
    expect(await consumeEmailVerification('raw')).toEqual({ ok: true })
    expect(await consumeEmailVerification('raw')).toEqual({ ok: false })
  })

  it('does NOT sign the user in', async () => {
    // The token is in a URL, which lands in browser history and in whatever
    // proxy logged the request. Verification proves the inbox; it is not a
    // credential.
    const mod = await import('@/actions/auth-verify')
    expect(Object.keys(mod)).not.toContain('signIn')
  })
})
