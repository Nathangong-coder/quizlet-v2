'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { isGroupVisibility, type GroupVisibility } from '@/lib/groups/roles'
import { notify, settleActionable } from '@/lib/notifications/load'
import type { ActionResult } from '@/types/action'

/**
 * How people get into groups without an invite link (2026-09-14):
 *
 *  - a PUBLIC group is listed; a signed-in user REQUESTS to join, accepting
 *    the privacy contract at request time; the owner accepts or declines.
 *  - an owner INVITES a user found in the public-user directory (users with a
 *    handle — the same population `/u/<handle>` shows); the invitee accepts,
 *    consenting at that moment, or declines.
 *
 * Both paths end in the same `StudyGroupMember` row an invite-link join
 * creates, so nothing downstream (leaderboards, coverage) knows the
 * difference. Every decision writes a notification for the other party.
 *
 * Consent is enforced HERE (`acknowledged === true`), as in `joinGroup`.
 */

function refresh(groupId?: string) {
  revalidatePath('/groups')
  revalidatePath('/groups/browse')
  revalidatePath('/notifications')
  if (groupId) revalidatePath(`/groups/${groupId}`)
}

async function ownerOf(groupId: string, userId: string) {
  const m = await prisma.studyGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { role: true } })
  return m?.role === 'owner'
}

async function handleOf(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { handle: true } })
  return u?.handle ? `@${u.handle}` : 'Someone'
}

export async function setGroupVisibility(groupId: string, visibility: GroupVisibility): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!isGroupVisibility(visibility)) return { success: false, error: 'Unknown visibility' }
  if (!(await ownerOf(groupId, session.user.id))) return { success: false, error: 'Group not found' }
  await prisma.studyGroup.update({ where: { id: groupId }, data: { visibility } })
  refresh(groupId)
  return { success: true, data: undefined }
}

const RequestSchema = z.object({
  groupId: z.string().min(1),
  message: z.string().trim().max(300).optional(),
  acknowledged: z.boolean(),
})

/** Ask to join a public group. One pending request per (group, user); a declined one may be re-sent. */
export async function requestToJoin(input: z.input<typeof RequestSchema>): Promise<ActionResult<{ requestId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = RequestSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  if (parsed.data.acknowledged !== true) return { success: false, error: 'You need to acknowledge what the group will see before asking to join' }

  const group = await prisma.studyGroup.findFirst({ where: { id: parsed.data.groupId, visibility: 'public' }, select: { id: true, name: true, ownerId: true } })
  if (!group) return { success: false, error: 'Group not found' }
  const already = await prisma.studyGroupMember.findUnique({ where: { groupId_userId: { groupId: group.id, userId: session.user.id } }, select: { id: true } })
  if (already) return { success: false, error: 'You are already a member' }

  const existing = await prisma.studyGroupJoinRequest.findUnique({ where: { groupId_userId: { groupId: group.id, userId: session.user.id } }, select: { id: true, status: true } })
  if (existing?.status === 'pending') return { success: false, error: 'Your request is already waiting on the owner' }

  const req = existing
    ? await prisma.studyGroupJoinRequest.update({ where: { id: existing.id }, data: { status: 'pending', message: parsed.data.message || null, decidedAt: null, createdAt: new Date() }, select: { id: true } })
    : await prisma.studyGroupJoinRequest.create({ data: { groupId: group.id, userId: session.user.id, message: parsed.data.message || null }, select: { id: true } })

  const who = await handleOf(session.user.id)
  await notify({
    userId: group.ownerId,
    kind: 'group_join_request',
    title: `${who} asked to join ${group.name}`,
    body: parsed.data.message || undefined,
    href: `/groups/${group.id}?tab=members`,
    meta: { requestId: req.id, groupId: group.id, userId: session.user.id },
  })
  refresh(group.id)
  return { success: true, data: { requestId: req.id } }
}

/** Owner decides a request. Accepting creates the member row (the requester consented when asking). */
export async function respondToJoinRequest(requestId: string, accept: boolean): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const req = await prisma.studyGroupJoinRequest.findUnique({ where: { id: requestId }, select: { id: true, groupId: true, userId: true, status: true, group: { select: { name: true } } } })
  if (!req || !(await ownerOf(req.groupId, session.user.id))) return { success: false, error: 'Request not found' }
  if (req.status !== 'pending') return { success: false, error: 'This request was already decided' }

  await prisma.$transaction(async (tx) => {
    await tx.studyGroupJoinRequest.update({ where: { id: req.id }, data: { status: accept ? 'accepted' : 'declined', decidedAt: new Date() } })
    if (accept) {
      await tx.studyGroupMember.upsert({
        where: { groupId_userId: { groupId: req.groupId, userId: req.userId } },
        create: { groupId: req.groupId, userId: req.userId, role: 'member' },
        update: {},
      })
    }
  })
  await settleActionable(session.user.id, 'requestId', req.id)
  await notify({
    userId: req.userId,
    kind: accept ? 'group_request_accepted' : 'group_request_declined',
    title: accept ? `You are in ${req.group.name}` : `${req.group.name} declined your request`,
    body: accept ? 'Members now see your progress on the group’s sets — and nothing outside them.' : undefined,
    href: accept ? `/groups/${req.groupId}` : '/groups/browse',
    meta: { groupId: req.groupId },
  })
  refresh(req.groupId)
  return { success: true, data: undefined }
}

