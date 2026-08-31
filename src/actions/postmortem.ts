'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { POSTMORTEM_FORMATS } from '@/lib/postmortem/kinds'
import type { ActionResult } from '@/types/action'

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

const OptionalNumber = (min: number, max: number) =>
  z.preprocess(
    (value) => {
      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        return undefined
      }
      return value
    },
    z.coerce.number().int().min(min).max(max).optional(),
  )

const PostmortemInputSchema = z.object({
  title: z.string().trim().min(1, 'Give this session a name').max(160),
  format: z.enum(POSTMORTEM_FORMATS),
  occurredAt: z.string().refine(isDateOnly, 'Choose a valid date'),
  setId: z.string().trim().max(80).optional(),
  durationMin: OptionalNumber(1, 1440),
  confidence: OptionalNumber(1, 5),
  whatCameUp: z.string().trim().min(1, 'Capture at least what came up').max(12000),
  wins: z.string().trim().max(12000).optional(),
  gaps: z.string().trim().max(12000).optional(),
  nextSteps: z.string().trim().max(12000).optional(),
})

type PostmortemInput = z.input<typeof PostmortemInputSchema>

function cleanOptional(value: string | undefined): string | null {
  const cleaned = value?.trim()
  return cleaned ? cleaned : null
}

function toDate(value: string): Date {
  // Noon UTC keeps a date-only value on the same calendar day in the app's
  // supported western time zones when it is rendered with date-fns.
  return new Date(`${value}T12:00:00.000Z`)
}

async function resolveSet(userId: string, setId: string | undefined) {
  const cleanedId = cleanOptional(setId)
  if (!cleanedId) return { id: null, title: null }

  const set = await prisma.set.findFirst({
    where: { id: cleanedId, ...readableSetWhere(userId) },
    select: { id: true, title: true },
  })
  return set ? { id: set.id, title: set.title } : null
}

function invalidInput(error: z.ZodError) {
  return { success: false as const, error: error.issues[0]?.message ?? 'Please check the form' }
}

export interface PostmortemListRow {
  id: string
  title: string
  format: string
  occurredAt: Date
  durationMin: number | null
  confidence: number | null
  setId: string | null
  setTitle: string | null
  whatCameUp: string
  gaps: string | null
  nextSteps: string | null
}

export interface PostmortemDetail extends PostmortemListRow {
  wins: string | null
  createdAt: Date
  updatedAt: Date
}

export async function listPostmortems(): Promise<ActionResult<PostmortemListRow[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const rows = await prisma.postmortemSession.findMany({
      where: { userId: session.user.id },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      select: {
        id: true,
        title: true,
        format: true,
        occurredAt: true,
        durationMin: true,
        confidence: true,
        setId: true,
        setTitleSnapshot: true,
        whatCameUp: true,
        gaps: true,
        nextSteps: true,
      },
    })

    return {
      success: true,
      data: rows.map((row) => ({ ...row, setTitle: row.setTitleSnapshot })),
    }
  } catch (error) {
    console.error('listPostmortems error:', error)
    return { success: false, error: 'Failed to load postmortems' }
  }
}

export async function getPostmortem(id: string): Promise<ActionResult<PostmortemDetail>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const row = await prisma.postmortemSession.findFirst({
      where: { id, userId: session.user.id },
      select: {
        id: true,
        title: true,
        format: true,
        occurredAt: true,
        durationMin: true,
        confidence: true,
        setId: true,
        setTitleSnapshot: true,
        whatCameUp: true,
        wins: true,
        gaps: true,
        nextSteps: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!row) return { success: false, error: 'Postmortem not found' }

    return { success: true, data: { ...row, setTitle: row.setTitleSnapshot } }
  } catch (error) {
    console.error('getPostmortem error:', error)
    return { success: false, error: 'Failed to load postmortem' }
  }
}

export async function getPostmortemSetOptions(): Promise<ActionResult<Array<{ id: string; title: string }>>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const sets = await prisma.set.findMany({
      where: readableSetWhere(session.user.id),
      orderBy: { title: 'asc' },
      take: 200,
      select: { id: true, title: true },
    })
    return { success: true, data: sets }
  } catch (error) {
    console.error('getPostmortemSetOptions error:', error)
    return { success: false, error: 'Failed to load study sets' }
  }
}

export async function createPostmortem(input: PostmortemInput): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsed = PostmortemInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const linkedSet = await resolveSet(session.user.id, parsed.data.setId)
    if (linkedSet === null) return { success: false, error: 'That study set is not available' }

    const created = await prisma.postmortemSession.create({
      data: {
        userId: session.user.id,
        setId: linkedSet.id,
        setTitleSnapshot: linkedSet.title,
        title: parsed.data.title,
        format: parsed.data.format,
        occurredAt: toDate(parsed.data.occurredAt),
        durationMin: parsed.data.durationMin ?? null,
        confidence: parsed.data.confidence ?? null,
        whatCameUp: parsed.data.whatCameUp,
        wins: cleanOptional(parsed.data.wins),
        gaps: cleanOptional(parsed.data.gaps),
        nextSteps: cleanOptional(parsed.data.nextSteps),
      },
    })

    revalidatePath('/postmortem')
    revalidatePath('/folders')
    revalidatePath('/', 'layout')
    return { success: true, data: { id: created.id } }
  } catch (error) {
    console.error('createPostmortem error:', error)
    return { success: false, error: 'Failed to save postmortem' }
  }
}

export async function updatePostmortem(
  id: string,
  input: PostmortemInput,
): Promise<ActionResult<{ id: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsed = PostmortemInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const existing = await prisma.postmortemSession.findFirst({ where: { id, userId: session.user.id } })
    if (!existing) return { success: false, error: 'Postmortem not found' }

    const linkedSet = await resolveSet(session.user.id, parsed.data.setId)
    if (linkedSet === null) return { success: false, error: 'That study set is not available' }

    await prisma.postmortemSession.update({
      where: { id: existing.id },
      data: {
        setId: linkedSet.id,
        setTitleSnapshot: linkedSet.title,
        title: parsed.data.title,
        format: parsed.data.format,
        occurredAt: toDate(parsed.data.occurredAt),
        durationMin: parsed.data.durationMin ?? null,
        confidence: parsed.data.confidence ?? null,
        whatCameUp: parsed.data.whatCameUp,
        wins: cleanOptional(parsed.data.wins),
        gaps: cleanOptional(parsed.data.gaps),
        nextSteps: cleanOptional(parsed.data.nextSteps),
      },
    })

    revalidatePath('/postmortem')
    revalidatePath(`/postmortem/${id}`)
    revalidatePath('/folders')
    revalidatePath('/', 'layout')
    return { success: true, data: { id } }
  } catch (error) {
    console.error('updatePostmortem error:', error)
    return { success: false, error: 'Failed to update postmortem' }
  }
}

export async function deletePostmortem(id: string): Promise<ActionResult<{ deleted: true }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const deleted = await prisma.postmortemSession.deleteMany({ where: { id, userId: session.user.id } })
    if (deleted.count === 0) return { success: false, error: 'Postmortem not found' }
    revalidatePath('/postmortem')
    revalidatePath('/folders')
    revalidatePath('/', 'layout')
    return { success: true, data: { deleted: true } }
  } catch (error) {
    console.error('deletePostmortem error:', error)
    return { success: false, error: 'Failed to delete postmortem' }
  }
}
