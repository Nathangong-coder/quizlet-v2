'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import type { ActionResult } from '@/types/action'

const FOLDER_ITEM_TYPES = ['set', 'postmortem', 'note', 'folder'] as const
export type FolderItemType = (typeof FOLDER_ITEM_TYPES)[number]

const FolderInputSchema = z.object({
  name: z.string().trim().min(1, 'Give this folder a name').max(80),
  description: z.string().trim().max(1000).optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(12).optional(),
})

export interface FolderListRow {
  id: string
  name: string
  description: string | null
  counts: { sets: number; postmortems: number; notes: number; folders: number }
  updatedAt: Date
}

export interface FolderMember {
  id: string
  title: string
  href: string
  meta?: string
  /** Timestamp for the folder sort controls. */
  addedAt?: Date
  createdAt?: Date
  updatedAt?: Date
  studiedAt?: Date | null
}

export interface FolderDetail {
  id: string
  name: string
  description: string | null
  tags: string[]
  pinned: boolean
  createdAt: Date
  updatedAt: Date
  sets: FolderMember[]
  postmortems: FolderMember[]
  notes: FolderMember[]
  folders: FolderMember[]
}

export interface FolderOptions {
  sets: Array<{ id: string; title: string }>
  postmortems: Array<{ id: string; title: string }>
  notes: Array<{ id: string; title: string }>
  folders: Array<{ id: string; title: string }>
}

function cleanDescription(value: string | undefined): string | null {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}

function cleanTags(value: string[] | undefined): string[] {
  return [...new Set((value ?? []).map((tag) => tag.trim()).filter(Boolean))].slice(0, 12)
}

function invalidInput(error: z.ZodError) {
  return { success: false as const, error: error.issues[0]?.message ?? 'Please check the form' }
}

function refreshFolderViews(id?: string) {
  revalidatePath('/folders')
  revalidatePath('/', 'layout')
  if (id) revalidatePath(`/folders/${id}`)
}

/** Walk upward from a prospective parent so a child can never point back to an
 * ancestor. This is intentionally an application check: Prisma's relational
 * constraints enforce row ownership, but not graph acyclicity. */
async function wouldCreateFolderCycle(parentId: string, childId: string) {
  const seen = new Set<string>([parentId])
  let frontier = [parentId]
  while (frontier.length > 0) {
    const edges = await prisma.folderFolder.findMany({ where: { childId: { in: frontier } }, select: { parentId: true } })
    const next: string[] = []
    for (const edge of edges) {
      if (edge.parentId === childId) return true
      if (!seen.has(edge.parentId)) {
        seen.add(edge.parentId)
        next.push(edge.parentId)
      }
    }
    frontier = next
  }
  return false
}

export async function listFolders(): Promise<ActionResult<FolderListRow[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const rows = await prisma.folder.findMany({
      where: { userId: session.user.id },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        updatedAt: true,
        tags: true,
        pinned: true,
        _count: { select: { sets: true, postmortems: true, notes: true, children: true } },
      },
    })
    return {
      success: true,
      data: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt, counts: { sets: row._count.sets, postmortems: row._count.postmortems, notes: row._count.notes, folders: row._count.children ?? 0 } })),
    }
  } catch (error) {
    console.error('listFolders error:', error)
    return { success: false, error: 'Failed to load folders' }
  }
}

