import type { DerivedTag } from '@/lib/errors/derive'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'

/**
 * A `too_terse` tag only counts as an ARTICULATION problem at or above this
 * pKnown. Below it, brevity is far more likely to mean the learner does not
 * know the material — and booking that as an expression gap would route them
 * to short-answer drilling when they need the concept, misdiagnosing exactly
 * the case this metric exists to separate.
 *
 * A starting value, named rather than inlined because it wants tuning once
 * real tag volume exists.
 */
export const ARTICULATION_MIN_PKNOWN = 0.6

/** Conciseness failures in the "too much" direction. */
export const OVER_TALK_TYPES = new Set([
  'rambling', 'padding', 'redundancy', 'over_qualification', 'kitchen_sink',
])

export interface KnowledgeRef {
  pKnown: number
  observations: number
}

export interface ArticulationInput {
  tags: DerivedTag[]
  /** Per-KLP BKT results, keyed by klpId. */
  knowledge: Record<string, KnowledgeRef>
}

export interface Articulation {
  /** Positive: over-talks. Negative: under-talks. Zero: calibrated. */
  verbosityIndex: number
  /** `too_terse` tags excluded as knowledge gaps rather than expression gaps. */
  knowledgeGapTerseness: number
  /** 0-1, higher is more interview-ready. Null with no evidence. */
  readiness: number | null
}

/** Scales total tag weight into a 0-1 readiness. Tuned to be gentle. */
const READINESS_SCALE = 20

export function computeArticulation(input: ArticulationInput): Articulation {
  let over = 0
  let under = 0
  let knowledgeGapTerseness = 0
  let expressionWeight = 0

  for (const tag of input.tags) {
    if (tag.dimension === 'clarity') {
      expressionWeight += tag.significance
      continue
    }
    if (tag.dimension !== 'conciseness') continue

    if (OVER_TALK_TYPES.has(tag.type)) {
      over += tag.significance
      expressionWeight += tag.significance
      continue
    }

    if (tag.type === 'too_terse') {
      const k = tag.klpId ? input.knowledge[tag.klpId] : undefined
      const counts =
        k !== undefined && k.observations >= MIN_OBSERVATIONS && k.pKnown >= ARTICULATION_MIN_PKNOWN
      if (counts) {
        under += tag.significance
        expressionWeight += tag.significance
      } else {
        knowledgeGapTerseness += 1
      }
    }
  }

  const hasEvidence = input.tags.length > 0
  const readiness = hasEvidence
    ? Math.max(0, 1 - expressionWeight / READINESS_SCALE)
    : null

  return { verbosityIndex: over - under, knowledgeGapTerseness, readiness }
}
