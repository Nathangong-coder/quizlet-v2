/**
 * Backfill `CardAuthoring.questionType` (2026-09-15) from the authoring run
 * files — the writer classified every card at step 0, and the label lived only
 * in the JSON until the column existed. Sets it on the CURRENT authoring row of
 * each card (matched by cardId) where it is still null.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/backfill-question-type.ts docs/ai/runs/2026-09-14/corpus-*.json
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { QUESTION_TYPES } from '../src/lib/ai/schemas'

async function main() {
  const files = process.argv.slice(2)
  const byCard = new Map<string, string>()
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8')) as { outcomes?: { cardId: string; outcome?: { questionType?: string } }[] }
    for (const o of j.outcomes ?? []) {
      const q = o.outcome?.questionType
      if (q && (QUESTION_TYPES as readonly string[]).includes(q)) byCard.set(o.cardId, q)
    }
  }
  console.log(`[backfill] ${byCard.size} cards with a question type in ${files.length} files`)
  let updated = 0, missing = 0
  for (const [cardId, q] of byCard) {
    const row = await prisma.cardAuthoring.findFirst({ where: { cardId, questionType: null }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    if (!row) { missing += 1; continue }
    await prisma.cardAuthoring.update({ where: { id: row.id }, data: { questionType: q } })
    updated += 1
  }
  const dist = await prisma.cardAuthoring.groupBy({ by: ['questionType'], _count: true })
  console.log(`[backfill] updated ${updated}, no null row ${missing}; distribution over all rows:`, dist.map((d) => `${d.questionType ?? 'null'} ${d._count}`).join(', '))
  await prisma.$disconnect()
}
main()
