'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import type { ActionResult } from '@/types/action'

const FOLDER_ITEM_TYPES = ['set', 'postmortem', 'note'] as const
export type FolderItemType = (typeof FOLDER_ITEM_TYPES)[number]

const FolderInputSchema = z.object({
  name: z.string().trim().min(1, 'Give this folder a name').max(80),
  description: z.string().trim().max(1000).optional(),
})

export interface FolderListRow {
  id: string
  name: string
  description: string | null
  counts: { sets: number; postmortems: number; notes: number }
  updatedAt: Date
}

export interface FolderMember {
  id: string
  title: string
  href: string
  meta?: string
}

export interface FolderDetail {
  id: string
  name: string
  description: string | null
  createdAt: Date
  updatedAt: Date
  sets: FolderMember[]
  postmortems: FolderMember[]
  notes: FolderMember[]
}

export interface FolderOptions {
  sets: Array<{ id: string; title: string }>
  postmortems: Array<{ id: string; title: string }>
  notes: Array<{ id: string; title: string }>
}

function cleanDescription(value: string | undefined): string | null {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}

function invalidInput(error: z.ZodError) {
  return { success: false as const, error: error.issues[0]?.message ?? 'Please check the form' }
}

function refreshFolderViews(id?: string) {
  revalidatePath('/folders')
  revalidatePath('/', 'layout')
  if (id) revalidatePath(`/folders/${id}`)
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
        _count: { select: { sets: true, postmortems: true, notes: true } },
      },
    })
    return {
      success: true,
      data: rows.map((row) => ({ id: row.id, name: row.name, description: row.description, updatedAt: row.updatedAt, counts: row._count })),
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
        createdAt: true,
        updatedAt: true,
        sets: { select: { set: { select: { id: true, title: true, description: true } } } },
        postmortems: { select: { postmortem: { select: { id: true, title: true, format: true } } } },
        notes: { select: { note: { select: { id: true, title: true, analyzedAt: true } } } },
      },
    })
    if (!row) return { success: false, error: 'Folder not found' }

    return {
      success: true,
      data: {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        sets: row.sets.map(({ set }) => ({ id: set.id, title: set.title, href: `/sets/${set.id}`, meta: set.description ?? undefined })),
        postmortems: row.postmortems.map(({ postmortem }) => ({ id: postmortem.id, title: postmortem.title, href: `/postmortem/${postmortem.id}`, meta: postmortem.format })),
        notes: row.notes.map(({ note }) => ({ id: note.id, title: note.title, href: `/notes/${note.id}`, meta: note.analyzedAt ? 'Analyzed' : 'Not analyzed' })),
      },
    }
  } catch (error) {
    console.error('getFolder error:', error)
    return { success: false, error: 'Failed to load folder' }
  }
}

export async function getFolderOptions(): Promise<ActionResult<FolderOptions>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const [sets, postmortems, notes] = await Promise.all([
      prisma.set.findMany({ where: readableSetWhere(session.user.id), orderBy: { title: 'asc' }, take: 200, select: { id: true, title: true } }),
      prisma.postmortemSession.findMany({ where: { userId: session.user.id }, orderBy: { occurredAt: 'desc' }, take: 200, select: { id: true, title: true } }),
      prisma.studyNote.findMany({ where: { userId: session.user.id }, orderBy: { updatedAt: 'desc' }, take: 200, select: { id: true, title: true } }),
    ])
    return { success: true, data: { sets, postmortems, notes } }
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
      data: { userId: session.user.id, name: parsed.data.name, description: cleanDescription(parsed.data.description) },
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
      data: { name: parsed.data.name, description: cleanDescription(parsed.data.description) },
    })
    if (updated.count === 0) return { success: false, error: 'Folder not found' }
    refreshFolderViews(id)
    return { success: true, data: { id } }
  } catch (error) {
    console.error('updateFolder error:', error)
    return { success: false, error: 'A folder with that name may already exist' }
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
    } else {
      const item = await prisma.studyNote.findFirst({ where: { id: itemId, userId: session.user.id }, select: { id: true } })
      if (!item) return { success: false, error: 'Study note not found' }
      await prisma.folderNote.upsert({ where: { folderId_noteId: { folderId, noteId: item.id } }, update: {}, create: { folderId, noteId: item.id } })
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

    const where = type === 'set'
      ? { folderId, setId: itemId }
      : type === 'postmortem'
        ? { folderId, postmortemId: itemId }
        : { folderId, noteId: itemId }
    const removed = type === 'set'
      ? await prisma.folderSet.deleteMany({ where })
      : type === 'postmortem'
        ? await prisma.folderPostmortem.deleteMany({ where })
        : await prisma.folderNote.deleteMany({ where })
    if (removed.count === 0) return { success: false, error: 'Item is not in this folder' }
    refreshFolderViews(folderId)
    return { success: true, data: { removed: true } }
  } catch (error) {
    console.error('removeFolderItem error:', error)
    return { success: false, error: 'Failed to remove item from folder' }
  }
}
