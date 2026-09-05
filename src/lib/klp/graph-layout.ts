/**
 * Where each key point sits when a card's relation graph is drawn.
 *
 * Pure geometry, no DOM, no React — so the layout can be tested with plain
 * assertions instead of by looking at a picture, and so the renderer
 * (`src/components/klp/KlpGraph.tsx`) contains no arithmetic worth arguing with.
 *
 * The shape it produces is a LAYERED left-to-right graph: a key point sits one
 * column to the right of everything it depends on. That is the right reading
 * for this data because the edge vocabulary is mostly derivational — `causes`,
 * `requires`, `precedes` all mean "this one comes out of that one" — so
 * horizontal position carries the meaning a reader is looking for, which is
 * "what has to be true before this step".
 *
 * SYMMETRIC EDGES DO NOT MOVE ANYTHING. `confused_with` asserts similarity, not
 * dependency; letting it push a node into a later column would draw a
 * derivation that the data never claimed.
 */
import { DIRECTED_TYPES, type RelationEdge } from '@/lib/klp/relations'

/** Box and spacing geometry, in SVG user units. */
export const NODE_WIDTH = 190
export const NODE_HEIGHT = 62
export const COLUMN_GAP = 96
export const ROW_GAP = 28
export const PADDING = 16

export interface LaidOutNode {
  index: number
  /** 0-based column; 0 is a starting point with nothing feeding it. */
  layer: number
  /** 0-based position within the column. */
  slot: number
  x: number
  y: number
}

export interface GraphLayout {
  nodes: LaidOutNode[]
  width: number
  height: number
  layerCount: number
}

function isDirected(type: string): boolean {
  return (DIRECTED_TYPES as readonly string[]).includes(type)
}

/**
 * The column each node belongs in: one past the deepest thing pointing at it.
 *
 * Relaxation rather than a topological sort, capped at `n` passes. Cycles are
 * pruned before persistence (`findCycles` in `relations.ts`), but this must not
 * be the code that discovers one by looping forever — a layout function that
 * hangs takes the whole page with it, and the honest failure here is a slightly
 * odd-looking graph, not a dead render.
 */
export function computeLayers(nodeCount: number, edges: RelationEdge[]): number[] {
  const layers = new Array<number>(nodeCount).fill(0)
  const directed = edges.filter(
    (e) => isDirected(e.type) && e.from < nodeCount && e.to < nodeCount && e.from !== e.to,
  )

  for (let pass = 0; pass < nodeCount; pass++) {
    let moved = false
    for (const e of directed) {
      const wanted = layers[e.from] + 1
      if (layers[e.to] < wanted) {
        layers[e.to] = wanted
        moved = true
      }
    }
    if (!moved) break
  }

  return layers
}

/**
 * Full geometry for a card's key points.
 *
 * Nodes keep their ORIGINAL ORDER within a column. The list beside the graph is
 * numbered K1..Kn in that same order, so a reader scanning down the list and
 * across the graph meets them in the same sequence; sorting columns by anything
 * cleverer (edge count, weight) would break that correspondence for a
 * prettier picture.
 */
export function layoutKlpGraph(nodeCount: number, edges: RelationEdge[]): GraphLayout {
  if (nodeCount <= 0) return { nodes: [], width: 0, height: 0, layerCount: 0 }

  const layers = computeLayers(nodeCount, edges)
  const layerCount = Math.max(...layers) + 1

  const slotCounters = new Array<number>(layerCount).fill(0)
  const nodes: LaidOutNode[] = []

  for (let index = 0; index < nodeCount; index++) {
    const layer = layers[index]
    const slot = slotCounters[layer]++
    nodes.push({
      index,
      layer,
      slot,
      x: PADDING + layer * (NODE_WIDTH + COLUMN_GAP),
      y: PADDING + slot * (NODE_HEIGHT + ROW_GAP),
    })
  }

  const rows = Math.max(...slotCounters)
  return {
    nodes,
    width: PADDING * 2 + layerCount * NODE_WIDTH + (layerCount - 1) * COLUMN_GAP,
    height: PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP,
    layerCount,
  }
}

export interface EdgeGeometry {
  /** SVG path `d` for the connector. */
  path: string
  /** Where the R-label sits. */
  labelX: number
  labelY: number
}

/**
 * The connector between two laid-out boxes.
 *
 * Forward edges (left to right) leave the right face and enter the left face,
 * as a cubic curve so crossings stay readable. An edge that goes BACKWARD or
 * stays in the same column cannot do that without drawing a line straight
 * through its own source box, so it routes under both nodes instead — which is
 * exactly the `confused_with` case, where the two endpoints are usually
 * siblings sitting in the same column.
 */
export function edgeGeometry(from: LaidOutNode, to: LaidOutNode): EdgeGeometry {
  const fromMidY = from.y + NODE_HEIGHT / 2
  const toMidY = to.y + NODE_HEIGHT / 2

  if (to.layer > from.layer) {
    const startX = from.x + NODE_WIDTH
    const endX = to.x
    const dx = Math.max(32, (endX - startX) / 2)
    return {
      path: `M ${startX} ${fromMidY} C ${startX + dx} ${fromMidY}, ${endX - dx} ${toMidY}, ${endX} ${toMidY}`,
      labelX: (startX + endX) / 2,
      labelY: (fromMidY + toMidY) / 2 - 8,
    }
  }

  // Same column or backwards: drop below both boxes and run across.
  const startX = from.x + NODE_WIDTH / 2
  const endX = to.x + NODE_WIDTH / 2
  const belowY = Math.max(from.y, to.y) + NODE_HEIGHT + ROW_GAP / 2
  return {
    path:
      `M ${startX} ${from.y + NODE_HEIGHT} ` +
      `C ${startX} ${belowY}, ${endX} ${belowY}, ${endX} ${to.y + NODE_HEIGHT}`,
    labelX: (startX + endX) / 2,
    labelY: belowY + 4,
  }
}

/** How each relation type is drawn. Mirrors the legend, one source for both. */
export const RELATION_STYLE: Record<
  string,
  { dash: string | undefined; tone: 'derivation' | 'confusion'; description: string }
> = {
  causes: { dash: undefined, tone: 'derivation', description: 'one step produces another' },
  requires: { dash: '6 3', tone: 'derivation', description: 'the second is only true if the first is' },
  precedes: { dash: '2 4', tone: 'derivation', description: 'must be said in this order' },
  applies_within: { dash: '10 3 2 3', tone: 'derivation', description: 'holds only in the other’s scope' },
  confused_with: { dash: '7 5', tone: 'confusion', description: 'learners mix these two up' },
  analogous_to: { dash: '7 5', tone: 'confusion', description: 'similar shape, different topic' },
}
