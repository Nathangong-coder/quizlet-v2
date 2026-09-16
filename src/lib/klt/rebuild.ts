/**
 * THE SET-LEVEL TREE REBUILD (2026-09-15, minting plan step 4; v2 the same
 * evening, after the owner read the first written M&A tree).
 *
 * Per-card minting produces one anchored fragment per card. This pass turns
 * a set's fragments into one tree, in pure TypeScript, by VOTES:
 *
 *  1. ANCHORS FIRST. Every card's anchor is matched into the vocabulary
 *     (`match.ts`) before any leaf, so a leaf or context on card 3 can hit
 *     the anchor card 40 names (the first version resolved in card order and
 *     a context could only ever be filed UNDER the card that mentioned it).
 *     A containment hit places the specific anchor under the general one.
 *  2. LEAVES VOTE. Each `under` is a weighted vote for "child sits under
 *     parent" (`VOTE_UNDER`); a node voted under two parents goes under the
 *     heavier one and is cross-listed under the other. Ties go to the parent
 *     with more cards, then the earlier one.
 *  3. CONTEXTS POINT UP. A context is the broad concept a point sits within.
 *     One that matches an existing node cross-lists the card's ANCHOR under
 *     it (the owner's example: "sources and uses" is above divestiture, not
 *     beneath it); one that matches nothing becomes a candidate under the
 *     domain and lives or dies by the node bar.
 *  4. EDGE ENDPOINTS NEVER MINT NODES. An endpoint resolves to an existing
 *     node (exact, or by containment to the general node) or the edge is
 *     dropped and counted. Edges are for the dependency view; the tree does
 *     not grow from them.
 *  5. THE NODE BAR. A leaf or context becomes a node only if ≥2 cards touch
 *     it, or it carries ≥3 points, or it is an anchor / an existing topic.
 *     Everything smaller stays a LABEL: kept in the plan with a parent so
 *     its points link to the nearest real ancestor, never placed. The first
 *     written M&A tree had 520 single-card nodes of 581 — a stack of card
 *     outlines, not a concept hierarchy.
 *  6. CARD MODE (`card-mode.ts`). An APPLIED card (a scenario on a case)
 *     mints one skill node — its anchor — and its leaves are labels that
 *     also link to the general concept they exercise when one exists. Its
 *     specifics never become topics. The anchor's `nature` follows the mode.
 *  7. CONSOLIDATION. Two nodes whose names differ only by a trailing facet
 *     word (`FACET_SUFFIXES`: test, analysis, schedule, process …) merge by
 *     rule; the loser becomes an ALIAS of the survivor. Containment pairs
 *     between real nodes are listed as `judgeCandidates` for the caller's
 *     judge (one model call) — the planner never merges on a guess.
 *  8. CLUSTER PARENTS and RECURRENCE as before: anchors that share children
 *     or content words cluster; a cluster of three or more wants a parent
 *     (named by the caller); a node is `active` at PROMOTE_CARDS / PROMOTE_KLPS.
 *
 * Output is a PLAN — printable, diffable, nothing touches the database.
 */
import { matchConcept, normalizeName, type VocabEntry } from '@/lib/klt/match'
import type { CardMode } from '@/lib/klp/card-mode'
import { NATURE_FOR_MODE } from '@/lib/klp/card-mode'

export const PROMOTE_CARDS = 3
export const PROMOTE_KLPS = 4
/** The node bar (rule 5). */
export const NODE_MIN_CARDS = 2
export const NODE_MIN_KLPS = 3
/** Vote weights (rule 2/3). */
export const VOTE_UNDER = 3
export const VOTE_CONTEXT = 1
/** A trailing word that names a facet of the same concept, not a concept (rule 7). */
export const FACET_SUFFIXES = new Set(['test', 'analysis', 'schedule', 'process', 'calculation', 'method', 'approach', 'treatment', 'impact', 'effect'])

export interface CardFragment {
  cardId: string
  term: string
  anchor: string
  domain: string
  leaves: { name: string; klpRefs: number[]; under: string }[]
  contexts: { klpRef: number; concept: string }[]
  relations: { klpRef: number; from: string; to: string; type: string }[]
  /** From `cardMode()`; absent means knowledge. */
  mode?: CardMode
}

