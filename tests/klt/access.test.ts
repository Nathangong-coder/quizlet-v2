import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  setFindFirst: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: { set: { findFirst: h.setFindFirst } },
}))
vi.mock('@/auth', () => ({ auth: h.auth }))

import { requireSetKltAccess, requireSetKltView } from '@/lib/klt/access'

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
    // The row's id DIFFERS from the argument passed in — a mock that resolved
    // the SAME id as the argument cannot distinguish `access.setId = set.id`
    // from `access.setId = setId` (the raw argument), which is exactly the
    // vacuous shape this guard had before (2026-08-26 review finding #3).
    h.setFindFirst.mockResolvedValue({ id: 'set-resolved', title: 'Finance 101' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access?.setId).toBe('set-resolved')
  })
})

describe('requireSetKltView', () => {
  it('admits a signed-in stranger through the READ fragment, with canEdit false', async () => {
    h.auth.mockResolvedValue({ user: { id: STRANGER } })
    // The set is link-shared, so the read fragment matches it. A stranger on
    // the OWNERSHIP gate would have had `userId: STRANGER` in the where and
    // matched nothing — that difference is the whole feature.
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view).toEqual({
      viewerId: STRANGER,
      setId: SET_ID,
      setTitle: 'Finance 101',
      canEdit: false,
      viaAllowlist: false,
    })
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, OR: [{ userId: STRANGER }, { visibility: 'link' }] },
      select: { id: true, title: true, userId: true },
    })
  })

  it('admits a signed-out visitor, querying link-shared sets only', async () => {
    h.auth.mockResolvedValue(null)
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view?.viewerId).toBeNull()
    expect(view?.canEdit).toBe(false)
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, visibility: 'link' },
      select: { id: true, title: true, userId: true },
    })
  })

  it('never reports canEdit for an anonymous visitor, even if the row has a nullish owner', async () => {
    h.auth.mockResolvedValue(null)
    // `undefined === undefined` would make a signed-out visitor "the owner" of
    // a row with no userId — the exact hazard `canReadSet` documents.
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Orphan', userId: undefined })

    const view = await requireSetKltView(SET_ID)

    expect(view?.canEdit).toBe(false)
  })

  it('reports canEdit for the owner', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view?.canEdit).toBe(true)
  })

  it('reports canEdit for an operator on a set they do not own, unscoped by the read fragment', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Someone Else’s Deck', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view).toEqual({
      viewerId: ADMIN,
      setId: SET_ID,
      setTitle: 'Someone Else’s Deck',
      canEdit: true,
      viaAllowlist: true,
    })
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID },
      select: { id: true, title: true, userId: true },
    })
  })

  it('returns null — never a distinguishable refusal — for a private set the viewer cannot read', async () => {
    h.auth.mockResolvedValue({ user: { id: STRANGER } })
    // What the read fragment does to a private set someone else owns.
    h.setFindFirst.mockResolvedValue(null)

    expect(await requireSetKltView(SET_ID)).toBeNull()
  })

  it('resolves setId from the database row, not merely echoing the argument back', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindFirst.mockResolvedValue({ id: 'set-resolved', title: 'Finance 101', userId: OWNER })

    expect((await requireSetKltView(SET_ID))?.setId).toBe('set-resolved')
  })
})
