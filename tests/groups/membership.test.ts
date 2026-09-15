import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Public groups, join requests, invitations and the notifications they
 * write. The consent gate is enforced in the action on BOTH paths: a
 * request carries it, an invite is accepted with it. Mocked-Prisma harness
 * in the style of tests/groups/actions.test.ts.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberUpsert: vi.fn(),
  groupFindFirst: vi.fn(),
  groupFindUnique: vi.fn(),
  groupUpdate: vi.fn(),
  reqFindUnique: vi.fn(),
  reqCreate: vi.fn(),
  reqUpdate: vi.fn(),
  invFindUnique: vi.fn(),
  invFindFirst: vi.fn(),
  invFindMany: vi.fn(),
  invCreate: vi.fn(),
  invUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userFindMany: vi.fn(),
  notifCreate: vi.fn(),
  notifUpdateMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => {
  const prisma = {
    studyGroupMember: { findUnique: h.memberFindUnique, findMany: h.memberFindMany, upsert: h.memberUpsert },
    studyGroup: { findFirst: h.groupFindFirst, findUnique: h.groupFindUnique, update: h.groupUpdate },
    studyGroupJoinRequest: { findUnique: h.reqFindUnique, create: h.reqCreate, update: h.reqUpdate },
    studyGroupInvite: { findUnique: h.invFindUnique, findFirst: h.invFindFirst, findMany: h.invFindMany, create: h.invCreate, update: h.invUpdate },
    user: { findUnique: h.userFindUnique, findFirst: h.userFindFirst, findMany: h.userFindMany },
    notification: { create: h.notifCreate, updateMany: h.notifUpdateMany },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma),
  }
  return { prisma }
})

import { requestToJoin, respondToJoinRequest, inviteUser, respondToInvite, listInvitableUsers, setGroupVisibility } from '@/actions/group-membership'

const ME = 'u-me'
const OWNER = 'u-owner'
const GROUP = 'g1'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: ME } })
  h.userFindUnique.mockResolvedValue({ handle: 'me' })
  h.notifCreate.mockResolvedValue({})
  h.notifUpdateMany.mockResolvedValue({ count: 1 })
  h.memberUpsert.mockResolvedValue({})
})

describe('requestToJoin', () => {
  beforeEach(() => {
    h.groupFindFirst.mockResolvedValue({ id: GROUP, name: 'Superday crew', ownerId: OWNER })
    h.memberFindUnique.mockResolvedValue(null)
    h.reqFindUnique.mockResolvedValue(null)
    h.reqCreate.mockResolvedValue({ id: 'r1' })
  })

  it('refuses without consent, and never touches the database first', async () => {
    const r = await requestToJoin({ groupId: GROUP, acknowledged: false })
    expect(r.success).toBe(false)
    expect(h.reqCreate).not.toHaveBeenCalled()
    expect(h.notifCreate).not.toHaveBeenCalled()
  })

  it('creates a pending request on a PUBLIC group and notifies the owner with the message', async () => {
    const r = await requestToJoin({ groupId: GROUP, acknowledged: true, message: 'same superday' })
    expect(r).toEqual({ success: true, data: { requestId: 'r1' } })
    expect(h.groupFindFirst.mock.calls[0][0].where).toMatchObject({ id: GROUP, visibility: 'public' })
    expect(h.notifCreate.mock.calls[0][0].data).toMatchObject({ userId: OWNER, kind: 'group_join_request', body: 'same superday', meta: { requestId: 'r1', groupId: GROUP, userId: ME } })
  })

  it('refuses a member, and a second request while one is pending', async () => {
    h.memberFindUnique.mockResolvedValueOnce({ id: 'm' })
    expect((await requestToJoin({ groupId: GROUP, acknowledged: true })).success).toBe(false)
    h.reqFindUnique.mockResolvedValueOnce({ id: 'r0', status: 'pending' })
    expect((await requestToJoin({ groupId: GROUP, acknowledged: true })).success).toBe(false)
    expect(h.reqCreate).not.toHaveBeenCalled()
  })

  it('a declined request may be re-sent (the row is reset, not duplicated)', async () => {
    h.reqFindUnique.mockResolvedValueOnce({ id: 'r0', status: 'declined' })
    h.reqUpdate.mockResolvedValueOnce({ id: 'r0' })
    const r = await requestToJoin({ groupId: GROUP, acknowledged: true })
    expect(r.success).toBe(true)
    expect(h.reqUpdate.mock.calls[0][0].data).toMatchObject({ status: 'pending' })
    expect(h.reqCreate).not.toHaveBeenCalled()
  })
})