export async function getFolder(id: string): Promise<ActionResult<FolderDetail>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const row = await prisma.folder.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        name: true,
        description: true,
        tags: true,
        pinned: true,
        createdAt: true,
        updatedAt: true,
        sets: { select: { createdAt: true, set: { select: { id: true, title: true, description: true, createdAt: true, updatedAt: true, _count: { select: { cards: true } } } } } },
        postmortems: { select: { createdAt: true, postmortem: { select: { id: true, title: true, format: true, createdAt: true, updatedAt: true } } } },
        notes: { select: { createdAt: true, note: { select: { id: true, title: true, analyzedAt: true, createdAt: true, updatedAt: true } } } },
        children: { select: { createdAt: true, child: { select: { id: true, name: true, description: true, createdAt: true, updatedAt: true } } } },
      },
    })
    if (!row) return { success: false, error: 'Folder not found' }

    const setIds = row.sets.map(({ set }) => set.id)
    const studiedBySet = new Map<string, Date>()
    if (setIds.length > 0) {
      const studiedRows = await prisma.studyEvent.findMany({
        where: { userId: session.user.id, card: { setId: { in: setIds } } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, card: { select: { setId: true } } },
      })
      for (const studiedRow of studiedRows) {
        if (!studiedBySet.has(studiedRow.card.setId)) studiedBySet.set(studiedRow.card.setId, studiedRow.createdAt)
      }
    }

    return {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        description: row.description,
        tags: row.tags,
        pinned: row.pinned,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sets: row.sets.map(({ createdAt: addedAt, set }) => ({ id: set.id, title: set.title, href: `/sets/${set.id}`, meta: set.description ?? `${set._count.cards} ${set._count.cards === 1 ? 'card' : 'cards'}`, addedAt, createdAt: set.createdAt, updatedAt: set.updatedAt, studiedAt: studiedBySet.get(set.id) ?? null })),
        postmortems: row.postmortems.map(({ createdAt: addedAt, postmortem }) => ({ id: postmortem.id, title: postmortem.title, href: `/postmortem/${postmortem.id}`, meta: postmortem.format, addedAt, createdAt: postmortem.createdAt, updatedAt: postmortem.updatedAt })),
        notes: row.notes.map(({ createdAt: addedAt, note }) => ({ id: note.id, title: note.title, href: `/notes/${note.id}`, meta: note.analyzedAt ? 'Analyzed' : 'Not analyzed', addedAt, createdAt: note.createdAt, updatedAt: note.updatedAt })),
        folders: row.children.map(({ createdAt: addedAt, child }) => ({ id: child.id, title: child.name, href: `/folders/${child.id}`, meta: child.description ?? undefined, addedAt, createdAt: child.createdAt, updatedAt: child.updatedAt })),
      },
    }
  } catch (error) {
    console.error('getFolder error:', error)
    return { success: false, error: 'Failed to load folder' }
  }
}

export async function getFolderOptions(excludeFolderId?: string): Promise<ActionResult<FolderOptions>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const [sets, postmortems, notes, folders] = await Promise.all([
      prisma.set.findMany({ where: readableSetWhere(session.user.id), orderBy: { title: 'asc' }, take: 200, select: { id: true, title: true } }),
      prisma.postmortemSession.findMany({ where: { userId: session.user.id }, orderBy: { occurredAt: 'desc' }, take: 200, select: { id: true, title: true } }),
      prisma.studyNote.findMany({ where: { userId: session.user.id }, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, title: true } }),
      prisma.folder.findMany({ where: { userId: session.user.id, ...(excludeFolderId ? { id: { not: excludeFolderId } } : {}) }, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, name: true } }),
    ])
    return { success: true, data: { sets, postmortems, notes, folders: folders.map((folder) => ({ id: folder.id, title: folder.name })) } }
  } catch (error) {
    console.error('getFolderOptions error:', error)
    return { success: false, error: 'Failed to load folder options' }
  }
}

export async function createFolder(input: z.input<typeof FolderInputSchema>): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = FolderInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const created = await prisma.folder.create({
        data: { userId: session.user.id, name: parsed.data.name, description: cleanDescription(parsed.data.description), ...(parsed.data.tags !== undefined ? { tags: cleanTags(parsed.data.tags) } : {}) },
    })
    refreshFolderViews(created.id)
    return { success: true, data: { id: created.id } }
  } catch (error) {
    console.error('createFolder error:', error)
    return { success: false, error: 'A folder with that name may already exist' }
  }
}

export async function updateFolder(id: string, input: z.input<typeof FolderInputSchema>): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = FolderInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const updated = await prisma.folder.updateMany({
      where: { id, userId: session.user.id },
      data: { name: parsed.data.name, description: cleanDescription(parsed.data.description), ...(parsed.data.tags !== undefined ? { tags: cleanTags(parsed.data.tags) } : {}) },
    })
    if (updated.count === 0) return { success: false, error: 'Folder not found' }
    refreshFolderViews(id)
    return { success: true, data: { id } }
  } catch (error) {
    console.error('updateFolder error:', error)
    return { success: false, error: 'A folder with that name may already exist' }
  }
}

