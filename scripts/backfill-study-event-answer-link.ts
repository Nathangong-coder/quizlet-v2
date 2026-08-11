import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { pairStudyEventsToAnswers } from '../src/lib/memory/link-backfill'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
})

/**
 * Links pre-existing StudyEvent rows to the QuizAnswer that produced them.
 * Idempotent: only touches rows where quizAnswerId is still null. Ambiguous
 * groups are reported and left alone — see link-backfill.ts for why.
 */
async function main() {
  const events = await prisma.studyEvent.findMany({
    where: { quizAnswerId: null, sessionId: { not: null } },
    select: { id: true, userId: true, cardId: true, sessionId: true, source: true, createdAt: true },
  })
  const answers = await prisma.quizAnswer.findMany({
    select: {
      id: true, userId: true, cardId: true, mode: true, createdAt: true,
      attempt: { select: { sessionId: true } },
    },
  })

  // Per user: an event can only belong to its own user's answer.
  const userIds = [...new Set(events.map((e) => e.userId))]
  let linked = 0

  for (const userId of userIds) {
    const pairs = pairStudyEventsToAnswers(
      events.filter((e) => e.userId === userId),
      answers
        .filter((a) => a.userId === userId)
        .map((a) => ({
          id: a.id,
          cardId: a.cardId,
          sessionId: a.attempt.sessionId,
          mode: a.mode,
          createdAt: a.createdAt,
        })),
    )
    for (const p of pairs) {
      await prisma.studyEvent.update({
        where: { id: p.eventId },
        data: { quizAnswerId: p.quizAnswerId },
      })
      linked++
    }
  }

  console.log(`Linked ${linked} of ${events.length} unlinked events.`)
  console.log(`${events.length - linked} left unlinked (ambiguous, non-quiz, or no matching answer).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
