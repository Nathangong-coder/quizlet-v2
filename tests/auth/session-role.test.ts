import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: h.findUnique } } }))

import { jwtCallback, sessionCallback } from '@/lib/auth/session'

beforeEach(() => vi.clearAllMocks())

describe('role on the session', () => {
  it('reads the role from the database on every resolution, not from the token', async () => {
    // The token carries a STALE role. The database says learner. The database wins.
    h.findUnique.mockResolvedValue({ sessionVersion: 3, role: 'learner' })

    const token = await jwtCallback({ token: { sub: 'u1', sv: 3, role: 'admin' } })
    expect(token).not.toBeNull()

    const session = await sessionCallback({
      session: { user: { id: undefined, name: 'A' } },
      token: token!,
    })
    expect(session.user?.role).toBe('learner')
  })

  it('stamps the role on first issue alongside the session version', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0, role: 'staff' })

    const token = await jwtCallback({ token: {}, user: { id: 'u2' } })

    const session = await sessionCallback({ session: { user: {} }, token: token! })
    expect(session.user?.id).toBe('u2')
    expect(session.user?.role).toBe('staff')
  })

  it('falls back to learner when the row somehow has no role', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0 })

    const token = await jwtCallback({ token: { sub: 'u3', sv: 0 } })
    const session = await sessionCallback({ session: { user: {} }, token: token! })
    expect(session.user?.role).toBe('learner')
  })

  it('still revokes on a session-version mismatch, role notwithstanding', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 9, role: 'admin' })
    expect(await jwtCallback({ token: { sub: 'u4', sv: 8 } })).toBeNull()
  })

  it('selects role in the SAME query as sessionVersion — no second round trip', async () => {
    h.findUnique.mockResolvedValue({ sessionVersion: 0, role: 'admin' })
    await jwtCallback({ token: { sub: 'u5', sv: 0 } })

    expect(h.findUnique).toHaveBeenCalledTimes(1)
    expect(h.findUnique.mock.calls[0][0].select).toEqual({ sessionVersion: true, role: true })
  })
})
