/**
 * Reads for the public-groups directory and for an owner's pending
 * requests / invites. Membership rows are the credential everywhere else;
 * here, a PUBLIC group's name, description, size and set titles are readable
 * by any signed-in user — that is what "public" means — and nothing about
 * members' progress is.
 */

export interface PublicGroupRow {
  id: string
  name: string
  description: string | null
  ownerHandle: string | null
  memberCount: number
  setTitles: string[]
  /** The viewer's relationship: none, member, or a pending request. */
  state: 'none' | 'member' | 'pending' | 'declined'
}

export async function loadPublicGroups(viewerId: string, query: string): Promise<PublicGroupRow[]> {
  const { prisma } = await import('@/lib/db')
  const q = query.trim()
  const groups = await prisma.studyGroup.findMany({
    where: { visibility: 'public', ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}) },
    orderBy: [{ createdAt: 'desc' }],
    take: 60,
    select: {
      id: true,
      name: true,
      description: true,
      owner: { select: { handle: true } },
      _count: { select: { members: true } },
      sets: { take: 4, select: { set: { select: { title: true, visibility: true } } } },
      members: { where: { userId: viewerId }, select: { id: true } },
      joinRequests: { where: { userId: viewerId }, select: { status: true } },
    },
  })
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    ownerHandle: g.owner.handle,
    memberCount: g._count.members,
    // Only titles of sets a stranger could open anyway.
    setTitles: g.sets.filter((s) => s.set.visibility !== 'private').map((s) => s.set.title),
    state: g.members.length > 0 ? 'member' : g.joinRequests[0]?.status === 'pending' ? 'pending' : g.joinRequests[0]?.status === 'declined' ? 'declined' : 'none',
  }))
}

export interface PendingRequestRow {
  id: string
  userId: string
  handle: string | null
  avatarUrl: string | null
  image: string | null
  message: string | null
  createdAt: Date
}

export async function loadPendingRequests(groupId: string): Promise<PendingRequestRow[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.studyGroupJoinRequest.findMany({
    where: { groupId, status: 'pending' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true, message: true, createdAt: true, user: { select: { handle: true, avatarUrl: true, image: true } } },
  })
  return rows.map((r) => ({ id: r.id, userId: r.userId, handle: r.user.handle, avatarUrl: r.user.avatarUrl, image: r.user.image, message: r.message, createdAt: r.createdAt }))
}

export interface PendingInviteRow {
  id: string
  userId: string
  handle: string | null
  createdAt: Date
}

export async function loadPendingInvites(groupId: string): Promise<PendingInviteRow[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.studyGroupInvite.findMany({
    where: { groupId, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    select: { id: true, userId: true, createdAt: true, user: { select: { handle: true } } },
  })
  return rows.map((r) => ({ id: r.id, userId: r.userId, handle: r.user.handle, createdAt: r.createdAt }))
}
