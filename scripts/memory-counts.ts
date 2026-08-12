/**
 * Prints the row counts Task 11 (deletion & forgetting) checks before and
 * after each erasure. Read-only.
 *
 *   npx tsx --env-file=.env scripts/memory-counts.ts
 *
 * Uses the Neon adapter because this repo's Prisma client is configured with
 * one — a bare `new PrismaClient()` throws PrismaClientInitializationError
 * here, which is what the plan's inline one-liner did.
 */
import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL environment variable is not set')

  const prisma = new PrismaClient({ adapter: new PrismaNeon({ connectionString }) })

  const [answers, events, klpResults, klpStates, progress, sessions, attempts, confidenceEvents] =
    await Promise.all([
      prisma.quizAnswer.count(),
      prisma.studyEvent.count(),
      prisma.answerKlpResult.count(),
      prisma.klpState.count(),
      prisma.cardProgress.count(),
      prisma.studySession.count(),
      prisma.quizAttempt.count(),
      prisma.confidenceEvent.count(),
    ])

  console.table({
    answers,
    events,
    klpResults,
    klpStates,
    progress,
    sessions,
    attempts,
    confidenceEvents,
  })

  await prisma.$disconnect()
}

main()
