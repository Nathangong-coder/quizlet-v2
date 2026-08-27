/**
 * Pure geometry for the top-down concept canvas. No React, no DOM, no Prisma —
 * given a flat list of visible nodes it returns where each one sits and the
 * connector path between each parent and child.
 *
 * Kept separate from `tree.ts` on purpose: that module owns what the tree
 * MEANS (depth, ancestry, cycles — values that get persisted and drive
 * mastery), this one owns only what it LOOKS like. A bug here misdraws a
 * picture; a bug there corrupts a learner's rollup. They deserve different
 * blast radii and different tests.
 *
 * Everything is keyed on `kltId`, matching the rest of the KLT code: a
 * `SetKltNode` row id never enters the layout.
 */

/** The minimum a node needs for layout — name is used only for sibling order. */
export interface LayoutNode {
  kltId: string
  parentKltId: string | null
  name: string
}

export interface LayoutOptions {
  nodeWidth?: number
  nodeHeight?: number
  /** Horizontal gap between adjacent node boxes. */
  hGap?: number
  /** Vertical gap between one level and the next. */
  vGap?: number
  /** Corner radius on the elbow connectors. */
  cornerRadius?: number
}

export const LAYOUT_DEFAULTS = {
  nodeWidth: 176,
  nodeHeight: 64,
  hGap: 28,
  vGap: 56,
  cornerRadius: 12,
} as const

/**
 * A laid-out node. `x` is the box's HORIZONTAL CENTRE and `y` is its TOP edge
 * — centre-x because a parent is centred over its children, top-y because
 * connectors leave from the bottom edge and arrive at the top edge.
 *
 * `depth` is depth WITHIN THE VISIBLE TREE, which is not always the stored
 * `SetKltNode.depth`: under a filter, a node whose ancestors are hidden is
 * drawn as a root at depth 0. Drawing it at its stored depth would leave a
 * column of empty space above a node with nothing to connect to.
 */
export interface PositionedNode {
  kltId: string
  x: number
  y: number
  depth: number
}

export interface LayoutEdge {
  parentKltId: string
  childKltId: string
  /** An SVG `d` attribute: down, across, down, with rounded corners. */
  path: string
}

export interface TreeLayout {
  nodes: PositionedNode[]
  edges: LayoutEdge[]
  /** Full extent of the drawing, so the canvas can size its viewport. */
  width: number
  height: number
  byKltId: Map<string, PositionedNode>
}

/** Two decimals — enough for sub-pixel smoothness, stable enough to assert on. */
function round(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * An elbow from a parent's bottom edge to a child's top edge: straight down to
 * the midpoint between the two levels, across, then down again, with the two
 * corners rounded.
 *
 * The radius shrinks to fit when a corner is tight, so a nearly-vertical edge
 * degrades to a straight line instead of drawing an arc wider than the gap it
 * is turning inside of.
 */
export function elbowPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cornerRadius: number,
): string {
  const midY = (y1 + y2) / 2
  const dx = x2 - x1
  // Directly beneath: no corner to round, and a Q with zero horizontal travel
  // renders as a visible nub in some browsers.
  if (Math.abs(dx) < 0.5) return `M ${round(x1)} ${round(y1)} L ${round(x2)} ${round(y2)}`

  const dir = dx > 0 ? 1 : -1
  const r = Math.min(cornerRadius, Math.abs(dx) / 2, Math.abs(midY - y1), Math.abs(y2 - midY))

  return [
    `M ${round(x1)} ${round(y1)}`,
    `L ${round(x1)} ${round(midY - r)}`,
    `Q ${round(x1)} ${round(midY)} ${round(x1 + dir * r)} ${round(midY)}`,
    `L ${round(x2 - dir * r)} ${round(midY)}`,
    `Q ${round(x2)} ${round(midY)} ${round(x2)} ${round(midY + r)}`,
    `L ${round(x2)} ${round(y2)}`,
  ].join(' ')
}

