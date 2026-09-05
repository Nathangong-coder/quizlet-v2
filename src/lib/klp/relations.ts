/**
 * KLP-to-KLP relations: the vocabulary, the invariant, and the graph property
 * that replaces the AI's centrality opinion.
 *
 * An edge is admitted to this vocabulary only if it makes a SPECIFIC FAILURE
 * nameable. `part_of` is deliberately absent — that is the concept tree
 * (SetKltNode) and duplicating it here would give one hierarchy two homes.
 */

import {
  WEIGHT_GRAPH_TERM,
  WEIGHT_EVIDENCE_TERM,
  BLAST_RADIUS_FULL,
} from '@/lib/klp/authoring-config'

export const DIRECTED_TYPES = ['causes', 'requires', 'precedes', 'applies_within'] as const
export const SYMMETRIC_TYPES = ['confused_with', 'analogous_to'] as const
export const RELATION_TYPES = [...DIRECTED_TYPES, ...SYMMETRIC_TYPES] as const

export type RelationType = (typeof RELATION_TYPES)[number]

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value)
}

/**
 * `RELATION_TYPES` minus `analogous_to`: the subset the authoring pipeline's
 * relate call (`RELATE_KLPS_PROMPT`, Spec 2) is allowed to emit.
 * `analogous_to` is a real member of the general vocabulary — it is
 * CROSS-CARD, and this spec's relate call only ever sees the KLPs of ONE
 * card, so it has no business producing it. Defined ONCE, here, and
 * consumed by both the prompt (`relate-klps.ts`, so the offered-types list
 * in its own text) and the schema that validates the model's response
 * (`RelationDraftSchema` in `src/lib/ai/schemas.ts`) — a single source
 * rather than two independently-maintained filters that could drift apart,
 * which review found: the prompt telling the model not to emit
 * `analogous_to` was the ONLY thing stopping it before this fix, and models
 * ignore instructions routinely.
 */
export const RELATABLE_TYPES = [...DIRECTED_TYPES, 'confused_with'] as const

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

/**
 * The GRAPH term alone: 0 dependents is a leaf (1); 4 or more is a root cause (5).
 *
 * Kept as its own function because it is the term `weightFromSignals` reduces
 * to when the evidence term is weighted 0, and a test pins that equivalence —
 * so the blend is demonstrably a generalisation of this rather than a silent
 * re-scaling of every weight already written.
 */
export function weightFromBlastRadius(radius: number): number {
  return Math.min(5, Math.max(1, radius + 1))
}

/**
 * The weight a KLP actually gets: a blend of dependency depth and adversarial
 * evidence (increment A §1).
 *
 *     weight = clamp(round(1 + 4 · (w_graph · radiusTerm + w_evidence · breadth)), 1, 5)
 *
 * WHY TWO TERMS. `blastRadius` measures how much of the card breaks if this KLP
 * is false, which is the right question on a DERIVATION CHAIN — the $10
 * depreciation walkthrough, where each step consumes the previous one's output.
 * It is the wrong question on an ENUMERATION — "why do LBOs use leverage",
 * several parallel value drivers that genuinely do not depend on one another.
 * The first real pilot card was an enumeration and produced weights 2,1,2,1,1
 * off two edges. That was not the relate call under-performing; two edges was
 * very likely correct, and the fix of pushing the prompt to find more would
 * fabricate `causes` links that Spec 3 then serves grading probes for, marking
 * a learner wrong for failing to make a connection nobody should make.
 *
 * `discriminationBreadth` (`src/lib/klp/separation.ts`) answers the same
 * question — how central is this point — from the adversarial verdict matrix
 * instead of the graph, and it has spread on exactly the cards where the graph
 * has none. Neither term is a fallback for the other; each dominates on one
 * card shape.
 *
 * BOTH INPUTS ARE STILL COMPUTED IN TYPESCRIPT from categorical AI output. The
 * model supplies edges and per-KLP verdicts; it never supplies a number. That
 * rule is what audit finding G1 broke and is not relaxed here.
 *
 * `radius` is clamped, not just capped: `BLAST_RADIUS_FULL` is where the graph
 * term saturates, and a negative radius is impossible but would otherwise pull
 * a weight below the floor.
 *
 * THE CEILING THIS BUYS, STATED PLAINLY. Because the two terms are weighted to
 * sum to 1, a KLP reaches weight 5 only by scoring high on BOTH — and a card
 * that is purely an enumeration has no graph term to score on, so under equal
 * weighting its most load-bearing point tops out at 3. That matters beyond this
 * file: `computeSignificance` (`src/lib/errors/significance.ts`) uses weight as
 * `relevance` and aggregates significance ACROSS cards, so a corpus of only
 * enumeration cards could not produce a top-band error — the mirror image of
 * G1, where nothing could score low. Equal weighting is the design's declared
 * starting point, to be revisited against the first real histogram; this is the
 * specific thing that histogram is looking for, and `terms` is here so the
 * rebalance is a config edit rather than a rewrite.
 */
export function weightFromSignals(
  radius: number,
  breadth: number,
  terms: { graph: number; evidence: number } = { graph: WEIGHT_GRAPH_TERM, evidence: WEIGHT_EVIDENCE_TERM },
): number {
  const radiusTerm = Math.min(1, Math.max(0, radius / BLAST_RADIUS_FULL))
  const breadthTerm = Math.min(1, Math.max(0, breadth))
  const blended = terms.graph * radiusTerm + terms.evidence * breadthTerm
  return Math.min(5, Math.max(1, Math.round(1 + blended * 4)))
}
