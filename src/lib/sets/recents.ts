import { readableSetWhere } from '@/lib/sets/visibility'

/** How many sets the homepage strip shows. One row, no pagination. */
export const RECENTS_LIMIT = 8

export interface RecentRow {
  viewedAt: Date
  set: {
    id: string
    title: string
    description: string | null
    visibility: string
    userId: string
    createdAt: Date
    user: { handle: string | null }
    _count: { cards: number }
  }
}

export interface RecentSet {
  id: string
  title: string
  description: string | null
  cardCount: number
  visibility: string
  /**
   * The creator's public handle, or null.
   *
   * NEVER falls back to `User.name` — that field comes from the OAuth provider
   * and is usually a real full name. No handle means no credit line.
   */
  ownerHandle: string | null
  isOwn: boolean
  viewedAt: Date
  /**
   * Carried so the strip can render the SAME card as `/sets` and the "Your
   * sets" block below it — `SetCard` falls back to the creation date when the
   * viewer has no study history on a set, and without this it had nothing to
   * fall back TO.
   */
  createdAt: Date
}

/**
 * Flatten joined rows. Pure, so the null-handle rule and the ownership flag
 * are tested without a database — the two places this quietly goes wrong.
 *
 * Deliberately does NOT re-sort. The query orders by `viewedAt desc` against
 * the `[userId, viewedAt]` index; re-sorting here would be a second notion of
 * recency that can disagree with it.
 */
export function shapeRecents(rows: RecentRow[], viewerId: string): RecentSet[] {
  return rows.map((r) => ({
    id: r.set.id,
    title: r.set.title,
    description: r.set.description,
    cardCount: r.set._count.cards,
    visibility: r.set.visibility,
    ownerHandle: r.set.user.handle,
    isOwn: r.set.userId === viewerId,
    viewedAt: r.viewedAt,
    createdAt: r.set.createdAt,
  }))
}

/**
 * Stamp that this user opened this set.
 *
 * An UPSERT — one row per (user, set). This is a "jump back in" list, not
 * history; `StudySession` already carries real history and a second
 * append-only table would be a second notion of activity that can disagree
 * with it.
 *
 * CALL THIS FROM `after()`, never during a Server Component's render. Writing
 * during render is unsafe under caching and PPR, and this write must never be
 * able to fail the page: a recents row is worth strictly less than the set the
 * reader came for. It therefore swallows its own errors — `after()` has no
 * error boundary, so an escaped rejection here would be an unhandled one.
 *
 * NOT EVIDENCE. Nothing here reaches the learner model, mastery or StudyEvent.
 */
export async function recordSetView(userId: string, setId: string): Promise<void> {
  const { prisma } = await import('@/lib/db')
  try {
    await prisma.setView.upsert({
      where: { userId_setId: { userId, setId } },
      create: { userId, setId },
      update: { viewedAt: new Date() },
    })
  } catch (error) {
    console.error('recordSetView failed', { setId, error })
  }
}

/**
 * The sets this user most recently opened, re-authorized at read time.
 *
 * `readableSetWhere` is applied HERE and not merely at write time on purpose:
 * a set you viewed and that its owner later made private must disappear from
 * your homepage, and the only way to guarantee that is to re-ask the question
 * on every read rather than trusting a stored row.
 */
export async function loadRecentSets(
  userId: string,
  limit: number = RECENTS_LIMIT,
  readableWhere: Record<string, unknown> = readableSetWhere(userId),
): Promise<RecentSet[]> {
  const { prisma } = await import('@/lib/db')
  const rows = await prisma.setView.findMany({
    where: { userId, set: readableWhere },
    orderBy: { viewedAt: 'desc' },
    take: limit,
    select: {
      viewedAt: true,
      set: {
        select: {
          id: true, title: true, description: true, visibility: true, userId: true,
          createdAt: true,
          user: { select: { handle: true } },
          _count: { select: { cards: true } },
        },
      },
    },
  })
  return shapeRecents(rows as RecentRow[], userId)
}
