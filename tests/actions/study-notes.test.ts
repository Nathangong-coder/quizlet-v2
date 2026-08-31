import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  class MockAiGenerationError extends Error {
    detail: { title: string; why: string }

    constructor(detail: { title: string; why: string }) {
      super(detail.title)
      this.name = 'AiGenerationError'
      this.detail = detail
    }
  }

  return {
    auth: vi.fn(),
    noteFindMany: vi.fn(),
    noteFindFirst: vi.fn(),
    noteCreate: vi.fn(),
    noteUpdate: vi.fn(),
    noteUpdateMany: vi.fn(),
    noteDeleteMany: vi.fn(),
    generateJson: vi.fn(),
    AiGenerationError: MockAiGenerationError,
  }
})

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    studyNote: {
      findMany: h.noteFindMany,
      findFirst: h.noteFindFirst,
      create: h.noteCreate,
      update: h.noteUpdate,
      updateMany: h.noteUpdateMany,
      deleteMany: h.noteDeleteMany,
    },
  },
}))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: h.AiGenerationError,
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  analyzeStudyNote,
  createStudyNote,
  deleteStudyNote,
  getStudyNote,
  listStudyNotes,
  updateStudyNote,
  updateStudyNoteDocument,
  updateStudyNoteSummary,
} from '@/actions/study-notes'

const OWNER = 'user-owner'
const input = { title: 'Working capital review', body: 'Current assets minus current liabilities.\nRevisit cash conversion.' }
const storedAnalysis = {
  summaryLines: [{ id: 'line-1', text: 'Working capital is current assets minus current liabilities.', kind: 'definition' as const, highlighted: false, comment: '' }],
  keyTerms: ['working capital'],
  followUps: ['Review the cash conversion cycle.'],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
})

describe('study note persistence', () => {
  it('requires authentication for reads and writes', async () => {
    h.auth.mockResolvedValue(null)

    expect((await listStudyNotes()).success).toBe(false)
    expect((await getStudyNote('note-1')).success).toBe(false)
    expect((await createStudyNote(input)).success).toBe(false)
    expect((await updateStudyNote('note-1', input)).success).toBe(false)
    expect((await deleteStudyNote('note-1')).success).toBe(false)
    expect(h.noteFindMany).not.toHaveBeenCalled()
    expect(h.noteCreate).not.toHaveBeenCalled()
  })

  it('creates notes under the authenticated user', async () => {
    h.noteCreate.mockResolvedValue({ id: 'note-1' })

    const result = await createStudyNote(input)

    expect(result).toEqual({ success: true, data: { id: 'note-1' } })
    expect(h.noteCreate).toHaveBeenCalledWith({ data: { userId: OWNER, ...input, originalBody: input.body } })
  })

  it('scopes reads, edits, and deletes to the authenticated user', async () => {
    h.noteFindMany.mockResolvedValue([])
    h.noteFindFirst.mockResolvedValue(null)
    h.noteUpdateMany.mockResolvedValue({ count: 0 })
    h.noteDeleteMany.mockResolvedValue({ count: 0 })

    await listStudyNotes()
    const detail = await getStudyNote('note-other')
    const updated = await updateStudyNote('note-other', input)
    const deleted = await deleteStudyNote('note-other')

    expect(detail.success).toBe(false)
    expect(updated.success).toBe(false)
    expect(deleted.success).toBe(false)
    expect(h.noteFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: OWNER } }))
    expect(h.noteFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'note-other', userId: OWNER } }))
    expect(h.noteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'note-other', userId: OWNER } }))
    expect(h.noteDeleteMany).toHaveBeenCalledWith({ where: { id: 'note-other', userId: OWNER } })
  })

  it('clears stale analysis when note content is edited', async () => {
    h.noteUpdateMany.mockResolvedValue({ count: 1 })

    const result = await updateStudyNote('note-1', input)

    expect(result).toEqual({ success: true, data: { id: 'note-1' } })
    expect(h.noteUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ analysis: expect.anything(), analyzedAt: null }),
    }))
  })
})

describe('study note AI analysis', () => {
  it('routes analysis through the dedicated task and stores editable lines', async () => {
    h.noteFindFirst.mockResolvedValue({ id: 'note-1', title: input.title, body: input.body })
    h.generateJson.mockResolvedValue({
      summaryLines: [{ text: 'Working capital is the difference between current assets and current liabilities.', sourceLine: 0, kind: 'definition' }],
      keyTerms: ['working capital'],
      followUps: ['Review the cash conversion cycle.'],
    })
    h.noteUpdate.mockResolvedValue({})

    const result = await analyzeStudyNote('note-1')

    expect(result.success).toBe(true)
    expect(h.generateJson).toHaveBeenCalledWith(expect.objectContaining({
      userId: OWNER,
      task: 'note-analysis',
      prompt: expect.stringContaining(input.body),
    }))
    expect(h.noteUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'note-1' },
      data: expect.objectContaining({
        analysis: expect.objectContaining({
          summaryLines: [expect.objectContaining({ id: 'line-1', highlighted: false, comment: '' })],
        }),
      }),
    }))
  })

  it('returns the structured no-credential error', async () => {
    h.noteFindFirst.mockResolvedValue({ id: 'note-1', title: input.title, body: input.body })
    h.generateJson.mockRejectedValue(new h.AiGenerationError({ title: 'No AI provider configured', why: 'Add a credential in AI settings.' }))

    const result = await analyzeStudyNote('note-1')

    expect(result).toEqual({
      success: false,
      error: 'No AI provider configured',
      detail: { title: 'No AI provider configured', why: 'Add a credential in AI settings.' },
    })
  })

  it('preserves extracted metadata while saving line highlights and comments', async () => {
    h.noteFindFirst.mockResolvedValue({ analysis: storedAnalysis })
    h.noteUpdate.mockResolvedValue({})
    const lines = [{ ...storedAnalysis.summaryLines[0], highlighted: true, comment: 'Connect this to the cash conversion cycle.' }]

    const result = await updateStudyNoteSummary('note-1', lines)

    expect(result).toEqual({ success: true, data: { saved: true } })
    expect(h.noteFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'note-1', userId: OWNER } }))
    expect(h.noteUpdate).toHaveBeenCalledWith({
      where: { id: 'note-1' },
      data: { analysis: { ...storedAnalysis, summaryLines: lines, suggestions: [], annotations: [] } },
    })
  })

  it('saves inline source edits and annotations without changing the analysis contract', async () => {
    h.noteFindFirst.mockResolvedValue({ analysis: storedAnalysis })
    h.noteUpdate.mockResolvedValue({})
    const summaryLines = [{ ...storedAnalysis.summaryLines[0], text: 'Updated definition.' }]

    const result = await updateStudyNoteDocument('note-1', {
      body: 'Updated source line.\nRevisit cash conversion.',
      summaryLines,
      annotations: [{ lineId: 'source-0', highlighted: true, comment: 'Check this against the balance sheet.' }],
    })

    expect(result).toEqual({ success: true, data: { saved: true } })
    expect(h.noteFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'note-1', userId: OWNER } }))
    expect(h.noteUpdate).toHaveBeenCalledWith({
      where: { id: 'note-1' },
      data: {
        body: 'Updated source line.\nRevisit cash conversion.',
        analysis: {
          ...storedAnalysis,
          suggestions: [],
          annotations: [{ lineId: 'source-0', highlighted: true, comment: 'Check this against the balance sheet.' }],
          summaryLines,
        },
      },
    })
  })
})
