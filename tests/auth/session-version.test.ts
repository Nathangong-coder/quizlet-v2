import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }))

import { jwtCallback, sessionCallback } from '@/lib/auth/session'

beforeEach(() => vi.clearAllMocks())

describe('jwtCallback on sign-in', () => {
  it('stamps the id and the current sessionVersion onto the token', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 3 })

    const token = await jwtCallback({ token: {}, user: { id: 'u1' } })

    expect(token).toMatchObject({ sub: 'u1', sv: 3 })
  })

  it('reads the version from the database rather than trusting the user object', async () => {
    // The `user` argument comes from an adapter or a provider and is not
    // guaranteed to carry every column. Reading it here — once, at sign-in —
    // is what makes the comparison below meaningful.
    h.findUnique.mockResolvedValue({ sessionVersion: 7 })

    const token = await jwtCallback({ token: {}, user: { id: 'u1', sessionVersion: 0 } })

    expect(token).toMatchObject({ sv: 7 })
  })
})

describe('jwtCallback on a later request', () => {
  it('keeps the token when the version still matches', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 3 })

    const token = await jwtCallback({ token: { sub: 'u1', sv: 3 } })

    expect(token).toMatchObject({ sub: 'u1', sv: 3 })
  })

  it('INVALIDATES the token when the stored version has moved on', async () => {
    // This is the whole point of the column. Without it, "change my password"
    // does not sign out an attacker already holding a token — there is no
    // session row to delete under the JWT strategy.
    h.findUnique.mockResolvedValue({ sessionVersion: 4 })

    expect(await jwtCallback({ token: { sub: 'u1', sv: 3 } })).toBeNull()
  })

  it('invalidates a token whose user no longer exists', async () => {
    h.findUnique.mockResolvedValue(null)

    expect(await jwtCallback({ token: { sub: 'u1', sv: 3 } })).toBeNull()
  })

  it('invalidates a token carrying no version claim at all', async () => {
    // Tokens issued before this shipped have no `sv`. Treating "absent" as
    // "matches" would leave every pre-existing token permanently unrevokable,
    // which is exactly the state this exists to end.
    h.findUnique.mockResolvedValue({ sessionVersion: 0 })

    expect(await jwtCallback({ token: { sub: 'u1' } })).toBeNull()
  })

  it('invalidates a token with no subject without querying', async () => {
    expect(await jwtCallback({ token: {} })).toBeNull()
    expect(h.findUnique).not.toHaveBeenCalled()
  })
})

describe('sessionCallback', () => {
  it('copies the token subject onto session.user.id', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Alice' } },
      token: { sub: 'u1', sv: 1 },
    })

    expect(session.user.id).toBe('u1')
  })

  it('does not leak the version claim into the client-visible session', async () => {
    const session = await sessionCallback({
      session: { user: { name: 'Alice' } },
      token: { sub: 'u1', sv: 1 },
    })

    expect(JSON.stringify(session)).not.toContain('"sv"')
  })
})
