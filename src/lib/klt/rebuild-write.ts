/**
 * THE WRITE STEP FOR A REBUILT TREE (2026-09-15; v2 the same evening for the
 * planner's labels, aliases, natures and cross-listings). Persists a
 * `TreePlan` and its fragments so the set's tree is what `/concepts` shows
 * and edits:
 *
 *   Klt          REAL nodes only (never a label, never an alias); looked up in
 *                one query; a NEW row takes the plan's status and nature; an
 *                existing row keeps its status but takes a skill/calculation
 *                nature the plan asserts. A plan ALIAS whose name already has a
 *                row marks that row `merged` → survivor and writes a KltAlias;
 *                one with no row writes only the KltAlias.
 *   SetKltNode   root→node paths through `applyPaths` — a node the set already
 *                has KEEPS its place (the owner's hand edits win over a vote);
 *                `resetPlacement` drops the set's old rows first because
 *                `applyPaths` refuses to re-parent an existing node.
 *   KlpTopic     rank 1 from each leaf to its points, resolved through labels
 *                and aliases to the nearest REAL node; rank 2 for contexts,
 *                for an applied card's general links, and for the card's
 *                ANCHOR on every point; a card's links are replaced, so a
 *                re-run is idempotent.
 *   KltRelation  the plan's edges (`minted`), rolled edges (`rolled`) and
 *                cross-listings (`cross_listed`, type applies_within, child →
 *                second parent) upserted on (from, to, type); a directed edge
 *                that would close a cycle is skipped and reported. With
 *                `resetPlacement`, rows of those provenances whose cards all
 *                belong to this set are deleted first, so a re-plan does not
 *                leave last run's edges behind.
 *   Card         kltStatus = 'ready'
 *
 * Cluster parents are named by the script (`nameClusters`) before this runs.
 */
import { prisma } from '@/lib/db'
import { applyPaths } from '@/lib/klt/structure'
import { DIRECTED_TYPES } from '@/lib/klp/relations'
import { wouldCycleRelations, type DirectedEdge } from '@/lib/klt/mint-plan'
import type { TreePlan, CardFragment, PlannedNode } from '@/lib/klt/rebuild'
import { normalizeName } from '@/lib/klt/match'
import { parseKltName } from '@/lib/klt/normalize'

export interface RebuildWriteResult {
  unparseable: string[]
  unplaceable: number
  kltCreated: number
  kltReused: number
  natureUpdated: number
  aliasesWritten: number
  kltMerged: number
  placements: { created: number; skipped: number }
  placementDropped: number
  relationsDropped: number
  klpTopics: number
  relationsWritten: number
  rolledWritten: number
  crossListed: number
  relationsSkippedForCycles: string[]
  cardsReady: number
}

export interface RebuildWriteOptions {
  resetPlacement?: boolean
}

const OWN_PROVENANCES = ['minted', 'rolled', 'cross_listed']

