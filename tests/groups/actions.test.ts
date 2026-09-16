import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Study-group actions: the consent gate on join, the private-set refusal on
 * attach, membership as the only credential, and owner-only mutations.
 * Mocked-Prisma harness in the style of tests/actions/update-set-rescore.
 */
const h = vi.hoisted(() => ({
  auth: vi.fn(),
  memberFindUnique: vi.fn(),
  memberFindMany: vi.fn(),
  memberUpsert: vi.fn(),
  memberDelete: vi.fn(),
  memberDeleteMany: vi.fn(),
  groupFindUnique: vi.fn(),
  groupCreate: vi.fn(),
  groupUpdate: vi.fn(),
  groupDelete: vi.fn(),
  setFindFirst: vi.fn(),
  setFindMany: vi.fn(),
  linkFindUnique: vi.fn(),
  linkFindMany: vi.fn(),
  linkUpsert: vi.fn(),
  linkDelete: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studyGroupMember: {
      findUnique: h.memberFindUnique,
      findMany: h.memberFindMany,
      upsert: h.memberUpsert,
      delete: h.memberDelete,
      deleteMany: h.memberDeleteMany,
    },
    studyGroup: { findUnique: h.groupFindUnique, create: h.groupCreate, update: h.groupUpdate, delete: h.groupDelete },
    set: { findFirst: h.setFindFirst, findMany: h.setFindMany },
    studyGroupSet: { findUnique: h.linkFindUnique, findMany: h.linkFindMany, upsert: h.linkUpsert, delete: h.linkDelete },
  },
}))

import {
  createGroup,
  joinGroup,
  leaveGroup,
  removeMember,
  deleteGroup,
  regenerateInvite,
  addSetToGroup,
  removeSetFromGroup,
} from '@/actions/groups'
import { isInviteCode } from '@/lib/groups/invite'

const ME = 'u-me'
const GROUP = 'g1'
const CODE = 'abcdefghjkmnpqrs'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: ME } })
})

describe('createGroup', () => {
  it('makes the creator an owner member row and mints a code', async () => {
    h.groupCreate.mockResolvedValue({ id: GROUP })
    const r = await createGroup({ name: '  Superday prep ' })
    expect(r).toEqual({ success: true, data: { id: GROUP } })
    const data = h.groupCreate.mock.calls[0][0].data
    expect(data.name).toBe('Superday prep')
    expect(data.members).toEqual({ create: { userId: ME, role: 'owner' } })
    expect(isInviteCode(data.inviteCode)).toBe(true)
  })

  it('refuses a blank name and a signed-out caller', async () => {
    expect((await createGroup({ name: '   ' })).success).toBe(false)
    h.auth.mockResolvedValue(null)
    expect((await createGroup({ name: 'x' })).success).toBe(false)
    expect(h.groupCreate).not.toHaveBeenCalled()
  })
})

describe('joinGroup — the consent gate', () => {
  it('REFUSES without acknowledgement, even with a valid code, and writes nothing', async () => {
    h.groupFindUnique.mockResolvedValue({ id: GROUP })
    const r = await joinGroup(CODE, false)
    expect(r.success).toBe(false)
    expect(h.memberUpsert).not.toHaveBeenCalled()
    // Truthy-but-not-true must not pass either: the flag is a boolean consent.
    const r2 = await joinGroup(CODE, 'yes' as unknown as boolean)
    expect(r2.success).toBe(false)
  })

  it('joins as a plain member once acknowledged', async () => {
    h.groupFindUnique.mockResolvedValue({ id: GROUP })
    h.memberUpsert.mockResolvedValue({})
    const r = await joinGroup(CODE, true)
    expect(r).toEqual({ success: true, data: { id: GROUP } })
    expect(h.memberUpsert.mock.calls[0][0].create).toEqual({ groupId: GROUP, userId: ME, role: 'member' })
  })

  it('rejects a malformed code before any query, and an unknown one after', async () => {
    expect((await joinGroup("x'; drop", true)).success).toBe(false)
    expect(h.groupFindUnique).not.toHaveBeenCalled()
    h.groupFindUnique.mockResolvedValue(null)
    expect((await joinGroup(CODE, true)).success).toBe(false)
  })
})

