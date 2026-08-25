import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import {
  summarizeKltsForCards,
  defaultKltGenerator,
  type KltGenerator,
} from '../src/lib/klt/summarize'
import { KLT_BATCH_SIZE } from '../src/lib/cards/klt-batch'
import { KltSummarySchema, KltPlacementSchema } from '../src/lib/ai/schemas'
import { placeUnparentedConcepts, type KltPlacer } from '../src/lib/klt/place'
import { checkTreeInvariants } from '../src/lib/klt/invariants'

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
 * `--direct` equivalent of `directGenerator`, for Phase B (placement). Same
 * rationale: bypasses the stored, encrypted `AiCredential` pool and hits a raw
 * `GOOGLE_API_KEY` directly, writing nothing to `AiCredential`.
 */
function directPlacer(): KltPlacer {
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
      output: Output.object({ schema: KltPlacementSchema }),
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

  // Phase B. Runs ONCE for the whole install, not per owner: the tree is
  // global, and placing one owner's concepts at a time would show the model a
  // partial tree and invite it to mint duplicates of nodes another owner's run
  // is about to create.
  //
  // Unconditional on `force`: unplaced concepts are unplaced either way, and
  // guarded on `owners.length` rather than defaulting a missing first owner's
  // id to an empty string — an empty userId would still reach `generateJson`
  // and fail credential resolution in a confusing way instead of skipping
  // cleanly, the way every other empty-database path in this script does.
  if (owners.length > 0) {
    console.log('[backfill:klts] placing unparented concepts…')
    await placeUnparentedConcepts(owners[0].id, direct ? directPlacer() : undefined)
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
  // Health is now tree-shaped, not tier-shaped: fragmentation is measured on
  // the DISCIPLINE/root tier only, and concentration on LEAVES. A global
  // topic count or an unqualified per-node share both cry wolf on a healthy
  // run — see `reportTreeHealth`.
  await reportTreeHealth()
}

/** Direct children above which a node has absorbed distinctions it should delegate. */
const MAX_BRANCHING = 7

async function reportTreeHealth() {
  const rows = await prisma.klt.findMany({
    select: { id: true, name: true, normalizedName: true, parentKltId: true, depth: true, ancestorIds: true },
  })

  const violations = checkTreeInvariants(rows)
  if (violations.length > 0) {
    console.error(`[backfill:klts] STRUCTURAL VIOLATIONS: ${violations.length}`)
    for (const v of violations.slice(0, 10)) console.error(`  ${v.kind} ${v.kltId}: ${v.detail}`)
  }

  const byDepth = new Map<number, number>()
  for (const r of rows) byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1)
  console.log('[backfill:klts] nodes by depth: ' +
    [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join(' '))

  const unplaced = rows.filter((r) => r.parentKltId === null &&
    !rows.some((o) => o.parentKltId === r.id))
  if (unplaced.length > 0) {
    console.warn(`[backfill:klts] ${unplaced.length} concept(s) still unparented — they report ` +
      `mastery as their own node but do not roll up: ${unplaced.slice(0, 8).map((u) => u.name).join(', ')}`)
  }

  const childCount = new Map<string, number>()
  for (const r of rows) {
    if (r.parentKltId) childCount.set(r.parentKltId, (childCount.get(r.parentKltId) ?? 0) + 1)
  }
  const overloaded = [...childCount.entries()]
    .filter(([, n]) => n > MAX_BRANCHING)
    .map(([id, n]) => `${rows.find((r) => r.id === id)?.name} (${n})`)
  if (overloaded.length > 0) {
    console.warn(`[backfill:klts] ${overloaded.length} node(s) exceed ${MAX_BRANCHING} direct ` +
      `children — a rung is probably missing beneath them: ${overloaded.join(', ')}`)
  }

  const linked = await prisma.klpTopic.groupBy({ by: ['kltId'], _count: true })
  const singletons = linked.filter((l) => l._count === 1).length
  if (linked.length > 0) {
    console.log(`[backfill:klts] concepts with exactly one key point: ${singletons}/${linked.length}`)
    if (singletons > linked.length * 0.5) {
      console.warn('[backfill:klts] WARNING: over half of concepts cover a single key point. ' +
        'Leaves are being minted per card instead of reused — nothing will aggregate.')
    }
  }
}

main()
  .catch((err) => {
    console.error('[backfill:klts] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
