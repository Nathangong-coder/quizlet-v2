/**
 * Spec 3B live gate, headless half.
 *
 *   npx tsx --env-file=.env scripts/tuning-check.ts
 *
 * Read-only. Prints what the app would compute for a user RIGHT NOW under the
 * tuning stored in their `LearnerTuning` row, plus the raw evidence that
 * decides whether any of it can be non-null yet.
 *
 * This exists because two of Spec 3B's effects have NO user interface:
 * `getLearnerMetrics` has zero production callers (Spec 3C's dashboard is the
 * intended consumer), so topic knowledge and the ranked candidate list are not
 * rendered anywhere. Without this script the only way to check the observation
 * floor actually does something would be to read the code and believe it.
 *
 * It calls the REAL `getLearnerMetrics`, not a reimplementation of it. A
 * checker that restates the formula proves only that it can restate the
 * formula; the point is to exercise the same path the app takes.
 *
 * Uses the Neon adapter because this repo's Prisma client is configured with
 * one — a bare `new PrismaClient()` throws PrismaClientInitializationError.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { getUserTuning } from '../src/lib/tuning/store'
import { getLearnerMetrics } from '../src/lib/metrics/read'
import { EMPTY_SCOPE } from '../src/lib/memory/scope'
import { UNCATEGORIZED_ID } from '../src/lib/cards/categories'
import { DEFAULT_THRESHOLDS } from '../src/lib/tuning/schema'
import { DEFAULT_BANDS } from '../src/lib/errors/bands'
import { loadCoverage, diagnoseEmptyState } from '../src/lib/metrics/coverage'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set')

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })

  const userId = process.argv[2] ?? (await prisma.user.findFirst({ select: { id: true } }))?.id
  if (!userId) {
    console.log('No users in the database.')
    return
  }

  const tuning = await getUserTuning(userId)
  const bandOverrides = Object.entries(tuning.bands).filter(
    ([type, band]) =>
      !DEFAULT_BANDS[type] || band[0] !== DEFAULT_BANDS[type][0] || band[1] !== DEFAULT_BANDS[type][1],
  )

  console.log('\n=== STORED TUNING ===')
  console.log(`user           ${userId}`)
  console.log(`strategy       ${tuning.strategy}`)
  console.log(
    `thresholds     minObservations=${tuning.thresholds.minObservations} ` +
      `articulationMinPKnown=${tuning.thresholds.articulationMinPKnown} ` +
      `readinessWeightPerAnswer=${tuning.thresholds.readinessWeightPerAnswer}`,
  )
  console.log(
    `               (shipped: ${DEFAULT_THRESHOLDS.minObservations} / ` +
      `${DEFAULT_THRESHOLDS.articulationMinPKnown} / ${DEFAULT_THRESHOLDS.readinessWeightPerAnswer})`,
  )
  console.log(
    bandOverrides.length === 0
      ? 'band overrides none — every type is at its shipped default'
      : `band overrides ${bandOverrides.map(([t, b]) => `${t}=[${b[0]},${b[1]}]`).join(', ')}`,
  )

  // Coverage comes from the SAME helper the dashboard uses, so the check that
  // verifies this feature and the page the learner reads can never disagree
  // about whether there is enough data. It is also owner-filtered, which the
  // hand-written counts here previously were not — harmless with one user in
  // the database, wrong the moment there are two.
  const floor = tuning.thresholds.minObservations
  const coverage = await loadCoverage(prisma, userId, EMPTY_SCOPE, [], floor)
  const cause = diagnoseEmptyState(coverage, false, floor)

  const maxObsRow = await prisma.klpState.findFirst({
    where: { userId },
    orderBy: { observations: 'desc' },
    select: { observations: true },
  })
  const maxObs = maxObsRow?.observations ?? 0

  console.log('\n=== EVIDENCE ===')
  console.log(`KlpState rows            ${coverage.klpStates}`)
  console.log(`most-observed KLP        ${maxObs} observation(s)`)
  console.log(`clearing your floor (${floor})  ${coverage.klpStatesClearingFloor}`)

  console.log('\n=== CANDIDATE COVERAGE ===')
  console.log(`cards with live KLPs             ${coverage.cardsWithLiveKlps}`)
  console.log(`cards with a category            ${coverage.categorizedCards}`)
  console.log(`cards with BOTH (topic-capable)  ${coverage.topicCapableCards}`)
  console.log(`extraction still pending         ${coverage.pendingExtraction}`)

  console.log('\n=== DIAGNOSIS (what the dashboard would say) ===')
  if (!cause) {
    console.log('nothing wrong — every section has something to render')
  } else {
    console.log(`${cause.kind}${cause.blocking ? '  (BLOCKING — the page is empty)' : '  (advisory)'}`)
    switch (cause.kind) {
      case 'no_klps':
        console.log(
          `  No card has key points yet; ${cause.pendingExtraction} still pending extraction.\n` +
            '  Pending means WAIT — extraction is after()-triggered and self-healing.',
        )
        break
      case 'no_history':
        console.log(
          '  Take a quiz — and do NOT seed synthetic data: the posterior is\n' +
            '  incremental and not self-correcting, so fabricated evidence does not\n' +
            '  cleanly come back out.',
        )
        break
      case 'below_floor':
        console.log(
          `  ${cause.measured} KLPs measured, none at your floor of ${cause.floor}.\n` +
            `  Lower "Evidence before an opinion" to ${maxObs} or less at /settings/ai\n` +
            '  and re-run: topics should start reporting numbers.',
        )
        break
      case 'nothing_categorized':
        console.log(
          `  ${cause.cardsWithLiveKlps} cards have key points but none is categorized, so no\n` +
            '  TOPIC can report anything. Since Task 4B the ranked list below still\n' +
            '  works — uncategorized KLPs are candidates. Categorizing is retroactive.',
        )
        break
      case 'scope_too_narrow':
        console.log('  Nothing inside the scope qualifies, though the library has candidates.')
        break
    }
  }

  const metrics = await getLearnerMetrics({ userId, scope: EMPTY_SCOPE })

  console.log('\n=== TOPICS (as the profile would report them) ===')
  if (metrics.profile.topics.length === 0) {
    console.log('(no categorized cards)')
  } else {
    console.table(
      metrics.profile.topics.map((t) => ({
        topic: t.key,
        klps: t.klpCount,
        knowledge: t.knowledge === null ? 'null (below floor)' : t.knowledge.toFixed(3),
        readiness: t.readiness === null ? 'null (no answers)' : t.readiness.toFixed(3),
        verbosity: t.verbosityIndex,
      })),
    )
  }

  // Split by topic bucket, because Task 4B's whole point is that the second
  // number is no longer zero for a library whose KLP-bearing cards are
  // uncategorized. Showing only the first 15 rows hides that entirely.
  const uncategorizedRanked = metrics.ranked.filter((c) => c.topicKey === UNCATEGORIZED_ID).length
  console.log(`\n=== RANKED CANDIDATES (strategy: ${tuning.strategy}) ===`)
  console.log(
    `${metrics.ranked.length} total — ${metrics.ranked.length - uncategorizedRanked} in a category, ` +
      `${uncategorizedRanked} uncategorized (Task 4B). Showing the first 15.`,
  )
  if (metrics.ranked.length === 0) {
    console.log('(none)')
  } else {
    console.table(
      metrics.ranked.slice(0, 15).map((c) => ({
        // TAIL, not head. cuids created in the same batch share a long prefix,
        // so a leading slice makes distinct KLPs render as the same id and the
        // table looks like it is emitting duplicates — which `toRankCandidates`
        // explicitly does not do. The entropy is at the end.
        klpId: `…${c.klpId.slice(-6)}`,
        topic: c.topicKey,
        weight: c.weight,
        pKnown: c.pKnown.toFixed(3),
        obs: c.observations,
        score: c.score.toFixed(3),
        sufficient: c.sufficient,
      })),
    )
    if (metrics.ranked.every((c) => !c.sufficient)) {
      console.log(
        '  Every candidate is below the floor, so this order carries no\n' +
          '  information yet — they are all tied at "unmeasured".',
      )
    }
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
