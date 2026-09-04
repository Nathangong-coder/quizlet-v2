import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock('@/auth', () => ({ auth: h.auth }))

import { requireStaff, requireAdmin } from '@/lib/staff/access'

beforeEach(() => vi.clearAllMocks())

describe('requireStaff', () => {
  it('resolves for staff and for admin', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    expect(await requireStaff()).toEqual({ userId: 'u1', role: 'staff' })

    h.auth.mockResolvedValue({ user: { id: 'u2', role: 'admin' } })
    expect(await requireStaff()).toEqual({ userId: 'u2', role: 'admin' })
  })

  it('returns null for a learner, a signed-out visitor, and a session with no id', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u3', role: 'learner' } })
    expect(await requireStaff()).toBeNull()

    h.auth.mockResolvedValue(null)
    expect(await requireStaff()).toBeNull()

    // A staff role with no id must NOT resolve — an empty subject is not a user.
    h.auth.mockResolvedValue({ user: { role: 'admin' } })
    expect(await requireStaff()).toBeNull()
  })

  it('returns null when the role is absent or unrecognised', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u4' } })
    expect(await requireStaff()).toBeNull()

    h.auth.mockResolvedValue({ user: { id: 'u5', role: 'superuser' } })
    expect(await requireStaff()).toBeNull()
  })
})

describe('requireAdmin', () => {
  it('resolves for admin only', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    expect(await requireAdmin()).toEqual({ userId: 'u1', role: 'admin' })
  })

  it('returns null for staff — the read role is not the grant role', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u2', role: 'staff' } })
    expect(await requireAdmin()).toBeNull()
  })
})
