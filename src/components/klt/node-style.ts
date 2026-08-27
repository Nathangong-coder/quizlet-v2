/**
 * The node palette and icon set for the concept canvas, plus the inheritance
 * rule that turns one choice at a branch's root into a whole branch that reads
 * as a family.
 *
 * The KEY LISTS live in `src/lib/klt/node-style.ts`, not here: `setNodeStyle`
 * validates against them server-side and must not pull lucide into a server
 * action to do it. This module is the presentation half — key to classes, key
 * to glyph — and a test pins that it covers those lists exactly.
 *
 * Colours are stored as palette KEYS (`violet`, `teal`, …), never as raw
 * colour values. Two reasons, both learned the hard way elsewhere in this
 * codebase: a stored hex ignores the theme and turns unreadable in dark mode,
 * and a stored arbitrary value cannot be re-themed later without a data
 * migration. The key maps to the existing `--chart-N` tokens, which are
 * already defined for both themes.
 */
import {
  Atom,
  Brain,
  BookOpen,
  Building2,
  Calculator,
  Coins,
  Dna,
  FlaskConical,
  Folder,
  Gavel,
  Globe,
  Landmark,
  Languages,
  Layers,
  LineChart,
  Lightbulb,
  Network,
  Percent,
  Puzzle,
  Scale,
  Shapes,
  Sigma,
  Target,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react'
import {
  NODE_COLOR_KEYS,
  NODE_ICON_KEYS,
  isNodeColorKey,
  isNodeIconKey,
  type NodeColorKey,
  type NodeIconKey,
} from '@/lib/klt/node-style'

export { NODE_COLOR_KEYS, NODE_ICON_KEYS, isNodeColorKey, isNodeIconKey }
export type { NodeColorKey, NodeIconKey }

/**
 * Every class written out in full, never assembled from fragments — Tailwind
 * scans source text, so `bg-chart-${n}` would compile to nothing at all and
 * every node would render colourless.
 */
export interface NodeColorClasses {
  label: string
  /** The accent bar across the top of a node card. */
  bar: string
  /** Card border when this colour applies. */
  border: string
  /** Faint card fill, so a colour reads even at a glance. */
  fill: string
  /** Icon and swatch colour. */
  text: string
  /** Connector stroke for edges INTO a node of this colour. */
  stroke: string
}

export const NODE_COLORS: Record<NodeColorKey, NodeColorClasses> = {
  violet: {
    label: 'Violet',
    bar: 'bg-chart-1',
    border: 'border-chart-1/50',
    fill: 'bg-chart-1/10',
    text: 'text-chart-1',
    stroke: 'stroke-chart-1/60',
  },
  teal: {
    label: 'Teal',
    bar: 'bg-chart-2',
    border: 'border-chart-2/50',
    fill: 'bg-chart-2/10',
    text: 'text-chart-2',
    stroke: 'stroke-chart-2/60',
  },
  green: {
    label: 'Green',
    bar: 'bg-chart-3',
    border: 'border-chart-3/50',
    fill: 'bg-chart-3/10',
    text: 'text-chart-3',
    stroke: 'stroke-chart-3/60',
  },
  amber: {
    label: 'Amber',
    bar: 'bg-chart-4',
    border: 'border-chart-4/50',
    fill: 'bg-chart-4/10',
    text: 'text-chart-4',
    stroke: 'stroke-chart-4/60',
  },
  rose: {
    label: 'Rose',
    bar: 'bg-chart-5',
    border: 'border-chart-5/50',
    fill: 'bg-chart-5/10',
    text: 'text-chart-5',
    stroke: 'stroke-chart-5/60',
  },
}

/** What a node with no colour anywhere up its chain looks like. */
export const NEUTRAL_NODE_COLOR: NodeColorClasses = {
  label: 'Default',
  bar: 'bg-border',
  border: 'border-border',
  fill: 'bg-card',
  text: 'text-muted-foreground',
  stroke: 'stroke-border',
}

export const NODE_ICONS: Record<NodeIconKey, { label: string; Icon: LucideIcon }> = {
  folder: { label: 'Folder', Icon: Folder },
  layers: { label: 'Layers', Icon: Layers },
  network: { label: 'Network', Icon: Network },
  shapes: { label: 'Shapes', Icon: Shapes },
  book: { label: 'Book', Icon: BookOpen },
  brain: { label: 'Brain', Icon: Brain },
  idea: { label: 'Idea', Icon: Lightbulb },
  target: { label: 'Target', Icon: Target },
  puzzle: { label: 'Puzzle', Icon: Puzzle },
  calculator: { label: 'Calculator', Icon: Calculator },
  sigma: { label: 'Formula', Icon: Sigma },
  percent: { label: 'Percent', Icon: Percent },
  chart: { label: 'Chart', Icon: LineChart },
  trending: { label: 'Trend', Icon: TrendingUp },
  coins: { label: 'Money', Icon: Coins },
  bank: { label: 'Bank', Icon: Landmark },
  company: { label: 'Company', Icon: Building2 },
  scale: { label: 'Balance', Icon: Scale },
  gavel: { label: 'Law', Icon: Gavel },
  flask: { label: 'Chemistry', Icon: FlaskConical },
  atom: { label: 'Physics', Icon: Atom },
  dna: { label: 'Biology', Icon: Dna },
  globe: { label: 'Geography', Icon: Globe },
  language: { label: 'Language', Icon: Languages },
}

/**
 * The icon for a key, or `Folder` for an unknown one.
 *
 * `SetKltNode.icon` is a free-text column, so a value written by an older
 * build, a hand-run SQL statement, or a future rename of this map can arrive
 * here. Falling back beats throwing: an unrecognised key should cost a node
 * its glyph, not take the whole canvas down.
 */
export function iconFor(key: string | null | undefined): LucideIcon {
  if (!isNodeIconKey(key)) return Folder
  return NODE_ICONS[key].Icon
}

/** Just enough of a node for the colour rule — anything with a chain and a colour. */
export interface ColorableNode {
  kltId: string
  ancestorIds: string[]
  color: string | null
}

/**
 * The colour a node actually renders in: its own if it has one, otherwise the
 * NEAREST ancestor that sets one, otherwise neutral.
 *
 * Nearest, not the root's: colouring a whole subtree amber under a violet
 * branch has to beat the branch colour, or the override would be pointless.
 * `ancestorIds` is root-first, so the walk runs backwards.
 *
 * An unrecognised stored key is treated as "not set" and keeps looking up the
 * chain, for the same reason `iconFor` falls back — data outlives code.
 */
export function resolveNodeColor(
  node: ColorableNode,
  byKltId: Map<string, ColorableNode>,
): NodeColorClasses {
  if (isNodeColorKey(node.color)) return NODE_COLORS[node.color]
  for (let i = node.ancestorIds.length - 1; i >= 0; i -= 1) {
    const ancestor = byKltId.get(node.ancestorIds[i])
    if (ancestor && isNodeColorKey(ancestor.color)) return NODE_COLORS[ancestor.color]
  }
  return NEUTRAL_NODE_COLOR
}
