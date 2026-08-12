/**
 * Asserts the invariant the deletion/forgetting work turns on:
 *
 *     no derived number may claim knowledge from evidence that no longer exists
 *
 * Read-only. Run after any erasure to confirm the replays left nothing stale:
 *
 *   npx tsx --env-file=.env scripts/check-memory-integrity.ts
 *
 * A stale row here is permanent if left alone — scripts/backfill-klp-state.ts
 * only rebuilds from SURVIVING evidence, so a posterior whose evidence is gone
 * is never revisited.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { overallQuizScore } from '../src/lib/quiz/scoring'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set')
  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })

  const problems: string[] = []

  // 1. The posterior must be exactly as observed as its surviving evidence.
  //    `observations` increments once per replayed AnswerKlpResult (see
  //    stepBkt / rebuildState in src/lib/metrics/cache.ts), so after a correct
  //    replay the two are equal by construction. A count HIGHER than the
  //    evidence is the precise signature of the defect this whole design
  //    exists to prevent: a posterior still carrying a deleted answer's
  //    contribution. Zero evidence with a surviving row is its worst case.
  const states = await prisma.klpState.findMany({
    select: { userId: true, klpId: true, observations: true },
  })
  for (const s of states) {
    const evidence = await prisma.answerKlpResult.count({
      where: { klpId: s.klpId, quizAnswer: { userId: s.userId } },
    })
    if (evidence === 0) {
      problems.push(`KlpState ${s.userId}/${s.klpId} has zero surviving evidence`)
    } else if (s.observations !== evidence) {
      problems.push(
        `KlpState ${s.userId}/${s.klpId} claims ${s.observations} observations but ${evidence} results survive`,
      )
    }
  }

  // 2. A CardProgress with no surviving StudyEvent is the same defect one
  //    table over — except when it is starred-only or confidence-only, which
  //    is legitimate (toggleStar writes progress with no event).
  const progress = await prisma.cardProgress.findMany({
    select: { userId: true, cardId: true, starred: true, reps: true },
  })
  for (const p of progress) {
    const events = await prisma.studyEvent.count({ where: { userId: p.userId, cardId: p.cardId } })
    if (events === 0 && p.reps > 0) {
      problems.push(`CardProgress ${p.userId}/${p.cardId} claims ${p.reps} reps with zero events`)
    }
  }

  // 3. A stored attempt score that disagrees with its surviving answers.
  //    Uses overallQuizScore — the SAME function the live writer
  //    (src/actions/quiz.ts) and the erasure planner both call. Reimplementing
  //    the formula here would test this script against itself; an earlier
  //    version guessed `correct / total` and produced five false positives.
  const attempts = await prisma.quizAttempt.findMany({
    select: { id: true, score: true, answers: { select: { score: true } } },
  })
  for (const a of attempts) {
    if (a.answers.length === 0) continue
    const mean = overallQuizScore(a.answers)
    const expected = mean === null ? null : Math.round(mean)
    if (a.score !== expected) {
      problems.push(
        `QuizAttempt ${a.id} stores score ${a.score} but its ${a.answers.length} surviving answers give ${expected}`,
      )
    }
  }

  // 4. An attempt with no answers but a score once HAD answers: that is the
  //    erasure-husk signature (the planner deletes an attempt whose survivors
  //    are empty). A scoreless one is just an abandoned quiz — startQuizAttempt
  //    writes the row before any answer exists — so it is not a defect.
  const husks = await prisma.quizAttempt.count({
    where: { answers: { none: {} }, score: { not: null } },
  })
  if (husks > 0) problems.push(`${husks} scored QuizAttempt row(s) have zero answers left`)

  const abandoned = await prisma.quizAttempt.count({
    where: { answers: { none: {} }, score: null },
  })

  if (problems.length === 0) {
    console.log('OK — no derived number claims knowledge from deleted evidence.')
    console.log(`  checked ${states.length} KlpState, ${progress.length} CardProgress, ${attempts.length} QuizAttempt`)
    console.log(`  (${abandoned} abandoned attempt(s) with no answers and no score — started, never answered, not a defect)`)
  } else {
    console.log(`FOUND ${problems.length} problem(s):`)
    for (const p of problems) console.log('  - ' + p)
  }

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('ERR', e.message)
  process.exit(1)
})