export type NodeRole = 'domain' | 'anchor' | 'leaf' | 'context' | 'label' | 'alias'

export interface PlannedNode {
  /** Normalized name; the identity within this plan. */
  key: string
  name: string
  /** Normalized key of the parent, or null for a domain root. A label's parent is the node its points link to. */
  parent: string | null
  role: NodeRole
  /** concept | skill | calculation — from the modes of the cards that anchor here. */
  nature: 'concept' | 'skill' | 'calculation'
  status: 'candidate' | 'active'
  cards: string[]
  klps: number
  /** Weighted parent votes: parent key -> weight. */
  votes: Record<string, number>
  /** Parents this node was also voted under (cross-listed). */
  alsoUnder: string[]
  /** The vocabulary entry it matched (existing topic) or null when new to this plan. */
  matched: { kltId: string; name: string; rule: string; status?: string } | null
  /** For role 'alias': the surviving node's key. */
  mergedInto?: string
}

export interface AnchorCluster {
  members: string[]
  sharedChildren: string[]
  sharedWords: string[]
  wantsParent: boolean
}

export interface GeneralLink {
  cardId: string
  klpRefs: number[]
  /** Key of the general node an applied card's point exercises. */
  key: string
}

export interface TreePlan {
  setId: string
  domain: string
  nodes: PlannedNode[]
  clusters: AnchorCluster[]
  anchorMatches: Record<string, number>
  edges: { from: string; to: string; type: string; cards: string[] }[]
  /** Edges whose endpoint resolved to a general node by containment or through a label (the former roll-up). */
  rolledEdges: { from: string; to: string; type: string; cards: string[]; via: string[] }[]
  /** Edges dropped because an endpoint is not a node (rule 4). */
  droppedEdges: number
  /** Rank-2 links from an applied card's points to the general concepts they exercise (rule 6). */
  generalLinks: GeneralLink[]
  /** Containment pairs between real nodes for the caller's judge (rule 7): specific ⊂ general. */
  judgeCandidates: { specific: string; general: string }[]
  /** Merges performed (loser -> survivor). */
  merges: { from: string; into: string; rule: string }[]
  /** Card mode counts, for the report. */
  modes: Record<string, number>
}

const FILL = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'vs', 'versus', 'with', 'by', 'at', 'from', 'as', 'into', 'over', 'under', 'between'])
const words = (n: string) => new Set(normalizeName(n).split(' ').filter((t) => t && !FILL.has(t)))

/** The key with one trailing facet word removed, or null when there is none to remove. */
export function stripFacet(key: string): string | null {
  const t = key.split(' ')
  if (t.length < 2) return null
  return FACET_SUFFIXES.has(t[t.length - 1]) ? t.slice(0, -1).join(' ') : null
}

type Resolved = { key: string; matched: PlannedNode['matched']; placeUnder: string | null; kind: 'match' | 'related' | 'new' }

