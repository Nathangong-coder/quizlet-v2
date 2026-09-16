'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { generateInviteCode, isInviteCode } from '@/lib/groups/invite'
import type { ActionResult } from '@/types/action'

/**
 * Study group writes.
 *
 * Membership is the credential: every mutation on an existing group first
 * resolves the caller's member row and refuses without it, and owner-only
 * mutations check `role === 'owner'` on that row. Not-found and forbidden are
 * reported alike ("Group not found") so a stranger cannot probe ids.
 *
 * `joinGroup` REQUIRES `acknowledged: true`. The join page shows the privacy
 * contract (members see your progress on the group's sets) and the checkbox
 * is what sets the flag; a client that skips the page cannot skip the
 * consent, because the action is where it is enforced.
 */

const GroupInputSchema = z.object({
  name: z.string().trim().min(1, 'Give the group a name').max(80),
  description: z.string().trim().max(500).optional(),
})

async function membership(groupId: string, userId: string) {
  return prisma.studyGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
    select: { id: true, role: true },
  })
}

function refresh(groupId?: string) {
  revalidatePath('/groups')
  if (groupId) revalidatePath(`/groups/${groupId}`)
}

export async function createGroup(input: z.input<typeof GroupInputSchema>): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = GroupInputSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  try {
    const created = await prisma.studyGroup.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description || null,
        ownerId: session.user.id,
        inviteCode: generateInviteCode(),
        // The owner is ALSO a member row, so "everyone in the group" is one
        // query and the owner's own progress appears on the leaderboard.
        members: { create: { userId: session.user.id, role: 'owner' } },
      },
      select: { id: true },
    })
    refresh(created.id)
    return { success: true, data: { id: created.id } }
  } catch (error) {
    console.error('createGroup error:', error)
    return { success: false, error: 'Failed to create the group' }
  }
}

export async function updateGroup(groupId: string, input: z.input<typeof GroupInputSchema>): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = GroupInputSchema.safeParse(input)
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Invalid input' }
  const m = await membership(groupId, session.user.id)
  if (!m || m.role !== 'owner') return { success: false, error: 'Group not found' }

  await prisma.studyGroup.update({
    where: { id: groupId },
    data: { name: parsed.data.name, description: parsed.data.description || null },
  })
  refresh(groupId)
  return { success: true, data: undefined }
}

/** Owner only. The previous link stops working the moment this returns. */
export async function regenerateInvite(groupId: string): Promise<ActionResult<{ inviteCode: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m || m.role !== 'owner') return { success: false, error: 'Group not found' }

  const inviteCode = generateInviteCode()
  await prisma.studyGroup.update({ where: { id: groupId }, data: { inviteCode } })
  refresh(groupId)
  return { success: true, data: { inviteCode } }
}

/** What the join page shows before consent. Null for an unknown code. */
export async function previewInvite(code: string): Promise<ActionResult<{ id: string; name: string; description: string | null; memberCount: number; setTitles: string[]; alreadyMember: boolean }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!isInviteCode(code)) return { success: false, error: 'Invite not found' }

  const group = await prisma.studyGroup.findUnique({
    where: { inviteCode: code },
    select: {
      id: true,
      name: true,
      description: true,
      _count: { select: { members: true } },
      members: { where: { userId: session.user.id }, select: { id: true } },
      sets: { select: { set: { select: { title: true } } }, take: 8 },
    },
  })
  if (!group) return { success: false, error: 'Invite not found' }
  return {
    success: true,
    data: {
      id: group.id,
      name: group.name,
      description: group.description,
      memberCount: group._count.members,
      setTitles: group.sets.map((s) => s.set.title),
      alreadyMember: group.members.length > 0,
    },
  }
}

