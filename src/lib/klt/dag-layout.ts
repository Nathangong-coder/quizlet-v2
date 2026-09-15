/**
 * Pure geometry for the DEPENDENCY view of a set (2026-09-15). The concept
 * tree answers "what is part of what"; this answers "what depends on what" —
 * the directed `KltRelation` edges the minting loop wrote (`causes`,
 * `requires`, `precedes`, `applies_within`), laid out left-to-right in
 * layers so an arrow always points forward. Same posture as `layout.ts`: no
 * React, no DOM, no Prisma; a bug here misdraws a picture and nothing else.
 *
 *   1. keep the directed edges that pass the caller's filter (min cards,
 *      provenance, an optional focus node with its k-hop neighbourhood);
 *   2. break cycles by dropping the back-edges a DFS finds (the writer
 *      already refuses an edge that closes a cycle, so this is belt-and-
 *      braces for hand-made relations);
 *   3. layer by longest path from a source — a node sits one column right of
 *      its furthest prerequisite;
 *   4. order each layer by the barycentre of its neighbours, two sweeps, so
 *      the picture has fewer crossings than the input order would give;
 *   5. position: columns left→right, rows top→bottom, every layer vertically
 *      centred on the tallest one.
 *
 * Edge weight is the card count behind the relation — one card is
 * contextual, many is structural — and the drawing scales stroke width by
 * it rather than hiding the light ones; the owner's call (2026-09-15) was
 * "all directed edges weighted by card count", not a ≥2-card rule.
 */
import { DIRECTED_TYPES } from '@/lib/klp/relations'

export interface DagInputNode {
  kltId: string
  name: string
}

export interface DagInputEdge {
  fromKltId: string
  toKltId: string
  type: string
  provenance: string
  cardCount: number
}

export interface DagFilter {
  /** Keep edges with at least this many cards behind them (default 1). */
  minCards?: number
  /** Keep only these provenances; undefined keeps all. */
  provenances?: Set<string>
  /** Keep only the focus node and everything within `hops` directed steps of it, either direction. */
  focusKltId?: string | null
  hops?: number
}

export interface DagOptions {
  nodeWidth?: number
  nodeHeight?: number
  /** Gap between one layer (column) and the next. */
  hGap?: number
  /** Gap between nodes stacked in one column. */
  vGap?: number
}

export const DAG_DEFAULTS = {
  nodeWidth: 168,
  nodeHeight: 44,
  hGap: 96,
  vGap: 14,
} as const

export interface DagNode {
  kltId: string
  name: string
  layer: number
  /** Left edge / top edge of the box. */
  x: number
  y: number
  inDegree: number
  outDegree: number
}

export interface DagEdge {
  fromKltId: string
  toKltId: string
  type: string
  provenance: string
  cardCount: number
  /** An SVG `d`: a cubic from the right edge of `from` to the left edge of `to`. */
  path: string
  midX: number
  midY: number
  /** True when the edge was dropped from layering to break a cycle; still drawn, dashed. */
  backEdge: boolean
}

export interface DagLayout {
  nodes: DagNode[]
  edges: DagEdge[]
  width: number
  height: number
  layers: number
  /** How many directed edges the filter kept, before cycle breaking. */
  kept: number
  /** How many directed edges the input had in total. */
  total: number
}

const isDirected = (t: string) => (DIRECTED_TYPES as readonly string[]).includes(t)
const round = (n: number) => Math.round(n * 100) / 100