export async function setFolderPinned(id: string, pinned: boolean): Promise<ActionResult<{ pinned: boolean }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const updated = await prisma.folder.updateMany({ where: { id, userId: session.user.id }, data: { pinned } })
    if (updated.count === 0) return { success: false, error: 'Folder not found' }
    refreshFolderViews(id)
    return { success: true, data: { pinned } }
  } catch (error) {
    console.error('setFolderPinned error:', error)
    return { success: false, error: 'Failed to update sidebar pin' }
  }
}

export async function deleteFolder(id: string): Promise<ActionResult<{ deleted: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const deleted = await prisma.folder.deleteMany({ where: { id, userId: session.user.id } })
    if (deleted.count === 0) return { success: false, error: 'Folder not found' }
    refreshFolderViews()
    return { success: true, data: { deleted: true } }
  } catch (error) {
    console.error('deleteFolder error:', error)
    return { success: false, error: 'Failed to delete folder' }
  }
}

export async function addFolderItem(
  folderId: string,
  type: FolderItemType,
  itemId: string,
): Promise<ActionResult<{ added: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!FOLDER_ITEM_TYPES.includes(type)) return { success: false, error: 'Unknown folder item type' }

  try {
    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId: session.user.id }, select: { id: true } })
    if (!folder) return { success: false, error: 'Folder not found' }

    if (type === 'set') {
      const item = await prisma.set.findFirst({ where: { id: itemId, ...readableSetWhere(session.user.id) }, select: { id: true } })
      if (!item) return { success: false, error: 'Study set not found' }
      await prisma.folderSet.upsert({ where: { folderId_setId: { folderId, setId: item.id } }, update: {}, create: { folderId, setId: item.id } })
    } else if (type === 'postmortem') {
      const item = await prisma.postmortemSession.findFirst({ where: { id: itemId, userId: session.user.id }, select: { id: true } })
      if (!item) return { success: false, error: 'Postmortem not found' }
      await prisma.folderPostmortem.upsert({ where: { folderId_postmortemId: { folderId, postmortemId: item.id } }, update: {}, create: { folderId, postmortemId: item.id } })
    } else if (type === 'note') {
      const item = await prisma.studyNote.findFirst({ where: { id: itemId, userId: session.user.id }, select: { id: true } })
      if (!item) return { success: false, error: 'Study note not found' }
      await prisma.folderNote.upsert({ where: { folderId_noteId: { folderId, noteId: item.id } }, update: {}, create: { folderId, noteId: item.id } })
    } else {
      const item = await prisma.folder.findFirst({ where: { id: itemId, userId: session.user.id }, select: { id: true } })
      if (!item) return { success: false, error: 'Folder not found' }
      if (item.id === folderId) return { success: false, error: 'A folder cannot contain itself' }
      if (await wouldCreateFolderCycle(folderId, item.id)) return { success: false, error: 'That would create a folder loop' }
      await prisma.folderFolder.upsert({ where: { parentId_childId: { parentId: folderId, childId: item.id } }, update: {}, create: { parentId: folderId, childId: item.id } })
    }

    refreshFolderViews(folderId)
    return { success: true, data: { added: true } }
  } catch (error) {
    console.error('addFolderItem error:', error)
    return { success: false, error: 'Failed to add item to folder' }
  }
}

export async function removeFolderItem(
  folderId: string,
  type: FolderItemType,
  itemId: string,
): Promise<ActionResult<{ removed: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  if (!FOLDER_ITEM_TYPES.includes(type)) return { success: false, error: 'Unknown folder item type' }

  try {
    const folder = await prisma.folder.findFirst({ where: { id: folderId, userId: session.user.id }, select: { id: true } })
    if (!folder) return { success: false, error: 'Folder not found' }

    const removed = type === 'set'
      ? await prisma.folderSet.deleteMany({ where: { folderId, setId: itemId } })
      : type === 'postmortem'
        ? await prisma.folderPostmortem.deleteMany({ where: { folderId, postmortemId: itemId } })
        : type === 'note'
          ? await prisma.folderNote.deleteMany({ where: { folderId, noteId: itemId } })
          : await prisma.folderFolder.deleteMany({ where: { parentId: folderId, childId: itemId } })
    if (removed.count === 0) return { success: false, error: 'Item is not in this folder' }
    refreshFolderViews(folderId)
    return { success: true, data: { removed: true } }
  } catch (error) {
    console.error('removeFolderItem error:', error)
    return { success: false, error: 'Failed to remove item from folder' }
  }
}
