/**
 * C4 — necessity, with R2's greedy-sequential loop.
 *
 * ## The question
 *
 * Delete one key point: is an answer that satisfies the rest, and says nothing
 * about the deleted one, still acceptable? If yes, that point was an optional
 * detail. It keeps sets from bloating to fifteen where seven do the work.
 *
 * ## R2: asked independently, this deletes both halves of one idea
 *
 * Two points that each cover half of a single required idea both answer "yes,
 * an answer without me is still fine" — because the other half is still there
 * when each is asked about. Delete both on that evidence and the idea vanishes,
 * with each deletion looking individually justified.
 *
 * So the loop is **greedy-sequential, never batch**: remove one, re-evaluate the
 * remainder against the REDUCED set, and only then consider the next. Once the
 * first half is gone, the second is the only thing carrying the idea and comes
 * back necessary.
 *
 * ## Order is part of the algorithm, not an implementation detail
 *
 * A greedy loop's output depends on the order it considers candidates. This
 * goes WEAKEST FIRST — lowest computed weight — so the periphery is tested
 * before the load-bearing points, and a central point is judged against a set
 * that has already shed its optional detail. The reverse order would test the
 * spine of the card while every peripheral point was still present to prop it
 * up, which is precisely when a central point looks droppable.
 *
 * ## It is a proposal, never a deletion
 *
 * Removing a key point supersedes a `CardKlp`, which detaches learner evidence
 * until the re-grade job catches up, and "this detail is optional" is a
 * judgment about what a card is for. This module reports; a human decides.
 */
import { MIN_KLPS_PER_CARD } from '@/lib/klp/authoring-config'

export interface NecessityCandidate {
  index: number
  text: string
  /** Computed weight, 1-5. Drives the order the greedy loop considers them in. */
  weight: number
}

export type NecessityVerdict =
  /** An acceptable answer exists that omits it. Optional detail. */
  | 'unnecessary'
  /** Omitting it produced an answer that would be marked down. Load-bearing. */
  | 'necessary'
  /** Not examined — the floor stopped the loop, or the probe failed. */
  | 'unexamined'

export interface NecessityResult {
  index: number
  text: string
  verdict: NecessityVerdict
  /** The answer written without this point, kept as the evidence for the call. */
  answerWithout: string
  /** The blind judge's overall score for that answer, when it ran. */
  judgeOverall: number | null
  reason: string
}

/**
 * The smallest set the loop may reduce a card to.
 *
 * A necessity pass that strips a card to two points has not tidied it, it has
 * broken it — and each individual deletion will have looked justified, which is
 * exactly how that happens. `MIN_KLPS_PER_CARD` is the same floor the authoring
 * sizer uses, so the two cannot disagree about what a viable card is.
 */
export const NECESSITY_FLOOR = MIN_KLPS_PER_CARD

/**
 * The order the greedy loop considers candidates in: weakest first, ties broken
 * by index so a run is reproducible.
 */
export function necessityOrder(candidates: NecessityCandidate[]): NecessityCandidate[] {
  return [...candidates].sort((a, b) => a.weight - b.weight || a.index - b.index)
}

/**
 * Has the loop reduced the set as far as it is allowed to?
 *
 * `survivors` counts the points still standing, INCLUDING ones already judged
 * necessary — the floor is about the size of the resulting card, not about how
 * many were examined.
 */
export function atFloor(survivors: number): boolean {
  return survivors <= NECESSITY_FLOOR
}

export interface NecessitySummary {
  examined: number
  unnecessary: number
  necessary: number
  unexamined: number
  /** How many points the card would keep if every proposal were accepted. */
  survivingCount: number
  startingCount: number
  hitFloor: boolean
}

export function summarizeNecessity(
  results: NecessityResult[],
  startingCount: number,
): NecessitySummary {
  const unnecessary = results.filter((r) => r.verdict === 'unnecessary').length
  const necessary = results.filter((r) => r.verdict === 'necessary').length
  const unexamined = results.filter((r) => r.verdict === 'unexamined').length
  return {
    examined: unnecessary + necessary,
    unnecessary,
    necessary,
    unexamined,
    survivingCount: startingCount - unnecessary,
    startingCount,
    hitFloor: atFloor(startingCount - unnecessary),
  }
}

export function formatNecessityReport(s: NecessitySummary): string {
  const lines: string[] = []
  lines.push(
    `Necessity (C4) — ${s.startingCount} key point(s), ${s.examined} examined, ` +
      `${s.unexamined} unexamined`,
  )
  lines.push(
    `  unnecessary ${s.unnecessary}   necessary ${s.necessary}   ` +
      `would leave ${s.survivingCount}${s.hitFloor ? ' (AT THE FLOOR)' : ''}`,
  )
  lines.push('')
  lines.push('  GREEDY-SEQUENTIAL, never batch: each point is judged against the set as reduced so')
  lines.push('  far. Asked independently, two points that each cover half of one idea both look')
  lines.push('  optional and both get deleted, with the idea vanishing and each deletion looking')
  lines.push('  justified.')
  lines.push('')
  lines.push('  NOTHING WAS DELETED. Removing a key point supersedes it, which detaches learner')
  lines.push('  evidence, and "this detail is optional" is a judgment about what the card is for.')
  return lines.join('\n')
}
