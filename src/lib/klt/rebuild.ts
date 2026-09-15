/**
 * THE SET-LEVEL TREE REBUILD (2026-09-15, minting plan step 4).
 *
 * Per-card minting produces one anchored fragment per card. This pass turns
 * a set's fragments into one tree, in pure TypeScript, by VOTES:
 *
 *  1. ANCHORS are matched into the growing vocabulary (`match.ts`): two
 *     cards whose anchors are the same concept (exact / alias / initials)
 *     share an anchor node. A containment hit places the specific anchor
 *     under the general one.
 *  2. EVERY `under` IS A VOTE for "child sits under parent". Leaves are
 *     matched into the vocabulary the same way, and each card's `under`
 *     chain votes for its placement. A node placed under two parents by
 *     different cards goes under the more-voted one and is cross-listed as
 *     a context under the other — nothing is discarded.
 *  3. EDGE ENDPOINTS AND ORPHAN CONTEXTS get placed by proximity: under the
 *     anchor of the card that mentions them most, unless a vote already
 *     places them.
 *  4. CLUSTER PARENTS: anchors that share children (a sub-leaf name in
 *     common) or whose names share content words are clustered; a cluster
 *     of three or more anchors is a candidate for a parent node above them
 *     (the owner's "semi-parent"). The cluster is reported with its members;
 *     naming it is the one model call this pass may need, and it is left to
 *     the caller — this module never invents a name.
 *  5. RECURRENCE is counted per node: cards and points linking it. Below
 *     `PROMOTE_CARDS` / `PROMOTE_KLPS` the node stays `candidate`.
 *
 * Output is a PLAN — nodes with parent, status, votes and evidence, plus the
 * clusters — printable and diffable, the same discipline as `mint-plan.ts`.
 * Nothing here touches the database.
 */
import { matchConcept, normalizeName, type VocabEntry } from '@/lib/klt/match'

export const PROMOTE_CARDS = 3
export const PROMOTE_KLPS = 4

export interface CardFragment {
  cardId: string
  term: string
  anchor: string
  domain: string
  leaves: { name: string; klpRefs: number[]; under: string }[]
  contexts: { klpRef: number; concept: string }[]
  relations: { klpRef: number; from: string; to: string; type: string }[]
}

export interface PlannedNode {
  /** Normalized name; the identity within this plan. */
  key: string
  name: string
  /** Normalized key of the parent, or null for a domain root. */
  parent: string | null
  role: 'domain' | 'anchor' | 'leaf' | 'endpoint' | 'context'
  status: 'candidate' | 'active'
  cards: string[]
  klps: number
  /** Parent votes as received: parent key -> count. */
  votes: Record<string, number>
  /** Parents this node was also voted under (cross-listed as a context). */
  alsoUnder: string[]
  /** The vocabulary entry it matched (existing topic) or null when new to this plan. */
  matched: { kltId: string; name: string; rule: string } | null
}

export interface AnchorCluster {
  members: string[]
  /** Why they cluster: shared children and/or shared content words. */
  sharedChildren: string[]
  sharedWords: string[]
  /** true when the cluster is big enough to warrant a parent above it. */
  wantsParent: boolean
}

export interface TreePlan {
  setId: string
  domain: string
  nodes: PlannedNode[]
  clusters: AnchorCluster[]
  /** Fragments whose anchor matched an existing vocabulary entry, by rule. */
  anchorMatches: Record<string, number>
  edges: { from: string; to: string; type: string; cards: string[] }[]
}

const FILL = new Set(['the', 'a', 'an', 'of', 'in', 'on', 'for', 'to', 'and', 'or', 'vs', 'versus', 'with', 'by', 'at', 'from', 'as', 'into', 'over', 'under', 'between'])
const words = (n: string) => new Set(normalizeName(n).split(' ').filter((t) => t && !FILL.has(t)))

