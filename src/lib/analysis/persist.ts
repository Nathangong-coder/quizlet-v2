import type { StudySource } from '@/lib/memory/scoring'
import {
  DIMENSIONS, MAX_TAGS_PER_DIMENSION, validateTagType, type Dimension,
} from '@/lib/errors/taxonomy'
import { computeSignificance } from '@/lib/errors/significance'
import { klpCredit, type KlpStatus } from '@/lib/errors/klp-credit'
import type { KlpVerdict } from '@/lib/klp/verdicts'
import { resolveSeverity } from '@/lib/errors/bands'
import { contaminationFactor } from '@/lib/errors/contamination'
import { resolveSpan } from '@/lib/analysis/spans'

/**
 * Version of the whole analysis-capture contract: the error-tag vocabulary,
 * the significance constants, and the klp-credit constants, versioned
 * together. Bump this if any of those three change in a way that makes an
 * old row's numbers not comparable to a new one's.
 *
 * Lives here (not in the `'use server'` action file that writes it) because
 * a "use server" module may only export async functions — a plain constant
 * export there is a hard Next.js build error.
 *
 * v2 (Spec 3): severity is now derived from a type band and an instance
 * magnitude, so a v1 row's severity is not comparable to a v2 row's.
 *
 * v3 (the negative check): `AnswerKlpResult.credit` is now
 * `statusCredit x evidenceStrength x contaminationFactor`. A v2 credit and a v3
 * credit for the same status and mode are therefore not comparable whenever the
 * answer carried a whole-answer accuracy tag. No column was added: the factor is
 * recomputable from the answer's own persisted `AnswerErrorTag` rows, which
 * already store dimension, type, klpId and severity — so the inputs ARE stored,
 * as the analysis contract requires, without a migration.
 *
 * v4 (Spec 5 Phase A, the content pass): the KLP vocabulary is widened from
 * three labels to the runtime verdict set, strict grading is on, the learner
 * profile is removed from the judgment prompt, `correct` replaces `passed`
 * (which is never written again — a read-only alias), every non-`correct`
 * verdict quotes the answer and the quote is resolved in TypeScript to
 * `AnswerKlpResult.spanStart/spanEnd`, relation verdicts persist on
 * `AnswerRelationResult` (passive provenance), form requirements on
 * `AnswerFormResult`, and unwarranted claims — the contamination check made
 * first-class — on `AnswerUnwarrantedClaim`, which the contamination factor
 * now reads alongside the tags. A v3 credit and a v4 credit are therefore not
 * comparable whenever the answer carried an unwarranted claim, and a v3 row's
 * `failed` is not distinguishable from a v4 row's specific label.
 * `QuizAnswer.graderVersion` (`GRADER_VERSION`, version.ts) separately names
 * the instrument that produced the rows.
 */
export const ANALYSIS_VERSION = 4

/** Why an answer has the analysis rows it has. */
export type AnalysisOutcome = 'analyzed' | 'no_provenance' | 'no_klps' | 'failed'

export interface KlpRef {
  id: string
  weight: number
}

export interface KlpResultDraft {
  klpRef: number
  /**
   * `KlpStatus`, the superset, not `KlpVerdict`: the runtime schema only ever
   * parses a verdict, but MC/TF drafts and legacy carry-forward paths are
   * typed against the persisted vocabulary, which still includes `passed`.
   */
  status: KlpStatus
  /** The verbatim excerpt the grader cited. Resolved to a span in TS. */
  quote?: string
  /**
   * Alias of `quote`, filled by the schema bridge (`bridgeQuoteToEvidence`)
   * and by older callers. `quote` wins when both are present.
   */
  evidence?: string
}

/** One relation on the card, judged passively from the answer (Spec 5 §4). */
export interface RelationResultDraft {
  relationRef: number
  status: KlpVerdict
  quote?: string
}

/** One authored form requirement, met or not (Spec 5 §5). */
export interface FormResultDraft {
  formRef: number
  status: 'met' | 'not_met'
  quote?: string
}

/**
 * A claim the answer makes that the key points do not — false, misleading or
 * invented (Spec 5 §3). `magnitude` is the grader's 1-10 seriousness for THIS
 * instance; the contamination band maps it, TypeScript never ranks it.
 */
export interface UnwarrantedDraft {
  text: string
  quote?: string
  magnitude: number
}

export interface ErrorTagDraft {
  dimension: Dimension
  type: string
  klpRef?: number
  secondaryKlpRef?: number
  /** 1-10 instance magnitude. `MC_TF_MAGNITUDE` for a generated distractor. */
  magnitude: number
  quote?: string
}

