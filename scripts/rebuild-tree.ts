/**
 * Rebuild one set's tree from the minting loop's outcomes (2026-09-15, v2 the
 * same evening). PLAN by default — prints the tree, the clusters and the
 * shape numbers, writes the plan to --json. Flags:
 *
 *   --judge          DeepSeek judges every containment pair between real nodes
 *                    (same / related / unrelated); 'same' merges (one batched
 *                    call per 25 pairs)
 *   --name-clusters  one DeepSeek call per ★ cluster names its parent
 *   --chapters       ONE DeepSeek call groups the branches under the domain into chapters
 *   --write          PERSIST (`src/lib/klt/rebuild-write.ts`)
 *   --reset-placement  drop the set's old placement and its own relations first
 *
 * Card MODE (`card-mode.ts`) is read from `CardAuthoring.questionType` and
 * the live points' kinds — an applied card mints one skill node.
 *
 *   npx tsx --conditions=react-server --env-file=.env scripts/rebuild-tree.ts --from loop-<set>.json [--json plan.json] [--judge] [--name-clusters] [--chapters] [--write] [--reset-placement]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { readDirectPool, comboResolveInput } from '../src/lib/klp/direct-pool'
import { rebuildTree, renderTree, applyMerges, type CardFragment, type TreePlan } from '../src/lib/klt/rebuild'
import { persistTreePlan } from '../src/lib/klt/rebuild-write'
import { normalizeName, type VocabEntry } from '../src/lib/klt/match'
import { NAME_CLUSTER_PROMPT } from '../src/lib/ai/prompts/name-cluster'
import { JUDGE_CONSOLIDATION_PROMPT } from '../src/lib/ai/prompts/judge-consolidation'
import { CHAPTER_SKELETON_PROMPT } from '../src/lib/ai/prompts/chapter-skeleton'
import { parseKltName } from '../src/lib/klt/normalize'
import { cardMode } from '../src/lib/klp/card-mode'

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const flag = (name: string) => process.argv.includes(name)
/** A plan node by name, in either normal form (a matched node's key is the stored tree form). */
const findByName = (plan: TreePlan, name: string) => {
  const key = normalizeName(name)
  return plan.nodes.find((n) => n.key === key || normalizeName(n.key) === key || normalizeName(n.name) === key)
}

function judgeModel() {
  const pool = readDirectPool({ ...process.env, KLP_DIRECT_PROVIDER: process.env.KLP_DIRECT_PROVIDER ?? 'deepseek', KLP_DIRECT_MODELS: process.env.KLP_DIRECT_MODELS ?? 'deepseek-flash' } as NodeJS.ProcessEnv)
  return resolveLanguageModel(comboResolveInput(pool[0]))
}