describe('respondToJoinRequest', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.reqFindUnique.mockResolvedValue({ id: 'r1', groupId: GROUP, userId: ME, status: 'pending', group: { name: 'Superday crew' } })
    h.reqUpdate.mockResolvedValue({})
  })

  it('owner accepts: the member row is created, the request settled, the requester told', async () => {
    h.memberFindUnique.mockResolvedValue({ role: 'owner' })
    const r = await respondToJoinRequest('r1', true)
    expect(r.success).toBe(true)
    expect(h.memberUpsert.mock.calls[0][0].create).toMatchObject({ groupId: GROUP, userId: ME, role: 'member' })
    expect(h.reqUpdate.mock.calls[0][0].data).toMatchObject({ status: 'accepted' })
    // The owner's own actionable notification is marked read by its request id.
    expect(h.notifUpdateMany.mock.calls[0][0].where).toMatchObject({ userId: OWNER, meta: { path: ['requestId'], equals: 'r1' } })
    expect(h.notifCreate.mock.calls[0][0].data).toMatchObject({ userId: ME, kind: 'group_request_accepted', href: `/groups/${GROUP}` })
  })

  it('owner declines: no member row, the requester told', async () => {
    h.memberFindUnique.mockResolvedValue({ role: 'owner' })
    await respondToJoinRequest('r1', false)
    expect(h.memberUpsert).not.toHaveBeenCalled()
    expect(h.notifCreate.mock.calls[0][0].data).toMatchObject({ userId: ME, kind: 'group_request_declined' })
  })

  it('a plain member cannot decide, and a decided request cannot be re-decided', async () => {
    h.memberFindUnique.mockResolvedValue({ role: 'member' })
    expect((await respondToJoinRequest('r1', true)).success).toBe(false)
    h.memberFindUnique.mockResolvedValue({ role: 'owner' })
    h.reqFindUnique.mockResolvedValueOnce({ id: 'r1', groupId: GROUP, userId: ME, status: 'accepted', group: { name: 'x' } })
    expect((await respondToJoinRequest('r1', true)).success).toBe(false)
    expect(h.memberUpsert).not.toHaveBeenCalled()
  })
})

