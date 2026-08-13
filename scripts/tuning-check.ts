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
import { DEFAULT_THRESHOLDS } from '../src/lib/tuning/schema'
import { DEFAULT_BANDS } from '../src/lib/errors/bands'

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

  // The raw evidence. A KLP below the floor cannot report knowledge, so this
  // says whether the floor is what is hiding the numbers, or whether there is
  // simply nothing to show yet.
  const states = await prisma.klpState.findMany({ select: { observations: true } })
  const floor = tuning.thresholds.minObservations
  const clearing = states.filter((s) => s.observations >= floor).length
  const maxObs = states.reduce((m, s) => Math.max(m, s.observations), 0)

  console.log('\n=== EVIDENCE ===')
  console.log(`KlpState rows            ${states.length}`)
  console.log(`most-observed KLP        ${maxObs} observation(s)`)
  console.log(`clearing your floor (${floor})  ${clearing}`)
  if (states.length === 0) {
    console.log(
      '\n  No study history at all. Nothing below can be non-null.\n' +
        '  Take a quiz first — and do NOT seed synthetic data: the posterior is\n' +
        '  incremental and not self-correcting, so fabricated evidence does not\n' +
        '  cleanly come back out.',
    )
  } else if (clearing === 0) {
    console.log(
      `\n  Every KLP is below your floor, so ZERO topics can report knowledge.\n` +
        `  Lower "Evidence before an opinion" to ${maxObs} or less at /settings/ai\n` +
        `  and re-run: topics should start reporting numbers. That is the knob's\n` +
        `  whole purpose, and this is the check that proves it is wired up.`,
    )
  }

  // Candidates are assembled category -> card -> LIVE KLP, so a card must be
  // BOTH categorized and have key points to be rankable at all. A library where
  // those two sets do not overlap produces an empty ranked list no matter how
  // much studying happens, which looks identical to "the feature is broken".
  const [liveKlps, cardsWithKlps, categorizedCards, rankable] = await Promise.all([
    prisma.cardKlp.count({ where: { supersededAt: null } }),
    prisma.card.count({ where: { klps: { some: { supersededAt: null } } } }),
    prisma.card.count({ where: { categoryAssignments: { some: {} } } }),
    prisma.card.count({
      where: { categoryAssignments: { some: {} }, klps: { some: { supersededAt: null } } },
    }),
  ])

  console.log('\n=== CANDIDATE COVERAGE ===')
  console.log(`live KLPs                        ${liveKlps}`)
  console.log(`cards with live KLPs             ${cardsWithKlps}`)
  console.log(`cards with a category            ${categorizedCards}`)
  console.log(`cards with BOTH (rankable)       ${rankable}`)
  if (rankable === 0) {
    console.log(
      '\n  No card is both categorized and has key points, so the ranked list\n' +
        '  below will be empty however much you study. Categorize a card that has\n' +
        '  KLPs (or add categories to the cards that do) before judging targeting.',
    )
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

  console.log(`\n=== RANKED CANDIDATES (strategy: ${tuning.strategy}) ===`)
  if (metrics.ranked.length === 0) {
    console.log('(none)')
  } else {
    console.table(
      metrics.ranked.slice(0, 15).map((c) => ({
        klpId: c.klpId.slice(0, 8),
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