/** Name each ★ cluster and insert the parent node between the domain and the members (plan mutation). */
async function nameClusters(plan: TreePlan): Promise<{ named: number; declined: number }> {
  const model = judgeModel()
  const domain = plan.nodes.find((n) => n.role === 'domain')!
  let named = 0, declined = 0
  for (const c of plan.clusters.filter((x) => x.wantsParent)) {
    const members = c.members.map((k) => plan.nodes.find((n) => n.key === k)?.name ?? k)
    const existing = plan.nodes.filter((n) => n.parent === domain.key && n.role !== 'label' && n.role !== 'alias' && !c.members.includes(n.key)).map((n) => n.name)
    const res = await generateText({ model, prompt: NAME_CLUSTER_PROMPT.build({ domain: plan.domain, members, sharedChildren: c.sharedChildren, existing }), output: Output.object({ schema: NAME_CLUSTER_PROMPT.schema }), maxRetries: 1, temperature: 0 })
    const name = res.output.name?.trim()
    if (!name) { declined += 1; console.log(`  cluster [${members.join(' | ')}] — no parent: ${res.output.reason ?? ''}`); continue }
    const existingNode = findByName(plan, name)
    const key = existingNode?.key ?? normalizeName(name)
    const isMember = c.members.includes(key)
    if (!existingNode) {
      plan.nodes.push({ key, name, parent: domain.key, role: 'anchor', nature: 'concept', status: 'active', cards: [], klps: 0, votes: {}, alsoUnder: [], matched: null })
    } else {
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

/** Judge every containment pair; merge the 'same' ones. */
async function judgePairs(plan: TreePlan): Promise<{ same: number; related: number; unrelated: number }> {
  const model = judgeModel()
  const nameOf = (k: string) => plan.nodes.find((n) => n.key === k)?.name ?? k
  const counts = { same: 0, related: 0, unrelated: 0 }
  const verdicts: { specific: string; general: string; verdict: 'same' | 'related' | 'unrelated' }[] = []
  const pairs = plan.judgeCandidates
  for (let i = 0; i < pairs.length; i += 25) {
    const batch = pairs.slice(i, i + 25)
    const res = await generateText({ model, prompt: JUDGE_CONSOLIDATION_PROMPT.build(plan.domain, batch.map((p) => ({ specific: nameOf(p.specific), general: nameOf(p.general) }))), output: Output.object({ schema: JUDGE_CONSOLIDATION_PROMPT.schema }), maxRetries: 1, temperature: 0 })
    for (const v of res.output.verdicts) {
      const p = batch[v.index]
      if (!p) continue
      counts[v.verdict] += 1
      verdicts.push({ ...p, verdict: v.verdict })
      if (v.verdict === 'same') console.log(`  merge "${nameOf(p.specific)}" → "${nameOf(p.general)}": ${v.reason ?? ''}`)
    }
  }
  applyMerges(plan, verdicts)
  return counts
}

/** One call: group the branches under the domain into chapters; create/lift the chapter nodes and reparent (plan mutation). */
async function chapterSkeleton(plan: TreePlan): Promise<{ chapters: number; placed: number; refused: string[] }> {
  const model = judgeModel()
  const domain = plan.nodes.find((n) => n.role === 'domain')!
  const real = (n: TreePlan['nodes'][number]) => n.role !== 'label' && n.role !== 'alias'
  const branches = plan.nodes.filter((n) => real(n) && n.parent === domain.key)
  const kids = (k: string) => plan.nodes.filter((n) => real(n) && n.parent === k).map((n) => n.name)
  const res = await generateText({ model, prompt: CHAPTER_SKELETON_PROMPT.build({ domain: plan.domain, branches: branches.map((b) => ({ name: b.name, cards: b.cards.length, children: kids(b.key) })) }), output: Output.object({ schema: CHAPTER_SKELETON_PROMPT.schema }), maxRetries: 1, temperature: 0 })
  const byName = new Map(branches.map((b) => [b.name.toLowerCase(), b]))
  const taken = new Set<string>()
  let chapters = 0, placed = 0
  const refused: string[] = []
  for (const ch of res.output.chapters) {
    const members = ch.members.map((m) => byName.get(m.toLowerCase())).filter((b): b is NonNullable<typeof b> => !!b && !taken.has(b.key))
    if (members.length < 2) continue
    if (!parseKltName(ch.name)) { refused.push(ch.name); continue }
    let parent = findByName(plan, ch.name)
    const key = parent?.key ?? normalizeName(ch.name)
    if (!parent) {
      parent = { key, name: ch.name, parent: domain.key, role: 'anchor', nature: 'concept', status: 'active', cards: [], klps: 0, votes: {}, alsoUnder: [], matched: null }
      plan.nodes.push(parent)
    } else {
      parent.parent = domain.key
      parent.status = 'active'
      if (parent.role === 'label' || parent.role === 'alias') { parent.role = 'anchor'; parent.mergedInto = undefined }
    }
    for (const m of members) {
      if (m.key === key) continue
      m.parent = key
      m.alsoUnder = m.alsoUnder.filter((k) => k !== key)
      taken.add(m.key)
      placed += 1
    }
    chapters += 1
    console.log(`  chapter "${ch.name}" ← ${members.map((m) => m.name).join(' | ')}${ch.reason ? ': ' + ch.reason : ''}`)
  }
  return { chapters, placed, refused }
}

export function shape(plan: TreePlan) {
  const real = plan.nodes.filter((n) => n.role !== 'label' && n.role !== 'alias')
  const domain = plan.nodes.find((n) => n.role === 'domain')!
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]))
  const top = real.filter((n) => n.parent === domain.key)
  const kids = new Map<string, string[]>()
  for (const n of real) if (n.parent) { const a = kids.get(n.parent) ?? []; a.push(n.key); kids.set(n.parent, a) }
  const under = (k: string, seen = new Set<string>()): Set<string> => { const s = new Set(byKey.get(k)?.cards ?? []); seen.add(k); for (const c of kids.get(k) ?? []) if (!seen.has(c)) for (const x of under(c, seen)) s.add(x); return s }
  const depth = (k: string): number => { let d = 0; let cur = byKey.get(k); const seen = new Set<string>(); while (cur?.parent && !seen.has(cur.key)) { seen.add(cur.key); d += 1; cur = byKey.get(cur.parent) } return d }
  const depths = real.filter((n) => n.role !== 'domain').map((n) => depth(n.key))
  const multi = real.filter((n) => n.role !== 'domain' && n.cards.length >= 2).length
  return {
    realNodes: real.length - 1,
    labels: plan.nodes.filter((n) => n.role === 'label').length,
    aliases: plan.nodes.filter((n) => n.role === 'alias').length,
    topBranches: top.length,
    singleCardBranches: top.filter((n) => under(n.key).size === 1).length,
    meanDepth: depths.length ? Number((depths.reduce((a, b) => a + b, 0) / depths.length).toFixed(2)) : 0,
    maxDepth: Math.max(0, ...depths),
    multiCardShare: real.length > 1 ? Math.round((multi / (real.length - 1)) * 100) : 0,
    natures: real.reduce<Record<string, number>>((a, n) => ((a[n.nature] = (a[n.nature] ?? 0) + 1), a), {}),
  }
}