export function rebuildTree(setId: string, fragments: CardFragment[], vocab: VocabEntry[]): TreePlan {
  const nodes = new Map<string, PlannedNode>()
  const v = vocab.map((e) => ({ ...e, aliases: [...(e.aliases ?? [])] }))
  const anchorMatches: Record<string, number> = {}
  const modes: Record<string, number> = {}
  const domainName = fragments[0]?.domain ?? ''
  const domainKey = normalizeName(domainName) || 'domain'
  const order = new Map<string, number>()

  const resolveKey = (name: string, grow = true): Resolved => {
    const norm = normalizeName(name)
    const r = matchConcept(name, v)
    if (r.kind === 'match') return { key: r.entry.normalizedName, matched: { kltId: r.entry.kltId, name: r.entry.name, rule: r.rule, status: r.entry.status }, placeUnder: null, kind: 'match' }
    if (r.kind === 'related') {
      if (grow && !v.some((e) => e.normalizedName === norm)) v.push({ kltId: `plan:${norm}`, name, normalizedName: norm, aliases: [] })
      // containment places the SPECIFIC under the general; when the proposal is
      // the general one ("purchase price" against a stored "equity purchase
      // price") it is new, and the pair surfaces as a judge candidate instead
      if (words(norm).size < words(r.entry.normalizedName).size) return { key: norm, matched: null, placeUnder: null, kind: 'new' }
      return { key: norm, matched: null, placeUnder: r.entry.normalizedName, kind: 'related' }
    }
    if (grow && !v.some((e) => e.normalizedName === norm)) v.push({ kltId: `plan:${norm}`, name, normalizedName: norm, aliases: [] })
    return { key: norm, matched: null, placeUnder: null, kind: 'new' }
  }
  // a node's nature is the MAJORITY nature of the cards that anchor on it —
  // one "explain to a client" scenario must not turn accretion/dilution into a skill
  const natureVotes = new Map<string, Record<string, number>>()
  const touch = (key: string, name: string, role: NodeRole, cardId: string, klps: number, matched: PlannedNode['matched'], nature?: PlannedNode['nature']): PlannedNode => {
    let n = nodes.get(key)
    if (!n) { n = { key, name, parent: null, role, nature: 'concept', status: 'candidate', cards: [], klps: 0, votes: {}, alsoUnder: [], matched }; nodes.set(key, n); order.set(key, order.size) }
    if (!n.cards.includes(cardId)) n.cards.push(cardId)
    n.klps += klps
    if (role === 'anchor' && n.role !== 'domain') {
      n.role = 'anchor'
      if (!nature) return n // a leaf that is the anchor's own name: no second vote for this card
      const tally = natureVotes.get(key) ?? {}
      tally[nature] = (tally[nature] ?? 0) + 1
      natureVotes.set(key, tally)
      const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
      n.nature = top[1] * 2 > Object.values(tally).reduce((a, b) => a + b, 0) ? (top[0] as PlannedNode['nature']) : 'concept'
    }
    return n
  }
  const vote = (child: string, parent: string, weight: number) => { const n = nodes.get(child); if (n && parent !== child) n.votes[parent] = (n.votes[parent] ?? 0) + weight }

  nodes.set(domainKey, { key: domainKey, name: domainName || 'domain', parent: null, role: 'domain', nature: 'concept', status: 'active', cards: [], klps: 0, votes: {}, alsoUnder: [], matched: null })
  order.set(domainKey, 0)

  // 1. anchors first
  const anchorKey = new Map<string, string>()
  for (const f of fragments) {
    const mode = f.mode ?? 'knowledge'
    modes[mode] = (modes[mode] ?? 0) + 1
    const a = resolveKey(f.anchor)
    const rule = a.matched?.rule ?? (a.placeUnder ? 'placed' : 'new')
    anchorMatches[rule] = (anchorMatches[rule] ?? 0) + 1
    touch(a.key, f.anchor, 'anchor', f.cardId, 0, a.matched, NATURE_FOR_MODE[mode])
    vote(a.key, a.placeUnder ?? domainKey, VOTE_UNDER)
    anchorKey.set(f.cardId, a.key)
  }
  // an anchor placed under an existing topic no card named: bring it in (context under the domain)
  for (const n of [...nodes.values()]) {
    for (const parentKey of Object.keys(n.votes)) {
      if (nodes.has(parentKey)) continue
      const entry = v.find((e) => e.normalizedName === parentKey)
      if (!entry || entry.kltId.startsWith('plan:')) continue
      nodes.set(parentKey, { key: parentKey, name: entry.name, parent: domainKey, role: 'context', nature: 'concept', status: entry.status === 'candidate' ? 'candidate' : 'active', cards: [...n.cards], klps: 0, votes: { [domainKey]: VOTE_UNDER }, alsoUnder: [], matched: { kltId: entry.kltId, name: entry.name, rule: 'placed', status: entry.status } })
      order.set(parentKey, order.size)
    }
  }

  // 2. leaves and contexts
  const generalLinks: GeneralLink[] = []
  const appliedLabels: { key: string; name: string; cardId: string; anchor: string }[] = []
  for (const f of fragments) {
    const aKey = anchorKey.get(f.cardId)!
    const applied = (f.mode ?? 'knowledge') === 'applied'
    const leafKey = new Map<string, string>()
    for (const l of f.leaves) {
      const r = resolveKey(l.name, !applied)
      leafKey.set(normalizeName(l.name), r.key)
      if (r.key === aKey) { touch(r.key, l.name, 'anchor', f.cardId, l.klpRefs.length, r.matched); continue }
      if (applied) {
        // a general concept the case exercises: link, add the card as evidence; never a new node
        if (r.kind === 'match' && nodes.has(r.key)) { generalLinks.push({ cardId: f.cardId, klpRefs: l.klpRefs, key: r.key }); const g = nodes.get(r.key)!; if (!g.cards.includes(f.cardId)) g.cards.push(f.cardId) }
        else if (r.kind === 'related' && nodes.has(r.placeUnder!)) generalLinks.push({ cardId: f.cardId, klpRefs: l.klpRefs, key: r.placeUnder! })
        appliedLabels.push({ key: normalizeName(l.name), name: l.name, cardId: f.cardId, anchor: aKey })
        continue
      }
      touch(r.key, l.name, 'leaf', f.cardId, l.klpRefs.length, r.matched)
    }
    if (!applied) {
      for (const l of f.leaves) {
        const child = leafKey.get(normalizeName(l.name))!
        if (child === aKey) continue
        const u = normalizeName(l.under)
        const parent = u === normalizeName(f.anchor) ? aKey : (leafKey.get(u) ?? aKey)
        vote(child, parent, VOTE_UNDER)
      }
    }
    for (const c of f.contexts) {
      const r = resolveKey(c.concept)
      const target = r.kind === 'match' ? r.key : r.kind === 'related' ? r.placeUnder! : null
      if (target && nodes.has(target) && target !== aKey) {
        // the anchor sits within this broader concept
        const an = nodes.get(aKey)!
        if (!an.alsoUnder.includes(target)) an.alsoUnder.push(target)
        const g = nodes.get(target)!
        if (!g.cards.includes(f.cardId)) g.cards.push(f.cardId)
        g.klps += 1
        continue
      }
      touch(r.key, c.concept, 'context', f.cardId, 1, r.matched)
      vote(r.key, domainKey, VOTE_CONTEXT)
    }
  }

  // 3. parents: heaviest vote; ties to the parent with more cards, then the earlier one
  const rank = (a: string, b: string) => (nodes.get(b)?.cards.length ?? 0) - (nodes.get(a)?.cards.length ?? 0) || (order.get(a) ?? 0) - (order.get(b) ?? 0)
  for (const n of nodes.values()) {
    if (n.role === 'domain') continue
    const ranked = Object.entries(n.votes).filter(([k]) => nodes.has(k)).sort((x, y) => y[1] - x[1] || rank(x[0], y[0]))
    n.parent = ranked[0]?.[0] ?? domainKey
    for (const [k] of ranked.slice(1)) if (!n.alsoUnder.includes(k)) n.alsoUnder.push(k)
    if (n.parent === n.key) n.parent = domainKey
    n.alsoUnder = n.alsoUnder.filter((k) => k !== n.parent && k !== n.key)
    if (n.matched?.rule === 'placed') continue
    n.status = n.cards.length >= PROMOTE_CARDS && n.klps >= PROMOTE_KLPS ? 'active' : 'candidate'
  }
  const breakCycles = () => {
    for (const n of nodes.values()) {
      const seen = new Set<string>([n.key])
      let cur = n.parent
      while (cur && cur !== domainKey) {
        if (seen.has(cur)) { n.parent = domainKey; break }
        seen.add(cur)
        cur = nodes.get(cur)?.parent ?? null
      }
    }
  }
  breakCycles()

  // 4. consolidation by rule: a trailing facet word on an otherwise identical name
  const merges: TreePlan['merges'] = []
  const mergeInto = (loserKey: string, winnerKey: string, rule: string) => {
    const l = nodes.get(loserKey)!, w = nodes.get(winnerKey)!
    for (const c of l.cards) if (!w.cards.includes(c)) w.cards.push(c)
    w.klps += l.klps
    for (const [k, wt] of Object.entries(l.votes)) if (k !== winnerKey) w.votes[k] = (w.votes[k] ?? 0) + wt
    for (const k of l.alsoUnder) if (k !== winnerKey && !w.alsoUnder.includes(k) && k !== w.parent) w.alsoUnder.push(k)
    if (l.role === 'anchor' && w.role !== 'domain') w.role = 'anchor'
    if (l.nature !== 'concept' && w.nature === 'concept') w.nature = l.nature
    for (const n of nodes.values()) {
      if (n.parent === loserKey) n.parent = winnerKey === n.key ? domainKey : winnerKey
      n.alsoUnder = n.alsoUnder.map((k) => (k === loserKey ? winnerKey : k)).filter((k, i, arr) => k !== n.key && k !== n.parent && arr.indexOf(k) === i)
    }
    l.role = 'alias'; l.mergedInto = winnerKey; l.parent = winnerKey
    merges.push({ from: loserKey, into: winnerKey, rule })
  }
  for (const n of [...nodes.values()]) {
    if (n.role === 'domain' || n.role === 'alias') continue
    const base = stripFacet(n.key)
    if (!base || !nodes.has(base) || nodes.get(base)!.role === 'alias') continue
    mergeInto(n.key, base, 'facet')
  }
  breakCycles()

  // 5. the node bar
  // an EXISTING topic counts only when it is active — a candidate row a
  // previous write minted from one card is exactly what the bar is for
  const isNode = (n: PlannedNode) => n.role === 'domain' || n.role === 'anchor' || (n.matched !== null && !n.matched.kltId.startsWith('plan:') && n.matched.status === 'active') || n.cards.length >= NODE_MIN_CARDS || n.klps >= NODE_MIN_KLPS
  for (const n of nodes.values()) {
    if (n.role === 'alias' || isNode(n)) continue
    n.role = 'label'
  }
  const realParent = (key: string | null): string | null => {
    let cur = key
    const seen = new Set<string>()
    while (cur && !seen.has(cur)) { seen.add(cur); const p = nodes.get(cur); if (!p) return domainKey; if (p.role !== 'label' && p.role !== 'alias') return cur; cur = p.role === 'alias' ? (p.mergedInto ?? null) : p.parent }
    return domainKey
  }
  for (const n of nodes.values()) {
    if (n.role === 'domain' || n.role === 'label') continue
    if (n.parent) n.parent = realParent(n.parent)
    n.alsoUnder = n.alsoUnder.map((k) => realParent(k)).filter((k, i, arr): k is string => !!k && k !== n.key && k !== n.parent && k !== domainKey && arr.indexOf(k) === i)
  }
  for (const n of nodes.values()) if (n.role === 'label' && n.parent) n.parent = realParent(n.parent)
  // an applied card's leaves: labels under the skill node (unless the name is already a real node)
  for (const l of appliedLabels) {
    const ex = nodes.get(l.key)
    if (ex) { if (!ex.cards.includes(l.cardId)) ex.cards.push(l.cardId); continue }
    nodes.set(l.key, { key: l.key, name: l.name, parent: l.anchor, role: 'label', nature: 'concept', status: 'candidate', cards: [l.cardId], klps: 0, votes: {}, alsoUnder: [], matched: null })
    order.set(l.key, order.size)
  }

  // 6. judge candidates: containment between two real nodes, not already parent/child
  const real = [...nodes.values()].filter((n) => n.role !== 'label' && n.role !== 'alias' && n.role !== 'domain')
  const judgeCandidates: TreePlan['judgeCandidates'] = []
  for (const s of real) {
    const st = words(s.name)
    for (const g of real) {
      if (g === s) continue
      const gt = words(g.name)
      if (gt.size === 0 || gt.size >= st.size) continue
      if (![...gt].every((t) => st.has(t))) continue
      if (s.parent === g.key || g.parent === s.key) continue
      judgeCandidates.push({ specific: s.key, general: g.key })
    }
  }

  // 7. edges: endpoints must be real nodes (direct) or resolve to one through a label or by containment (rolled)
  const edges = new Map<string, { from: string; to: string; type: string; cards: string[] }>()
  const rolled = new Map<string, { from: string; to: string; type: string; cards: string[]; via: string[] }>()
  let droppedEdges = 0
  const endpoint = (name: string): { key: string; rolled: boolean } | null => {
    const r = resolveKey(name, false)
    const direct = nodes.get(r.key)
    if (direct?.role === 'alias' && direct.mergedInto) return { key: direct.mergedInto, rolled: false }
    if (direct?.role === 'label') return direct.parent && direct.parent !== domainKey ? { key: direct.parent, rolled: true } : null
    if (direct && direct.role !== 'domain') return { key: r.key, rolled: false }
    if (r.placeUnder) { const g = nodes.get(r.placeUnder); if (g && g.role !== 'label' && g.role !== 'alias' && g.role !== 'domain') return { key: r.placeUnder, rolled: true } }
    return null
  }
  for (const f of fragments) {
    for (const e of f.relations) {
      const from = endpoint(e.from), to = endpoint(e.to)
      if (!from || !to || from.key === to.key) { droppedEdges += 1; continue }
      const key = `${from.key}|${to.key}|${e.type}`
      if (from.rolled || to.rolled) {
        const via = [from.rolled ? `${e.from}→${from.key}` : '', to.rolled ? `${e.to}→${to.key}` : ''].filter(Boolean)
        const ex = rolled.get(key)
        if (ex) { if (!ex.cards.includes(f.cardId)) ex.cards.push(f.cardId); ex.via.push(...via) } else rolled.set(key, { from: from.key, to: to.key, type: e.type, cards: [f.cardId], via })
      } else {
        const ex = edges.get(key)
        if (ex) { if (!ex.cards.includes(f.cardId)) ex.cards.push(f.cardId) } else edges.set(key, { from: from.key, to: to.key, type: e.type, cards: [f.cardId] })
      }
    }
  }
  for (const [key, r] of rolled) { const ex = edges.get(key); if (ex) { for (const c of r.cards) if (!ex.cards.includes(c)) ex.cards.push(c); rolled.delete(key) } }

  // 8. anchor clusters
  const anchors = real.filter((n) => n.role === 'anchor')
  const childrenOf = (k: string) => new Set([...nodes.values()].filter((n) => n.role !== 'alias' && (n.parent === k || n.alsoUnder.includes(k))).map((n) => n.key))
  const clusters: AnchorCluster[] = []
  const assigned = new Set<string>()
  for (let i = 0; i < anchors.length; i++) {
    if (assigned.has(anchors[i].key)) continue
    const members = [anchors[i].key]
    const sharedChildren = new Set<string>()
    const sharedWords = new Set<string>()
    for (let j = i + 1; j < anchors.length; j++) {
      if (assigned.has(anchors[j].key)) continue
      const ci = childrenOf(anchors[i].key), cj = childrenOf(anchors[j].key)
      const shared = [...ci].filter((c) => cj.has(c))
      const wi = words(anchors[i].name), wj = words(anchors[j].name)
      const sw = [...wi].filter((w) => wj.has(w))
      if (shared.length > 0 || (sw.length > 0 && sw.length >= Math.min(wi.size, wj.size) / 2)) {
        members.push(anchors[j].key)
        shared.forEach((c) => sharedChildren.add(c))
        sw.forEach((w) => sharedWords.add(w))
      }
    }
    if (members.length > 1) {
      members.forEach((m) => assigned.add(m))
      clusters.push({ members, sharedChildren: [...sharedChildren], sharedWords: [...sharedWords], wantsParent: members.length >= PROMOTE_CARDS })
    }
  }

  return { setId, domain: domainName, nodes: [...nodes.values()], clusters, anchorMatches, edges: [...edges.values()], rolledEdges: [...rolled.values()], droppedEdges, generalLinks, judgeCandidates, merges, modes }
}

