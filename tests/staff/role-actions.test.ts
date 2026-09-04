import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userUpdate: vi.fn(),
  grantCreate: vi.fn(),
  grantUpdateMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { update: h.userUpdate, findMany: vi.fn().mockResolvedValue([]) },
    roleGrant: { create: h.grantCreate, updateMany: h.grantUpdateMany },
    $transaction: h.transaction,
  },
}))

import { grantRole, revokeRole } from '@/actions/staff-roles'

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockResolvedValue([])
})

describe('grantRole', () => {
  it('refuses a learner, a staff member, and a signed-out caller', async () => {
    for (const session of [
      { user: { id: 'u1', role: 'learner' } },
      // STAFF IS NOT ADMIN: reading the engine is not granting access to it.
      { user: { id: 'u1', role: 'staff' } },
      null,
    ]) {
      h.auth.mockResolvedValue(session)
      expect(await grantRole({ userId: 'u2', role: 'admin' })).toEqual({
        success: false,
        error: 'Not found',
      })
      expect(h.transaction).not.toHaveBeenCalled()
    }
  })

  it('refuses a role outside the vocabulary', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'admin' } })
    const res = await grantRole({ userId: 'u2', role: 'superuser' })
    expect(res.success).toBe(false)
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('writes the grant and stamps the actor', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await grantRole({ userId: 'u2', role: 'staff' })
    expect(res.success).toBe(true)
    expect(h.grantCreate).toHaveBeenCalledWith({
      data: { userId: 'u2', role: 'staff', grantedById: 'admin-1' },
    })
  })
})

describe('revokeRole', () => {
  /**
   * THE GUARD THAT CANNOT FAIL VISIBLY. The last admin revoking themselves
   * locks the install out of /staff/roles permanently, recoverable only by
   * CLI. Assert the refusal, not just the success path.
   */
  it('refuses an admin revoking their own role', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await revokeRole({ userId: 'admin-1' })
    expect(res).toEqual({
      success: false,
      error: 'You cannot revoke your own role. Use npm run grant-role.',
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('revokes someone else', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await revokeRole({ userId: 'u2' })
    expect(res.success).toBe(true)
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('refuses a staff caller', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    expect(await revokeRole({ userId: 'u2' })).toEqual({ success: false, error: 'Not found' })
  })
})
