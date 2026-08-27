import { describe, it, expect } from 'vitest'
import {
  NODE_COLORS,
  NODE_COLOR_KEYS,
  NEUTRAL_NODE_COLOR,
  NODE_ICONS,
  NODE_ICON_KEYS,
  iconFor,
  isNodeColorKey,
  resolveNodeColor,
  type ColorableNode,
} from '@/components/klt/node-style'

function index(nodes: ColorableNode[]) {
  return new Map(nodes.map((n) => [n.kltId, n]))
}

describe('resolveNodeColor', () => {
  it("uses the node's own colour when it has one", () => {
    const n: ColorableNode = { kltId: 'a', ancestorIds: [], color: 'teal' }
    expect(resolveNodeColor(n, index([n]))).toBe(NODE_COLORS.teal)
  })

  it('inherits from an ancestor, so one choice colours a whole branch', () => {
    const root: ColorableNode = { kltId: 'root', ancestorIds: [], color: 'violet' }
    const leaf: ColorableNode = { kltId: 'leaf', ancestorIds: ['root', 'mid'], color: null }
    const mid: ColorableNode = { kltId: 'mid', ancestorIds: ['root'], color: null }
    expect(resolveNodeColor(leaf, index([root, mid, leaf]))).toBe(NODE_COLORS.violet)
  })

  it('prefers the NEAREST coloured ancestor over the root', () => {
    // Otherwise recolouring a subtree would be silently ignored under an
    // already-coloured branch, which makes the override pointless.
    const root: ColorableNode = { kltId: 'root', ancestorIds: [], color: 'violet' }
    const mid: ColorableNode = { kltId: 'mid', ancestorIds: ['root'], color: 'amber' }
    const leaf: ColorableNode = { kltId: 'leaf', ancestorIds: ['root', 'mid'], color: null }
    expect(resolveNodeColor(leaf, index([root, mid, leaf]))).toBe(NODE_COLORS.amber)
  })

  it('falls back to neutral when nothing up the chain sets a colour', () => {
    const root: ColorableNode = { kltId: 'root', ancestorIds: [], color: null }
    const leaf: ColorableNode = { kltId: 'leaf', ancestorIds: ['root'], color: null }
    expect(resolveNodeColor(leaf, index([root, leaf]))).toBe(NEUTRAL_NODE_COLOR)
  })

  it('ignores an unrecognised stored colour and keeps looking up the chain', () => {
    // The column is free text, so a key from an older build can arrive here.
    const root: ColorableNode = { kltId: 'root', ancestorIds: [], color: 'green' }
    const leaf: ColorableNode = { kltId: 'leaf', ancestorIds: ['root'], color: 'chartreuse' }
    expect(resolveNodeColor(leaf, index([root, leaf]))).toBe(NODE_COLORS.green)
  })

  it('survives an ancestor id with no node in this set', () => {
    const leaf: ColorableNode = { kltId: 'leaf', ancestorIds: ['gone'], color: null }
    expect(resolveNodeColor(leaf, index([leaf]))).toBe(NEUTRAL_NODE_COLOR)
  })
})

describe('palette', () => {
  it('defines classes for every key, written out in full for Tailwind to find', () => {
    for (const key of NODE_COLOR_KEYS) {
      const c = NODE_COLORS[key]
      // A fragment like `bg-chart-${n}` compiles to nothing — Tailwind scans
      // source text — so every class must be a complete literal.
      expect(c.bar).toMatch(/^bg-chart-[1-5]$/)
      expect(c.text).toMatch(/^text-chart-[1-5]$/)
      expect(c.stroke).toMatch(/^stroke-chart-[1-5]\/\d+$/)
    }
  })

  it('maps each key to a distinct token', () => {
    const bars = NODE_COLOR_KEYS.map((k) => NODE_COLORS[k].bar)
    expect(new Set(bars).size).toBe(NODE_COLOR_KEYS.length)
  })

  it('covers every key the shared vocabulary declares, and no others', () => {
    // The picker renders from these maps while `setNodeStyle` validates
    // against the key lists in `src/lib/klt/node-style.ts`. Drift between
    // them means a swatch the user can click and the server then rejects.
    expect(Object.keys(NODE_COLORS).sort()).toEqual([...NODE_COLOR_KEYS].sort())
    expect(Object.keys(NODE_ICONS).sort()).toEqual([...NODE_ICON_KEYS].sort())
  })

  it('recognises only its own keys', () => {
    expect(isNodeColorKey('teal')).toBe(true)
    expect(isNodeColorKey('turquoise')).toBe(false)
    expect(isNodeColorKey(null)).toBe(false)
  })
})

describe('iconFor', () => {
  it('returns the icon for a known key', () => {
    expect(iconFor('brain')).toBe(NODE_ICONS.brain.Icon)
  })

  it('falls back rather than throwing on an unknown or missing key', () => {
    // Costing a node its glyph is survivable; taking the canvas down is not.
    expect(iconFor('nonsense')).toBe(NODE_ICONS.folder.Icon)
    expect(iconFor(null)).toBe(NODE_ICONS.folder.Icon)
    expect(iconFor(undefined)).toBe(NODE_ICONS.folder.Icon)
  })
})
