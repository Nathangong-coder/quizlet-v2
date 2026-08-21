import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  verifyPassword: vi.fn(),
  verifyAgainstDummy: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: { user: { findFirst: h.findFirst } } }))
vi.mock('@/lib/auth/password', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/password')>()
  return { ...actual, verifyPassword: h.verifyPassword, verifyAgainstDummy: h.verifyAgainstDummy }
})

import { authorizeCredentials } from '@/lib/auth/credentials'

const USER = {
  id: 'u1',
  email: 'alice@example.com',
  name: 'Alice',
  image: null,
  passwordHash: '$2b$12$hash',
  emailVerified: new Date('2026-01-01'),
}

beforeEach(() => {
  vi.clearAllMocks()
  h.verifyAgainstDummy.mockResolvedValue(false)
})

describe('authorizeCredentials', () => {
  it('returns the user when the password verifies', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).toEqual({
      kind: 'ok',
      user: { id: 'u1', email: 'alice@example.com', name: 'Alice', image: null },
    })
  })

  it('NEVER returns the password hash to Auth.js', async () => {
    // Whatever this returns is what lands in the JWT-building pipeline.
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(JSON.stringify(result)).not.toContain('passwordHash')
  })

  it('returns rejected on a wrong password', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(false)

    expect(
      await authorizeCredentials({ identifier: 'alice', password: 'wrongwrongwrong' }),
    ).toEqual({ kind: 'rejected' })
  })

  it('runs a dummy comparison when no user matches, instead of returning early', async () => {
    // The defect this closes: an early return answers in ~1ms where a real
    // account takes ~250ms, which tells an attacker which addresses exist.
    // A mock that merely resolves (even asynchronously) cannot tell an AWAITED
    // dummy compare from a fire-and-forget `void verifyAgainstDummy(...)`
    // followed by an immediate `return null` — both call the mock, and both
    // would satisfy a plain `toHaveBeenCalledWith`. So this test backs the
    // mock with a deferred promise it controls by hand, and asserts that
    // `authorizeCredentials` has NOT settled while that promise is still
    // outstanding — which only holds if the implementation actually awaits it.
    let releaseDummy: (() => void) | undefined
    h.verifyAgainstDummy.mockImplementation(
      () => new Promise<false>((resolve) => { releaseDummy = () => resolve(false) }),
    )
    h.findFirst.mockResolvedValue(null)

    let settled = false
    const pending = authorizeCredentials({ identifier: 'nobody', password: 'a'.repeat(12) })
    pending.then(() => { settled = true })

    // Flush the microtask queue so a synchronous (non-awaited) `return null`
    // would already have settled `pending` by this point.
    await new Promise((resolve) => setImmediate(resolve))
    expect(settled, 'authorize resolved before the dummy comparison finished').toBe(false)

    releaseDummy!()
    expect(await pending).toEqual({ kind: 'rejected' })
    expect(h.verifyAgainstDummy).toHaveBeenCalledWith('a'.repeat(12))
  })

  it('runs a dummy comparison for an OAuth-only account with no password', async () => {
    // Same oracle, different route: a GitHub user has passwordHash null, and
    // returning early there leaks that the address is registered.
    h.findFirst.mockResolvedValue({ ...USER, passwordHash: null })

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).toEqual({ kind: 'rejected' })
    expect(h.verifyAgainstDummy).toHaveBeenCalled()
    expect(h.verifyPassword).not.toHaveBeenCalled()
  })

  it('rejects non-string input without touching the database', async () => {
    expect(await authorizeCredentials({ identifier: undefined, password: 'a'.repeat(12) })).toEqual({
      kind: 'rejected',
    })
    expect(await authorizeCredentials({ identifier: 'alice', password: 123 })).toEqual({
      kind: 'rejected',
    })
    expect(h.findFirst).not.toHaveBeenCalled()
  })

  it('queries by email OR normalizedHandle, and selects no other user', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    await authorizeCredentials({ identifier: 'Alice@Example.com', password: 'a'.repeat(12) })

    expect(h.findFirst.mock.calls[0][0].where).toEqual({
      OR: [{ email: 'alice@example.com' }, { normalizedHandle: 'alice@example.com' }],
    })
  })

  it('does not apply the sign-up length policy to sign-in', async () => {
    // A password shorter than today's minimum may already exist (the policy
    // can change). Rejecting it here would lock those accounts out while
    // reporting "incorrect", which is unrecoverable without password reset.
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'short' })

    expect(result).toEqual({ kind: 'ok', user: expect.any(Object) })
  })
})

describe('the verification gate', () => {
  const VERIFIED = { ...USER, emailVerified: new Date('2026-01-01') }
  const UNVERIFIED = { ...USER, emailVerified: null }

  it('returns unverified ONLY when the password was correct', async () => {
    // The gate is enumeration-safe because of WHEN it fires. At this moment the
    // caller already knows the account exists and knows its password, so
    // telling them "verify your email" reveals nothing they did not supply.
    h.findFirst.mockResolvedValue(UNVERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    expect(await authorizeCredentials({ identifier: 'a', password: 'p' })).toEqual({
      kind: 'unverified',
    })
  })

  it('returns rejected — NOT unverified — for a WRONG password on an unverified account', async () => {
    // Otherwise the gate becomes the oracle: "unverified" would confirm the
    // account exists to someone who guessed nothing right.
    h.findFirst.mockResolvedValue(UNVERIFIED)
    h.verifyPassword.mockResolvedValue(false)
    expect(await authorizeCredentials({ identifier: 'a', password: 'wrong' })).toEqual({
      kind: 'rejected',
    })
  })

  it('lets a verified account through', async () => {
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    const res = await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(res).toEqual({
      kind: 'ok',
      user: { id: 'u1', email: 'alice@example.com', name: 'Alice', image: null },
    })
  })

  it('returns rejected for an unknown identifier, after a real dummy comparison', async () => {
    h.findFirst.mockResolvedValue(null)
    expect(await authorizeCredentials({ identifier: 'nobody', password: 'p' })).toEqual({
      kind: 'rejected',
    })
    expect(h.verifyAgainstDummy).toHaveBeenCalled()
  })

  it('never returns the password hash in the ok payload', async () => {
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    const res = await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(JSON.stringify(res)).not.toContain('$2b$12$')
  })

  it('selects emailVerified — a gate reading an unselected field fails CLOSED, not open', async () => {
    // If `emailVerified` were left out of `select`, the field would come back
    // `undefined` — falsy — so `if (!user.emailVerified)` would fire for
    // EVERY user, verified or not, locking everyone out rather than letting
    // anyone through. That failure mode is invisible to any behavioural test
    // here: this mock ignores `select` and always returns the whole fixture
    // regardless of what was asked for, so only a direct assertion on the
    // query shape below can catch the omission.
    h.findFirst.mockResolvedValue(VERIFIED)
    h.verifyPassword.mockResolvedValue(true)
    await authorizeCredentials({ identifier: 'a', password: 'p' })
    expect(h.findFirst.mock.calls[0][0].select.emailVerified).toBe(true)
  })
})