export async function joinGroup(code: string, acknowledged: boolean): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!isInviteCode(code)) return { success: false, error: 'Invite not found' }
  // The consent gate. Enforced HERE, not only on the page.
  if (acknowledged !== true) {
    return { success: false, error: 'You need to acknowledge what the group will see before joining' }
  }

  const group = await prisma.studyGroup.findUnique({ where: { inviteCode: code }, select: { id: true } })
  if (!group) return { success: false, error: 'Invite not found' }

  try {
    await prisma.studyGroupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: session.user.id } },
      create: { groupId: group.id, userId: session.user.id, role: 'member' },
      update: {},
    })
    refresh(group.id)
    return { success: true, data: { id: group.id } }
  } catch (error) {
    console.error('joinGroup error:', error)
    return { success: false, error: 'Failed to join the group' }
  }
}

/**
 * Leaving ends the sharing at once — nothing was ever copied. The owner
 * cannot leave (the group would be ownerless); they delete it instead.
 */
export async function leaveGroup(groupId: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m) return { success: false, error: 'Group not found' }
  if (m.role === 'owner') return { success: false, error: 'The owner cannot leave — delete the group instead' }

  await prisma.studyGroupMember.delete({ where: { id: m.id } })
  refresh(groupId)
  return { success: true, data: undefined }
}

export async function removeMember(groupId: string, userId: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m || m.role !== 'owner') return { success: false, error: 'Group not found' }
  if (userId === session.user.id) return { success: false, error: 'The owner cannot be removed' }

  await prisma.studyGroupMember.deleteMany({ where: { groupId, userId } })
  refresh(groupId)
  return { success: true, data: undefined }
}

export async function deleteGroup(groupId: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m || m.role !== 'owner') return { success: false, error: 'Group not found' }

  await prisma.studyGroup.delete({ where: { id: groupId } })
  refresh()
  return { success: true, data: undefined }
}

/**
 * Any member may attach a set, and only a LINK or PUBLIC one. Membership
 * grants no read rights of its own — `readableSetWhere` is untouched by this
 * feature — so attaching a private set would attach something the other
 * members cannot open. Refused with the fix in the message.
 */
export async function addSetToGroup(groupId: string, setId: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m) return { success: false, error: 'Group not found' }

  const set = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(session.user.id) },
    select: { id: true, visibility: true },
  })
  if (!set) return { success: false, error: 'Set not found' }
  if (set.visibility === 'private') {
    return { success: false, error: 'This set is private. Share it (anyone with the link, or public) before adding it to a group.' }
  }

  await prisma.studyGroupSet.upsert({
    where: { groupId_setId: { groupId, setId } },
    create: { groupId, setId, addedById: session.user.id },
    update: {},
  })
  refresh(groupId)
  return { success: true, data: undefined }
}

/** The owner, or the member who attached it. */
export async function removeSetFromGroup(groupId: string, setId: string): Promise<ActionResult<void>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m) return { success: false, error: 'Group not found' }

  const link = await prisma.studyGroupSet.findUnique({ where: { groupId_setId: { groupId, setId } }, select: { id: true, addedById: true } })
  if (!link) return { success: false, error: 'Set not in this group' }
  if (m.role !== 'owner' && link.addedById !== session.user.id) return { success: false, error: 'Only the owner or whoever added it can remove a set' }

  await prisma.studyGroupSet.delete({ where: { id: link.id } })
  refresh(groupId)
  return { success: true, data: undefined }
}

/** The caller's own shareable sets, for the "add a set" picker. */
export async function listAttachableSets(groupId: string): Promise<ActionResult<{ id: string; title: string; cardCount: number; attached: boolean }[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const m = await membership(groupId, session.user.id)
  if (!m) return { success: false, error: 'Group not found' }

  const [sets, attached] = await Promise.all([
    prisma.set.findMany({
      where: { userId: session.user.id, visibility: { in: ['link', 'public'] } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, _count: { select: { cards: true } } },
    }),
    prisma.studyGroupSet.findMany({ where: { groupId }, select: { setId: true } }),
  ])
  const attachedIds = new Set(attached.map((a) => a.setId))
  return { success: true, data: sets.map((s) => ({ id: s.id, title: s.title, cardCount: s._count.cards, attached: attachedIds.has(s.id) })) }
}