/** Step 1: the directed edges that survive the filter, and the nodes they touch. */
export function filterDag(nodes: DagInputNode[], edges: DagInputEdge[], filter: DagFilter = {}): { nodes: DagInputNode[]; edges: DagInputEdge[]; total: number } {
  const known = new Set(nodes.map((n) => n.kltId))
  const directed = edges.filter((e) => isDirected(e.type) && known.has(e.fromKltId) && known.has(e.toKltId) && e.fromKltId !== e.toKltId)
  const minCards = filter.minCards ?? 1
  let kept = directed.filter((e) => e.cardCount >= minCards && (!filter.provenances || filter.provenances.has(e.provenance)))
  if (filter.focusKltId && known.has(filter.focusKltId)) {
    const hops = filter.hops ?? 2
    const reach = new Set<string>([filter.focusKltId])
    let frontier = [filter.focusKltId]
    for (let h = 0; h < hops && frontier.length; h++) {
      const next: string[] = []
      for (const e of kept) {
        if (frontier.includes(e.fromKltId) && !reach.has(e.toKltId)) { reach.add(e.toKltId); next.push(e.toKltId) }
        if (frontier.includes(e.toKltId) && !reach.has(e.fromKltId)) { reach.add(e.fromKltId); next.push(e.fromKltId) }
      }
      frontier = next
    }
    kept = kept.filter((e) => reach.has(e.fromKltId) && reach.has(e.toKltId))
  }
  const touched = new Set<string>()
  for (const e of kept) { touched.add(e.fromKltId); touched.add(e.toKltId) }
  if (filter.focusKltId && known.has(filter.focusKltId)) touched.add(filter.focusKltId)
  return { nodes: nodes.filter((n) => touched.has(n.kltId)), edges: kept, total: directed.length }
}

/** Step 2: DFS back-edges, as a set of `from|to` keys. */
export function findBackEdges(nodeIds: string[], edges: { fromKltId: string; toKltId: string }[]): Set<string> {
  const out = new Map<string, string[]>()
  for (const id of nodeIds) out.set(id, [])
  for (const e of edges) out.get(e.fromKltId)?.push(e.toKltId)
  const state = new Map<string, 0 | 1 | 2>()
  const back = new Set<string>()
  const visit = (u: string) => {
    state.set(u, 1)
    for (const v of out.get(u) ?? []) {
      const s = state.get(v) ?? 0
      if (s === 1) back.add(`${u}|${v}`)
      else if (s === 0) visit(v)
    }
    state.set(u, 2)
  }
  for (const id of nodeIds) if ((state.get(id) ?? 0) === 0) visit(id)
  return back
}

/** Step 3: longest-path layering over the acyclic edge set. */
export function assignLayers(nodeIds: string[], edges: { fromKltId: string; toKltId: string }[]): Map<string, number> {
  const inc = new Map<string, string[]>()
  const indeg = new Map<string, number>()
  for (const id of nodeIds) { inc.set(id, []); indeg.set(id, 0) }
  for (const e of edges) { inc.get(e.toKltId)?.push(e.fromKltId); indeg.set(e.toKltId, (indeg.get(e.toKltId) ?? 0) + 1) }
  const layer = new Map<string, number>()
  // Kahn order guarantees every predecessor is layered before its successor.
  const queue = nodeIds.filter((id) => (indeg.get(id) ?? 0) === 0)
  const out = new Map<string, string[]>()
  for (const id of nodeIds) out.set(id, [])
  for (const e of edges) out.get(e.fromKltId)?.push(e.toKltId)
  const remaining = new Map(indeg)
  while (queue.length) {
    const u = queue.shift()!
    const preds = inc.get(u) ?? []
    layer.set(u, preds.length ? Math.max(...preds.map((p) => layer.get(p) ?? 0)) + 1 : 0)
    for (const v of out.get(u) ?? []) {
      remaining.set(v, (remaining.get(v) ?? 1) - 1)
      if (remaining.get(v) === 0) queue.push(v)
    }
  }
  for (const id of nodeIds) if (!layer.has(id)) layer.set(id, 0)
  return layer
}

