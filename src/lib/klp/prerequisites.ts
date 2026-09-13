/**
 * Prerequisite blame: when a learner fails a key point *because* they failed
 * the one it depends on.
 *
 * ## The problem, in one sentence
 *
 * If B cannot be held without A, then a learner who does not know A cannot
 * demonstrate B — so recording "failed A" and "failed B" as two independent
 * observations counts one gap twice, and drops two posteriors for one thing the
 * learner did not know.
 *
 * ## Why this is not the same as the pair being redundant
 *
 * C3 (`src/lib/klp/independence.ts`) found the case that motivated this:
 *
 *   A. "the $100 deposit increases cash and equity by the same amount"
 *   B. "because the cash rise is offset by lower Net Debt, EV is unchanged"
 *
 * B presupposes A. Both are worth teaching and worth testing — B says something
 * A does not. The defect is not that one of them should be deleted; it is that
 * **they are not independent evidence**. Deleting either would lose real
 * information; treating them as independent inflates every posterior.
 *
 * ## What this module does, and the two things it refuses to do
 *
 * Given one answer's per-key-point outcomes and the card's `requires` edges, it
 * separates failures into:
 *
 *  - **root failures** — the learner missed the point on its own terms
 *  - **blocked failures** — downstream of a root failure, and therefore
 *    UNEXPLAINED rather than demonstrated. The learner might know B perfectly
 *    and be unable to show it without A.
 *
 * **It never upgrades a blocked failure to a pass.** Not knowing whether the
 * learner holds B is not the same as evidence that they do, and writing a pass
 * would be a fabricated observation.
 *
 * **It never blocks a point the learner got right.** A learner who states B
 * correctly while fumbling A has demonstrated B; the entailment says B *implies*
 * A, so that outcome is itself informative (and, incidentally, a sign the
 * grading of A deserves a look).
 */
import type { RelationEdge } from '@/lib/klp/relations'

/** Outcome of one key point on one answer, as far as this module cares. */
export interface KlpOutcome {
  /** Index within the card. */
  index: number
  /** Did the learner earn any credit for it? */
  passed: boolean
}

export type BlameKind = 'root' | 'blocked'

export interface BlameResult {
  index: number
  kind: BlameKind
  /**
   * For a blocked failure: the prerequisite indexes that explain it, nearest
   * first. Empty for a root failure.
   */
  blockedBy: number[]
}

/**
 * `requires` edges only.
 *
 * The vocabulary's convention (see `RELATE_KLPS_PROMPT`): an edge
 * `from: X, to: Y` typed `requires` reads "Y cannot hold without X" — so X is
 * the prerequisite and Y depends on it. That is the same direction
 * `blastRadius` walks, which is why recording an entailment also raises the
 * prerequisite's weight without any extra machinery.
 *
 * `causes` is deliberately NOT used here. "X drives Y" says the world works a
 * certain way; it does not say a learner cannot state Y without stating X. Only
 * `requires` licenses the excuse this module hands out, and handing it out on a
 * weaker edge would silently stop crediting real failures.
 */
function prerequisiteMap(edges: RelationEdge[]): Map<number, number[]> {
  const deps = new Map<number, number[]>()
  for (const e of edges) {
    if (e.type !== 'requires') continue
    const list = deps.get(e.to)
    if (list) list.push(e.from)
    else deps.set(e.to, [e.from])
  }
  return deps
}

/**
 * Attributes each failure to itself or to an upstream prerequisite.
 *
 * Walks the prerequisite chain, so a failure two hops downstream is still
 * blocked — and reports the whole chain rather than only the nearest link,
 * because the useful sentence for a learner names the ROOT ("you missed X
 * because you never had Y"), not the intermediate step.
 *
 * CYCLE-SAFE. `canonicalizeEdges` prunes cycles during authoring, but this runs
 * against whatever is in the database, and a cycle here would hang the walk
 * rather than produce a wrong answer — the worse failure of the two.
 */
export function attributeBlame(
  outcomes: KlpOutcome[],
  edges: RelationEdge[],
): BlameResult[] {
  const deps = prerequisiteMap(edges)
  const passed = new Map(outcomes.map((o) => [o.index, o.passed]))

  return outcomes
    .filter((o) => !o.passed)
    .map((o) => {
      const blockedBy: number[] = []
      const seen = new Set<number>([o.index])
      const queue = [...(deps.get(o.index) ?? [])]

      while (queue.length > 0) {
        const p = queue.shift()!
        if (seen.has(p)) continue
        seen.add(p)
        // A prerequisite the learner ALSO failed explains this failure. One
        // they passed does not — and its own prerequisites are then irrelevant,
        // so the walk stops rather than continuing through a satisfied link.
        if (passed.get(p) === false) {
          blockedBy.push(p)
          queue.push(...(deps.get(p) ?? []))
        }
      }

      return {
        index: o.index,
        kind: blockedBy.length > 0 ? ('blocked' as const) : ('root' as const),
        blockedBy,
      }
    })
}

/** The indexes whose failure is explained by something upstream. */
export function blockedIndexes(blame: BlameResult[]): number[] {
  return blame.filter((b) => b.kind === 'blocked').map((b) => b.index)
}

/**
 * The learner-facing sentence, which is the whole point of recording the edge.
 *
 * Names the ROOT of the chain rather than the nearest link: "you missed the EV
 * conclusion because you never had the cash/equity step" is actionable, while
 * "because you missed the intermediate inference" sends them to the wrong
 * place. `blockedBy` is ordered nearest-first by the walk, so the root is last.
 */
export function explainBlocked(
  blame: BlameResult,
  text: (index: number) => string,
): string | null {
  if (blame.kind !== 'blocked' || blame.blockedBy.length === 0) return null
  const root = blame.blockedBy[blame.blockedBy.length - 1]
  return (
    `Not counted against you separately: "${text(blame.index)}" cannot be shown without ` +
    `"${text(root)}", which you also missed. Fix that first.`
  )
}

export interface BlameSummary {
  failures: number
  root: number
  blocked: number
}

export function summarizeBlame(blame: BlameResult[]): BlameSummary {
  return {
    failures: blame.length,
    root: blame.filter((b) => b.kind === 'root').length,
    blocked: blame.filter((b) => b.kind === 'blocked').length,
  }
}
