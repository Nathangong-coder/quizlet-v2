/**
 * Rebuild one set's tree from the minting loop's outcomes (2026-09-15).
 * PLAN by default — prints the tree, the clusters and the recurrence
 * summary, writes the plan to --json. With --write it PERSISTS the plan
 * (`src/lib/klt/rebuild-write.ts`) so `/concepts` shows and edits it; with
 * --name-clusters it first names every ★ cluster with one DeepSeek call and
 * places the cluster's anchors under the new parent.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/rebuild-tree.ts --from loop-<set>.json [--json plan.json] [--name-clusters] [--write] [--reset-placement]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { readDirectPool, comboResolveInput } from '../src/lib/klp/direct-pool'
import { rebuildTree, renderTree, type CardFragment, type TreePlan } from '../src/lib/klt/rebuild'
import { persistTreePlan } from '../src/lib/klt/rebuild-write'
import { normalizeName, type VocabEntry } from '../src/lib/klt/match'
import { NAME_CLUSTER_PROMPT } from '../src/lib/ai/prompts/name-cluster'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(name)

/** Name each ★ cluster and insert the parent node between the domain and the members (plan mutation). */
async function nameClusters(plan: TreePlan): Promise<{ named: number; declined: number }> {
  const pool = readDirectPool({ ...process.env, KLP_DIRECT_PROVIDER: process.env.KLP_DIRECT_PROVIDER ?? 'deepseek', KLP_DIRECT_MODELS: process.env.KLP_DIRECT_MODELS ?? 'deepseek-flash' } as NodeJS.ProcessEnv)
  const model = resolveLanguageModel(comboResolveInput(pool[0]))
  const domain = plan.nodes.find((n) => n.role === 'domain')!
  let named = 0, declined = 0
  for (const c of plan.clusters.filter((x) => x.wantsParent)) {
    const members = c.members.map((k) => plan.nodes.find((n) => n.key === k)?.name ?? k)
    const existing = plan.nodes.filter((n) => n.parent === domain.key && !c.members.includes(n.key)).map((n) => n.name)
    const res = await generateText({ model, prompt: NAME_CLUSTER_PROMPT.build({ domain: plan.domain, members, sharedChildren: c.sharedChildren, existing }), output: Output.object({ schema: NAME_CLUSTER_PROMPT.schema }), maxRetries: 1, temperature: 0 })
    const name = res.output.name?.trim()
    if (!name) { declined += 1; console.log(`  cluster [${members.join(' | ')}] — no parent: ${res.output.reason ?? ''}`); continue }
    const key = normalizeName(name)
    const isMember = c.members.includes(key)
    const existingNode = plan.nodes.find((n) => n.key === key)
    if (!existingNode) {
      plan.nodes.push({ key, name, parent: domain.key, role: 'anchor', status: 'active', cards: [], klps: 0, votes: {}, alsoUnder: [], matched: null })
    } else {
      // the name may already be a LEAF beneath one of the members ("purchase
      // price allocation" under "goodwill"): lift it to the domain first, or
      // re-parenting the members under it closes a cycle
      existingNode.parent = domain.key
      existingNode.status = 'active'
      if (existingNode.role !== 'anchor') existingNode.role = 'anchor'
    }
    for (const m of c.members) {
      if (m === key) continue
      const n = plan.nodes.find((x) => x.key === m)
      if (n && n.parent === domain.key) n.parent = key
    }
    named += 1
    console.log(`  cluster [${members.join(' | ')}] → parent "${name}"${isMember ? ' (a member)' : ''}: ${res.output.reason ?? ''}`)
  }
  return { named, declined }
}

async function main() {
  const from = opt('--from')
  const out = opt('--json')
  if (!from) throw new Error('--from <loop json> is required')
  const loop = JSON.parse(readFileSync(from, 'utf8')) as { setId: string; setTitle?: string; model?: string; outcomes: { cardId: string; term: string; proposal: CardFragment & { anchor: string; domain: string }; status: string }[] }
  const klts = await prisma.klt.findMany({ select: { id: true, name: true, normalizedName: true, status: true, aliases: { select: { normalizedName: true } } } })
  const vocab: VocabEntry[] = klts.map((k) => ({ kltId: k.id, name: k.name, normalizedName: k.normalizedName, status: k.status, aliases: k.aliases.map((a) => a.normalizedName) }))
  const fragments: CardFragment[] = loop.outcomes.map((o) => ({ cardId: o.cardId, term: o.term, anchor: o.proposal.anchor, domain: o.proposal.domain, leaves: o.proposal.leaves, contexts: o.proposal.contexts, relations: o.proposal.relations }))
  const plan = rebuildTree(loop.setId, fragments, vocab)
  const roles = plan.nodes.reduce<Record<string, number>>((a, n) => ((a[n.role] = (a[n.role] ?? 0) + 1), a), {})
  const active = plan.nodes.filter((n) => n.status === 'active').length
  console.log(`[rebuild-tree] ${loop.setTitle ?? loop.setId}: ${fragments.length} cards → ${plan.nodes.length} nodes (${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(', ')}); active ${active}, candidate ${plan.nodes.length - active}; anchors matched ${JSON.stringify(plan.anchorMatches)}; clusters ${plan.clusters.length} (${plan.clusters.filter((c) => c.wantsParent).length} want a parent); edges ${plan.edges.length}, with ≥2 cards ${plan.edges.filter((e) => e.cards.length >= 2).length}; rolled-up edges ${plan.rolledEdges.length}, with ≥2 cards ${plan.rolledEdges.filter((e) => e.cards.length >= 2).length}`)
  if (flag('--name-clusters')) {
    console.log('\nnaming clusters:')
    const r = await nameClusters(plan)
    console.log(`  ${r.named} named, ${r.declined} declined`)
  }
  console.log(renderTree(plan))
  if (plan.clusters.length) {
    console.log('\nclusters:')
    for (const c of plan.clusters) console.log(`  ${c.wantsParent ? '★ ' : '  '}${c.members.join(' | ')}  — shared ${c.sharedChildren.length ? 'children: ' + c.sharedChildren.join(', ') : 'words: ' + c.sharedWords.join(', ')}`)
  }
  if (out) writeFileSync(out, JSON.stringify(plan, null, 2))
  if (flag('--write')) {
    console.log('\n[rebuild-tree] WRITING the plan')
    const r = await persistTreePlan(plan, fragments, loop.model ?? 'deepseek-flash', { resetPlacement: flag('--reset-placement') })
    console.log(`[rebuild-tree] written: placement rows dropped ${r.placementDropped}; klt created ${r.kltCreated}, reused ${r.kltReused}; placements created ${r.placements.created}, skipped ${r.placements.skipped}; klp links ${r.klpTopics}; relations ${r.relationsWritten} + rolled ${r.rolledWritten}, skipped for cycles ${r.relationsSkippedForCycles.length}; cards ready ${r.cardsReady}; names refused by the tree cap ${r.unparseable.length} (${r.unplaceable} nodes unplaced)`)
    if (r.unparseable.length) console.log('  refused: ' + r.unparseable.join(' | '))
    if (r.relationsSkippedForCycles.length) console.log('  cycles skipped: ' + r.relationsSkippedForCycles.slice(0, 10).join(' | '))
  }
  await prisma.$disconnect()
}
main()
