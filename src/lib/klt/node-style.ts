/**
 * The vocabulary of node display styles: which colour keys and icon keys are
 * legal values for `SetKltNode.color` / `SetKltNode.icon`.
 *
 * Deliberately a plain module with no React and no icon imports, because BOTH
 * sides need it: `setNodeStyle` validates against these lists server-side, and
 * `src/components/klt/node-style.ts` maps the same keys to Tailwind classes
 * and lucide components. One list, two consumers — a colour the picker offers
 * but the action rejects (or vice versa) is exactly the drift this prevents,
 * and a test asserts the component map covers these keys exactly.
 */

export const NODE_COLOR_KEYS = ['violet', 'teal', 'green', 'amber', 'rose'] as const
export type NodeColorKey = (typeof NODE_COLOR_KEYS)[number]

export const NODE_ICON_KEYS = [
  'folder',
  'layers',
  'network',
  'shapes',
  'book',
  'brain',
  'idea',
  'target',
  'puzzle',
  'calculator',
  'sigma',
  'percent',
  'chart',
  'trending',
  'coins',
  'bank',
  'company',
  'scale',
  'gavel',
  'flask',
  'atom',
  'dna',
  'globe',
  'language',
] as const
export type NodeIconKey = (typeof NODE_ICON_KEYS)[number]

export function isNodeColorKey(value: unknown): value is NodeColorKey {
  return typeof value === 'string' && (NODE_COLOR_KEYS as readonly string[]).includes(value)
}

export function isNodeIconKey(value: unknown): value is NodeIconKey {
  return typeof value === 'string' && (NODE_ICON_KEYS as readonly string[]).includes(value)
}
