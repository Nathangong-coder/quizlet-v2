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
  // Re-summarize cards that are already 'ready'. Needed after a prompt change:
  // the normal run skips them, so a new prompt would never reach the corpus.
  const force = process.argv.includes('--force')
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
        ...(force ? {} : { kltStatus: { not: 'ready' } }),
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
  // Fragmentation is measured on the DISCIPLINE tier only.
  //
  // A total-topic count is meaningless once topics form a specific->broad
  // ladder: many rank-1 topics is the goal, not a symptom. It is rank 3 that
  // must stay small — a corpus with as many "disciplines" as cards has no
  // rollup at all. The first ladder run produced 68/33/14 across the three
  // tiers, which the old global check wrongly flagged as fragmenting.
  await reportFragmentation(processed)

  await reportConcentration(liveKlps)
}

/** Share of key points one NARROW topic may cover before it is a shelf. */
const CONCENTRATION_LIMIT = 0.25

/** Distinct rank-3 topics, as a share of cards, above which rollup is lost. */
const DISCIPLINE_LIMIT = 0.25

async function reportFragmentation(cards: number) {
  if (cards === 0) return
  const tiers = await Promise.all(
    [1, 2, 3].map((rank) =>
      prisma.klpTopic
        .groupBy({ by: ['kltId'], where: { rank, klp: { supersededAt: null } } })
        .then((r) => r.length),
    ),
  )
  console.log(
    `[backfill:klts] distinct topics by tier — narrow ${tiers[0]}, area ${tiers[1]}, discipline ${tiers[2]}`,
  )
  if (tiers[2] > cards * DISCIPLINE_LIMIT) {
    console.warn(
      `[backfill:klts] WARNING: ${tiers[2]} distinct DISCIPLINE topics for ${cards} cards. The broad tier is meant to be a handful; this many means the ladder is not rolling up and topic mastery has nothing to aggregate over.`,
    )
  }
}

/**
 * The OPPOSITE failure to fragmentation, and the one the first real run hit:
 * too few topics, each covering too much. One umbrella term ("financial
 * analysis") held 15% of the corpus at rank 1 under the v2 prompt.
 *
 * Measured on rank 1 ONLY. Rank 3 is the discipline and is an umbrella BY
 * DESIGN — warning about it would cry wolf on every healthy run. Rank 1 is the
 * grain that has to stay specific for the study list to be worth reading.
 */
async function reportConcentration(liveKlps: number) {
  if (liveKlps === 0) return

  const rows = await prisma.klt.findMany({
    select: {
      name: true,
      _count: { select: { links: { where: { rank: 1, klp: { supersededAt: null } } } } },
    },
  })
  const ranked = rows
    .map((r) => ({ name: r.name, share: r._count.links / liveKlps }))
    .filter((r) => r.share > 0)
    .sort((a, b) => b.share - a.share)

  console.log('')
  console.log('[backfill:klts] most concentrated NARROW (rank 1) topics:')
  for (const r of ranked.slice(0, 8)) {
    console.log(`  ${(r.share * 100).toFixed(1).padStart(5)}%  ${r.name}`)
  }

  const tooBroad = ranked.filter((r) => r.share > CONCENTRATION_LIMIT)
  if (tooBroad.length > 0) {
    console.warn(
      `[backfill:klts] WARNING: ${tooBroad.length} narrow topic(s) cover more than ${CONCENTRATION_LIMIT * 100}% of key points each: ` +
        tooBroad.map((r) => `"${r.name}" ${(r.share * 100).toFixed(0)}%`).join(', ') +
        `. A rank-1 topic that broad is a shelf, not an idea — mastery on it will not tell the learner what to study.`,
    )
  }
}

main()
  .catch((err) => {
    console.error('[backfill:klts] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
