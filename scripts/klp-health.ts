import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { Pool } from '@neondatabase/serverless'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set')
}

const prisma = new PrismaClient({
  adapter: new PrismaNeon({ connectionString }),
})

async function main() {
  const byStatus = await prisma.card.groupBy({
    by: ['klpStatus'],
    _count: { _all: true },
  })
  console.log('Cards by klpStatus:')
  for (const row of byStatus) {
    console.log(`  ${row.klpStatus}: ${row._count._all}`)
  }

  const liveKlps = await prisma.cardKlp.count({ where: { supersededAt: null } })
  const klpResults = await prisma.answerKlpResult.count()
  const tags = await prisma.answerErrorTag.count()

  const answersByAnalysis = await prisma.quizAnswer.groupBy({
    by: ['analysisStatus'],
    _count: { _all: true },
  })

  console.log(`\nLive KLPs: ${liveKlps}`)
  console.log(`AnswerKlpResult rows: ${klpResults}`)
  console.log(`AnswerErrorTag rows: ${tags}`)
  console.log('\nQuiz answers by analysisStatus:')
  for (const row of answersByAnalysis) {
    console.log(`  ${row.analysisStatus ?? 'null (legacy)'}: ${row._count._all}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
