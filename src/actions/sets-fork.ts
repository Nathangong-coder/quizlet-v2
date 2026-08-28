'use server'

import { randomUUID } from 'node:crypto'
import { copy, del } from '@vercel/blob'
import { revalidatePath } from 'next/cache'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { checkForkSize, describeForkRefusal } from '@/lib/sets/fork'
import type { ActionResult } from '@/types/action'

/**
 * Copy any set this viewer may READ into a set they own outright.
 *
 * Fork is a READ of the source and a WRITE to a new set. It needs no write
 * access to the source and must never be given any — `readableSetWhere` is
 * therefore the only guard it has, and the only one it needs.
 *
 * The copy is the forker's outright (design §3): they edit it freely and
 * control its visibility like any set of theirs. Attribution is CARRIED, not
 * enforced.
 */
export async function forkSet(setId: string): Promise<ActionResult<{ setId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Authentication required' }
  const viewerId = session.user.id

  const source = await prisma.set.findFirst({
    where: { id: setId, ...readableSetWhere(viewerId) },
    include: {
      user: { select: { handle: true } },
      categories: true,
      kltNodes: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: { select: { categoryId: true } },
        },
      },
    },
  })
  // Not-found rather than forbidden, like every other read path in this app: a
  // distinguishable error confirms to a stranger that a set id is real.
  if (!source) return { success: false, error: 'Set not found' }

  // Every asset actually REACHABLE from a content block — deliberately not
  // `CardAsset.setId`, which records where an asset was UPLOADED rather than
  // where it is USED. `/api/assets/[id]` makes the same distinction for the
  // same reason.
  //
  // The dedupe is LOAD-BEARING, not tidiness. Several blocks may legitimately
  // reference one asset (duplicating a card in the editor does exactly that),
  // and counting per-block would read a 20 MB video reused on six cards as
  // 120 MB and refuse a fork that actually costs 20 MB.
  const assetIds = [
    ...new Set(
      source.cards.flatMap((c) =>
        c.contentBlocks.map((b) => b.assetId).filter((a): a is string => a !== null),
      ),
    ),
  ]
  const assets = assetIds.length
    ? await prisma.cardAsset.findMany({ where: { id: { in: assetIds } } })
    : []

  // BEFORE any copy, so a refusal costs nothing.
  const size = checkForkSize({
    cardCount: source.cards.length,
    assetSizes: assets.map((a) => a.sizeBytes),
  })
  if (!size.ok) return { success: false, error: describeForkRefusal(size) }

  // Blobs are copied OUTSIDE every transaction. A network call inside a
  // Postgres transaction holds it open for the whole copy, which for a set of
  // videos is seconds of a held connection.
  const newKeyByAssetId = new Map<string, string>()
  const copiedKeys: string[] = []
  // Declared outside the try so the catch can delete a half-built set. See the
  // rollback comment at the bottom for why that case exists at all.
  let createdSetId: string | null = null

  try {
    for (const asset of assets) {
      // `access: 'private'`, matching `uploadAsset` (`src/lib/uploads/index.ts`).
      // NOT 'public' — a public blob is fetchable by its URL with no
      // authentication at all, which would route every forked asset AROUND
      // `/api/assets/[id]`, the proxy that exists to owner-check each byte.
      // Copying a private set's media into a world-readable blob is the
      // largest hole this whole feature could open, and the two values differ
      // by one word.
      const result = await copy(asset.storageKey, `${randomUUID()}_${asset.originalName}`, {
        access: 'private',
      })
      newKeyByAssetId.set(asset.id, result.url)
      copiedKeys.push(result.url)
    }

    // BATCHED, not an interactive transaction with sequential awaits.
    //
    // No `$transaction` call in this repo passes a `timeout`, so Prisma's
    // 5-SECOND default applies, and an interactive transaction creating cards
    // and blocks one await at a time would P2028 long before FORK_MAX_CARDS
    // fired — handing the user an unreadable Prisma error instead of the
    // worded refusal. `createSet` (`src/actions/sets.ts`) already uses the
    // batched array form for exactly this reason.
    const created = await prisma.set.create({
      data: {
        title: source.title,
        description: source.description,
        userId: viewerId,
        // ALWAYS private, never inherited. A fork that auto-published would
        // republish someone else's work under a new name with no deliberate
        // act (design §7.1).
        visibility: 'private',
        publishedAt: null,
        forkedFromId: source.id,
        // Denormalized AT FORK TIME. Rendering from the live FK would leak the
        // title of a set the author later makes private (design §7.3).
        forkedFromTitle: source.title,
        forkedFromHandle: source.user.handle,
        categories: {
          create: source.categories.map((c) => ({
            name: c.name,
            normalizedName: c.normalizedName,
            color: c.color,
          })),
        },
      },
      include: { categories: true },
    })
    createdSetId = created.id

    // Keyed on normalizedName, which `@@unique([setId, normalizedName])`
    // guarantees is unique within a set — the same mapping `createSet` builds.
    const newCategoryIdByNormalized = new Map(
      created.categories.map((c) => [c.normalizedName, c.id]),
    )
    const newCategoryIdByOldId = new Map(
      source.categories
        .map((c) => [c.id, newCategoryIdByNormalized.get(c.normalizedName)] as const)
        .filter((pair): pair is readonly [string, string] => pair[1] !== undefined),
    )

    const newAssets = assets.length
      ? await prisma.cardAsset.createManyAndReturn({
          data: assets.map((a) => ({
            userId: viewerId,
            setId: created.id,
            storageKey: newKeyByAssetId.get(a.id)!,
            originalName: a.originalName,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            kind: a.kind,
            textExtract: a.textExtract,
          })),
          select: { id: true, storageKey: true },
        })
      : []

    // Joined back through `storageKey`, which is `@unique`.
    // `createManyAndReturn` does not promise input order, so zipping by index
    // would be a silent mis-mapping that renders the wrong image on the wrong
    // card — a bug that looks like a content mistake, not a code one.
    const newAssetIdByKey = new Map(newAssets.map((a) => [a.storageKey, a.id]))
    const newAssetIdByOldId = new Map(
      assets
        .map((a) => [a.id, newAssetIdByKey.get(newKeyByAssetId.get(a.id)!)] as const)
        .filter((pair): pair is readonly [string, string] => pair[1] !== undefined),
    )

    await prisma.$transaction(
      source.cards.map((card) =>
        prisma.card.create({
          data: {
            setId: created.id,
            term: card.term,
            definition: card.definition,
            position: card.position,
            // Uniformly pending, including cards the source left 'skipped'.
            // KLPs are re-extracted rather than copied: copied version history
            // describes edits made to SOMEONE ELSE'S card, which defeats the
            // reason KLPs are versioned at all (design §7.5).
            klpStatus: 'pending',
            contentBlocks: {
              create: card.contentBlocks.map((b) => ({
                side: b.side,
                type: b.type,
                text: b.text,
                position: b.position,
                assetId: b.assetId ? (newAssetIdByOldId.get(b.assetId) ?? null) : null,
              })),
            },
            categoryAssignments: {
              create: card.categoryAssignments
                .map((a) => newCategoryIdByOldId.get(a.categoryId))
                .filter((id): id is string => id !== undefined)
                .map((categoryId) => ({ categoryId })),
            },
          },
        }),
      ),
    )

    // The concept tree carries VERBATIM. `SetKltNode` points at a GLOBAL `Klt`
    // and stores only placement, so there is no id to remap — and the
    // hierarchy is often the most valuable authored thing in a mature set
    // (design §7.4).
    if (source.kltNodes.length) {
      await prisma.setKltNode.createMany({
        data: source.kltNodes.map((n) => ({
          setId: created.id,
          kltId: n.kltId,
          parentKltId: n.parentKltId,
          depth: n.depth,
          ancestorIds: n.ancestorIds,
          color: n.color,
          icon: n.icon,
        })),
      })
    }

    revalidatePath('/sets')
    revalidatePath('/')
    return { success: true, data: { setId: created.id } }
  } catch (error) {
    // Two things to roll back, and the SET one exists because of the batching
    // above. Going batched means the set, its assets and its cards are no
    // longer one atomic unit — so a failure partway through leaves a real,
    // owned, EMPTY set in the forker's library carrying a fork-attribution
    // line. That is worse than a failed fork, because it looks like a
    // successful one.
    //
    // Deleting the set cascades its cards, blocks, categories, assignments and
    // CardAsset rows (verified: `onDelete: Cascade` on all of them), so this
    // one call is the whole database rollback.
    //
    // `.catch()` on each step so a failing rollback cannot replace the REAL
    // error with its own — the original cause is what the caller needs.
    if (createdSetId) {
      await prisma.set
        .deleteMany({ where: { id: createdSetId, userId: viewerId } })
        .catch(() => undefined)
    }
    // Blobs were copied outside every transaction, so nothing else reclaims
    // them.
    //
    // KNOWN RESIDUAL: if the process DIES between the copy and here, the copies
    // are orphaned. Accepted in design §7.2/§15 rather than solved — a
    // reconciliation job is a larger piece of work than this whole feature.
    for (const key of copiedKeys) {
      await del(key).catch(() => undefined)
    }
    return { success: false, error: (error as Error).message }
  }
}