/** Step 4: barycentre ordering, two sweeps (down then up), returns ordered ids per layer. */
export function orderLayers(nodeIds: string[], names: Map<string, string>, layer: Map<string, number>, edges: { fromKltId: string; toKltId: string }[]): string[][] {
  const count = nodeIds.length ? Math.max(...nodeIds.map((id) => layer.get(id) ?? 0)) + 1 : 0
  const layers: string[][] = Array.from({ length: count }, () => [])
  for (const id of [...nodeIds].sort((a, b) => (names.get(a) ?? '').localeCompare(names.get(b) ?? ''))) layers[layer.get(id) ?? 0].push(id)
  const preds = new Map<string, string[]>()
  const succs = new Map<string, string[]>()
  for (const e of edges) {
    if (!preds.has(e.toKltId)) preds.set(e.toKltId, [])
    preds.get(e.toKltId)!.push(e.fromKltId)
    if (!succs.has(e.fromKltId)) succs.set(e.fromKltId, [])
    succs.get(e.fromKltId)!.push(e.toKltId)
  }
  const sweep = (neighbours: Map<string, string[]>, from: number, to: number, step: number) => {
    for (let i = from; i !== to; i += step) {
      const ref = new Map(layers[i - step].map((id, idx) => [id, idx]))
      const bary = new Map<string, number>()
      layers[i].forEach((id, idx) => {
        const ns = (neighbours.get(id) ?? []).map((n) => ref.get(n)).filter((v): v is number => v !== undefined)
        bary.set(id, ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : idx)
      })
      layers[i].sort((a, b) => (bary.get(a)! - bary.get(b)!) || (names.get(a) ?? '').localeCompare(names.get(b) ?? ''))
    }
  }
  if (count > 1) {
    sweep(preds, 1, count, 1)
    sweep(succs, count - 2, -1, -1)
    sweep(preds, 1, count, 1)
  }
  return layers
}

/** Steps 1-5 together. */
export function layoutDag(nodesIn: DagInputNode[], edgesIn: DagInputEdge[], filter: DagFilter = {}, options: DagOptions = {}): DagLayout {
  const opt = { ...DAG_DEFAULTS, ...options }
  const { nodes, edges, total } = filterDag(nodesIn, edgesIn, filter)
  const ids = nodes.map((n) => n.kltId)
  const names = new Map(nodes.map((n) => [n.kltId, n.name]))
  const back = findBackEdges(ids, edges)
  const forward = edges.filter((e) => !back.has(`${e.fromKltId}|${e.toKltId}`))
  const layer = assignLayers(ids, forward)
  const layers = orderLayers(ids, names, layer, forward)

  const tallest = Math.max(0, ...layers.map((l) => l.length))
  const height = tallest * opt.nodeHeight + Math.max(0, tallest - 1) * opt.vGap
  const pos = new Map<string, DagNode>()
  const indeg = new Map<string, number>()
  const outdeg = new Map<string, number>()
  for (const e of edges) { indeg.set(e.toKltId, (indeg.get(e.toKltId) ?? 0) + 1); outdeg.set(e.fromKltId, (outdeg.get(e.fromKltId) ?? 0) + 1) }
  layers.forEach((ids, li) => {
    const colHeight = ids.length * opt.nodeHeight + Math.max(0, ids.length - 1) * opt.vGap
    const top = (height - colHeight) / 2
    ids.forEach((id, ri) => {
      pos.set(id, {
        kltId: id,
        name: names.get(id) ?? id,
        layer: li,
        x: round(li * (opt.nodeWidth + opt.hGap)),
        y: round(top + ri * (opt.nodeHeight + opt.vGap)),
        inDegree: indeg.get(id) ?? 0,
        outDegree: outdeg.get(id) ?? 0,
      })
    })
  })

  const laidEdges: DagEdge[] = edges.map((e) => {
    const a = pos.get(e.fromKltId)!
    const b = pos.get(e.toKltId)!
    const x1 = a.x + opt.nodeWidth, y1 = a.y + opt.nodeHeight / 2
    const x2 = b.x, y2 = b.y + opt.nodeHeight / 2
    const isBack = back.has(`${e.fromKltId}|${e.toKltId}`)
    const dx = Math.max(24, Math.abs(x2 - x1) / 2)
    const path = isBack
      ? `M ${round(a.x)} ${round(y1)} C ${round(a.x - dx)} ${round(y1)}, ${round(b.x + opt.nodeWidth + dx)} ${round(y2)}, ${round(b.x + opt.nodeWidth)} ${round(y2)}`
      : `M ${round(x1)} ${round(y1)} C ${round(x1 + dx)} ${round(y1)}, ${round(x2 - dx)} ${round(y2)}, ${round(x2)} ${round(y2)}`
    return { ...e, path, midX: round((x1 + x2) / 2), midY: round((y1 + y2) / 2), backEdge: isBack }
  })

  const width = layers.length ? layers.length * opt.nodeWidth + (layers.length - 1) * opt.hGap : 0
  return { nodes: [...pos.values()], edges: laidEdges, width: round(width), height: round(height), layers: layers.length, kept: edges.length, total }
}
