'use server'

import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ActionResult } from '@/types/action'

import { ContentBlock } from '@/lib/cards/content';
import { collectSetCategories, normalizeCategoryName } from '@/lib/cards/categories'

const CardInputSchema = z.object({
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  termBlocks: z.array(z.any()).optional(),
  definitionBlocks: z.array(z.any()).optional(),
  categoryNames: z.array(z.string()).optional(),
  position: z.number().int().min(0),
})

/**
 * Sanitize a client-side content block into the shape the database expects.
 * The client attaches a temporary `id` (e.g. "1751688-0.23") for React keys —
 * we must NOT write that as the DB primary key, so we strip it and let Prisma
 * generate a real cuid. Only known columns are passed through.
 */
function sanitizeBlock(
  block: any,
  side: 'term' | 'definition',
  position: number,
) {
  return {
    side,
    type: typeof block?.type === 'string' ? block.type : 'text',
    text: block?.text ?? null,
    assetId: block?.assetId ?? null,
    position,
  }
}

function buildContentBlockCreate(card: z.infer<typeof CardInputSchema>) {
  return [
    ...(card.termBlocks || []).map((b, i) => sanitizeBlock(b, 'term', i)),
    ...(card.definitionBlocks || []).map((b, i) => sanitizeBlock(b, 'definition', i)),
  ]
}

function buildCardCreate(
  card: z.infer<typeof CardInputSchema>,
  categoryIdByNormalized: Record<string, string>,
) {
  const categoryIds = Array.from(
    new Set(
      (card.categoryNames ?? [])
        .map((n) => categoryIdByNormalized[normalizeCategoryName(n)])
        .filter((id): id is string => Boolean(id)),
    ),
  )
  return {
    term: card.term,
    definition: card.definition,
    position: card.position,
    contentBlocks: { create: buildContentBlockCreate(card) },
    categoryAssignments: { create: categoryIds.map((categoryId) => ({ categoryId })) },
  }
}

/**
 * Collect every assetId referenced by a set's cards so we can backfill the
 * owning set (and card) onto assets that were uploaded before the set existed.
 */
function collectAssetIds(cards: z.infer<typeof CardInputSchema>[]): string[] {
  const ids = new Set<string>()
  for (const card of cards) {
    for (const b of [...(card.termBlocks || []), ...(card.definitionBlocks || [])]) {
      if (b?.assetId) ids.add(b.assetId as string)
    }
  }
  return Array.from(ids)
}

/**
 * Link assets referenced by a set's content blocks back to the set (and card).
 * Assets uploaded during the "create new set" flow are stored with a null
 * setId because the set does not exist yet; this connects them once it does.
 * Owner-guarded so a user can only ever link their own assets.
 */
async function backfillAssetLinks(
  setId: string,
  userId: string,
  cards: z.infer<typeof CardInputSchema>[],
) {
  const assetIds = collectAssetIds(cards)
  if (assetIds.length === 0) return

  // Attach the owning set to every referenced asset (one query).
  await prisma.cardAsset.updateMany({
    where: { id: { in: assetIds }, userId },
    data: { setId },
  })

  // Backfill cardId by reading which card each asset's block ended up on.
  const blocks = await prisma.cardContentBlock.findMany({
    where: { card: { setId }, assetId: { in: assetIds } },
    select: { assetId: true, cardId: true },
  })
  await Promise.all(
    blocks
      .filter((b) => b.assetId)
      .map((b) =>
        prisma.cardAsset.updateMany({
          where: { id: b.assetId as string, userId },
          data: { cardId: b.cardId },
        }),
      ),
  )
}

const SetInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  cards: z.array(CardInputSchema).min(1, 'At least one card is required'),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        color: z.string().max(32).nullable().optional(),
      }),
    )
    .optional(),
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
    const collected = collectSetCategories(validated.cards, validated.categories ?? [])

    // Create the set + its categories first so we can map names -> ids.
    const set = await prisma.set.create({
      data: {
        title: validated.title,
        description: validated.description,
        userId: session.user.id,
        categories: {
          create: collected.map((c) => ({
            name: c.name,
            normalizedName: c.normalizedName,
            color: c.color,
          })),
        },
      },
      include: { categories: true },
    })

    const map = Object.fromEntries(set.categories.map((c) => [c.normalizedName, c.id]))

    await prisma.$transaction(
      validated.cards.map((card) =>
        prisma.card.create({ data: { setId: set.id, ...buildCardCreate(card, map) } }),
      ),
    )

    await backfillAssetLinks(set.id, session.user.id, validated.cards)

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

    const existing = await prisma.set.findUnique({ where: { id } })
    if (!existing) return { success: false, error: 'Set not found' }
    if (existing.userId !== session.user.id) return { success: false, error: 'Unauthorized' }

    const collected = collectSetCategories(validated.cards, validated.categories ?? [])

    // Reconcile the set's categories: drop removed ones (cascades assignments),
    // upsert the rest so surviving category ids stay stable across edits.
    await prisma.$transaction([
      prisma.cardCategory.deleteMany({
        where: { setId: id, normalizedName: { notIn: collected.map((c) => c.normalizedName) } },
      }),
      ...collected.map((c) =>
        prisma.cardCategory.upsert({
          where: { setId_normalizedName: { setId: id, normalizedName: c.normalizedName } },
          create: { setId: id, name: c.name, normalizedName: c.normalizedName, color: c.color },
          update: { name: c.name, color: c.color },
        }),
      ),
    ])

    const cats = await prisma.cardCategory.findMany({ where: { setId: id } })
    const map = Object.fromEntries(cats.map((c) => [c.normalizedName, c.id]))

    // Cards are fully replaced (existing behavior); assignments are recreated
    // against the reconciled categories using the new card ids.
    await prisma.$transaction([
      prisma.card.deleteMany({ where: { setId: id } }),
      ...validated.cards.map((card) =>
        prisma.card.create({ data: { setId: id, ...buildCardCreate(card, map) } }),
      ),
      prisma.set.update({
        where: { id },
        data: { title: validated.title, description: validated.description },
      }),
    ])

    await backfillAssetLinks(id, session.user.id, validated.cards)

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
