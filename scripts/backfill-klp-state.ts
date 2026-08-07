/**
 * Backfill `KlpState` from the `AnswerKlpResult` rows that already exist.
 *
 * Stage 8 Spec 3 shipped the read path (`src/lib/metrics/read.ts`) and the
 * pure BKT stepping (`src/lib/metrics/cache.ts`) but no writer, so every
 * answer recorded before that was fixed left evidence in `AnswerKlpResult`
 * with no posterior materialized from it. This replays that evidence.
 *
 * Full replay, not incremental stepping: the stored rows ARE the inputs, and
 * `traceKlp` sorts them chronologically, so the result does not depend on the
 * order the database returns them in. Safe to re-run — it is idempotent by
 * construction, because it recomputes each state from scratch rather than
 * adding to whatever is already there.
 *
 * Usage: `npx tsx scripts/backfill-klp-state.ts [--dry-run]`
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
  // Grouped per user: `rebuildStatesFromResults` keys states by (user, KLP),
  // and two users answering the same shared card must never share a posterior.
  const rows = await prisma.answerKlpResult.findMany({
    select: {
      klpId: true,
      status: true,
      mode: true,
      createdAt: true,
      quizAnswer: { select: { userId: true } },
    },
  })

  const byUser = new Map<string, { klpId: string; status: string; mode: string; createdAt: Date }[]>()
  for (const r of rows) {
    const userId = r.quizAnswer.userId
    const list = byUser.get(userId)
    const obs = { klpId: r.klpId, status: r.status, mode: r.mode, createdAt: r.createdAt }
    if (list) list.push(obs)
    else byUser.set(userId, [obs])
  }

  console.log(`AnswerKlpResult rows: ${rows.length} across ${byUser.size} user(s)`)

  let written = 0
  for (const [userId, results] of byUser) {
    const states = rebuildStatesFromResults(userId, results)
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

  console.log(dryRun ? 'Dry run — nothing written.' : `KlpState rows written: ${written}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