describe('invites', () => {
  beforeEach(() => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.memberFindUnique.mockImplementation(async ({ where }: { where: { groupId_userId: { userId: string } } }) => (where.groupId_userId.userId === OWNER ? { role: 'owner' } : null))
    h.groupFindUnique.mockResolvedValue({ name: 'Superday crew' })
    h.userFindFirst.mockResolvedValue({ id: ME })
    h.invFindUnique.mockResolvedValue(null)
    h.invCreate.mockResolvedValue({ id: 'i1' })
    h.userFindUnique.mockResolvedValue({ handle: 'owner' })
  })

  it('the directory lists public users (handles only) minus members, marking the already-invited', async () => {
    h.memberFindMany.mockResolvedValue([{ userId: OWNER }, { userId: 'u-member' }])
    h.invFindMany.mockResolvedValue([{ userId: 'u-invited' }])
    h.userFindMany.mockResolvedValue([
      { id: OWNER, handle: 'owner', bio: null },
      { id: 'u-member', handle: 'member', bio: null },
      { id: 'u-invited', handle: 'invited', bio: 'hi' },
      { id: ME, handle: 'me', bio: null },
    ])
    const r = await listInvitableUsers(GROUP, '@M')
    expect(r.success).toBe(true)
    if (!r.success) return
    expect(r.data).toEqual([
      { id: 'u-invited', handle: 'invited', bio: 'hi', invited: true },
      { id: ME, handle: 'me', bio: null, invited: false },
    ])
    expect(h.userFindMany.mock.calls[0][0].where).toMatchObject({ handle: { not: null }, normalizedHandle: { contains: 'm' } })
  })

  it('inviting writes a pending invite and a notification carrying its id', async () => {
    const r = await inviteUser(GROUP, ME)
    expect(r).toEqual({ success: true, data: { inviteId: 'i1' } })
    expect(h.notifCreate.mock.calls[0][0].data).toMatchObject({ userId: ME, kind: 'group_invite', meta: { inviteId: 'i1', groupId: GROUP } })
  })

  it('accepting an invite REQUIRES consent; declining does not', async () => {
    h.auth.mockResolvedValue({ user: { id: ME } })
    h.invFindFirst.mockResolvedValue({ id: 'i1', groupId: GROUP, invitedById: OWNER, status: 'pending', group: { name: 'Superday crew' } })
    h.invUpdate.mockResolvedValue({})
    expect((await respondToInvite('i1', true, false)).success).toBe(false)
    expect(h.memberUpsert).not.toHaveBeenCalled()
    const ok = await respondToInvite('i1', true, true)
    expect(ok).toEqual({ success: true, data: { groupId: GROUP } })
    expect(h.memberUpsert.mock.calls[0][0].create).toMatchObject({ groupId: GROUP, userId: ME })
    expect(h.notifCreate.mock.calls[0][0].data).toMatchObject({ userId: OWNER, kind: 'group_invite_accepted' })
    // The invitee's own notification is settled by invite id.
    expect(h.notifUpdateMany.mock.calls[0][0].where).toMatchObject({ userId: ME, meta: { path: ['inviteId'], equals: 'i1' } })
    vi.clearAllMocks()
    h.auth.mockResolvedValue({ user: { id: ME } })
    h.invFindFirst.mockResolvedValue({ id: 'i2', groupId: GROUP, invitedById: OWNER, status: 'pending', group: { name: 'Superday crew' } })
    h.invUpdate.mockResolvedValue({})
    h.userFindUnique.mockResolvedValue({ handle: 'me' })
    expect((await respondToInvite('i2', false)).success).toBe(true)
    expect(h.memberUpsert).not.toHaveBeenCalled()
  })

  it('only the invitee can answer an invite', async () => {
    h.auth.mockResolvedValue({ user: { id: 'u-stranger' } })
    h.invFindFirst.mockResolvedValue(null)
    expect((await respondToInvite('i1', true, true)).success).toBe(false)
    expect(h.invFindFirst.mock.calls[0][0].where).toMatchObject({ id: 'i1', userId: 'u-stranger' })
  })
})

describe('setGroupVisibility', () => {
  it('owner only, closed vocabulary', async () => {
    h.auth.mockResolvedValue({ user: { id: OWNER } })
    h.memberFindUnique.mockResolvedValue({ role: 'owner' })
    h.groupUpdate.mockResolvedValue({})
    expect((await setGroupVisibility(GROUP, 'public')).success).toBe(true)
    expect(h.groupUpdate.mock.calls[0][0]).toMatchObject({ where: { id: GROUP }, data: { visibility: 'public' } })
    expect((await setGroupVisibility(GROUP, 'secret' as never)).success).toBe(false)
    h.memberFindUnique.mockResolvedValue({ role: 'member' })
    expect((await setGroupVisibility(GROUP, 'private')).success).toBe(false)
  })
})
