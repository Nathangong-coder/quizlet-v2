'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { generateJson, AiGenerationError } from '@/lib/ai/generate'
import {
  StudyNoteAnalysisSchema,
  StudyNoteStoredAnalysisSchema,
  StudyNoteStoredLineSchema,
  type StudyNoteStoredAnalysis,
} from '@/lib/ai/schemas'
import { STUDY_NOTE_ANALYSIS_PROMPT } from '@/lib/ai/prompts/study-note'
import type { ActionResult } from '@/types/action'

const NoteInputSchema = z.object({
  title: z.string().trim().min(1, 'Give this note a title').max(160),
  body: z.string().trim().min(1, 'Write something in the note first').max(50000),
})

const SummaryLinesSchema = z.array(StudyNoteStoredLineSchema).max(24)
type NoteInput = z.input<typeof NoteInputSchema>

export interface StudyNoteRow {
  id: string
  title: string
  body: string
  analysis: StudyNoteStoredAnalysis | null
  analyzedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

function parseAnalysis(value: unknown): StudyNoteStoredAnalysis | null {
  const parsed = StudyNoteStoredAnalysisSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

function invalidInput(error: z.ZodError) {
  return { success: false as const, error: error.issues[0]?.message ?? 'Please check the form' }
}

function normalizeAnalysis(value: z.infer<typeof StudyNoteAnalysisSchema>): StudyNoteStoredAnalysis {
  return {
    summaryLines: value.summaryLines.map((line, index) => ({
      id: `line-${index + 1}`,
      text: line.text,
      sourceLine: line.sourceLine,
      kind: line.kind,
      highlighted: false,
      comment: '',
    })),
    keyTerms: value.keyTerms,
    followUps: value.followUps,
  }
}

function toRow(row: {
  id: string
  title: string
  body: string
  analysis: unknown
  analyzedAt: Date | null
  createdAt: Date
  updatedAt: Date
}): StudyNoteRow {
  return { ...row, analysis: parseAnalysis(row.analysis) }
}

const noteSelect = {
  id: true,
  title: true,
  body: true,
  analysis: true,
  analyzedAt: true,
  createdAt: true,
  updatedAt: true,
} as const

export async function listStudyNotes(): Promise<ActionResult<StudyNoteRow[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const rows = await prisma.studyNote.findMany({
      where: { userId: session.user.id },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      select: noteSelect,
    })
    return { success: true, data: rows.map(toRow) }
  } catch (error) {
    console.error('listStudyNotes error:', error)
    return { success: false, error: 'Failed to load study notes' }
  }
}

export async function getStudyNote(id: string): Promise<ActionResult<StudyNoteRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const row = await prisma.studyNote.findFirst({ where: { id, userId: session.user.id }, select: noteSelect })
    if (!row) return { success: false, error: 'Study note not found' }
    return { success: true, data: toRow(row) }
  } catch (error) {
    console.error('getStudyNote error:', error)
    return { success: false, error: 'Failed to load study note' }
  }
}

export async function createStudyNote(input: NoteInput): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = NoteInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const created = await prisma.studyNote.create({
      data: { userId: session.user.id, title: parsed.data.title, body: parsed.data.body },
    })
    revalidatePath('/notes')
    revalidatePath('/folders')
    return { success: true, data: { id: created.id } }
  } catch (error) {
    console.error('createStudyNote error:', error)
    return { success: false, error: 'Failed to save study note' }
  }
}

export async function updateStudyNote(id: string, input: NoteInput): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }
  const parsed = NoteInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const updated = await prisma.studyNote.updateMany({
      where: { id, userId: session.user.id },
      // Any body edit invalidates the old analysis. The user sees this as a
      // clear invitation to run analysis again rather than stale advice.
      data: { title: parsed.data.title, body: parsed.data.body, analysis: Prisma.DbNull, analyzedAt: null },
    })
    if (updated.count === 0) return { success: false, error: 'Study note not found' }
    revalidatePath('/notes')
    revalidatePath(`/notes/${id}`)
    revalidatePath('/folders')
    return { success: true, data: { id } }
  } catch (error) {
    console.error('updateStudyNote error:', error)
    return { success: false, error: 'Failed to update study note' }
  }
}

export async function deleteStudyNote(id: string): Promise<ActionResult<{ deleted: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const deleted = await prisma.studyNote.deleteMany({ where: { id, userId: session.user.id } })
    if (deleted.count === 0) return { success: false, error: 'Study note not found' }
    revalidatePath('/notes')
    revalidatePath('/folders')
    return { success: true, data: { deleted: true } }
  } catch (error) {
    console.error('deleteStudyNote error:', error)
    return { success: false, error: 'Failed to delete study note' }
  }
}

export async function analyzeStudyNote(id: string): Promise<ActionResult<{ analyzedAt: Date }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const note = await prisma.studyNote.findFirst({
      where: { id, userId: session.user.id },
      select: { id: true, title: true, body: true },
    })
    if (!note) return { success: false, error: 'Study note not found' }

    const output = await generateJson({
      userId: session.user.id,
      task: 'note-analysis',
      prompt: STUDY_NOTE_ANALYSIS_PROMPT.build({ title: note.title, body: note.body }),
      schema: STUDY_NOTE_ANALYSIS_PROMPT.schema,
    })
    const analysis = normalizeAnalysis(StudyNoteAnalysisSchema.parse(output))
    const analyzedAt = new Date()

    await prisma.studyNote.update({ where: { id: note.id }, data: { analysis, analyzedAt } })
    revalidatePath('/notes')
    revalidatePath(`/notes/${id}`)
    revalidatePath('/folders')
    return { success: true, data: { analyzedAt } }
  } catch (error) {
    if (error instanceof AiGenerationError) {
      return { success: false, error: error.detail.title, detail: error.detail }
    }
    console.error('analyzeStudyNote error:', error)
    return { success: false, error: 'Failed to analyze study note' }
  }
}

export async function updateStudyNoteSummary(
  id: string,
  summaryLines: z.input<typeof SummaryLinesSchema>,
): Promise<ActionResult<{ saved: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsedLines = SummaryLinesSchema.safeParse(summaryLines)
  if (!parsedLines.success) return invalidInput(parsedLines.error)

  try {
    const note = await prisma.studyNote.findFirst({
      where: { id, userId: session.user.id },
      select: { analysis: true },
    })
    if (!note) return { success: false, error: 'Study note not found' }
    const analysis = parseAnalysis(note.analysis)
    if (!analysis) return { success: false, error: 'Analyze this note before editing its summary' }

    await prisma.studyNote.update({
      where: { id },
      data: { analysis: { ...analysis, summaryLines: parsedLines.data } },
    })
    revalidatePath('/notes')
    revalidatePath(`/notes/${id}`)
    revalidatePath('/folders')
    return { success: true, data: { saved: true } }
  } catch (error) {
    console.error('updateStudyNoteSummary error:', error)
    return { success: false, error: 'Failed to save summary edits' }
  }
}
