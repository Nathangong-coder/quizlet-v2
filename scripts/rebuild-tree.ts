/**
 * Rebuild one set's tree from the minting loop's outcomes (2026-09-15).
 * PLAN ONLY — prints the tree, the clusters and the recurrence summary, and
 * writes the plan to --json. Nothing is written to the database.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/rebuild-tree.ts --from loop-<set>.json --json plan.json
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { prisma } from '../src/lib/db'
import { rebuildTree, renderTree, type CardFragment } from '../src/lib/klt/rebuild'
import type { VocabEntry } from '../src/lib/klt/match'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main() {
  const from = opt('--from')
  const out = opt('--json')
  if (!from) throw new Error('--from <loop json> is required')
  const loop = JSON.parse(readFileSync(from, 'utf8')) as { setId: string; setTitle?: string; outcomes: { cardId: string; term: string; proposal: CardFragment & { anchor: string; domain: string }; status: string }[] }
  const klts = await prisma.klt.findMany({ select: { id: true, name: true, normalizedName: true, status: true, aliases: { select: { normalizedName: true } } } })
  const vocab: VocabEntry[] = klts.map((k) => ({ kltId: k.id, name: k.name, normalizedName: k.normalizedName, status: k.status, aliases: k.aliases.map((a) => a.normalizedName) }))
  const fragments: CardFragment[] = loop.outcomes.map((o) => ({ cardId: o.cardId, term: o.term, anchor: o.proposal.anchor, domain: o.proposal.domain, leaves: o.proposal.leaves, contexts: o.proposal.contexts, relations: o.proposal.relations }))
  const plan = rebuildTree(loop.setId, fragments, vocab)
  const roles = plan.nodes.reduce<Record<string, number>>((a, n) => ((a[n.role] = (a[n.role] ?? 0) + 1), a), {})
  const active = plan.nodes.filter((n) => n.status === 'active').length
  console.log(`[rebuild-tree] ${loop.setTitle ?? loop.setId}: ${fragments.length} cards → ${plan.nodes.length} nodes (${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(', ')}); active ${active}, candidate ${plan.nodes.length - active}; anchors matched ${JSON.stringify(plan.anchorMatches)}; clusters ${plan.clusters.length} (${plan.clusters.filter((c) => c.wantsParent).length} want a parent); edges ${plan.edges.length}, with ≥2 cards ${plan.edges.filter((e) => e.cards.length >= 2).length}`)
  console.log(renderTree(plan))
  if (plan.clusters.length) {
    console.log('\nclusters:')
    for (const c of plan.clusters) console.log(`  ${c.wantsParent ? '★ ' : '  '}${c.members.join(' | ')}  — shared ${c.sharedChildren.length ? 'children: ' + c.sharedChildren.join(', ') : 'words: ' + c.sharedWords.join(', ')}`)
  }
  if (out) writeFileSync(out, JSON.stringify(plan, null, 2))
  await prisma.$disconnect()
}
main()
