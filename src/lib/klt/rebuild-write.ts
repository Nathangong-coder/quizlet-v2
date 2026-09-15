/**
 * THE WRITE STEP FOR A REBUILT TREE (2026-09-15). Persists a `TreePlan` and
 * its fragments so the set's tree is what `/concepts` shows and edits:
 *
 *   Klt          upserted by normalizedName; a NEW row takes the plan's
 *                status (candidate | active); an existing row is untouched
 *   SetKltNode   the plan's parents, written as root→node paths through
 *                `applyPaths` — a node the set already has KEEPS its place
 *                (the owner's hand edits win over a vote), a new node lands
 *                where the votes put it; the domain is the set's root
 *   KlpTopic     rank 1 from each leaf to its points, rank 2 for contexts
 *                and for the card's ANCHOR on every point (the owner's
 *                "context persisted throughout the card"); the card's
 *                existing links are replaced, so a re-run is idempotent
 *   KltRelation  the plan's edges (provenance `minted`) and the rolled-up
 *                edges (provenance `rolled`), upserted on (from, to, type)
 *                with card ids merged; a directed edge that would close a
 *                cycle is skipped and reported
 *   Card         kltStatus = 'ready'
 *
 * Cluster parents are NOT created here — `nameClusters` in the script does
 * that with one model call per ★ cluster and then reparents through the
 * same `applyPaths`. Nothing about mastery is touched: writing links
 * changes which topic evidence rolls up to, which is the point.
 */
import { prisma } from '@/lib/db'
import { applyPaths } from '@/lib/klt/structure'
import { DIRECTED_TYPES } from '@/lib/klp/relations'
import { wouldCycleRelations, type DirectedEdge } from '@/lib/klt/mint-plan'
import type { TreePlan, CardFragment } from '@/lib/klt/rebuild'
import { normalizeName } from '@/lib/klt/match'
import { parseKltName } from '@/lib/klt/normalize'

export interface RebuildWriteResult {
  /** Names `parseKltName` refused, and how many nodes (them plus descendants) therefore have no placement. */
  unparseable: string[]
  unplaceable: number
  kltCreated: number
  kltReused: number
  placements: { created: number; skipped: number }
  klpTopics: number
  relationsWritten: number
  rolledWritten: number
  relationsSkippedForCycles: string[]
  cardsReady: number
}

export interface RebuildWriteOptions {
  /**
   * Drop the set's EXISTING placement (`SetKltNode` rows) before applying the
   * plan. `applyPaths` refuses any path that would re-parent a node the set
   * already has, so a legacy flat placement (M&A had 21 depth-0 roots from the
   * orphaned concept layer, 10 live links) blocks the whole tree. Concepts,
   * links and relations are untouched — only where the nodes sit in this set.
   */
  resetPlacement?: boolean
}