/** Apply a judge's verdicts (or the owner's) to a plan: merge `specific` into `general` where the verdict is 'same'. Mutates and returns the plan. */
export function applyMerges(plan: TreePlan, pairs: { specific: string; general: string; verdict: 'same' | 'related' | 'unrelated' }[]): TreePlan {
  const by = new Map(plan.nodes.map((n) => [n.key, n]))
  const domainKey = plan.nodes.find((n) => n.role === 'domain')!.key
  for (const p of pairs) {
    if (p.verdict !== 'same') continue
    let l = by.get(p.specific), w = by.get(p.general)
    if (!l || !w || l.role === 'alias' || w.role === 'alias' || l.role === 'domain' || w.role === 'domain') continue
    // the SURVIVOR is the node with more evidence; "accretion/dilution" (many
    // cards) judged the same as a one-card "dilution" keeps its name
    if (l.cards.length > w.cards.length || (l.cards.length === w.cards.length && l.role === 'anchor' && w.role !== 'anchor')) [l, w] = [w, l]
    for (const c of l.cards) if (!w.cards.includes(c)) w.cards.push(c)
    w.klps += l.klps
    if (l.role === 'anchor') w.role = 'anchor'
    for (const n of plan.nodes) {
      if (n.parent === l.key) n.parent = w.key === n.key ? domainKey : w.key
      n.alsoUnder = n.alsoUnder.map((k) => (k === l.key ? w.key : k)).filter((k, i, arr) => k !== n.key && k !== n.parent && arr.indexOf(k) === i)
    }
    for (const e of [...plan.edges, ...plan.rolledEdges]) { if (e.from === l.key) e.from = w.key; if (e.to === l.key) e.to = w.key }
    for (const g of plan.generalLinks) if (g.key === l.key) g.key = w.key
    l.role = 'alias'; l.mergedInto = w.key; l.parent = w.key
    plan.merges.push({ from: l.key, into: w.key, rule: 'judge' })
    if (w.cards.length >= PROMOTE_CARDS && w.klps >= PROMOTE_KLPS) w.status = 'active'
  }
  for (const n of plan.nodes) {
    let cur = n.parent
    const seen = new Set<string>()
    while (cur && by.get(cur)?.role === 'alias' && !seen.has(cur)) { seen.add(cur); cur = by.get(cur)!.mergedInto ?? domainKey }
    if (cur === n.key) cur = domainKey
    n.parent = cur
  }
  return plan
}

