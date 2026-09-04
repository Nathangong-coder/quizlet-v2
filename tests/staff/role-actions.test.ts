import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  userUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindMany: vi.fn(),
  grantCreate: vi.fn(),
  grantUpdateMany: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      update: h.userUpdate,
      findMany: h.userFindMany,
      findUnique: h.userFindUnique,
    },
    roleGrant: { create: h.grantCreate, updateMany: h.grantUpdateMany },
    $transaction: h.transaction,
  },
}))

import { grantRole, revokeRole, searchUsers } from '@/actions/staff-roles'

beforeEach(() => {
  vi.clearAllMocks()
  h.transaction.mockResolvedValue([])
  h.userFindMany.mockResolvedValue([])
  // Default: the target id exists. Tests for the missing-user path override
  // this to null explicitly, so every other test keeps exercising the write
  // path rather than silently short-circuiting on a false "not found".
  h.userFindUnique.mockResolvedValue({ id: 'exists' })
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

  /**
   * FINDING 1 (review, 2026-09-03): grantRole is a second door to the exact
   * lockout revokeRole's self-check forbids — an admin could demote (or
   * no-op re-grant) themselves via this action with nothing standing in the
   * way but a disabled button in the UI, which is not a guard. Both self-
   * target cases route through the same refuseSelfTarget helper revokeRole
   * uses, and must return the identical message.
   */
  it('refuses an admin granting themselves a role — the same lockout door as revokeRole', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await grantRole({ userId: 'admin-1', role: 'learner' })
    expect(res).toEqual({
      success: false,
      error: 'You cannot change your own role. Use npm run grant-role.',
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('refuses self-targeting for any role, not just a demotion to learner', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await grantRole({ userId: 'admin-1', role: 'staff' })
    expect(res).toEqual({
      success: false,
      error: 'You cannot change your own role. Use npm run grant-role.',
    })
    expect(h.transaction).not.toHaveBeenCalled()
  })

  it('still grants someone else — the self-check must not over-block', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    const res = await grantRole({ userId: 'u2', role: 'staff' })
    expect(res.success).toBe(true)
    expect(h.transaction).toHaveBeenCalledTimes(1)
  })

  it('returns Not found for a userId that does not exist, rather than throwing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    h.userFindUnique.mockResolvedValue(null)
    const res = await grantRole({ userId: 'ghost', role: 'staff' })
    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.transaction).not.toHaveBeenCalled()
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
      error: 'You cannot change your own role. Use npm run grant-role.',
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

  it('returns Not found for a userId that does not exist, rather than throwing', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    h.userFindUnique.mockResolvedValue(null)
    const res = await revokeRole({ userId: 'ghost' })
    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.transaction).not.toHaveBeenCalled()
  })
})

describe('searchUsers', () => {
  /**
   * FINDING 3 (review, 2026-09-03): grantRole and revokeRole each had a
   * hand-written gating test in this file; searchUsers had none — the
   * generic every-export loop in tests/staff/actions-gating.test.ts covers
   * @/actions/staff only, not staff-roles.ts. Assert the refusal AND that
   * the lookup never ran, the same shape every other refusal test here uses.
   */
  it('refuses a staff caller and never looks a user up', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u1', role: 'staff' } })
    const res = await searchUsers({ q: 'nathan' })
    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.userFindMany).not.toHaveBeenCalled()
  })
})
