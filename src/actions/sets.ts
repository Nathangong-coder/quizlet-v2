'use server'

import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ActionResult } from '@/types/action'

import { ContentBlock } from '@/lib/cards/content';

const CardInputSchema = z.object({
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  termBlocks: z.array(z.any()).optional(),
  definitionBlocks: z.array(z.any()).optional(),
  position: z.number().int().min(0),
})

const SetInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  cards: z.array(CardInputSchema).min(1, 'At least one card is required'),
})

type SetInput = z.infer<typeof SetInputSchema>

function isRedirectError(error: any): boolean {
  return error && (error as any).digest?.includes('NEXT_REDIRECT')
}

export async function createSet(input: SetInput): Promise<ActionResult<{ setId: string }>> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    const validated = SetInputSchema.parse(input)

    const set = await prisma.set.create({
      data: {
        title: validated.title,
        description: validated.description,
        userId: session.user.id,
        cards: {
          create: validated.cards.map(card => ({
            term: card.term,
            definition: card.definition,
            position: card.position,
            contentBlocks: {
              create: [
                ...(card.termBlocks || []).map((b, i) => ({ ...b, side: 'term', position: i })),
                ...(card.definitionBlocks || []).map((b, i) => ({ ...b, side: 'definition', position: i })),
              ]
            }
          })),
        },
      },
    })

    revalidatePath('/sets')
    return { success: true, data: { setId: set.id } }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0].message }
    }
    return { success: false, error: (error as Error).message }
  }
}

export async function updateSet(id: string, input: SetInput): Promise<ActionResult<{ setId: string }>> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    const validated = SetInputSchema.parse(input)

    const set = await prisma.set.findUnique({
      where: { id },
    })

    if (!set) {
      return { success: false, error: 'Set not found' }
    }

    if (set.userId !== session.user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    await prisma.$transaction([
      prisma.card.deleteMany({
        where: { setId: id },
      }),
      prisma.set.update({
        where: { id },
        data: {
          title: validated.title,
          description: validated.description,
          cards: {
            create: validated.cards.map(card => ({
              term: card.term,
              definition: card.definition,
              position: card.position,
              contentBlocks: {
                create: [
                  ...(card.termBlocks || []).map((b, i) => ({ ...b, side: 'term', position: i })),
                  ...(card.definitionBlocks || []).map((b, i) => ({ ...b, side: 'definition', position: i })),
                ]
              }
            })),
          },
        },
      }),
    ])

    revalidatePath('/sets')
    revalidatePath(`/sets/${id}`)
    return { success: true, data: { setId: id } }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { success: false, error: error.issues[0].message }
    }
    return { success: false, error: (error as Error).message }
  }
}

export async function deleteSet(id: string): Promise<ActionResult<void>> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    const set = await prisma.set.findUnique({
      where: { id },
    })

    if (!set) {
      return { success: false, error: 'Set not found' }
    }

    if (set.userId !== session.user.id) {
      return { success: false, error: 'Unauthorized' }
    }

    await prisma.set.delete({
      where: { id },
    })

    revalidatePath('/sets')
    redirect('/sets')
    return { success: true, data: undefined }
  } catch (error) {
    if (isRedirectError(error)) {
      throw error
    }
    return { success: false, error: (error as Error).message }
  }
}
