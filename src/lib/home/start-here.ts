import { readableSetWhere } from '@/lib/sets/visibility'

/**
 * The "Start here" hub pages (Flashcards, Study guides, Games, Tests) all
 * begin the same way: pick a set. One loader — the learner's own sets, then
 * sets they recently opened that they do not own — so the four pages agree
 * on what "your sets" means.
 */

export interface StartSet {
  id: string
  title: string
  cardCount: number
  isOwn: boolean
  ownerHandle: string | null
  subject: string | null
  /** Live key points on the set — what the guide, Mastery and the diagnostic need. */
  klpCards: number
}

export async function loadStartSets(userId: string, limit = 24): Promise<StartSet[]> {
  const { prisma } = await import('@/lib/db')
  const { loadRecentSets } = await import('@/lib/sets/recents')
  const [own, recent] = await Promise.all([
    prisma.set.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      select: { id: true, title: true, subject: true, user: { select: { handle: true } }, _count: { select: { cards: true } } },
    }),
    loadRecentSets(userId, 12, readableSetWhere(userId)),
  ])
  const ids = new Set(own.map((s) => s.id))
  const others = recent.filter((r) => !ids.has(r.id))
  const allIds = [...own.map((s) => s.id), ...others.map((r) => r.id)]
  const klpCounts = allIds.length
    ? await prisma.card.groupBy({ by: ['setId'], where: { setId: { in: allIds }, klps: { some: { supersededAt: null } } }, _count: { _all: true } })
    : []
  const klpBy = new Map(klpCounts.map((k) => [k.setId, k._count._all]))
  return [
    ...own.map((s) => ({ id: s.id, title: s.title, cardCount: s._count.cards, isOwn: true, ownerHandle: s.user.handle, subject: s.subject, klpCards: klpBy.get(s.id) ?? 0 })),
    ...others.map((r) => ({ id: r.id, title: r.title, cardCount: r.cardCount, isOwn: false, ownerHandle: r.ownerHandle, subject: null, klpCards: klpBy.get(r.id) ?? 0 })),
  ].slice(0, limit)
}
