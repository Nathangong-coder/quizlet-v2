import type { StudySource } from '@/lib/memory/scoring'
import {
  DIMENSIONS, MAX_TAGS_PER_DIMENSION, validateTagType, type Dimension,
} from '@/lib/errors/taxonomy'
import { computeSignificance } from '@/lib/errors/significance'
import { klpCredit, type KlpStatus } from '@/lib/errors/klp-credit'

/** Why an answer has the analysis rows it has. */
export type AnalysisOutcome = 'analyzed' | 'no_provenance' | 'no_klps' | 'failed'

export interface KlpRef {
  id: string
  weight: number
}

export interface KlpResultDraft {
  klpRef: number
  status: KlpStatus
  evidence?: string
}

export interface ErrorTagDraft {
  dimension: Dimension
  type: string
  klpRef?: number
  secondaryKlpRef?: number
  severity: number
  quote?: string
}

export interface AnalysisWarning {
  reason: string
  value: string
}

export interface AnalysisWrites {
  status: AnalysisOutcome
  klpResults: {
    klpId: string
    status: KlpStatus
    credit: number
    mode: StudySource
    evidence?: string
  }[]
  errorTags: {
    dimension: Dimension
    type: string
    klpId: string | null
    secondaryKlpId: string | null
    relevance: number
    severity: number
    starred: boolean
    significance: number
    quote?: string
  }[]
  warnings: AnalysisWarning[]
}

/**
 * Relevance for a tag with no KLP target. The midpoint is the only defensible
 * neutral — there is no stored weight to read — and it is persisted like any
 * other input so it can be revisited.
 */
const WHOLE_ANSWER_RELEVANCE = 3

/**
 * Decides what analysis rows an answer produces. Pure: every rejection,
 * warning, and computed value is decided here so the action only writes.
 *
 * Every rejection path DROPS the offending item and records why. Nothing is
 * defaulted into existence: a fabricated tag is indistinguishable from a real
 * observation once written, and would let Spec 3 promote a misconception the
 * learner never had.
 */
export function buildAnalysisWrites(input: {
  mode: StudySource
  klps: KlpRef[]
  starred: boolean
  klpResults: KlpResultDraft[]
  errorTags: ErrorTagDraft[]
  /** Overrides the derived status, e.g. 'no_provenance' for a v1 cache row. */
  forcedStatus?: AnalysisOutcome
}): AnalysisWrites {
  const warnings: AnalysisWarning[] = []
  const resolve = (ref?: number): KlpRef | null =>
    typeof ref === 'number' ? input.klps[ref] ?? null : null

  const klpResults: AnalysisWrites['klpResults'] = []
  for (const r of input.klpResults) {
    const klp = resolve(r.klpRef)
    if (!klp) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(r.klpRef) })
      continue
    }
    klpResults.push({
      klpId: klp.id,
      status: r.status,
      credit: klpCredit(r.status, input.mode),
      mode: input.mode,
      evidence: r.evidence,
    })
  }

  const accepted: AnalysisWrites['errorTags'] = []
  for (const t of input.errorTags) {
    if (!DIMENSIONS.includes(t.dimension)) {
      warnings.push({ reason: 'unknown_dimension', value: String(t.dimension) })
      continue
    }
    if (!validateTagType(t.dimension, t.type)) {
      const known = DIMENSIONS.some((d) => validateTagType(d, t.type))
      warnings.push({
        reason: known ? 'invalid_type_for_dimension' : 'unknown_type',
        value: known ? `${t.dimension}/${t.type}` : t.type,
      })
      continue
    }

    const target = resolve(t.klpRef)
    if (t.klpRef !== undefined && !target) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(t.klpRef) })
      continue
    }
    const secondary = resolve(t.secondaryKlpRef)

    const sig = computeSignificance({
      relevance: target?.weight ?? WHOLE_ANSWER_RELEVANCE,
      severity: t.severity,
      dimension: t.dimension,
      starred: input.starred,
    })

    accepted.push({
      dimension: t.dimension,
      type: t.type,
      klpId: target?.id ?? null,
      secondaryKlpId: secondary?.id ?? null,
      relevance: sig.relevance,
      severity: sig.severity,
      starred: sig.starred,
      significance: sig.significance,
      quote: t.quote,
    })
  }

  // Cap per dimension, keeping the most severe. The model is asked to rank,
  // but the cap is enforced here rather than trusted to it.
  const errorTags: AnalysisWrites['errorTags'] = []
  for (const d of DIMENSIONS) {
    const inDim = accepted
      .filter((t) => t.dimension === d)
      .sort((a, b) => b.severity - a.severity)
    if (inDim.length > MAX_TAGS_PER_DIMENSION) {
      warnings.push({ reason: 'dimension_cap', value: d })
    }
    errorTags.push(...inDim.slice(0, MAX_TAGS_PER_DIMENSION))
  }

  const status: AnalysisOutcome =
    input.forcedStatus ?? (input.klps.length === 0 ? 'no_klps' : 'analyzed')

  return { status, klpResults, errorTags, warnings }
}
