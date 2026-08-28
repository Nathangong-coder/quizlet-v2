import { composeSetWhere, listableSetWhere } from '@/lib/sets/visibility'

/** One page of the directory. Cursor-paginated, so it is a page and not an offset. */
export const DIRECTORY_PAGE_SIZE = 24

export interface DirectoryEntry {
  id: string
  title: string
  description: string | null
  cardCount: number
  handle: string | null
  categories: { name: string; color: string | null }[]
  forkCount: number
  publishedAt: Date | null
  forkedFromId: string | null
  forkedFromTitle: string | null
  forkedFromHandle: string | null
}

/**
 * The directory's `where`.
 *
 * `composeSetWhere` and NOT a spread. `readableSetWhere` returns a bare `OR`
 * for a signed-in viewer, and the search below is also an `OR` — spreading
 * both at one level makes the second REPLACE the first, widening the query to
 * every set in the database while still returning plausible results. That is
 * the failure mode this function exists to make impossible.
 *
 * `listableSetWhere` looks like it makes the readable fragment redundant. It
 * is kept anyway: the day someone adds "also show my own private sets here",
 * a hand-rolled filter leaks and a composed one does not.
 */
export function buildDirectoryWhere(
  viewerId: string | null,
  q?: string,
): Record<string, unknown> {
  const trimmed = q?.trim()
  const clauses: Record<string, unknown>[] = [listableSetWhere()]

  // Omitted entirely for a blank query. `{ contains: '' }` matches every row,
  // which is not the same thing as "no filter" once it sits inside an OR
  // alongside other clauses.
  if (trimmed) {
    clauses.push({
      OR: [
        { title: { contains: trimmed, mode: 'insensitive' } },
        { description: { contains: trimmed, mode: 'insensitive' } },
      ],
    })
  }

  return composeSetWhere(viewerId, ...clauses)
}

/**
 * Thin DB shell over `buildDirectoryWhere`. Untested here by the same
 * convention as `getLearnerMetrics` — the predicate it delegates to is
 * covered, and no DB fixture in this suite would add signal.
 *
 * The `@/lib/db` import is DYNAMIC on purpose: that module throws at import
 * time when `DATABASE_URL` is absent, which is the case in the unit suite.
 * A top-level import would take the pure tests above down with it.
 *
 * Cursor-paginated on id, ordered by fork count then recency. Offset paging
 * drifts as sets are published mid-scroll.
 *
 * Sort is deliberately NOT "most studied": study counts come from
 * `StudySession` rows belonging to individual learners, and turning private
 * study behaviour into a public ranking signal is a privacy decision nobody
 * has made.
 */
export async function loadDirectory(
  viewerId: string | null,
  q: string | undefined,
  cursor?: string,
): Promise<{ entries: DirectoryEntry[]; nextCursor: string | null }> {
  const { prisma } = await import('@/lib/db')

  const rows = await prisma.set.findMany({
    where: buildDirectoryWhere(viewerId, q),
    orderBy: [{ forks: { _count: 'desc' } }, { publishedAt: 'desc' }, { id: 'desc' }],
    take: DIRECTORY_PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      description: true,
      publishedAt: true,
      forkedFromId: true,
      forkedFromTitle: true,
      forkedFromHandle: true,
      user: { select: { handle: true } },
      categories: { select: { name: true, color: true }, take: 6 },
      _count: { select: { cards: true, forks: true } },
    },
  })

  const page = rows.slice(0, DIRECTORY_PAGE_SIZE)
  return {
    entries: page.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      cardCount: r._count.cards,
      forkCount: r._count.forks,
      publishedAt: r.publishedAt,
      handle: r.user.handle,
      categories: r.categories,
      forkedFromId: r.forkedFromId,
      forkedFromTitle: r.forkedFromTitle,
      forkedFromHandle: r.forkedFromHandle,
    })),
    nextCursor: rows.length > DIRECTORY_PAGE_SIZE ? page[page.length - 1].id : null,
  }
}
