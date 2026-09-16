/**
 * Which cards a prompt change actually touches (2026-09-15): the applied /
 * calculation cards (the mode line changes what the minter writes for them)
 * and the cards whose loop proposal carries a name over MAX_NAME_WORDS (the
 * brevity bar is hard now). Prints the card ids per set for `mint-loop --cards`.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/remint-subset.ts docs/ai/runs/2026-09-15/loop-*.json
 */
import { readFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { cardMode } from '../src/lib/klp/card-mode'
import { MAX_NAME_WORDS } from '../src/lib/klp/topic-minting-v2'

async function main() {
  for (const f of process.argv.slice(2)) {
    const loop = JSON.parse(readFileSync(f, 'utf8')) as { setId: string; setTitle?: string; outcomes: { cardId: string; proposal: { anchor: string; leaves: { name: string }[]; contexts: { concept: string }[] } }[] }
    const ids = loop.outcomes.map((o) => o.cardId)
    const authoring = await prisma.cardAuthoring.findMany({ where: { cardId: { in: ids } }, orderBy: { createdAt: 'desc' }, select: { cardId: true, questionType: true } })
    const qt = new Map<string, string | null>()
    for (const a of authoring) if (!qt.has(a.cardId)) qt.set(a.cardId, a.questionType)
    const klps = await prisma.cardKlp.findMany({ where: { cardId: { in: ids }, supersededAt: null }, select: { cardId: true, kind: true } })
    const kinds = new Map<string, string[]>()
    for (const k of klps) { const a = kinds.get(k.cardId) ?? []; a.push(k.kind); kinds.set(k.cardId, a) }
    const why = new Map<string, string>()
    for (const o of loop.outcomes) {
      const mode = cardMode({ questionType: qt.get(o.cardId) ?? null, kinds: kinds.get(o.cardId) ?? [] })
      if (mode === 'applied' || mode === 'calculation') why.set(o.cardId, mode)
      const names = [o.proposal.anchor, ...o.proposal.leaves.map((l) => l.name), ...o.proposal.contexts.map((c) => c.concept)]
      if (names.some((n) => n.trim().split(/\s+/).length > MAX_NAME_WORDS)) why.set(o.cardId, (why.get(o.cardId) ? why.get(o.cardId) + '+' : '') + 'long')
    }
    const counts: Record<string, number> = {}
    for (const w of why.values()) counts[w] = (counts[w] ?? 0) + 1
    console.log(`${loop.setTitle ?? loop.setId}\t${loop.setId}\t${why.size} of ${ids.length}\t${JSON.stringify(counts)}`)
    console.log(`CARDS ${loop.setId} ${[...why.keys()].join(',')}`)
  }
  await prisma.$disconnect()
}
main()
