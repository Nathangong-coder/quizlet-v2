import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  updateMany: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: { set: { updateMany: h.updateMany } },
}))
vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: h.revalidatePath }))

import { setListingBlocked } from '@/actions/set-reports'

const SET_ID = 'set-1'

beforeEach(() => {
  vi.clearAllMocks()
  h.updateMany.mockResolvedValue({ count: 1 })
})

describe('setListingBlocked', () => {
  it('succeeds for an admin session', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })

    const res = await setListingBlocked(SET_ID, true)

    expect(res).toEqual({ success: true, data: undefined })
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { id: SET_ID },
      data: { listingBlocked: true },
    })
    expect(h.revalidatePath).toHaveBeenCalledWith('/browse')
    expect(h.revalidatePath).toHaveBeenCalledWith(`/sets/${SET_ID}`)
  })

  it('refuses a staff session — staff is not admin — touching no row and revalidating nothing', async () => {
    // Regression guard, same shape as the klt-presets/klt-access findings: a
    // session with no `role` at all would leave a requireAdmin -> requireStaff
    // swap undetected here (isStaff(undefined) and isAdmin(undefined) are both
    // false), so this has to be an EXPLICIT 'staff' role to actually
    // distinguish the two predicates.
    h.auth.mockResolvedValue({ user: { id: 'staff-1', role: 'staff' } })

    const res = await setListingBlocked(SET_ID, true)

    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.updateMany).not.toHaveBeenCalled()
    expect(h.revalidatePath).not.toHaveBeenCalled()
  })

  it('refuses a signed-out caller', async () => {
    h.auth.mockResolvedValue(null)

    const res = await setListingBlocked(SET_ID, true)

    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.updateMany).not.toHaveBeenCalled()
  })

  it('reports not-found — never a distinguishable refusal — when the set does not exist, even for an admin', async () => {
    h.auth.mockResolvedValue({ user: { id: 'admin-1', role: 'admin' } })
    h.updateMany.mockResolvedValue({ count: 0 })

    const res = await setListingBlocked('does-not-exist', true)

    expect(res).toEqual({ success: false, error: 'Not found' })
    expect(h.revalidatePath).not.toHaveBeenCalled()
  })
})
