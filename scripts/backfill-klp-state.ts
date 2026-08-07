/**
 * Backfill `KlpState` from the `AnswerKlpResult` rows that already exist.
 *
 * Stage 8 Spec 3 shipped the read path (`src/lib/metrics/read.ts`) and the
 * pure BKT stepping (`src/lib/metrics/cache.ts`) but no writer, so every
 * answer recorded before that was fixed left evidence in `AnswerKlpResult`
 * with no posterior materialized from it. This replays that evidence.
 *
 * Full replay, not incremental stepping: the stored rows ARE the inputs, and
 * `traceKlp` sorts them chronologically with a stable sort. That makes the
 * result independent of the order rows arrive from the database, but ONLY if
 * the order itself is deterministic across runs: `createdAt` is
 * millisecond-precision, so two observations for the same (user, KLP) that
 * land in the same millisecond are otherwise ordered however the database
 * feels like returning them that run, and a stable sort preserves whatever
 * arbitrary order that was — producing a different posterior on different
 * runs. The query below orders by `(createdAt, id)` so the tie always breaks
 * the same way.
 *
 * Re-running this script back-to-back is safe — it recomputes each state
 * from scratch rather than adding to whatever is already there, so repeated
 * runs against the same unchanged data converge to the same result.
 *
 * It is NOT safe to run against a live/active database: the script takes one
 * snapshot of `AnswerKlpResult` per user, then writes absolute `pKnown`/
 * `observations` values for that user. An answer committed after that user's
 * snapshot was read but before the write lands is not merged into the new
 * state — it is silently overwritten and its observation is lost. Run this
 * during a quiet period with no in-flight quiz submissions, not against
 * live traffic.
 *
 * Usage: `npm run backfill:klp-state -- --dry-run`
 */
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { rebuildStatesFromResults } from '../src/lib/metrics/cache'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
})

const dryRun = process.argv.includes('--dry-run')

async function main() {
  // Users are processed one at a time rather than loading every
  // `AnswerKlpResult` row for every user into memory at once: each user's
  // rows are fetched, replayed, and (if not a dry run) written before moving
  // to the next user, bounding memory to one user's history at a time.
  const userRows = await prisma.quizAnswer.findMany({
    where: { klpResults: { some: {} } },
    select: { userId: true },
    distinct: ['userId'],
  })
  const userIds = userRows.map((u) => u.userId)

  console.log(`Users with AnswerKlpResult rows: ${userIds.length}`)

  let totalRows = 0
  let written = 0

  for (const userId of userIds) {
    // Deterministic order: `createdAt` alone cannot break same-millisecond
    // ties, and `traceKlp`'s stable sort would otherwise let those ties
    // resolve however the database happens to return them. `id` guarantees
    // a total order so the same input always replays to the same posterior.
    const rows = await prisma.answerKlpResult.findMany({
      where: { quizAnswer: { userId } },
      select: {
        klpId: true,
        status: true,
        mode: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    totalRows += rows.length

    const states = rebuildStatesFromResults(userId, rows)
    for (const s of states) {
      if (dryRun) {
        console.log(
          `  [dry-run] ${userId} ${s.klpId}: pKnown=${s.pKnown.toFixed(4)} n=${s.observations}`,
        )
        continue
      }
      const data = {
        pKnown: s.pKnown,
        observations: s.observations,
        lastObservedAt: s.lastObservedAt,
      }
      await prisma.klpState.upsert({
        where: { userId_klpId: { userId, klpId: s.klpId } },
        create: { userId, klpId: s.klpId, ...data },
        update: data,
      })
      written++
    }
  }

  console.log(`AnswerKlpResult rows: ${totalRows} across ${userIds.length} user(s)`)
  console.log(dryRun ? 'Dry run — nothing written.' : `KlpState rows written: ${written}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