export async function persistTreePlan(plan: TreePlan, fragments: CardFragment[], model: string, opts: RebuildWriteOptions = {}): Promise<RebuildWriteResult> {
  const byKey = new Map(plan.nodes.map((n) => [n.key, n]))
  const domain = plan.nodes.find((n) => n.role === 'domain')!
  const isReal = (n: PlannedNode | undefined): n is PlannedNode => !!n && n.role !== 'label' && n.role !== 'alias'
  /** The real node a key resolves to: through aliases (survivor) and labels (parent). */
  const realKey = (key: string | null | undefined): string | null => {
    let cur = key ?? null
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const n: PlannedNode | undefined = byKey.get(cur)
      if (!n) return null
      if (n.role !== 'label' && n.role !== 'alias') return cur
      cur = n.role === 'alias' ? (n.mergedInto ?? null) : n.parent
    }
    return null
  }

  let placementDropped = 0, relationsDropped = 0
  if (opts.resetPlacement) {
    placementDropped = (await prisma.setKltNode.deleteMany({ where: { setId: plan.setId } })).count
    const setCards = new Set((await prisma.card.findMany({ where: { setId: plan.setId }, select: { id: true } })).map((c) => c.id))
    const own = await prisma.kltRelation.findMany({ where: { provenance: { in: OWN_PROVENANCES } }, select: { id: true, cardIds: true } })
    const ids = own.filter((r) => r.cardIds.length > 0 && r.cardIds.every((c) => setCards.has(c))).map((r) => r.id)
    if (ids.length) relationsDropped = (await prisma.kltRelation.deleteMany({ where: { id: { in: ids } } })).count
  }

  // 1. vocabulary — real nodes only, one lookup
  const real = plan.nodes.filter(isReal)
  const ids = new Map<string, string>()
  const storedKey = new Map<string, string>()
  const unparseable: string[] = []
  const wanted = new Map<string, PlannedNode>()
  for (const n of real) {
    if (n.matched && !n.matched.kltId.startsWith('plan:')) { ids.set(n.key, n.matched.kltId); storedKey.set(n.key, n.key); continue }
    const parsed = parseKltName(n.name)
    if (!parsed) { unparseable.push(n.name); continue }
    storedKey.set(n.key, parsed.normalizedName)
    wanted.set(parsed.normalizedName, n)
  }
  const existingRows = await prisma.klt.findMany({ where: { normalizedName: { in: [...wanted.keys()] } }, select: { id: true, normalizedName: true, nature: true } })
  let kltCreated = 0, kltReused = ids.size, natureUpdated = 0
  const existingByNorm = new Map(existingRows.map((r) => [r.normalizedName, r]))
  for (const [norm, n] of wanted) {
    const ex = existingByNorm.get(norm)
    if (ex) {
      ids.set(n.key, ex.id); kltReused += 1
      if (n.nature !== 'concept' && ex.nature !== n.nature) { await prisma.klt.update({ where: { id: ex.id }, data: { nature: n.nature } }); natureUpdated += 1 }
      continue
    }
    const row = await prisma.klt.create({ data: { name: parseKltName(n.name)!.name, normalizedName: norm, status: n.status, nature: n.nature }, select: { id: true } })
    ids.set(n.key, row.id); kltCreated += 1
  }
  for (const n of real) {
    if (!(n.matched && !n.matched.kltId.startsWith('plan:')) || n.nature === 'concept') continue
    const r = await prisma.klt.update({ where: { id: n.matched.kltId }, data: { nature: n.nature }, select: { nature: true } }).catch(() => null)
    if (r) natureUpdated += 1
  }

  // 1b. aliases: a merged name points at its survivor
  let aliasesWritten = 0, kltMerged = 0
  for (const n of plan.nodes) {
    if (n.role !== 'alias') continue
    const survivor = realKey(n.mergedInto)
    const survivorId = survivor ? ids.get(survivor) : undefined
    if (!survivorId) continue
    const parsed = parseKltName(n.name)
    const norms = new Set([n.key, parsed?.normalizedName].filter((x): x is string => !!x))
    for (const norm of norms) {
      const row = await prisma.klt.findUnique({ where: { normalizedName: norm }, select: { id: true, status: true } })
      if (row && row.id === survivorId) continue
      if (row && row.status !== 'merged') { await prisma.klt.update({ where: { id: row.id }, data: { status: 'merged', mergedIntoId: survivorId } }); kltMerged += 1 }
      const existingAlias = await prisma.kltAlias.findUnique({ where: { normalizedName: norm }, select: { id: true } })
      if (existingAlias) continue
      await prisma.kltAlias.create({ data: { normalizedName: norm, name: n.name, kltId: survivorId, source: plan.merges.find((m) => m.from === n.key)?.rule === 'judge' ? 'judge' : 'merge' } })
      aliasesWritten += 1
    }
  }

  // 2. placement: root→node paths in stored keys, parents first
  const pathOf = (key: string): string[] | null => {
    const out: string[] = []
    let cur: string | null = key
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) {
      seen.add(cur)
      const sk = storedKey.get(cur)
      // an ancestor the tree cap refused is skipped, not fatal: the node hangs
      // from the next placeable ancestor ("buyer type" under a five-word parent)
      if (sk) out.unshift(sk)
      else if (cur === key) return null
      const p = realKey(byKey.get(cur)?.parent)
      cur = p === cur ? null : p
    }
    return out.length ? out : null
  }
  const domainKey = storedKey.get(domain.key)!
  const allPaths = real.filter((n) => n.role !== 'domain').map((n) => pathOf(n.key))
  const paths = allPaths.filter((p): p is string[] => p !== null).sort((a, b) => a.length - b.length)
  const unplaceable = allPaths.length - paths.length
  const placements = await applyPaths(plan.setId, [[domainKey], ...paths])

  // 3. KLP links
  let klpTopics = 0, cardsReady = 0
  const generalByCard = new Map<string, { klpRefs: number[]; key: string }[]>()
  for (const g of plan.generalLinks) { const a = generalByCard.get(g.cardId) ?? []; a.push(g); generalByCard.set(g.cardId, a) }
  for (const f of fragments) {
    const klps = await prisma.cardKlp.findMany({ where: { cardId: f.cardId, supersededAt: null }, orderBy: { index: 'asc' }, select: { id: true, index: true } })
    const klpId = (ref: number) => klps.find((k) => k.index === ref)?.id
    const resolveName = (name: string): string | undefined => {
      const norm = normalizeName(name)
      const direct = byKey.get(norm) ?? plan.nodes.find((n) => n.name === name)
      const key = realKey(direct?.key ?? null)
      return key ? ids.get(key) : undefined
    }
    const rows: { klpId: string; kltId: string; rank: number }[] = []
    const seen = new Set<string>()
    const push = (kid: string | undefined, tid: string | undefined, rank: number) => { if (!kid || !tid) return; const k = `${kid}|${tid}`; if (seen.has(k)) return; seen.add(k); rows.push({ klpId: kid, kltId: tid, rank }) }
    const anchorId = resolveName(f.anchor)
    for (const l of f.leaves) for (const ref of l.klpRefs) push(klpId(ref), resolveName(l.name) ?? anchorId, 1)
    for (const c of f.contexts) push(klpId(c.klpRef), resolveName(c.concept), 2)
    for (const g of generalByCard.get(f.cardId) ?? []) for (const ref of g.klpRefs) push(klpId(ref), ids.get(realKey(g.key) ?? ''), 2)
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
  let relationsWritten = 0, rolledWritten = 0, crossListed = 0
  const isDirected = (t: string) => (DIRECTED_TYPES as readonly string[]).includes(t)
  const writeEdge = async (e: { from: string; to: string; type: string; cards: string[] }, provenance: string) => {
    const fromId = ids.get(realKey(e.from) ?? ''), toId = ids.get(realKey(e.to) ?? '')
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
  for (const n of real) for (const p of n.alsoUnder) if (await writeEdge({ from: n.key, to: p, type: 'applies_within', cards: n.cards }, 'cross_listed')) crossListed += 1

  return { unparseable, unplaceable, kltCreated, kltReused, natureUpdated, aliasesWritten, kltMerged, placements, placementDropped, relationsDropped, klpTopics, relationsWritten, rolledWritten, crossListed, relationsSkippedForCycles: skipped, cardsReady }
}