export interface AnalysisWarning {
  reason: string
  value: string
}

/**
 * Character offsets into `QuizAnswer.answer` for the quote a row cites. Both
 * null when the grader gave no quote (a `correct` key-point verdict) or gave
 * one that could not be located (a paraphrase — recorded as `quote_unresolved`).
 * Explicitly null rather than absent, so a fresh unresolved row and a
 * pre-Phase-A row read the same way.
 */
interface SpanColumns {
  spanStart: number | null
  spanEnd: number | null
}

export interface AnalysisWrites {
  status: AnalysisOutcome
  klpResults: ({
    klpId: string
    status: KlpStatus
    credit: number
    mode: StudySource
    /** The quote text, kept for display; the span is its location. */
    evidence?: string
  } & SpanColumns)[]
  /** `AnswerRelationResult` rows. Passive: judged from the answer as given, no probe asked. */
  relationResults: ({
    relationId: string
    status: KlpVerdict
    credit: number
    provenance: 'passive'
    evidence?: string
  } & SpanColumns)[]
  /** `AnswerFormResult` rows. */
  formResults: ({
    formRequirementId: string
    status: 'met' | 'not_met'
    evidence?: string
  } & SpanColumns)[]
  /** `AnswerUnwarrantedClaim` rows — uncapped, unlike tags. */
  unwarranted: ({
    text: string
    magnitude: number
    evidence?: string
  } & SpanColumns)[]
  errorTags: {
    dimension: Dimension
    type: string
    klpId: string | null
    secondaryKlpId: string | null
    relevance: number
    severity: number
    magnitude: number
    mode: StudySource
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
  /**
   * The stored answer text every quote is located in. `''` for a mode with
   * nothing to quote (MC/TF), where no draft carries a quote either.
   */
  answerText: string
  /**
   * The card's relations, by the ref the grader was shown — the SAME array
   * `promptViewOf` numbered (`src/lib/quiz/grading-context.ts`), so a verdict
   * on `[R1]` lands on `relations[1]`. Empty for a mode that shows none (MC/TF).
   */
  relations: { id: string }[]
  /** The card's form requirements, by the ref the grader was shown. Same rule. */
  formReqs: { id: string }[]
  relationResults: RelationResultDraft[]
  formResults: FormResultDraft[]
  unwarranted: UnwarrantedDraft[]
  /** Overrides the derived status, e.g. 'no_provenance' for a v1 cache row. */
  forcedStatus?: AnalysisOutcome
}): AnalysisWrites {
  const warnings: AnalysisWarning[] = []
  const resolve = (ref?: number): KlpRef | null =>
    typeof ref === 'number' ? input.klps[ref] ?? null : null

  // The MODEL quotes; TypeScript locates. A quote that was given and cannot be
  // found is a paraphrase — kept as `evidence` for display, span null, and
  // named in the warnings so the benchmark can count the rate. No quote at all
  // (a `correct` key-point verdict is not asked for one) is silent: nothing
  // went unresolved.
  // An empty or blank quote is "no quote", not a paraphrase: nothing was
  // cited, so there is nothing to fail to find — no evidence, no span, no warning.
  const quoteOf = (q: string | undefined): string | undefined => (q && q.trim() ? q : undefined)
  const locate = (quote: string | undefined, ref: string): SpanColumns => {
    if (quote === undefined) return { spanStart: null, spanEnd: null }
    const span = resolveSpan(input.answerText, quote)
    if (!span) {
      warnings.push({ reason: 'quote_unresolved', value: ref })
      return { spanStart: null, spanEnd: null }
    }
    return { spanStart: span.start, spanEnd: span.end }
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

    const severity = resolveSeverity({
      type: t.type,
      magnitude: t.magnitude,
      mode: input.mode,
    })

    const sig = computeSignificance({
      relevance: target?.weight ?? WHOLE_ANSWER_RELEVANCE,
      severity,
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
      magnitude: t.magnitude,
      mode: input.mode,
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

  // THE NEGATIVE CHECK. Computed from the ACCEPTED tags — the ones that
  // survived vocabulary validation and carry a resolved severity — and applied
  // to every key point's credit below.
  //
  // ORDER IS LOAD-BEARING, and it is why the key-point loop moved below the tag
  // loop: credit now depends on the tags, so a tag that has not been validated
  // and severity-resolved yet cannot inform it. Computed from `errorTags`
  // (post-cap) rather than `accepted` so that a tag dropped by the per-dimension
  // cap cannot dock credit while being absent from the row that would explain
  // why — the factor must be recomputable from what was actually persisted.
  //
  // Unwarranted claims (Spec 5 §3) are the second source. Uncapped and never
  // validated against a vocabulary — there is none; the text IS the claim —
  // so every draft becomes a row, and every row informs the factor. An
  // unresolvable quote only costs the span, never the claim.
  const unwarranted: AnalysisWrites['unwarranted'] = input.unwarranted.map((u, i) => {
    const quote = quoteOf(u.quote)
    return {
      text: u.text,
      magnitude: u.magnitude,
      evidence: quote,
      ...locate(quote, `unwarranted:${i}`),
    }
  })
  const factor = contaminationFactor({ tags: errorTags, unwarranted })

  const klpResults: AnalysisWrites['klpResults'] = []
  // AnswerKlpResult is unique on (quizAnswerId, klpId), and nothing stops the
  // grader naming the same point twice — the schema permits a repeated
  // `klpRef`. Undeduped, `createMany` violated the constraint and rolled back
  // the ENTIRE transaction, so a successfully graded answer was discarded
  // behind "Failed to submit answer".
  //
  // Keyed on the RESOLVED klpId, not the ref: two different refs can point at
  // the same KLP, and the constraint is on the id. The FIRST occurrence wins
  // — merging two contradictory statuses would invent a judgment the grader
  // never made, which is the same fabrication the unresolved-ref path refuses.
  const seenKlpIds = new Set<string>()
  for (const r of input.klpResults) {
    const klp = resolve(r.klpRef)
    if (!klp) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(r.klpRef) })
      continue
    }
    if (seenKlpIds.has(klp.id)) {
      warnings.push({ reason: 'duplicate_klp_ref', value: String(r.klpRef) })
      continue
    }
    seenKlpIds.add(klp.id)
    const quote = quoteOf(r.quote ?? r.evidence)
    // `passed` is a read-only alias; from v4 no row is written with it — every
    // caller is covered here, not at each draft site.
    const status: KlpStatus = r.status === 'passed' ? 'correct' : r.status
    klpResults.push({
      klpId: klp.id,
      status,
      credit: klpCredit(status, input.mode, factor),
      mode: input.mode,
      evidence: quote,
      ...locate(quote, `klp:${r.klpRef}`),
    })
  }

  // Relations, judged passively (Spec 5 §4): the same ref-resolution and
  // dedupe discipline as key points — AnswerRelationResult is unique on
  // (quizAnswerId, relationId) — and the same credit formula, so a relation
  // observation and a key-point observation are comparable numbers. An
  // unresolvable ref is a warning and no row: until the call site passes the
  // card's relation ids, every ref lands here, which is the honest state.
  const relationResults: AnalysisWrites['relationResults'] = []
  const seenRelationIds = new Set<string>()
  for (const r of input.relationResults) {
    const rel = input.relations[r.relationRef] ?? null
    if (!rel) {
      warnings.push({ reason: 'unresolved_relation_ref', value: String(r.relationRef) })
      continue
    }
    if (seenRelationIds.has(rel.id)) {
      warnings.push({ reason: 'duplicate_relation_ref', value: String(r.relationRef) })
      continue
    }
    seenRelationIds.add(rel.id)
    const quote = quoteOf(r.quote)
    relationResults.push({
      relationId: rel.id,
      status: r.status,
      credit: klpCredit(r.status, input.mode, factor),
      provenance: 'passive',
      evidence: quote,
      ...locate(quote, `rel:${r.relationRef}`),
    })
  }

  // Form requirements (Spec 5 §5): met or not, no credit — form is not
  // knowledge and must not feed the posterior. Unique on
  // (quizAnswerId, formRequirementId), hence the dedupe.
  const formResults: AnalysisWrites['formResults'] = []
  const seenFormIds = new Set<string>()
  for (const f of input.formResults) {
    const req = input.formReqs[f.formRef] ?? null
    if (!req) {
      warnings.push({ reason: 'unresolved_form_ref', value: String(f.formRef) })
      continue
    }
    if (seenFormIds.has(req.id)) {
      warnings.push({ reason: 'duplicate_form_ref', value: String(f.formRef) })
      continue
    }
    seenFormIds.add(req.id)
    const quote = quoteOf(f.quote)
    formResults.push({
      formRequirementId: req.id,
      status: f.status,
      evidence: quote,
      ...locate(quote, `form:${f.formRef}`),
    })
  }

  const status: AnalysisOutcome =
    input.forcedStatus ?? (input.klps.length === 0 ? 'no_klps' : 'analyzed')

  return { status, klpResults, errorTags, relationResults, formResults, unwarranted, warnings }
}
