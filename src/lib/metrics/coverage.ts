import type { HistoryScope } from '@/lib/memory/scope'
import { buildCardScopeWhere } from '@/lib/memory/scope'
import type { PrismaClient } from '@prisma/client'

/**
 * How much of the learner's library the metrics substrate can actually see.
 *
 * Exists because an empty dashboard has FOUR distinct causes that render
 * identically — a loaded page with a header and no rows — and three of them
 * are fixable in seconds once the learner knows which one it is. The 3B live
 * gate produced two, and both were indistinguishable from a broken feature
 * until diagnosed against the database.
 *
 * Shared with `scripts/tuning-check.ts` on purpose: the gate that verifies this
 * and the page the learner sees must never disagree about whether there is
 * enough data.
 */
export interface DashboardCoverage {
  /** KLPs with any evidence at all. */
  klpStates: number
  /** …of those, how many clear THE LEARNER'S floor, not a constant. */
  klpStatesClearingFloor: number
  /** Cards carrying at least one live KLP — the whole rankable population. */
  cardsWithLiveKlps: number
  /** …restricted to the scope in force. */
  cardsWithLiveKlpsInScope: number
  /** Cards with any category, whether or not they have KLPs. */
  categorizedCards: number
  /**
   * Cards with BOTH a category and live KLPs — the population that can produce
   * a TOPIC. Since Task 4B this is no longer the rankable population: an
   * uncategorized card is a study candidate, it simply has no concept to roll
   * up to.
   */
  topicCapableCards: number
  /** Cards whose KLP extraction has not finished. Means WAIT, not act. */
  pendingExtraction: number
  /**
   * Cards WITH live KLPs whose TOPIC summarization has not finished or failed.
   *
   * A fifth cause of a thin panel, and like `pendingExtraction` it means WAIT
   * rather than act. Kept separate because the remedies differ: no KLPs means
   * there is nothing to test, whereas no topics means the points exist and are
   * testable but have no concept to roll up to yet.
   */
  pendingKltSummarization: number
}

/**
 * Owner-scoped counts. EVERY count filters by userId — `scripts/tuning-check.ts`
 * previously counted `cardKlp` and `card` globally, which is harmless with one
 * user in the database and wrong the moment there are two. This helper is about
 * to back a page a user reads, so the guard is not optional.
 */
export async function loadCoverage(
  prisma: PrismaClient,
  userId: string,
  scope: HistoryScope,
  categoryIds: string[],
  floor: number,
): Promise<DashboardCoverage> {
  const owned = { set: { userId } }
  const liveKlps = { klps: { some: { supersededAt: null } } }
  const scopeWhere = buildCardScopeWhere(scope, categoryIds)
  const inScope = scope.cardId ? { id: scope.cardId } : scopeWhere

  const [
    klpStates,
    klpStatesClearingFloor,
    cardsWithLiveKlps,
    cardsWithLiveKlpsInScope,
    categorizedCards,
    topicCapableCards,
    pendingExtraction,
    pendingKltSummarization,
  ] = await Promise.all([
    prisma.klpState.count({ where: { userId } }),
    prisma.klpState.count({ where: { userId, observations: { gte: floor } } }),
    prisma.card.count({ where: { ...owned, ...liveKlps } }),
    prisma.card.count({ where: { ...owned, ...liveKlps, ...inScope } }),
    prisma.card.count({ where: { ...owned, categoryAssignments: { some: {} } } }),
    prisma.card.count({
      where: { ...owned, ...liveKlps, categoryAssignments: { some: {} } },
    }),
    prisma.card.count({ where: { ...owned, klpStatus: 'pending' } }),
    // Live KLPs required: a card with no KLPs yet is already counted by
    // `pendingExtraction`, and counting it twice would make the panel report
    // two separate things to wait for when there is only one.
    prisma.card.count({
      where: { ...owned, ...liveKlps, kltStatus: { in: ['pending', 'failed'] } },
    }),
  ])

  return {
    klpStates,
    klpStatesClearingFloor,
    cardsWithLiveKlps,
    cardsWithLiveKlpsInScope,
    categorizedCards,
    topicCapableCards,
    pendingExtraction,
    pendingKltSummarization,
  }
}

export type EmptyCause =
  | { kind: 'no_klps'; blocking: true; pendingExtraction: number }
  | { kind: 'scope_too_narrow'; blocking: true }
  | { kind: 'no_history'; blocking: true }
  | { kind: 'below_floor'; blocking: false; measured: number; floor: number }
  | { kind: 'nothing_categorized'; blocking: false; cardsWithLiveKlps: number }

/**
 * Name the single most important reason the page is thin, or `null` when it is
 * not thin at all.
 *
 * `blocking` separates "nothing at all can render" from "real content is on
 * screen and this explains a gap in it". Task 4B moved `nothing_categorized`
 * across that line: uncategorized KLPs are now study candidates, so a library
 * with no categories renders a working study list and empty TOPIC sections.
 * Copy that still said "no topic can report anything, so this page is empty"
 * would be describing the pre-4B app.
 *
 * The ORDER is the design, not an implementation detail. `scope_too_narrow`
 * must be checked before `nothing_categorized`: both can be true at once, both
 * read as "nothing is here", and the remedies are OPPOSITE — widen versus
 * categorize. One merged message sends half the learners to the wrong fix.
 *
 * Pure, so every combination is tested without a database.
 */
export function diagnoseEmptyState(
  coverage: DashboardCoverage,
  scoped: boolean,
  floor: number,
): EmptyCause | null {
  // Nothing has key points, so there is nothing to target OR roll up. Distinct
  // from "no history": these cards have never been readable by the substrate.
  if (coverage.cardsWithLiveKlps === 0) {
    return { kind: 'no_klps', blocking: true, pendingExtraction: coverage.pendingExtraction }
  }

  // The library has candidates; this VIEW does not. Only reachable when a scope
  // is in force, which is what makes "widen" the right advice rather than
  // "study more".
  if (scoped && coverage.cardsWithLiveKlpsInScope === 0) {
    return { kind: 'scope_too_narrow', blocking: true }
  }

  if (coverage.klpStates === 0) {
    return { kind: 'no_history', blocking: true }
  }

  // Non-blocking from here: the ranked list renders, it just cannot claim to
  // have measured anything yet.
  if (coverage.klpStatesClearingFloor === 0) {
    return { kind: 'below_floor', blocking: false, measured: coverage.klpStates, floor }
  }

  if (coverage.topicCapableCards === 0) {
    return {
      kind: 'nothing_categorized',
      blocking: false,
      cardsWithLiveKlps: coverage.cardsWithLiveKlps,
    }
  }

  return null
}
