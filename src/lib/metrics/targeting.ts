import { BKT_PRIOR } from '@/lib/metrics/bkt'
import { DEFAULT_THRESHOLDS, type MetricThresholds, type StrategyKey } from '@/lib/tuning/schema'

/** Overdue-ness saturates here, so a year-late card does not dwarf everything. */
export const OVERDUE_SATURATION_DAYS = 7

/** Neutral centrality for a KLP with no stored weight. */
export const DEFAULT_WEIGHT = 3

/**
 * One rankable unit: a key learning point with its metrics attached.
 *
 * The KLP is the candidate rather than the card or the topic because it is the
 * finest actionable unit — what a focus quiz targets and what Spec 4 will
 * schedule. Topic ordering is derivable by aggregating candidates; the reverse
 * is not.
 */
export interface RankCandidate {
  klpId: string
  topicKey: string
  /** CardKlp.weight, 1-5: how central this point is to its card. */
  weight: number
  pKnown: number
  observations: number
  /** The topic's short-answer readiness, or null when unmeasured. */
  readiness: number | null
  dueAt: Date | null
}

export interface RankedCandidate extends RankCandidate {
  score: number
  /** False when the candidate is below the learner's observation floor. */
  sufficient: boolean
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function overdueness(dueAt: Date | null, now: Date): number {
  if (dueAt === null) return 0
  const days = (now.getTime() - dueAt.getTime()) / 86_400_000
  return clamp01(days / OVERDUE_SATURATION_DAYS)
}

/**
 * Unknown readiness is treated as NO articulation problem (1), not a severe
 * one. Ranking an unmeasured point as maximally rough would fill the list with
 * propositions we have simply never tested in short answer.
 */
function articulationGap(readiness: number | null): number {
  return 1 - (readiness ?? 1)
}

function scoreFor(c: RankCandidate, strategy: StrategyKey, now: Date): number {
  const weakness = (1 - c.pKnown) * (c.weight / 5)
  const polish = c.pKnown * articulationGap(c.readiness)
  const forgetting = overdueness(c.dueAt, now)

  switch (strategy) {
    case 'shore_up_weaknesses':
      return weakness
    case 'polish_near_ready':
      return polish
    case 'follow_forgetting':
      return forgetting
    case 'balanced':
      return (weakness + polish + forgetting) / 3
  }
}

/**
 * Rank candidates under one strategy. Every strategy ranks the same set and
 * returns the same shape, so the setting only SELECTS — it never changes what
 * is recorded or which data is considered.
 *
 * Candidates below the learner's observation floor sort last under EVERY
 * strategy: an unmeasured proposition is not evidence of weakness, and
 * `polish_near_ready` in particular must not promote a KLP whose high pKnown
 * rests on one lucky answer. The floor is the LEARNER'S, not a constant —
 * on a thin corpus every candidate is sub-threshold and the order carries no
 * information until they lower it.
 */
export function rankCandidates(
  candidates: RankCandidate[],
  strategy: StrategyKey,
  opts: { now?: Date; thresholds?: MetricThresholds } = {},
): RankedCandidate[] {
  const now = opts.now ?? new Date()
  const { minObservations } = opts.thresholds ?? DEFAULT_THRESHOLDS

  return candidates
    .map((c) => ({
      ...c,
      score: scoreFor(c, strategy, now),
      sufficient: c.observations >= minObservations,
    }))
    .sort((a, b) => {
      if (a.sufficient !== b.sufficient) return a.sufficient ? -1 : 1
      return b.score - a.score
    })
}

export interface CandidateSource {
  /**
   * LIVE KLP ids per topic. Never `supersededKlpIds` — a retired KLP belongs to
   * an older version of the card, and handing it back as something to study
   * would target text the learner can no longer see.
   */
  topics: { key: string; klpIds: string[]; readiness: number | null }[]
  /** CardKlp.weight per KLP id. */
  klpWeights: Record<string, number>
  knowledge: Record<string, { pKnown: number; observations: number }>
  /** Which card each KLP belongs to, for resolving due state. */
  klpCardIds: Record<string, string>
  /** CardProgress.dueAt per card id. */
  dueByCard: Record<string, Date>
}

/**
 * Flatten topics into one candidate per KLP.
 *
 * A KLP appearing under two topics is emitted ONCE — the first topic wins —
 * because a duplicate would occupy two slots in a ranked list and be studied
 * twice. A KLP with no knowledge entry is still emitted, at the prior with
 * zero observations: the floor ranks it last, but dropping it would hide the
 * proposition entirely rather than marking it unmeasured.
 */
export function toRankCandidates(source: CandidateSource): RankCandidate[] {
  const seen = new Set<string>()
  const out: RankCandidate[] = []

  for (const topic of source.topics) {
    for (const klpId of topic.klpIds) {
      if (seen.has(klpId)) continue
      seen.add(klpId)

      const known = source.knowledge[klpId]
      const cardId = source.klpCardIds[klpId]

      out.push({
        klpId,
        topicKey: topic.key,
        weight: source.klpWeights[klpId] ?? DEFAULT_WEIGHT,
        pKnown: known?.pKnown ?? BKT_PRIOR,
        observations: known?.observations ?? 0,
        readiness: topic.readiness,
        dueAt: (cardId ? source.dueByCard[cardId] : undefined) ?? null,
      })
    }
  }

  return out
}
