import { composeSetWhere } from '@/lib/sets/visibility'
import { shapeSetLeaderboard, type SetLeaderboard, type GroupMemberRef } from '@/lib/groups/progress'
import type { GroupRole } from '@/lib/groups/roles'

/**
 * Group reads. Every function here takes the VIEWER and refuses (returns null)
 * unless the viewer is a member — membership is the only credential a group
 * has, and it is checked here rather than in each page so a page cannot
 * forget.
 *
 * Progress is read for (member of this group) × (card of this group's sets
 * READABLE BY THE VIEWER) only. The set filter goes through
 * `composeSetWhere` like every other set read: a set that went private after
 * being attached is excluded from every number, not just hidden.
 *
 * `@/lib/db` is imported dynamically so the pure module beside this one can
 * be tested without `DATABASE_URL`.
 */

export interface GroupSummary {
  id: string
  name: string
  description: string | null
  role: GroupRole
  memberCount: number
  setCount: number
}

export interface GroupMember extends GroupMemberRef {
  role: GroupRole
  joinedAt: Date
  avatarUrl: string | null
  image: string | null
}

export interface GroupSetRow {
  linkId: string
  setId: string
  /** Null when the set is no longer readable by the viewer (went private, or was deleted mid-request). */
  title: string | null
  cardCount: number
  subject: string | null
  ownerHandle: string | null
  readable: boolean
}

export interface GroupDetail {
  id: string
  name: string
  description: string | null
  ownerId: string
  inviteCode: string
  viewerRole: GroupRole
  members: GroupMember[]
  sets: GroupSetRow[]
}

export async function loadMyGroups(viewerId: string): Promise<GroupSummary[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.studyGroupMember.findMany({
    where: { userId: viewerId },
    orderBy: { joinedAt: 'desc' },
    select: {
      role: true,
      group: { select: { id: true, name: true, description: true, _count: { select: { members: true, sets: true } } } },
    },
  })
  return rows.map((r) => ({
    id: r.group.id,
    name: r.group.name,
    description: r.group.description,
    role: r.role as GroupRole,
    memberCount: r.group._count.members,
    setCount: r.group._count.sets,
  }))
}

export async function loadGroup(viewerId: string, groupId: string): Promise<GroupDetail | null> {
  const { prisma } = await import('@/lib/db')
  const membership = await prisma.studyGroupMember.findUnique({
    where: { groupId_userId: { groupId, userId: viewerId } },
    select: { role: true },
  })
  // Not-found rather than forbidden: a distinguishable error confirms to a
  // stranger that a group id is real.
  if (!membership) return null

  const group = await prisma.studyGroup.findUnique({
    where: { id: groupId },
    select: {
      id: true,
      name: true,
      description: true,
      ownerId: true,
      inviteCode: true,
      members: {
        orderBy: { joinedAt: 'asc' },
        select: { role: true, joinedAt: true, user: { select: { id: true, handle: true, avatarUrl: true, image: true } } },
      },
      sets: { orderBy: { addedAt: 'asc' }, select: { id: true, setId: true } },
    },
  })
  if (!group) return null

  const setIds = group.sets.map((s) => s.setId)
  const readable = setIds.length
    ? await prisma.set.findMany({
        where: composeSetWhere(viewerId, { id: { in: setIds } }),
        select: { id: true, title: true, subject: true, user: { select: { handle: true } }, _count: { select: { cards: true } } },
      })
    : []
  const byId = new Map(readable.map((s) => [s.id, s]))

  return {
    id: group.id,
    name: group.name,
    description: group.description,
    ownerId: group.ownerId,
    inviteCode: group.inviteCode,
    viewerRole: membership.role as GroupRole,
    members: group.members.map((m) => ({
      userId: m.user.id,
      handle: m.user.handle,
      avatarUrl: m.user.avatarUrl,
      image: m.user.image,
      role: m.role as GroupRole,
      joinedAt: m.joinedAt,
    })),
    sets: group.sets.map((link) => {
      const s = byId.get(link.setId)
      return {
        linkId: link.id,
        setId: link.setId,
        title: s?.title ?? null,
        cardCount: s?._count.cards ?? 0,
        subject: s?.subject ?? null,
        ownerHandle: s?.user.handle ?? null,
        readable: s !== undefined,
      }
    }),
  }
}

export interface GroupSetProgress {
  set: { id: string; title: string; cards: { id: string; term: string; definition: string }[] }
  leaderboard: SetLeaderboard
}

/**
 * One set's leaderboard and card coverage for a group. Null unless the viewer
 * is a member, the set is attached, AND the set is readable by the viewer.
 */
export async function loadGroupSetProgress(
  viewerId: string,
  groupId: string,
  setId: string,
): Promise<GroupSetProgress | null> {
  const { prisma } = await import('@/lib/db')
  const [membership, link] = await Promise.all([
    prisma.studyGroupMember.findUnique({ where: { groupId_userId: { groupId, userId: viewerId } }, select: { id: true } }),
    prisma.studyGroupSet.findUnique({ where: { groupId_setId: { groupId, setId } }, select: { id: true } }),
  ])
  if (!membership || !link) return null

  const set = await prisma.set.findFirst({
    where: composeSetWhere(viewerId, { id: setId }),
    select: { id: true, title: true, cards: { orderBy: { position: 'asc' }, select: { id: true, term: true, definition: true } } },
  })
  if (!set) return null

  const members = await prisma.studyGroupMember.findMany({
    where: { groupId },
    select: { user: { select: { id: true, handle: true } } },
  })
  const memberIds = members.map((m) => m.user.id)
  const cardIds = set.cards.map((c) => c.id)

  const [progress, sessions] = await Promise.all([
    prisma.cardProgress.findMany({
      where: { userId: { in: memberIds }, cardId: { in: cardIds } },
      select: { userId: true, cardId: true, confidence: true, updatedAt: true },
    }),
    prisma.studySession.findMany({
      where: { userId: { in: memberIds }, setId },
      select: { userId: true, setId: true, durationMs: true, startedAt: true },
    }),
  ])

  return {
    set: { id: set.id, title: set.title, cards: set.cards },
    leaderboard: shapeSetLeaderboard({
      setId,
      cardIds,
      members: members.map((m) => ({ userId: m.user.id, handle: m.user.handle })),
      progress,
      sessions,
    }),
  }
}

/** Every attached set's standings, for the group page's overview. Unreadable sets are skipped. */
export async function loadGroupOverview(viewerId: string, group: GroupDetail): Promise<Record<string, SetLeaderboard>> {
  const out: Record<string, SetLeaderboard> = {}
  for (const s of group.sets) {
    if (!s.readable) continue
    const p = await loadGroupSetProgress(viewerId, group.id, s.setId)
    if (p) out[s.setId] = p.leaderboard
  }
  return out
}