async function main() {
  const from = opt('--from')
  const out = opt('--json')
  if (!from) throw new Error('--from <loop json> is required')
  const loop = JSON.parse(readFileSync(from, 'utf8')) as { setId: string; setTitle?: string; model?: string; outcomes: { cardId: string; term: string; proposal: CardFragment & { anchor: string; domain: string }; status: string }[] }
  const klts = await prisma.klt.findMany({ where: { status: { not: 'merged' } }, select: { id: true, name: true, normalizedName: true, status: true, aliases: { select: { normalizedName: true } } } })
  const vocab: VocabEntry[] = klts.map((k) => ({ kltId: k.id, name: k.name, normalizedName: k.normalizedName, status: k.status, aliases: k.aliases.map((a) => a.normalizedName) }))
  // card modes from the DB
  const cardIds = loop.outcomes.map((o) => o.cardId)
  const authoring = await prisma.cardAuthoring.findMany({ where: { cardId: { in: cardIds } }, orderBy: { createdAt: 'desc' }, select: { cardId: true, questionType: true } })
  const qt = new Map<string, string | null>()
  for (const a of authoring) if (!qt.has(a.cardId)) qt.set(a.cardId, a.questionType)
  const klps = await prisma.cardKlp.findMany({ where: { cardId: { in: cardIds }, supersededAt: null }, select: { cardId: true, kind: true } })
  const kinds = new Map<string, string[]>()
  for (const k of klps) { const a = kinds.get(k.cardId) ?? []; a.push(k.kind); kinds.set(k.cardId, a) }
  const fragments: CardFragment[] = loop.outcomes.map((o) => ({ cardId: o.cardId, term: o.term, anchor: o.proposal.anchor, domain: o.proposal.domain, leaves: o.proposal.leaves, contexts: o.proposal.contexts, relations: o.proposal.relations, mode: cardMode({ questionType: qt.get(o.cardId) ?? null, kinds: kinds.get(o.cardId) ?? [] }) }))
  const plan = rebuildTree(loop.setId, fragments, vocab)
  const roles = plan.nodes.reduce<Record<string, number>>((a, n) => ((a[n.role] = (a[n.role] ?? 0) + 1), a), {})
  console.log(`[rebuild-tree] ${loop.setTitle ?? loop.setId}: ${fragments.length} cards (modes ${JSON.stringify(plan.modes)}) → ${plan.nodes.length} plan nodes (${Object.entries(roles).map(([k, v]) => `${k} ${v}`).join(', ')}); anchors matched ${JSON.stringify(plan.anchorMatches)}; rule merges ${plan.merges.length}; judge candidates ${plan.judgeCandidates.length}; clusters ${plan.clusters.length} (${plan.clusters.filter((c) => c.wantsParent).length} want a parent); edges ${plan.edges.length} + rolled ${plan.rolledEdges.length}, dropped ${plan.droppedEdges}; general links ${plan.generalLinks.length}`)
  if (flag('--judge') && plan.judgeCandidates.length) {
    console.log('\njudging containment pairs:')
    const c = await judgePairs(plan)
    console.log(`  same ${c.same}, related ${c.related}, unrelated ${c.unrelated}`)
  }
  if (flag('--name-clusters')) {
    console.log('\nnaming clusters:')
    const r = await nameClusters(plan)
    console.log(`  ${r.named} named, ${r.declined} declined`)
  }
  if (flag('--chapters')) {
    console.log('\nchapter skeleton:')
    const r = await chapterSkeleton(plan)
    console.log(`  ${r.chapters} chapters, ${r.placed} branches placed${r.refused.length ? '; names refused: ' + r.refused.join(' | ') : ''}`)
  }
  console.log(`\nshape: ${JSON.stringify(shape(plan))}\n`)
  console.log(renderTree(plan))
  if (plan.clusters.length) {
    console.log('\nclusters:')
    for (const c of plan.clusters) console.log(`  ${c.wantsParent ? '★ ' : '  '}${c.members.join(' | ')}  — shared ${c.sharedChildren.length ? 'children: ' + c.sharedChildren.join(', ') : 'words: ' + c.sharedWords.join(', ')}`)
  }
  if (out) writeFileSync(out, JSON.stringify(plan, null, 2))
  if (flag('--write')) {
    console.log('\n[rebuild-tree] WRITING the plan')
    const r = await persistTreePlan(plan, fragments, loop.model ?? 'deepseek-flash', { resetPlacement: flag('--reset-placement') })
    console.log(`[rebuild-tree] written: placement rows dropped ${r.placementDropped}, own relations dropped ${r.relationsDropped}; klt created ${r.kltCreated}, reused ${r.kltReused}, nature set ${r.natureUpdated}, merged ${r.kltMerged}, aliases ${r.aliasesWritten}; placements created ${r.placements.created}, skipped ${r.placements.skipped}; klp links ${r.klpTopics}; relations ${r.relationsWritten} + rolled ${r.rolledWritten} + cross-listed ${r.crossListed}, skipped for cycles ${r.relationsSkippedForCycles.length}; cards ready ${r.cardsReady}; names refused by the tree cap ${r.unparseable.length} (${r.unplaceable} nodes unplaced)`)
    if (r.unparseable.length) console.log('  refused: ' + r.unparseable.join(' | '))
    if (r.relationsSkippedForCycles.length) console.log('  cycles skipped: ' + r.relationsSkippedForCycles.slice(0, 10).join(' | '))
  }
  await prisma.$disconnect()
}
main()
