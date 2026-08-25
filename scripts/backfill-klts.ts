import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import {
  summarizeKltsForCards,
  defaultKltGenerator,
  type KltGenerator,
} from '../src/lib/klt/summarize'
import { KLT_BATCH_SIZE } from '../src/lib/cards/klt-batch'
import { KltSummarySchema } from '../src/lib/ai/schemas'

/**
 * `--direct` runs against a raw `GOOGLE_API_KEY` instead of the user's stored
 * credentials.
 *
 * For one situation only: `GOOGLE_KEY_ENCRYPTION_SECRET` locally is not the
 * secret those credentials were encrypted with, so every decrypt throws and the
 * feature cannot be exercised at all. This bypasses the credential pool, and
 * therefore also bypasses rotation, per-user billing and failure classification
 * — so it is an operator tool, never a code path the app uses.
 *
 * It writes NOTHING to `AiCredential`, so it leaves no row that production
 * would later fail to decrypt.
 */
function directGenerator(): KltGenerator {
  const apiKey = process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('--direct needs GOOGLE_API_KEY in the environment')
  const google = createGoogle({ apiKey })
  const model = process.env.KLT_DIRECT_MODEL ?? 'gemini-3.6-flash'

  return async ({ prompt }) => {
    // generateObject does not exist in AI SDK v7; structured output is
    // generateText + Output.object.
    const res = await generateText({
      model: google(model),
      prompt,
      output: Output.object({ schema: KltSummarySchema }),
    })
    return res.output
  }
}

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
  const direct = process.argv.includes('--direct')
  const generate = direct ? directGenerator() : defaultKltGenerator
  if (direct) {
    console.log('[backfill:klts] --direct: using GOOGLE_API_KEY, bypassing stored credentials')
  }

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
      await summarizeKltsForCards(owner.id, batch, true, generate)
      processed += batch.length
      console.log(`[backfill:klts]   ${processed} cards processed`)
    }
  }

  const [topics, links, labels, stillPending] = await Promise.all([
    prisma.klt.count(),
    prisma.klpTopic.count(),
    prisma.cardKlp.count({ where: { supersededAt: null, label: { not: null } } }),
    prisma.card.count({
      where: { klps: { some: { supersededAt: null } }, kltStatus: { not: 'ready' } },
    }),
  ])

  const liveKlps = await prisma.cardKlp.count({ where: { supersededAt: null } })
  console.log(
    `[backfill:klts] done — ${processed} cards, ${topics} topics, ${links} links, ${labels}/${liveKlps} labelled, ${stillPending} still not ready`,
  )

  // A low label yield means the model is returning propositions instead of
  // headlines and `parseKltLabel` is discarding them. Silent otherwise: every
  // row just falls back to the full KLP text, which looks like the feature was
  // never built rather than like a generation problem.
  if (liveKlps > 0 && labels < liveKlps * 0.5) {
    console.warn(
      `[backfill:klts] WARNING: only ${labels} of ${liveKlps} live key points got a usable short label. The rest were discarded for being too long — study lists will show the full proposition instead.`,
    )
  }
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