/** Public users an owner may invite: anyone with a handle, minus current members, matched on handle. */
export async function listInvitableUsers(groupId: string, query: string): Promise<ActionResult<{ id: string; handle: string; bio: string | null; invited: boolean }[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!(await ownerOf(groupId, session.user.id))) return { success: false, error: 'Group not found' }
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const [members, invites, users] = await Promise.all([
    prisma.studyGroupMember.findMany({ where: { groupId }, select: { userId: true } }),
    prisma.studyGroupInvite.findMany({ where: { groupId, status: 'pending' }, select: { userId: true } }),
    prisma.user.findMany({
      where: { handle: { not: null }, ...(q ? { normalizedHandle: { contains: q } } : {}) },
      orderBy: { handle: 'asc' },
      take: 20,
      select: { id: true, handle: true, bio: true },
    }),
  ])
  const memberIds = new Set(members.map((m) => m.userId))
  const invitedIds = new Set(invites.map((i) => i.userId))
  return {
    success: true,
    data: users.filter((u) => !memberIds.has(u.id)).map((u) => ({ id: u.id, handle: u.handle as string, bio: u.bio, invited: invitedIds.has(u.id) })),
  }
}

export async function inviteUser(groupId: string, userId: string): Promise<ActionResult<{ inviteId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!(await ownerOf(groupId, session.user.id))) return { success: false, error: 'Group not found' }
  if (userId === session.user.id) return { success: false, error: 'You are already the owner' }
  const [group, target, member] = await Promise.all([
    prisma.studyGroup.findUnique({ where: { id: groupId }, select: { name: true } }),
    prisma.user.findFirst({ where: { id: userId, handle: { not: null } }, select: { id: true } }),
    prisma.studyGroupMember.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { id: true } }),
  ])
  if (!group || !target) return { success: false, error: 'User not found' }
  if (member) return { success: false, error: 'Already a member' }

  const existing = await prisma.studyGroupInvite.findUnique({ where: { groupId_userId: { groupId, userId } }, select: { id: true, status: true } })
  if (existing?.status === 'pending') return { success: false, error: 'Already invited' }
  const invite = existing
    ? await prisma.studyGroupInvite.update({ where: { id: existing.id }, data: { status: 'pending', invitedById: session.user.id, decidedAt: null, createdAt: new Date() }, select: { id: true } })
    : await prisma.studyGroupInvite.create({ data: { groupId, userId, invitedById: session.user.id }, select: { id: true } })

  const who = await handleOf(session.user.id)
  await notify({
    userId,
    kind: 'group_invite',
    title: `${who} invited you to ${group.name}`,
    body: 'Accepting means members see your progress on the group’s sets — and nothing outside them.',
    href: '/notifications',
    meta: { inviteId: invite.id, groupId },
  })
  refresh(groupId)
  return { success: true, data: { inviteId: invite.id } }
}

/** The invitee decides. Accepting REQUIRES the consent flag — it is their first sight of the contract. */
export async function respondToInvite(inviteId: string, accept: boolean, acknowledged = false): Promise<ActionResult<{ groupId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const invite = await prisma.studyGroupInvite.findFirst({ where: { id: inviteId, userId: session.user.id }, select: { id: true, groupId: true, invitedById: true, status: true, group: { select: { name: true } } } })
  if (!invite) return { success: false, error: 'Invitation not found' }
  if (invite.status !== 'pending') return { success: false, error: 'This invitation was already answered' }
  if (accept && acknowledged !== true) return { success: false, error: 'You need to acknowledge what the group will see before joining' }

  await prisma.$transaction(async (tx) => {
    await tx.studyGroupInvite.update({ where: { id: invite.id }, data: { status: accept ? 'accepted' : 'declined', decidedAt: new Date() } })
    if (accept) {
      await tx.studyGroupMember.upsert({
        where: { groupId_userId: { groupId: invite.groupId, userId: session.user.id } },
        create: { groupId: invite.groupId, userId: session.user.id, role: 'member' },
        update: {},
      })
    }
  })
  await settleActionable(session.user.id, 'inviteId', invite.id)
  const who = await handleOf(session.user.id)
  await notify({
    userId: invite.invitedById,
    kind: accept ? 'group_invite_accepted' : 'group_invite_declined',
    title: accept ? `${who} joined ${invite.group.name}` : `${who} declined the invitation to ${invite.group.name}`,
    href: `/groups/${invite.groupId}?tab=members`,
    meta: { groupId: invite.groupId },
  })
  refresh(invite.groupId)
  return { success: true, data: { groupId: invite.groupId } }
}

export async function markNotificationsRead(ids: string[] | 'all'): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null, ...(ids === 'all' ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  })
  revalidatePath('/notifications')
  return { success: true, data: undefined }
}