export function rebuildTree(setId: string, fragments: CardFragment[], vocab: VocabEntry[]): TreePlan {
  const nodes = new Map<string, PlannedNode>()
  const v = vocab.map((e) => ({ ...e, aliases: [...(e.aliases ?? [])] }))
  const anchorMatches: Record<string, number> = {}
  const domainName = fragments[0]?.domain ?? ''
  const domainKey = normalizeName(domainName) || 'domain'

  const resolveKey = (name: string): { key: string; matched: PlannedNode['matched']; placeUnder: string | null } => {
    const norm = normalizeName(name)
    const r = matchConcept(name, v)
    if (r.kind === 'match') return { key: r.entry.normalizedName, matched: { kltId: r.entry.kltId, name: r.entry.name, rule: r.rule }, placeUnder: null }
    if (r.kind === 'related') {
      if (!v.some((e) => e.normalizedName === norm)) v.push({ kltId: `plan:${norm}`, name, normalizedName: norm, aliases: [] })
      return { key: norm, matched: null, placeUnder: r.entry.normalizedName }
    }
    if (!v.some((e) => e.normalizedName === norm)) v.push({ kltId: `plan:${norm}`, name, normalizedName: norm, aliases: [] })
    return { key: norm, matched: null, placeUnder: null }
  }
  const touch = (key: string, name: string, role: PlannedNode['role'], cardId: string, klps: number, matched: PlannedNode['matched']): PlannedNode => {
    let n = nodes.get(key)
    if (!n) { n = { key, name, parent: null, role, status: 'candidate', cards: [], klps: 0, votes: {}, alsoUnder: [], matched }; nodes.set(key, n) }
    if (!n.cards.includes(cardId)) n.cards.push(cardId)
    n.klps += klps
    if (role === 'anchor' && n.role !== 'domain') n.role = 'anchor'
    return n
  }
  const vote = (child: string, parent: string) => { const n = nodes.get(child); if (n && parent !== child) n.votes[parent] = (n.votes[parent] ?? 0) + 1 }

  nodes.set(domainKey, { key: domainKey, name: domainName || 'domain', parent: null, role: 'domain', status: 'active', cards: [], klps: 0, votes: {}, alsoUnder: [], matched: null })

  const edges = new Map<string, { from: string; to: string; type: string; cards: string[] }>()
  for (const f of fragments) {
    const a = resolveKey(f.anchor)
    anchorMatches[a.matched?.rule ?? (a.placeUnder ? 'placed' : 'new')] = (anchorMatches[a.matched?.rule ?? (a.placeUnder ? 'placed' : 'new')] ?? 0) + 1
    touch(a.key, f.anchor, 'anchor', f.cardId, 0, a.matched)
    vote(a.key, a.placeUnder ?? domainKey)
    const leafKey = new Map<string, string>()
    for (const l of f.leaves) {
      const r = resolveKey(l.name)
      leafKey.set(normalizeName(l.name), r.key)
      touch(r.key, l.name, r.key === a.key ? 'anchor' : 'leaf', f.cardId, l.klpRefs.length, r.matched)
    }
    for (const l of f.leaves) {
      const child = leafKey.get(normalizeName(l.name))!
      if (child === a.key) continue
      const u = normalizeName(l.under)
      const parent = u === normalizeName(f.anchor) ? a.key : (leafKey.get(u) ?? a.key)
      vote(child, parent)
    }
    for (const c of f.contexts) {
      const r = resolveKey(c.concept)
      touch(r.key, c.concept, 'context', f.cardId, 1, r.matched)
      vote(r.key, r.placeUnder ?? a.key)
    }
    for (const e of f.relations) {
      const from = resolveKey(e.from), to = resolveKey(e.to)
      for (const [r, nm] of [[from, e.from], [to, e.to]] as const) {
        if (!nodes.has(r.key)) touch(r.key, nm, 'endpoint', f.cardId, 0, r.matched)
        else if (!nodes.get(r.key)!.cards.includes(f.cardId)) nodes.get(r.key)!.cards.push(f.cardId)
        if (r.placeUnder) vote(r.key, r.placeUnder)
        else if (Object.keys(nodes.get(r.key)!.votes).length === 0) vote(r.key, a.key)
      }
      const ek = `${from.key}|${to.key}|${e.type}`
      const ex = edges.get(ek)
      if (ex) { if (!ex.cards.includes(f.cardId)) ex.cards.push(f.cardId) } else edges.set(ek, { from: from.key, to: to.key, type: e.type, cards: [f.cardId] })
    }
  }

  // Resolve parents: the most-voted, ties to the earlier-seen; cross-list the rest.
  for (const n of nodes.values()) {
    if (n.role === 'domain') continue
    const ranked = Object.entries(n.votes).sort((x, y) => y[1] - x[1])
    n.parent = ranked[0]?.[0] ?? domainKey
    n.alsoUnder = ranked.slice(1).map((r) => r[0])
    if (n.parent === n.key) n.parent = domainKey
    n.status = n.cards.length >= PROMOTE_CARDS && n.klps >= PROMOTE_KLPS ? 'active' : 'candidate'
  }
  // Break parent cycles by lifting the later node to the domain.
  for (const n of nodes.values()) {
    const seen = new Set<string>([n.key])
    let cur = n.parent
    while (cur && cur !== domainKey) {
      if (seen.has(cur)) { n.parent = domainKey; break }
      seen.add(cur)
      cur = nodes.get(cur)?.parent ?? null
    }
  }

  // Anchor clusters: shared children or shared content words.
  const anchors = [...nodes.values()].filter((n) => n.role === 'anchor')
  const childrenOf = (k: string) => new Set([...nodes.values()].filter((n) => n.parent === k || n.alsoUnder.includes(k)).map((n) => n.key))
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

  return { setId, domain: domainName, nodes: [...nodes.values()], clusters, anchorMatches, edges: [...edges.values()] }
}

/** A readable tree, depth-first, for the console and the artifact. */
export function renderTree(plan: TreePlan): string {
  const byParent = new Map<string | null, PlannedNode[]>()
  for (const n of plan.nodes) { const arr = byParent.get(n.parent) ?? []; arr.push(n); byParent.set(n.parent, arr) }
  const lines: string[] = []
  const walk = (key: string | null, depth: number) => {
    for (const n of (byParent.get(key) ?? []).sort((a, b) => b.cards.length - a.cards.length || a.name.localeCompare(b.name))) {
      lines.push(`${'  '.repeat(depth)}${n.name}  [${n.role}${n.status === 'active' ? ', active' : ''}; ${n.cards.length} card${n.cards.length === 1 ? '' : 's'}, ${n.klps} klps${n.alsoUnder.length ? `; also under ${n.alsoUnder.length}` : ''}${n.matched ? `; = ${n.matched.name} (${n.matched.rule})` : ''}]`)
      if (depth < 12) walk(n.key, depth + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}
