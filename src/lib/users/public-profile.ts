import { composeSetWhere, listableSetWhere } from '@/lib/sets/visibility'
import { normalizeHandle } from '@/lib/users/handle'
import type { DirectoryEntry } from '@/lib/sets/directory'

/**
 * A public profile: what a STRANGER may see about a user.
 *
 * Only what the user has already chosen to publish. `name` is the OAuth
 * provider's real-name field and never leaves this module; `email` is not
 * even selected. Study numbers — streaks, answers, mastery — are private
 * evidence and are not here; publishing them is a decision the learner would
 * have to make explicitly, and no such control exists yet.
 */
export interface PublicProfile {
  id: string
  handle: string
  bio: string | null
  avatarUrl: string | null
  image: string | null
  createdAt: Date
}

/**
 * The profile's set list `where`: the user's sets that are public AND listable
 * AND readable by this viewer. `listableSetWhere` excludes moderation-blocked
 * sets — a set unlisted from Browse for a reason its owner cannot see must not
 * resurface on the owner's profile. Composed, never spread (spec §3.1).
 */
export function buildProfileSetsWhere(viewerId: string | null, userId: string): Record<string, unknown> {
  return composeSetWhere(viewerId, listableSetWhere(), { userId })
}

/**
 * Lookup by NORMALIZED handle, so `/u/Alice` and `/u/alice` are one page —
 * the same rule that makes them one account. Null for an unknown handle or a
 * user who never chose one (a handle-less user has no public page at all).
 */
export async function loadPublicProfile(rawHandle: string): Promise<PublicProfile | null> {
  const { prisma } = await import('@/lib/db')
  const normalized = normalizeHandle(rawHandle)
  if (!normalized) return null
  const user = await prisma.user.findUnique({
    where: { normalizedHandle: normalized },
    select: { id: true, handle: true, bio: true, avatarUrl: true, image: true, createdAt: true },
  })
  if (!user?.handle) return null
  return { ...user, handle: user.handle }
}

export const PROFILE_SETS_LIMIT = 60

export async function loadProfileSets(viewerId: string | null, userId: string): Promise<DirectoryEntry[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.set.findMany({
    where: buildProfileSetsWhere(viewerId, userId),
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    take: PROFILE_SETS_LIMIT,
    select: {
      id: true,
      title: true,
      description: true,
      subject: true,
      publishedAt: true,
      forkedFromId: true,
      forkedFromTitle: true,
      forkedFromHandle: true,
      user: { select: { handle: true } },
      categories: { select: { name: true, color: true }, take: 6 },
      _count: { select: { cards: true, forks: true } },
    },
  })
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    subject: r.subject,
    cardCount: r._count.cards,
    forkCount: r._count.forks,
    publishedAt: r.publishedAt,
    handle: r.user.handle,
    categories: r.categories,
    forkedFromId: r.forkedFromId,
    forkedFromTitle: r.forkedFromTitle,
    forkedFromHandle: r.forkedFromHandle,
  }))
}
