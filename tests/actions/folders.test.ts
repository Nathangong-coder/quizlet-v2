import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  folderFindMany: vi.fn(),
  folderFindFirst: vi.fn(),
  folderCreate: vi.fn(),
  folderUpdateMany: vi.fn(),
  folderDeleteMany: vi.fn(),
  folderSetUpsert: vi.fn(),
  folderPostmortemUpsert: vi.fn(),
  folderNoteUpsert: vi.fn(),
  folderSetDeleteMany: vi.fn(),
  folderPostmortemDeleteMany: vi.fn(),
  folderNoteDeleteMany: vi.fn(),
  setFindMany: vi.fn(),
  setFindFirst: vi.fn(),
  postmortemFindMany: vi.fn(),
  postmortemFindFirst: vi.fn(),
  noteFindMany: vi.fn(),
  noteFindFirst: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    folder: { findMany: h.folderFindMany, findFirst: h.folderFindFirst, create: h.folderCreate, updateMany: h.folderUpdateMany, deleteMany: h.folderDeleteMany },
    folderSet: { upsert: h.folderSetUpsert, deleteMany: h.folderSetDeleteMany },
    folderPostmortem: { upsert: h.folderPostmortemUpsert, deleteMany: h.folderPostmortemDeleteMany },
    folderNote: { upsert: h.folderNoteUpsert, deleteMany: h.folderNoteDeleteMany },
    set: { findMany: h.setFindMany, findFirst: h.setFindFirst },
    postmortemSession: { findMany: h.postmortemFindMany, findFirst: h.postmortemFindFirst },
    studyNote: { findMany: h.noteFindMany, findFirst: h.noteFindFirst },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  addFolderItem,
  createFolder,
  deleteFolder,
  getFolder,
  getFolderOptions,
  listFolders,
  removeFolderItem,
  updateFolder,
} from '@/actions/folders'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('folder persistence', () => {
  it('requires authentication', async () => {
    h.auth.mockResolvedValue(null)

    expect((await listFolders()).success).toBe(false)
    expect((await createFolder({ name: 'IB prep' })).success).toBe(false)
    expect((await getFolder('folder-1')).success).toBe(false)
    expect((await deleteFolder('folder-1')).success).toBe(false)
    expect(h.folderFindMany).not.toHaveBeenCalled()
  })

  it('lists only the owner folders and returns counts', async () => {
    h.folderFindMany.mockResolvedValue([{ id: 'folder-1', name: 'IB prep', description: null, updatedAt: new Date('2026-08-30'), _count: { sets: 2, postmortems: 1, notes: 3 } }])

    const result = await listFolders()

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data).toEqual([{ id: 'folder-1', name: 'IB prep', description: null, updatedAt: expect.any(Date), counts: { sets: 2, postmortems: 1, notes: 3 } }])
    expect(h.folderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
  })

  it('creates and updates folders under the owner', async () => {
    h.folderCreate.mockResolvedValue({ id: 'folder-1' })
    h.folderUpdateMany.mockResolvedValue({ count: 1 })

    expect(await createFolder({ name: '  IB prep  ', description: ' Interview cycle ' })).toEqual({ success: true, data: { id: 'folder-1' } })
    expect(h.folderCreate).toHaveBeenCalledWith({ data: { userId: OWNER, name: 'IB prep', description: 'Interview cycle' } })

    expect(await updateFolder('folder-1', { name: 'Final round', description: '' })).toEqual({ success: true, data: { id: 'folder-1' } })
    expect(h.folderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'folder-1', userId: OWNER }, data: { name: 'Final round', description: null } }))
  })
})

describe('folder membership', () => {
  it('maps member links to navigable set, postmortem, and note entries', async () => {
    h.folderFindFirst.mockResolvedValue({
      id: 'folder-1', name: 'IB prep', description: 'A sprint', createdAt: new Date('2026-08-01'), updatedAt: new Date('2026-08-30'),
      sets: [{ set: { id: 'set-1', title: 'DCF', description: 'Valuation' } }],
      postmortems: [{ postmortem: { id: 'pm-1', title: 'Mock interview', format: 'mock_interview' } }],
      notes: [{ note: { id: 'note-1', title: 'Working capital', analyzedAt: new Date('2026-08-30') } }],
    })

    const result = await getFolder('folder-1')

    expect(result).toEqual({ success: true, data: expect.objectContaining({
      sets: [{ id: 'set-1', title: 'DCF', href: '/sets/set-1', meta: 'Valuation' }],
      postmortems: [{ id: 'pm-1', title: 'Mock interview', href: '/postmortem/pm-1', meta: 'mock_interview' }],
      notes: [{ id: 'note-1', title: 'Working capital', href: '/notes/note-1', meta: 'Analyzed' }],
    }) })
    expect(h.folderFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'folder-1', userId: OWNER } }))
  })

  it('checks ownership before adding each kind of item', async () => {
    h.folderFindFirst.mockResolvedValue({ id: 'folder-1' })
    h.setFindFirst.mockResolvedValue({ id: 'set-1' })
    h.postmortemFindFirst.mockResolvedValue({ id: 'pm-1' })
    h.noteFindFirst.mockResolvedValue({ id: 'note-1' })

    await addFolderItem('folder-1', 'set', 'set-1')
    await addFolderItem('folder-1', 'postmortem', 'pm-1')
    await addFolderItem('folder-1', 'note', 'note-1')

    expect(h.setFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'set-1' }) }))
    expect(h.postmortemFindFirst).toHaveBeenCalledWith({ where: { id: 'pm-1', userId: OWNER }, select: { id: true } })
    expect(h.noteFindFirst).toHaveBeenCalledWith({ where: { id: 'note-1', userId: OWNER }, select: { id: true } })
    expect(h.folderSetUpsert).toHaveBeenCalled()
    expect(h.folderPostmortemUpsert).toHaveBeenCalled()
    expect(h.folderNoteUpsert).toHaveBeenCalled()
  })

  it('removes only a membership in an owner folder', async () => {
    h.folderFindFirst.mockResolvedValue({ id: 'folder-1' })
    h.folderSetDeleteMany.mockResolvedValue({ count: 1 })

    const result = await removeFolderItem('folder-1', 'set', 'set-1')

    expect(result).toEqual({ success: true, data: { removed: true } })
    expect(h.folderSetDeleteMany).toHaveBeenCalledWith({ where: { folderId: 'folder-1', setId: 'set-1' } })
  })

  it('loads readable sets plus owned postmortems and notes as options', async () => {
    h.setFindMany.mockResolvedValue([{ id: 'set-1', title: 'DCF' }])
    h.postmortemFindMany.mockResolvedValue([{ id: 'pm-1', title: 'Mock interview' }])
    h.noteFindMany.mockResolvedValue([{ id: 'note-1', title: 'Working capital' }])

    const result = await getFolderOptions()

    expect(result).toEqual({ success: true, data: {
      sets: [{ id: 'set-1', title: 'DCF' }],
      postmortems: [{ id: 'pm-1', title: 'Mock interview' }],
      notes: [{ id: 'note-1', title: 'Working capital' }],
    } })
    expect(h.postmortemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
    expect(h.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
  })
})
