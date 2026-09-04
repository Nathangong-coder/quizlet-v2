/**
 * KLP-to-KLP relations: the vocabulary, the invariant, and the graph property
 * that replaces the AI's centrality opinion.
 *
 * An edge is admitted to this vocabulary only if it makes a SPECIFIC FAILURE
 * nameable. `part_of` is deliberately absent — that is the concept tree
 * (SetKltNode) and duplicating it here would give one hierarchy two homes.
 */

export const DIRECTED_TYPES = ['causes', 'requires', 'precedes', 'applies_within'] as const
export const SYMMETRIC_TYPES = ['confused_with', 'analogous_to'] as const
export const RELATION_TYPES = [...DIRECTED_TYPES, ...SYMMETRIC_TYPES] as const

export type RelationType = (typeof RELATION_TYPES)[number]

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value)
}

export const RELATION_PROVENANCES = ['perturbation', 'order_violation', 'substitution'] as const
export type RelationProvenance = (typeof RELATION_PROVENANCES)[number]

/** Endpoints are KLP INDEXES within one card, not ids — ids do not exist yet. */
export interface RelationEdge {
  from: number
  to: number
  type: RelationType
}

function isSymmetric(type: RelationType): boolean {
  return (SYMMETRIC_TYPES as readonly string[]).includes(type)
}

/**
 * Store each symmetric pair once, under a fixed endpoint ordering.
 *
 * Without this, `confused_with` between 1 and 3 can be persisted twice — once
 * from each direction — and the unique constraint cannot see that they are the
 * same fact.
 *
 * GENERIC over `T extends RelationEdge`, not fixed to the bare shape. The
 * authoring pipeline's edges (`src/lib/klp/authoring.ts`) carry `provenance`,
 * `rationale` and `probe` alongside `from`/`to`/`type` — persisted fields a
 * caller needs back. A version fixed to `RelationEdge[]` would silently drop
 * them for exactly the edges this function reorders (symmetric, `from > to`),
 * since the reordering branch used to build a bare `{ from, to, type }`
 * rather than copy the input through. Spreading `...e` before overriding
 * `from`/`to` keeps every extra field the caller attached; the unreordered
 * branch already returned `e` untouched, so this only fixes the branch that
 * was actually losing data.
 */
export function canonicalizeEdges<T extends RelationEdge>(edges: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const e of edges) {
    const edge = isSymmetric(e.type) && e.from > e.to
      ? { ...e, from: e.to, to: e.from }
      : e
    const key = `${edge.from}>${edge.to}:${edge.type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
  }
  return out
}

/**
 * Every cycle among the DIRECTED edges.
 *
 * An AI will happily emit X causes Y in one call and Y causes X in another,
 * because neither call can see the other. `src/lib/klt/invariants.ts` was
 * needed for a strictly easier invariant, so this one gets the same treatment:
 * a pure checker, tested in both directions, run before persistence.
 *
 * Symmetric types are exempt — they assert similarity, not dependency, so a
 * pair pointing both ways is the same fact rather than a contradiction.
 */
export function findCycles(edges: RelationEdge[]): number[][] {
  const adj = new Map<number, number[]>()
  for (const e of edges) {
    if (isSymmetric(e.type)) continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }

  const cycles: number[][] = []
  const state = new Map<number, 'open' | 'done'>()
  const stack: number[] = []

  const walk = (node: number) => {
    state.set(node, 'open')
    stack.push(node)
    for (const next of adj.get(node) ?? []) {
      if (state.get(next) === 'open') {
        cycles.push(stack.slice(stack.indexOf(next)))
      } else if (state.get(next) !== 'done') {
        walk(next)
      }
    }
    stack.pop()
    state.set(node, 'done')
  }

  for (const node of adj.keys()) {
    if (!state.has(node)) walk(node)
  }
  return cycles
}

/**
 * For each KLP, how many OTHER KLPs break if it is false.
 *
 * This is the perturbation pass read off the graph, and it is what replaces
 * the AI's 1-5 centrality rating. Audit finding G1: 92% of AI-assigned weights
 * were 4 or 5, so no accuracy error could score below 5 and significance never
 * spanned its own range. A model asked "how central is this point?" says
 * "very"; a graph says how much actually depends on it.
 *
 * Visited-set traversal, so a cycle terminates instead of hanging — cycles are
 * rejected before persistence, but this must not be the thing that discovers
 * one by never returning.
 */
export function blastRadius(klpCount: number, edges: RelationEdge[]): number[] {
  const adj = new Map<number, number[]>()
  for (const e of edges) {
    if (isSymmetric(e.type)) continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }

  return Array.from({ length: klpCount }, (_, start) => {
    const seen = new Set<number>()
    const queue = [...(adj.get(start) ?? [])]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (node === start || seen.has(node)) continue
      seen.add(node)
      queue.push(...(adj.get(node) ?? []))
    }
    return seen.size
  })
}

/** 0 dependents is a leaf (1); 4 or more is a root cause (5). */
export function weightFromBlastRadius(radius: number): number {
  return Math.min(5, Math.max(1, radius + 1))
}