describe('membership is the credential', () => {
  it('a non-member cannot leave, attach, detach, regenerate or delete — all "not found"', async () => {
    h.memberFindUnique.mockResolvedValue(null)
    for (const call of [
      () => leaveGroup(GROUP),
      () => addSetToGroup(GROUP, 's1'),
      () => removeSetFromGroup(GROUP, 's1'),
      () => regenerateInvite(GROUP),
      () => deleteGroup(GROUP),
      () => removeMember(GROUP, 'u-other'),
    ]) {
      const r = await call()
      expect(r.success).toBe(false)
      expect(r.success === false && r.error).toMatch(/not found/i)
    }
    expect(h.groupDelete).not.toHaveBeenCalled()
    expect(h.linkUpsert).not.toHaveBeenCalled()
  })

  it('a plain member cannot do owner things, but can leave', async () => {
    h.memberFindUnique.mockResolvedValue({ id: 'm1', role: 'member' })
    expect((await regenerateInvite(GROUP)).success).toBe(false)
    expect((await deleteGroup(GROUP)).success).toBe(false)
    expect((await removeMember(GROUP, 'u-other')).success).toBe(false)
    h.memberDelete.mockResolvedValue({})
    expect((await leaveGroup(GROUP)).success).toBe(true)
    expect(h.memberDelete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })

  it('the owner cannot leave (delete instead) and cannot remove themself', async () => {
    h.memberFindUnique.mockResolvedValue({ id: 'm0', role: 'owner' })
    expect((await leaveGroup(GROUP)).success).toBe(false)
    expect((await removeMember(GROUP, ME)).success).toBe(false)
    expect(h.memberDelete).not.toHaveBeenCalled()
    expect(h.memberDeleteMany).not.toHaveBeenCalled()
  })
})

describe('addSetToGroup', () => {
  beforeEach(() => h.memberFindUnique.mockResolvedValue({ id: 'm1', role: 'member' }))

  it('refuses a PRIVATE set with the fix in the message', async () => {
    h.setFindFirst.mockResolvedValue({ id: 's1', visibility: 'private' })
    const r = await addSetToGroup(GROUP, 's1')
    expect(r.success).toBe(false)
    expect(r.success === false && r.error).toMatch(/private/i)
    expect(h.linkUpsert).not.toHaveBeenCalled()
  })

  it('reads the set through readableSetWhere and attaches a link set', async () => {
    h.setFindFirst.mockResolvedValue({ id: 's1', visibility: 'link' })
    h.linkUpsert.mockResolvedValue({})
    expect((await addSetToGroup(GROUP, 's1')).success).toBe(true)
    const where = h.setFindFirst.mock.calls[0][0].where
    expect(where.id).toBe('s1')
    expect(Object.keys(where).length).toBeGreaterThan(1)
    expect(h.linkUpsert.mock.calls[0][0].create).toEqual({ groupId: GROUP, setId: 's1', addedById: ME })
  })

  it('a set the caller cannot read is not found — never "private"', async () => {
    h.setFindFirst.mockResolvedValue(null)
    const r = await addSetToGroup(GROUP, 's1')
    expect(r.success === false && r.error).toMatch(/not found/i)
  })
})

describe('removeSetFromGroup', () => {
  it('lets the owner, or whoever attached it, remove it — nobody else', async () => {
    h.linkFindUnique.mockResolvedValue({ id: 'l1', addedById: 'u-other' })
    h.memberFindUnique.mockResolvedValue({ id: 'm1', role: 'member' })
    expect((await removeSetFromGroup(GROUP, 's1')).success).toBe(false)
    h.memberFindUnique.mockResolvedValue({ id: 'm0', role: 'owner' })
    h.linkDelete.mockResolvedValue({})
    expect((await removeSetFromGroup(GROUP, 's1')).success).toBe(true)
    h.memberFindUnique.mockResolvedValue({ id: 'm1', role: 'member' })
    h.linkFindUnique.mockResolvedValue({ id: 'l1', addedById: ME })
    expect((await removeSetFromGroup(GROUP, 's1')).success).toBe(true)
  })
})
