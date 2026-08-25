import { prisma } from '../src/lib/db'
import { summarizeKltsForCards } from '../src/lib/klt/summarize'
import { KLT_BATCH_SIZE } from '../src/lib/cards/klt-batch'

/**
 * One-time backfill for cards whose KLPs predate the KLT layer.
 *
 * IDEMPOTENT AND RESUMABLE. It selects only cards that are not already
 * `kltStatus: 'ready'`, so a re-run after an interruption picks up where it
 * stopped rather than paying for every card again; and `applyKltWrites`
 * REPLACES a KLP's links rather than adding to them, so even a card processed
 * twice ends with one set of links. Safe to run repeatedly.
 *
 * Runs per owner because `summarizeKltsForCards` bills the owner's own AI
 * credentials and scopes its reads to what that user may see.
 */
async function main() {
  const owners = await prisma.user.findMany({ select: { id: true } })
  let processed = 0

  for (const owner of owners) {
    const cards = await prisma.card.findMany({
      where: {
        set: { userId: owner.id },
        klps: { some: { supersededAt: null } },
        kltStatus: { not: 'ready' },
      },
      select: { id: true },
    })
    if (cards.length === 0) continue

    console.log(`[backfill:klts] ${owner.id}: ${cards.length} cards to summarize`)

    for (let i = 0; i < cards.length; i += KLT_BATCH_SIZE) {
      const batch = cards.slice(i, i + KLT_BATCH_SIZE).map((c) => c.id)
      await summarizeKltsForCards(owner.id, batch)
      processed += batch.length
      console.log(`[backfill:klts]   ${processed} cards processed`)
    }
  }

  const [topics, links, stillPending] = await Promise.all([
    prisma.klt.count(),
    prisma.klpTopic.count(),
    prisma.card.count({
      where: { klps: { some: { supersededAt: null } }, kltStatus: { not: 'ready' } },
    }),
  ])

  console.log(
    `[backfill:klts] done — ${processed} cards, ${topics} topics, ${links} links, ${stillPending} still not ready`,
  )
  // A topic count approaching the card count means the reconciler is minting
  // one topic per card instead of converging, which is the fragmentation this
  // design exists to prevent. Worth an operator's eye, not an exception.
  if (topics > 0 && processed > 0 && topics > processed * 0.6) {
    console.warn(
      `[backfill:klts] WARNING: ${topics} topics for ${processed} cards — the vocabulary may be fragmenting. Inspect it before trusting topic mastery.`,
    )
  }
}

main()
  .catch((err) => {
    console.error('[backfill:klts] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
