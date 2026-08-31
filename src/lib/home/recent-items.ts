import { prisma } from '@/lib/db'
import { loadRecentSets } from '@/lib/sets/recents'
import { readableSetWhere } from '@/lib/sets/visibility'

export type HomeRecentKind = 'flashcard' | 'folder' | 'study-guide' | 'postmortem'

export interface HomeRecentItem {
  id: string
  title: string
  href: string
  kind: HomeRecentKind
  kindLabel: string
  meta: string | null
  byline: string
  updatedAt: Date
}

/**
 * Merge the four learner-owned/recent content streams into one homepage
 * shelf. A set is recent because it was opened; the other objects are recent
 * because they were edited. Each source remains authorized before merging.
 */
export async function loadHomeRecentItems(userId: string, limit = 8, setReadWhere = readableSetWhere(userId)): Promise<HomeRecentItem[]> {
  const [sets, folders, notes, postmortems] = await Promise.all([
    loadRecentSets(userId, limit, setReadWhere),
    prisma.folder.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: limit,
      select: { id: true, name: true, updatedAt: true },
    }),
    prisma.studyNote.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    }),
    prisma.postmortemSession.findMany({
      where: { userId },
      orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
      take: limit,
      select: { id: true, title: true, updatedAt: true },
    }),
  ])

  const items: HomeRecentItem[] = [
    ...sets.map((set) => ({
      id: set.id,
      title: set.title,
      href: `/sets/${set.id}`,
      kind: 'flashcard' as const,
      kindLabel: 'Flashcard set',
      meta: `${set.cardCount} ${set.cardCount === 1 ? 'card' : 'cards'}`,
      byline: set.isOwn ? 'by you' : `by ${set.ownerHandle ?? 'the creator'}`,
      updatedAt: set.viewedAt,
    })),
    ...folders.map((folder) => ({
      id: folder.id,
      title: folder.name,
      href: `/folders/${folder.id}`,
      kind: 'folder' as const,
      kindLabel: 'Folder',
      meta: null,
      byline: 'by you',
      updatedAt: folder.updatedAt,
    })),
    ...notes.map((note) => ({
      id: note.id,
      title: note.title,
      href: `/notes/${note.id}`,
      kind: 'study-guide' as const,
      kindLabel: 'Study guide',
      meta: null,
      byline: 'by you',
      updatedAt: note.updatedAt,
    })),
    ...postmortems.map((postmortem) => ({
      id: postmortem.id,
      title: postmortem.title,
      href: `/postmortem/${postmortem.id}`,
      kind: 'postmortem' as const,
      kindLabel: 'Postmortem',
      meta: null,
      byline: 'by you',
      updatedAt: postmortem.updatedAt,
    })),
  ]

  return items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, limit)
}
