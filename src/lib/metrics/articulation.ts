import type { DerivedTag } from '@/lib/errors/derive'
import {
  ARTICULATION_MIN_PKNOWN, READINESS_WEIGHT_PER_ANSWER,
  DEFAULT_THRESHOLDS, type MetricThresholds,
} from '@/lib/tuning/schema'

// `ARTICULATION_MIN_PKNOWN` and `READINESS_WEIGHT_PER_ANSWER` are DEFINED in
// the tuning module so `DEFAULT_THRESHOLDS` can derive from them without an
// import cycle — this file imports `MetricThresholds` from there. Their doc
// comments moved with them.
//
// Imported and then re-exported, rather than `export { ... } from`, because a
// pure re-export creates NO local binding and this module's own body reads
// both as defaults. Existing importers are unaffected either way, and the
// settings panel shows them as "the shipped default".
export { ARTICULATION_MIN_PKNOWN, READINESS_WEIGHT_PER_ANSWER }

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
  /** Count of analyzed answers these tags came from. */
  analyzedAnswers: number
  /**
   * The learner's tuned thresholds. Optional, defaulting to the shipped
   * constants, so every existing caller is unchanged — but a caller that HAS a
   * user must pass theirs, or the knob is inert for that surface.
   */
  thresholds?: MetricThresholds
}

export interface Articulation {
  /** Positive: over-talks. Negative: under-talks. Zero: calibrated. */
  verbosityIndex: number
  /** `too_terse` tags excluded as knowledge gaps rather than expression gaps. */
  knowledgeGapTerseness: number
  /** 0-1, higher is more interview-ready. Null with no evidence. */
  readiness: number | null
}

export function computeArticulation(input: ArticulationInput): Articulation {
  const { minObservations, articulationMinPKnown, readinessWeightPerAnswer } =
    input.thresholds ?? DEFAULT_THRESHOLDS

  let over = 0
  let under = 0
  let knowledgeGapTerseness = 0
  let expressionWeight = 0

  for (const tag of input.tags) {
    // A whole-answer tag names no KLP — the grading prompt tells the model to
    // omit the reference for errors that are judgements about the answer as a
    // whole. It is real expression evidence and MUST reach `expressionWeight`,
    // but it is excluded from the SIGNED index: there is no pKnown to test, so
    // counting whole-answer over-talk while whole-answer terseness can never
    // be counted would bias the index positive by construction.
    const wholeAnswer = tag.klpId === null

    if (tag.dimension === 'clarity') {
      expressionWeight += tag.significance
      continue
    }
    if (tag.dimension !== 'conciseness') continue

    if (OVER_TALK_TYPES.has(tag.type)) {
      expressionWeight += tag.significance
      if (!wholeAnswer) over += tag.significance
      continue
    }

    if (tag.type === 'too_terse') {
      // Not `knowledgeGapTerseness`: that counter means "excluded BECAUSE the
      // learner likely does not know it". A whole-answer terseness is excluded
      // for a different reason — no target to test — and is booked as
      // expression, so calling it a knowledge gap would misreport it.
      if (wholeAnswer) {
        expressionWeight += tag.significance
        continue
      }

      const k = input.knowledge[tag.klpId as string]
      const counts =
        k !== undefined && k.observations >= minObservations && k.pKnown >= articulationMinPKnown
      if (counts) {
        under += tag.significance
        expressionWeight += tag.significance
      } else {
        knowledgeGapTerseness += 1
      }
    }
  }

  let readiness: number | null
  if (input.analyzedAnswers === 0) {
    readiness = null
  } else {
    const weightPerAnswer = expressionWeight / input.analyzedAnswers
    readiness = Math.max(0, 1 - weightPerAnswer / readinessWeightPerAnswer)
  }

  return { verbosityIndex: over - under, knowledgeGapTerseness, readiness }
}
