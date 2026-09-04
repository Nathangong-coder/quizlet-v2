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
// Asserted THROUGH the fragment, never against a copy of its literal shape.
// These three assertions used to hardcode `{ visibility: 'link' }` and all
// went red the moment `public` was added — not because the gate regressed,
// but because a test had duplicated a security module's internals. Referencing
// it still catches the failure that matters (a call site reverting to an
// ownership-only filter, or passing the wrong viewerId) and cannot drift again.
import { readableSetWhere } from '@/lib/sets/visibility'

const OWNER = 'owner-1'
const STRANGER = 'stranger-1'
const STAFF = 'staff-1'
const ADMIN = 'admin-1'
const SET_ID = 'set-1'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireSetKltAccess', () => {
  it('admits the set owner, scoped to their own userId in the query', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toEqual({ userId: OWNER, setId: SET_ID, setTitle: 'Finance 101', viaRole: false })
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

  it('refuses a staff member reaching for a set they do not own, scoped to their own userId in the query — a staff member is not an admin', async () => {
    // Regression guard: isStaff(role) admits 'staff' as well as 'admin', so a
    // gate mistakenly written as isStaff instead of isAdmin would leave this
    // green if it only checked the RETURNED value. Asserting the exact Prisma
    // `where` shape is what actually catches that swap — a staff-as-admin bug
    // would query `{ id: SET_ID }` (unscoped), never `{ id: SET_ID, userId }`.
    h.auth.mockResolvedValue({ user: { id: STAFF, role: 'staff' } })
    h.setFindFirst.mockResolvedValue(null)

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toBeNull()
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, userId: STAFF },
      select: { id: true, title: true },
    })
  })

  it('refuses a nonexistent set even for an admin', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
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

  it('admits an admin who does not own the set, querying by id alone (no userId filter)', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Someone Else’s Deck' })

    const access = await requireSetKltAccess(SET_ID)

    expect(access).toEqual({
      userId: ADMIN,
      setId: SET_ID,
      setTitle: 'Someone Else’s Deck',
      viaRole: true,
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
      viaRole: false,
    })
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, ...readableSetWhere(STRANGER) },
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
      where: { id: SET_ID, ...readableSetWhere(null) },
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

  it('reports viaRole and canEdit false for a staff member on a set they do not own, still scoped by the read fragment — a staff member is not an admin', async () => {
    // Same regression guard as requireSetKltAccess's staff case: isAdmin, not
    // isStaff, must gate viaRole here too. A staff-as-admin swap would make
    // viaRole true and switch the query to the unscoped `{ id: SET_ID }`,
    // which the where-shape assertion below would catch even though the
    // resolved row looks identical either way.
    h.auth.mockResolvedValue({ user: { id: STAFF, role: 'staff' } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Finance 101', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view).toEqual({
      viewerId: STAFF,
      setId: SET_ID,
      setTitle: 'Finance 101',
      canEdit: false,
      viaRole: false,
    })
    expect(h.setFindFirst).toHaveBeenCalledWith({
      where: { id: SET_ID, ...readableSetWhere(STAFF) },
      select: { id: true, title: true, userId: true },
    })
  })

  it('reports canEdit for an operator on a set they do not own, unscoped by the read fragment', async () => {
    h.auth.mockResolvedValue({ user: { id: ADMIN, role: 'admin' } })
    h.setFindFirst.mockResolvedValue({ id: SET_ID, title: 'Someone Else’s Deck', userId: OWNER })

    const view = await requireSetKltView(SET_ID)

    expect(view).toEqual({
      viewerId: ADMIN,
      setId: SET_ID,
      setTitle: 'Someone Else’s Deck',
      canEdit: true,
      viaRole: true,
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
