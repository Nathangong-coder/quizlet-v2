/**
 * Backfill `Card.topicProposal` / `topicKlpVersion` (2026-09-16) from the loop
 * files, so the trees written from those files can be rebuilt from the
 * database and the owner's build step reads "ready" for them.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/backfill-topic-proposals.ts docs/ai/runs/2026-09-15/loop-*.json
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import type { Prisma } from '@prisma/client'

async function main() {
  let written = 0, skipped = 0
  for (const f of process.argv.slice(2)) {
    const loop = JSON.parse(readFileSync(f, 'utf8')) as { outcomes: { cardId: string; proposal: unknown }[] }
    for (const o of loop.outcomes) {
      const card = await prisma.card.findUnique({ where: { id: o.cardId }, select: { klpVersion: true, topicProposal: true } })
      if (!card) { skipped += 1; continue }
      await prisma.card.update({ where: { id: o.cardId }, data: { topicProposal: o.proposal as Prisma.InputJsonValue, topicKlpVersion: card.klpVersion } })
      written += 1
    }
  }
  console.log(`[backfill] proposals written ${written}, skipped ${skipped}`)
  await prisma.$disconnect()
}
main()
