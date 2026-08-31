import { prisma } from '@/lib/db'

export const RAIL_FOLDERS_LIMIT = 6

export interface RailFolder {
  id: string
  name: string
}

/** Small, owner-scoped folder read used by both desktop and mobile navigation. */
export async function loadRecentFolders(userId: string, limit = RAIL_FOLDERS_LIMIT): Promise<RailFolder[]> {
  const folders = await prisma.folder.findMany({
    where: { userId, pinned: true },
    orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
    take: limit,
    select: { id: true, name: true },
  })
  return folders
}
