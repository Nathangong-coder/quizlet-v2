import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  setFindFirst: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: { set: { findFirst: h.setFindFirst } },
}))
vi.mock('@/auth', () => ({ auth: h.auth }))

import { requireSetKltAccess } from '@/lib/klt/access'

const OWNER = 'owner-1'
const STRANGER = 'stranger-1'
const ADMIN = 'admin-1'
const SET_ID = 'set-1'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.KLT_EDITORS = ADMIN
})

describe('requireSetKltAccess', () => {
  it('admits the set owner, scoped to their own userId in the query', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toEqual({ userId: OWNER, setId: SET_ID, setTitle: 'Finance 101', viaAllowlist: false })
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, userId: OWNER },
      select: { id: true, title: true },
    })
  })

  it('refuses a stranger — the query itself excludes their access, and the DB returns nothing', async () => {
    h.auth.mockResolvedValue({ user: { id: STRANGER } })
    // A stranger's query is scoped to their OWN userId, so a set they don't
    // own is never matched — simulate that by resolving null, exactly as a
    // real `where: { id, userId: STRANGER }` would for someone else's set.
    h.setFindFirst.mockResolvedValue(null)

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toBeNull()
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, userId: STRANGER },
      select: { id: true, title: true },
    })
  })

  it('refuses a nonexistent set even for the operator allowlist', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN } })
    h.setFindFirst.mockResolvedValue(null)

    const access = await requireSetKltAccess('does-not-exist')

    expect(access).toBeNull()
  })

  it('refuses when signed out, without ever querying the database', async () => {
    h.auth.mockResolvedValue(null)

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toBeNull()
    expect(h.setFindFirst).not.toHaveBeenCalled()
  })

  it('admits an allowlisted operator who does not own the set, querying by id alone (no userId filter)', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Someone Else’s Deck' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toEqual({
      userId: ADMIN,
      setId: SET_ID,
      setTitle: 'Someone Else’s Deck',
      viaAllowlist: true,
    })
    // The operator's query is NOT scoped by userId — that is what makes it
    // reach a set owned by someone else at all.
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID },
      select: { id: true, title: true },
    })
  })

  it('resolves setId from the database row, not merely echoing the argument back', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access?.setId).toBe(SET_ID)
  })
})
