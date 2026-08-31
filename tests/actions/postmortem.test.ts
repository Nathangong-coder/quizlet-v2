import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  postmortemFindMany: vi.fn(),
  postmortemFindFirst: vi.fn(),
  postmortemCreate: vi.fn(),
  postmortemUpdate: vi.fn(),
  postmortemDeleteMany: vi.fn(),
  setFindFirst: vi.fn(),
  setFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    postmortemSession: {
      findMany: h.postmortemFindMany,
      findFirst: h.postmortemFindFirst,
      create: h.postmortemCreate,
      update: h.postmortemUpdate,
      deleteMany: h.postmortemDeleteMany,
    },
    set: {
      findFirst: h.setFindFirst,
      findMany: h.setFindMany,
    },
  },
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  createPostmortem,
  deletePostmortem,
  getPostmortem,
  getPostmortemSetOptions,
  listPostmortems,
  updatePostmortem,
} from '@/actions/postmortem'

const OWNER = 'user-owner'
const input = {
  title: 'Goldman Sachs first-round prep',
  format: 'mock_interview' as const,
  occurredAt: '2026-08-30',
  setId: 'set-finance',
  durationMin: '45',
  confidence: '3',
  whatCameUp: 'DCF walk-through and a market-sizing question.',
  wins: 'I stayed structured.',
  gaps: 'Working capital was fuzzy.',
  nextSteps: 'Do two timed DCF walk-throughs.',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.setFindFirst.mockResolvedValue({ id: 'set-finance', title: 'IB interview prep' })
})

describe('createPostmortem', () => {
  it('requires authentication', async () => {
    h.auth.mockResolvedValue(null)
    const result = await createPostmortem(input)
    expect(result.success).toBe(false)
    expect(h.postmortemCreate).not.toHaveBeenCalled()
  })

  it('rejects invalid format and date before touching the database', async () => {
    const result = await createPostmortem({ ...input, format: 'diary' as never, occurredAt: '2026-02-31' })
    expect(result.success).toBe(false)
    expect(h.setFindFirst).not.toHaveBeenCalled()
    expect(h.postmortemCreate).not.toHaveBeenCalled()
  })

  it('writes the session under the authenticated user and snapshots the set title', async () => {
    h.postmortemCreate.mockResolvedValue({ id: 'pm1' })
    const result = await createPostmortem(input)

    expect(result).toEqual({ success: true, data: { id: 'pm1' } })
    expect(h.setFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'set-finance' }) }))
    expect(h.postmortemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: OWNER,
        setId: 'set-finance',
        setTitleSnapshot: 'IB interview prep',
        title: input.title,
        format: input.format,
        durationMin: 45,
        confidence: 3,
        whatCameUp: input.whatCameUp,
      }),
    })
  })

  it('allows a standalone offline session without a set', async () => {
    h.postmortemCreate.mockResolvedValue({ id: 'pm2' })
    const result = await createPostmortem({ ...input, setId: '' })
    expect(result.success).toBe(true)
    expect(h.setFindFirst).not.toHaveBeenCalled()
    expect(h.postmortemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ setId: null, setTitleSnapshot: null }),
    })
  })

  it('refuses a linked set the user cannot read', async () => {
    h.setFindFirst.mockResolvedValue(null)
    const result = await createPostmortem(input)
    expect(result.success).toBe(false)
    expect(h.postmortemCreate).not.toHaveBeenCalled()
  })
})

describe('postmortem reads and mutations', () => {
  it('lists only the authenticated user’s rows', async () => {
    h.postmortemFindMany.mockResolvedValue([])
    const result = await listPostmortems()
    expect(result).toEqual({ success: true, data: [] })
    expect(h.postmortemFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
  })

  it('scopes a detail lookup by both id and user', async () => {
    h.postmortemFindFirst.mockResolvedValue(null)
    const result = await getPostmortem('pm-other')
    expect(result.success).toBe(false)
    expect(h.postmortemFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pm-other', userId: OWNER } }))
  })

  it('scopes updates and deletes by both id and user', async () => {
    h.postmortemFindFirst.mockResolvedValue({ id: 'pm1' })
    h.postmortemUpdate.mockResolvedValue({ id: 'pm1' })
    h.postmortemDeleteMany.mockResolvedValue({ count: 1 })

    const updated = await updatePostmortem('pm1', input)
    const deleted = await deletePostmortem('pm1')

    expect(updated.success).toBe(true)
    expect(h.postmortemFindFirst).toHaveBeenCalledWith({ where: { id: 'pm1', userId: OWNER } })
    expect(h.postmortemUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pm1' } }))
    expect(deleted).toEqual({ success: true, data: { deleted: true } })
    expect(h.postmortemDeleteMany).toHaveBeenCalledWith({ where: { id: 'pm1', userId: OWNER } })
  })

  it('loads readable set options for the authenticated user', async () => {
    h.setFindMany.mockResolvedValue([{ id: 'set1', title: 'Accounting' }])
    const result = await getPostmortemSetOptions()
    expect(result).toEqual({ success: true, data: [{ id: 'set1', title: 'Accounting' }] })
    expect(h.setFindMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { title: 'asc' } }))
  })
})
