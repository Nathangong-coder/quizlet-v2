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

    expect(result).toEqual({ id: 'u1', email: 'alice@example.com', name: 'Alice', image: null })
  })

  it('NEVER returns the password hash to Auth.js', async () => {
    // Whatever this returns is what lands in the JWT-building pipeline.
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(true)

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).not.toHaveProperty('passwordHash')
  })

  it('returns null on a wrong password', async () => {
    h.findFirst.mockResolvedValue(USER)
    h.verifyPassword.mockResolvedValue(false)

    expect(await authorizeCredentials({ identifier: 'alice', password: 'wrongwrongwrong' })).toBeNull()
  })

  it('runs a dummy comparison when no user matches, instead of returning early', async () => {
    // The defect this closes: an early return answers in ~1ms where a real
    // account takes ~250ms, which tells an attacker which addresses exist.
    h.findFirst.mockResolvedValue(null)

    const result = await authorizeCredentials({ identifier: 'nobody', password: 'a'.repeat(12) })

    expect(result).toBeNull()
    expect(h.verifyAgainstDummy).toHaveBeenCalledWith('a'.repeat(12))
  })

  it('runs a dummy comparison for an OAuth-only account with no password', async () => {
    // Same oracle, different route: a GitHub user has passwordHash null, and
    // returning early there leaks that the address is registered.
    h.findFirst.mockResolvedValue({ ...USER, passwordHash: null })

    const result = await authorizeCredentials({ identifier: 'alice', password: 'a'.repeat(12) })

    expect(result).toBeNull()
    expect(h.verifyAgainstDummy).toHaveBeenCalled()
    expect(h.verifyPassword).not.toHaveBeenCalled()
  })

  it('rejects non-string input without touching the database', async () => {
    expect(await authorizeCredentials({ identifier: undefined, password: 'a'.repeat(12) })).toBeNull()
    expect(await authorizeCredentials({ identifier: 'alice', password: 123 })).toBeNull()
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

    expect(result).not.toBeNull()
  })
})