/**
 * Lay out the visible nodes as a tidy top-down tree.
 *
 * The classic two-rule layout: **leaves take consecutive horizontal slots,
 * and every parent is centred over its own children.** Because sibling
 * subtrees occupy disjoint runs of slots, and a node is always inside its own
 * subtree's run, no two boxes on the same level can overlap — which is the
 * property the tests pin, since it is the one a reader notices when it breaks.
 *
 * **A node whose parent is not in `nodes` is drawn as a root.** That is not a
 * defensive nicety, it is the filter and collapse behaviour: the caller passes
 * only what should be visible, and a node whose ancestors were filtered out
 * still has to appear somewhere.
 *
 * **Every input node is drawn, always.** A parent cycle leaves its members
 * unreachable from any root, so a final sweep draws whatever the root walk
 * missed as roots of their own. Dropping them instead would make a corrupt
 * row invisible in the one screen built to fix it.
 */
export function layoutTree(nodes: LayoutNode[], options: LayoutOptions = {}): TreeLayout {
  const { nodeWidth, nodeHeight, hGap, vGap, cornerRadius } = { ...LAYOUT_DEFAULTS, ...options }

  const present = new Set(nodes.map((n) => n.kltId))
  const childrenOf = new Map<string, LayoutNode[]>()
  const roots: LayoutNode[] = []

  for (const n of nodes) {
    // A parent outside the visible set makes this node a root of its own
    // visible tree; so does a self-reference, which no valid row has but a
    // hand-edited one might.
    if (n.parentKltId === null || !present.has(n.parentKltId) || n.parentKltId === n.kltId) {
      roots.push(n)
      continue
    }
    const list = childrenOf.get(n.parentKltId)
    if (list) list.push(n)
    else childrenOf.set(n.parentKltId, [n])
  }

  const bySiblingOrder = (a: LayoutNode, b: LayoutNode) =>
    a.name.localeCompare(b.name) || a.kltId.localeCompare(b.kltId)
  roots.sort(bySiblingOrder)
  for (const list of childrenOf.values()) list.sort(bySiblingOrder)

  const slotWidth = nodeWidth + hGap
  const positioned: PositionedNode[] = []
  const byKltId = new Map<string, PositionedNode>()
  const edges: LayoutEdge[] = []
  let nextLeafSlot = 0

  // Guards a cycle among nodes whose parents are all present — `walk` would
  // otherwise recurse forever. Cannot happen through the actions (every write
  // runs `wouldCycle` first) but the canvas must not be the thing that hangs
  // if it ever does.
  const visited = new Set<string>()

  /** Post-order: children first, then centre the parent over them. */
  const walk = (node: LayoutNode, depth: number): number => {
    if (visited.has(node.kltId)) return nextLeafSlot * slotWidth + nodeWidth / 2
    visited.add(node.kltId)

    const children = childrenOf.get(node.kltId) ?? []
    let x: number
    if (children.length === 0) {
      x = nextLeafSlot * slotWidth + nodeWidth / 2
      nextLeafSlot += 1
    } else {
      const childXs = children.map((c) => walk(c, depth + 1))
      x = (childXs[0] + childXs[childXs.length - 1]) / 2
    }

    const y = depth * (nodeHeight + vGap)
    const entry: PositionedNode = { kltId: node.kltId, x: round(x), y: round(y), depth }
    positioned.push(entry)
    byKltId.set(node.kltId, entry)

    for (const child of children) {
      const childPos = byKltId.get(child.kltId)
      if (!childPos) continue
      edges.push({
        parentKltId: node.kltId,
        childKltId: child.kltId,
        path: elbowPath(x, y + nodeHeight, childPos.x, childPos.y, cornerRadius),
      })
    }
    return x
  }

  for (const root of roots) walk(root, 0)

  // Anything a root could not reach is drawn as its own root. Only a parent
  // cycle produces this — every member of a cycle has a present parent, so
  // none of them qualifies as a root and the whole ring would otherwise be
  // silently omitted from the canvas. Showing it detached is how a corruption
  // becomes visible instead of becoming invisible.
  for (const node of [...nodes].sort(bySiblingOrder)) {
    if (!visited.has(node.kltId)) walk(node, 0)
  }

  const maxX = positioned.reduce((m, p) => Math.max(m, p.x), 0)
  const maxDepth = positioned.reduce((m, p) => Math.max(m, p.depth), 0)

  return {
    nodes: positioned,
    edges,
    width: positioned.length === 0 ? 0 : round(maxX + nodeWidth / 2),
    height: positioned.length === 0 ? 0 : round(maxDepth * (nodeHeight + vGap) + nodeHeight),
    byKltId,
  }
}