export async function persistTreePlan(plan: TreePlan, fragments: CardFragment[], model: string, opts: RebuildWriteOptions = {}): Promise<RebuildWriteResult & { placementDropped: number }> {
  let placementDropped = 0
  if (opts.resetPlacement) {
    const r = await prisma.setKltNode.deleteMany({ where: { setId: plan.setId } })
    placementDropped = r.count
  }
  // 1. vocabulary. A plan key is the MATCHER's normal form (`normalizeName`:
  //    singular, abbreviations expanded); a Klt row is keyed by the TREE's
  //    (`normalizeKltName`: lower-case, punctuation stripped). A matched node
  //    already carries the row's key; a new node is stored under the tree form
  //    of its display name so the editor's own create/rename finds it.
  const ids = new Map<string, string>()
  const storedKey = new Map<string, string>()
  // a name the tree's own cap refuses (`parseKltName`: 4 words, 40 chars) is
  // not placed, nor is anything the plan hung beneath it — reported, not fudged
  const unparseable: string[] = []
  let kltCreated = 0, kltReused = 0
  for (const n of plan.nodes) {
    // a match against a stored row (not a `plan:` entry the planner grew) is that row
    if (n.matched && !n.matched.kltId.startsWith('plan:')) { ids.set(n.key, n.matched.kltId); storedKey.set(n.key, n.key); kltReused += 1; continue }
    const parsed = parseKltName(n.name)
    if (!parsed) { unparseable.push(n.name); continue }
    storedKey.set(n.key, parsed.normalizedName)
    const existing = await prisma.klt.findUnique({ where: { normalizedName: parsed.normalizedName }, select: { id: true } })
    if (existing) { ids.set(n.key, existing.id); kltReused += 1; continue }
    const row = await prisma.klt.create({ data: { name: parsed.name, normalizedName: parsed.normalizedName, status: n.status }, select: { id: true } })
    ids.set(n.key, row.id)
    kltCreated += 1
  }

  // 2. placement: root→node paths in stored keys, parents first
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]))
  const pathOf = (key: string): string[] | null => {
    const out: string[] = []
    let cur: string | null = key
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const sk = storedKey.get(cur)
      if (!sk) return null
      out.unshift(sk)
      cur = byKey.get(cur)?.parent ?? null
    }
    return out
  }
  const domainKey = storedKey.get(plan.nodes.find((n) => n.role === 'domain')!.key)!
  const allPaths = plan.nodes.filter((n) => n.role !== 'domain').map((n) => pathOf(n.key))
  const paths = allPaths.filter((p): p is string[] => p !== null).sort((a, b) => a.length - b.length)
  const unplaceable = allPaths.length - paths.length
  const placements = await applyPaths(plan.setId, [[domainKey], ...paths])

  // 3. KLP links
  let klpTopics = 0
  let cardsReady = 0
  for (const f of fragments) {
    const klps = await prisma.cardKlp.findMany({ where: { cardId: f.cardId, supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, index: true } })
    const klpId = (ref: number) => klps.find((k) => k.index === ref)?.id
    const resolve = (name: string) => ids.get(normalizeName(name)) ?? ids.get(plan.nodes.find((n) => n.name === name)?.key ?? '')
    const rows: { klpId: string; kltId: string; rank: number }[] = []
    const seen = new Set<string>()
    const push = (kid: string | undefined, tid: string | undefined, rank: number) => { if (!kid || !tid) return; const k = `${kid}|${tid}`; if (seen.has(k)) return; seen.add(k); rows.push({ klpId: kid, kltId: tid, rank }) }
    for (const l of f.leaves) for (const ref of l.klpRefs) push(klpId(ref), resolve(l.name), 1)
    for (const c of f.contexts) push(klpId(c.klpRef), resolve(c.concept), 2)
    const anchorId = resolve(f.anchor)
    for (const k of klps) push(k.id, anchorId, 2)
    await prisma.$transaction(async (tx) => {
      if (klps.length) await tx.klpTopic.deleteMany({ where: { klpId: { in: klps.map((k) => k.id) } } })
      if (rows.length) await tx.klpTopic.createMany({ data: rows, skipDuplicates: true })
      await tx.card.update({ where: { id: f.cardId }, data: { kltStatus: 'ready', kltError: null } })
    })
    klpTopics += rows.length
    cardsReady += 1
  }

  // 4. relations, cycle-checked against what is stored
  const stored = await prisma.kltRelation.findMany({ where: { type: { in: [...DIRECTED_TYPES] } }, select: { fromKltId: true, toKltId: true } })
  const directed: DirectedEdge[] = stored.map((e) => ({ from: e.fromKltId, to: e.toKltId }))
  const skipped: string[] = []
  let relationsWritten = 0, rolledWritten = 0
  const isDirected = (t: string) => (DIRECTED_TYPES as readonly string[]).includes(t)
  const writeEdge = async (e: { from: string; to: string; type: string; cards: string[] }, provenance: 'minted' | 'rolled') => {
    const fromId = ids.get(e.from), toId = ids.get(e.to)
    if (!fromId || !toId || fromId === toId) return false
    if (isDirected(e.type) && wouldCycleRelations(directed, fromId, toId)) { skipped.push(`${e.from} --${e.type}--> ${e.to}`); return false }
    const existing = await prisma.kltRelation.findUnique({ where: { fromKltId_toKltId_type: { fromKltId: fromId, toKltId: toId, type: e.type } }, select: { id: true, cardIds: true, models: true } })
    if (existing) await prisma.kltRelation.update({ where: { id: existing.id }, data: { cardIds: [...new Set([...existing.cardIds, ...e.cards])], models: [...new Set([...existing.models, model])] } })
    else await prisma.kltRelation.create({ data: { fromKltId: fromId, toKltId: toId, type: e.type, provenance, cardIds: e.cards, klpIds: [], models: [model] } })
    if (isDirected(e.type)) directed.push({ from: fromId, to: toId })
    return true
  }
  for (const e of plan.edges) if (await writeEdge(e, 'minted')) relationsWritten += 1
  for (const e of plan.rolledEdges) if (await writeEdge(e, 'rolled')) rolledWritten += 1

  return { unparseable, unplaceable, kltCreated, kltReused, placements, klpTopics, relationsWritten, rolledWritten, relationsSkippedForCycles: skipped, cardsReady, placementDropped }
}
