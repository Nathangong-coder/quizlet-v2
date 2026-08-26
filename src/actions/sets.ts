'use server'

import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { after } from 'next/server'
import { ActionResult } from '@/types/action'

import { ContentBlock } from '@/lib/cards/content';
import { collectSetCategories, normalizeCategoryName } from '@/lib/cards/categories'
import { reconcileCards } from '@/lib/cards/reconcile'
import { extractKlpsForCards } from '@/actions/klp'
import { summarizeKltsForCards } from '@/lib/klt/summarize'
import { placeUnparentedConcepts } from '@/lib/klt/place'
import { selectRefreshableStaleCardIds } from '@/lib/cards/stale'
import { rescoreSetAttempts } from '@/lib/quiz/rescore'
import type { CardKlpStatus } from '@/lib/cards/klp-status'
import { toSetVisibility, type SetVisibility } from '@/lib/sets/visibility'

const CardInputSchema = z.object({
  // Present when the editor is round-tripping an existing card. Absent for
  // newly added cards. Ownership is re-checked server-side in updateSet.
  id: z.string().optional(),
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  termBlocks: z.array(z.any()).optional(),
  definitionBlocks: z.array(z.any()).optional(),
  categoryNames: z.array(z.string().min(1).max(60)).optional(),
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
 * Update payload for an existing card. Content blocks and category
 * assignments are replaced wholesale (they have no independent identity worth
 * preserving), but the CARD ROW SURVIVES — which is the entire point: its id
 * is what CardProgress, StudyEvent and QuizAnswer hang off.
 */
function buildCardUpdate(
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
    contentBlocks: { deleteMany: {}, create: buildContentBlockCreate(card) },
    categoryAssignments: {
      deleteMany: {},
      create: categoryIds.map((categoryId) => ({ categoryId })),
    },
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
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
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

    // Post-response so the user is never blocked on extraction. Every failure
    // is recorded on the card by extractKlpsForCards, which never throws.
    // The findMany itself CAN throw (e.g. a DB blip) — guarded so that alone
    // can't turn an already-successful set creation into an error response;
    // any cards missed here stay klpStatus: 'pending' and are picked up by
    // ensureKlpsReady's self-healing extraction on first use.
    try {
      const created = await prisma.card.findMany({
        where: { setId: set.id },
        select: { id: true },
      })
      // Chained, not parallel: summarization reads the KLPs extraction just
      // wrote, so racing them would summarize an empty set.
      after(async () => {
        const ids = created.map((c) => c.id)
        await extractKlpsForCards(session.user.id, ids)
        await summarizeKltsForCards(session.user.id, ids)
        // Third and last: hang the new concepts in the tree. Without this a
        // concept is created but never parented, so it reports mastery only as
        // an isolated node and never rolls up into a subject — the tree would
        // freeze at whatever the last manual backfill produced.
        //
        // Cheap when there is nothing to do: it early-returns after ONE query
        // when no concept is unparented, so an ordinary edit costs no AI call.
        await placeUnparentedConcepts(session.user.id)
      })
    } catch (klpErr) {
      // Nothing more to do — see comment above — but log so an operator can
      // see extraction was never even scheduled for this set.
      console.error('KLP extraction scheduling failed for createSet:', klpErr)
    }

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

    // Cards are reconciled by identity, never replaced. Deleting and
    // recreating them cascades away CardProgress, StudyEvent,
    // ConfidenceEvent, QuizAnswer and QuizOptionCache — i.e. the set's whole
    // learning history — which is exactly what used to happen on every save.
    // Named `existingCards`, not `existing` — `updateSet` already has a local
    // `existing` holding the Set row (line 196).
    const existingCards = await prisma.card.findMany({
      where: { setId: id },
      select: { id: true },
    })
    const plan = reconcileCards(
      existingCards.map((c) => c.id),
      validated.cards,
    )

    // INTERACTIVE form, not the array form this used to be. The array form
    // takes pre-built promises and so cannot express "read after the delete
    // lands" — which is exactly what the re-score below has to do. The order is
    // otherwise unchanged: deleteMany -> updates -> creates -> set.update, each
    // awaited in sequence.
    await prisma.$transaction(async (tx) => {
      if (plan.toDeleteIds.length > 0) {
        await tx.card.deleteMany({ where: { setId: id, id: { in: plan.toDeleteIds } } })
      }
      for (const { id: cardId, card } of plan.toUpdate) {
        await tx.card.update({ where: { id: cardId }, data: buildCardUpdate(card, map) })
      }
      for (const card of plan.toCreate) {
        await tx.card.create({ data: { setId: id, ...buildCardCreate(card, map) } })
      }
      await tx.set.update({
        where: { id },
        data: { title: validated.title, description: validated.description },
      })
      // A card delete cascades away its QuizAnswer rows, leaving every attempt
      // that tested it holding a score derived from evidence that no longer
      // exists — including attempts belonging to OTHER users, since sets are
      // link-shareable. Only on a delete: nothing else here can change what an
      // attempt's surviving answers are worth. See rescoreSetAttempts' comment
      // for why it carries no userId filter.
      if (plan.toDeleteIds.length > 0) {
        await rescoreSetAttempts(tx, id)
      }
    })

    await backfillAssetLinks(id, session.user.id, validated.cards)

    // Only cards whose meaning actually changed get re-extracted. Re-running
    // the whole set on every save would burn a batch of AI calls and supersede
    // perfectly good KLPs each time a title is corrected.
    //
    // Deliberately NOT wrapped in a try/catch like createSet's equivalent
    // block: an edited card already has klpStatus: 'ready' and live,
    // un-superseded CardKlp rows from its prior extraction, so there is no
    // self-healing path if this findMany silently fails to run — the card
    // would be graded against stale, pre-edit KLPs indefinitely (see
    // klpSourceHash's doc comment in ./klp-hash on this exact failure mode).
    // Letting the error propagate to the outer catch surfaces it to the user
    // and makes the failure retryable instead of silent.
    const saved = await prisma.card.findMany({
      where: { setId: id },
      include: { contentBlocks: true },
    })
    // `selectRefreshableStaleCardIds`, not `selectStaleCardIds`: on the EDIT
    // path a null stored hash means never-extracted (every card predating the
    // KLP feature), not stale. Treating those as stale made the first
    // one-word edit to a legacy set queue extraction for the whole set.
    // ensureKlpsReady picks them up on demand instead.
    const stale = selectRefreshableStaleCardIds(saved)

    // Mark the genuinely-stale cards 'pending' before the response goes out,
    // so the stored state is honest the moment the edit commits: their live
    // CardKlp rows now describe pre-edit content. Without this, a dropped or
    // failed `after()` callback left the card sitting at 'ready' with stale
    // KLPs and nothing to signal otherwise.
    if (stale.length > 0) {
      await prisma.card.updateMany({
        where: { setId: id, id: { in: stale } },
        // kltStatus too: the live labels and topics describe pre-edit
        // propositions just as the KLPs do, and leaving them 'ready' is the
        // same dishonesty this write exists to prevent.
        data: {
          klpStatus: 'pending' satisfies CardKlpStatus,
          kltStatus: 'pending' satisfies CardKlpStatus,
        },
      })
    }

    after(async () => {
      await extractKlpsForCards(session.user.id, stale)
      await summarizeKltsForCards(session.user.id, stale)
      await placeUnparentedConcepts(session.user.id)
    })

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

/**
 * Change who can read a set. OWNER ONLY.
 *
 * Visibility governs who may READ a set; changing it is a write, so it is
 * gated on ownership rather than on readability. `updateMany` with the owner
 * in the `where` rather than findUnique-then-check, for the same reason
 * `readableSetWhere` exists: a check embedded in the query cannot be forgotten,
 * and a mismatch updates zero rows instead of silently succeeding.
 */
export async function setSetVisibility(
  setId: string,
  visibility: string,
): Promise<ActionResult<{ visibility: SetVisibility }>> {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    // Reject rather than coerce. `toSetVisibility` fails CLOSED, so silently
    // accepting an unrecognised value would make the set private while the UI
    // showed whatever the user clicked — the failure mode is invisible.
    const parsed = toSetVisibility(visibility)
    if (parsed !== visibility) {
      return { success: false, error: 'Unrecognised visibility setting' }
    }

    const updated = await prisma.set.updateMany({
      where: { id: setId, userId: session.user.id },
      data: { visibility: parsed },
    })
    // Not-found rather than unauthorized: the same reason every read path
    // 404s. A distinguishable error confirms the set exists.
    if (updated.count === 0) return { success: false, error: 'Set not found' }

    revalidatePath(`/sets/${setId}`)
    revalidatePath('/sets')
    return { success: true, data: { visibility: parsed } }
  } catch (error) {
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