/** A readable tree, depth-first; labels are counted, aliases listed inline. */
export function renderTree(plan: TreePlan): string {
  const byParent = new Map<string | null, PlannedNode[]>()
  for (const n of plan.nodes) { if (n.role === 'label' || n.role === 'alias') continue; const arr = byParent.get(n.parent) ?? []; arr.push(n); byParent.set(n.parent, arr) }
  const labels = new Map<string, number>()
  for (const n of plan.nodes) if (n.role === 'label' && n.parent) labels.set(n.parent, (labels.get(n.parent) ?? 0) + 1)
  const aliases = new Map<string, string[]>()
  for (const n of plan.nodes) if (n.role === 'alias' && n.mergedInto) { const a = aliases.get(n.mergedInto) ?? []; a.push(n.name); aliases.set(n.mergedInto, a) }
  const nameOf = (k: string) => plan.nodes.find((x) => x.key === k)?.name ?? k
  const lines: string[] = []
  const walk = (key: string | null, depth: number) => {
    for (const n of (byParent.get(key) ?? []).sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name))) {
      lines.push(`${'  '.repeat(depth)}${n.name}  [${n.role}${n.nature !== 'concept' ? ' ' + n.nature : ''}${n.status === 'active' ? ', active' : ''}; ${n.cards.length} card${n.cards.length === 1 ? '' : 's'}, ${n.klps} klps${labels.get(n.key) ? `; ${labels.get(n.key)} labels` : ''}${n.alsoUnder.length ? `; also under ${n.alsoUnder.map(nameOf).join(', ')}` : ''}${aliases.get(n.key) ? `; = ${aliases.get(n.key)!.join(' = ')}` : ''}${n.matched ? `; ↔ ${n.matched.name} (${n.matched.rule})` : ''}]`)
      if (depth < 12) walk(n.key, depth + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}
