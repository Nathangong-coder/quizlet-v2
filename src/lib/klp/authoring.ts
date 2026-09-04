/**
 * The KLP authoring orchestrator (design doc §1).
 *
 * Runs the whole per-card pipeline: author -> grade each candidate in its
 * OWN call -> compute separation in TypeScript -> revise and re-grade while
 * it fails, capped -> relate -> drop cycle-introducing edges -> compute
 * weight from the resulting graph -> mechanical validation. The AI never
 * computes a score anywhere in this file; every number here is derived from
 * its categorical verdicts, the same division of labour `separation.ts`
 * documents.
 *
 * The AI layer is INJECTED as `AuthoringGenerator`, exactly as `KltGenerator`
 * is in `src/lib/klt/summarize.ts` — so this whole loop is testable with zero
 * AI calls. A production generator (wired to `generateJson` and the four
 * prompts in `src/lib/ai/prompts/`) is assembled by the caller, not exported
 * from here.
 */
import { computeSeparation, scoreCandidate, type CandidateGrade, type SeparationResult } from '@/lib/klp/separation'
import { validateKlpSet, type KlpDefect } from '@/lib/klp/validate'
import {
  canonicalizeEdges,
  findCycles,
  blastRadius,
  weightFromBlastRadius,
  type RelationEdge,
  type RelationProvenance,
} from '@/lib/klp/relations'
import { MAX_REVISIONS, GRADE_CANDIDATES_SEPARATELY, type ProbeKind } from '@/lib/klp/authoring-config'
import type { KlpVerdict } from '@/lib/klp/verdicts'
import type { KlpDiscrimination } from '@/lib/klp/separation'

export interface AuthorInput {
  question: string
  definition: string
  setTitle: string
}

export interface AuthorResult {
  referenceAnswer: string
  klps: { text: string; kind: string }[]
  wrongAnswers: { kind: ProbeKind; text: string }[]
}

export interface GradeInput {
  question: string
  referenceAnswer: string
  klps: { text: string }[]
  candidateAnswer: string
}

export interface GradeResult {
  verdicts: { klpIndex: number; verdict: KlpVerdict; evidence?: string }[]
}

export interface ReviseInput {
  question: string
  klps: { text: string; kind: string }[]
  discrimination: KlpDiscrimination[]
}

export interface ReviseResult {
  klps: { text: string; kind: string }[]
}

export interface RelateInput {
  question: string
  klps: { text: string }[]
}

export type AuthoredRelationDraft = RelationEdge & {
  provenance: RelationProvenance
  rationale: string
  probe: string
}

export interface RelateResult {
  relations: AuthoredRelationDraft[]
}

/**
 * The seam. Production always goes through a generator built from
 * `generateJson` plus the four prompts in `src/lib/ai/prompts/`; this
 * interface exists so the loop below can be driven by a mock in tests and by
 * the real thing in `scripts/author-klps.ts`, with no other code changed.
 */
export interface AuthoringGenerator {
  author(input: AuthorInput): Promise<AuthorResult>
  /**
   * ONE candidate per call — see `src/lib/ai/prompts/grade-candidate.ts` for
   * why this is load-bearing rather than merely careful. `input` never
   * carries which archetype produced `candidateAnswer`; the grader judges
   * the text alone.
   */
  grade(input: GradeInput): Promise<GradeResult>
  revise(input: ReviseInput): Promise<ReviseResult>
  relate(input: RelateInput): Promise<RelateResult>
}

/**
 * Diagnostics for the relate step, DISPLAY-ONLY — nothing here is persisted
 * (the `KlpRelation` schema is closed; see the design doc). Without this,
 * nothing distinguishes "this card genuinely has independent leaves" from
 * "the relate call returned little, or its edges were pruned" — only the
 * final accepted set survives otherwise, even in verbose printouts.
 */
export interface RelationStats {
  /** Raw count of edges `gen.relate` returned, before any filtering. */
  candidates: number
  /** Final count after both filters, i.e. `relations.length`. */
  accepted: number
  /** Dropped because adding them would introduce a cycle. */
  droppedForCycles: number
  /** Dropped because an endpoint referenced a KLP index that doesn't exist on this card. */
  droppedOutOfRange: number
}

export interface AuthoringOutcome {
  referenceAnswer: string
  klps: { text: string; kind: string; weight: number }[]
  probes: { kind: ProbeKind; text: string; score: number; verdicts: Record<string, KlpVerdict> }[]
  relations: AuthoredRelationDraft[]
  relationStats: RelationStats
  separationScore: number
  revisions: number
  /** `failed` only when the author call produced no KLPs at all. */
  status: 'separated' | 'low_discrimination' | 'failed'
  defects: KlpDefect[]
}

/** Fills any klpIndex the grader skipped with the honest 'failed' fallback, never a fabricated pass. */
function toOrderedVerdicts(result: GradeResult, count: number): KlpVerdict[] {
  const byIndex = new Map(result.verdicts.map((v) => [v.klpIndex, v.verdict]))
  return Array.from({ length: count }, (_, i) => byIndex.get(i) ?? 'failed')
}

interface GradedCandidate {
  kind: 'reference' | ProbeKind
  text: string
  verdicts: KlpVerdict[]
}

/**
 * Grades every candidate against the current KLP set.
 *
 * `GRADE_CANDIDATES_SEPARATELY` is the named toggle from the design doc
 * (§1.1) and `authoring-config.ts`. TRUE (the default, and the only path any
 * test exercises) makes one isolated `grade` call per candidate — the
 * grader never sees another candidate's answer or any archetype label, so it
 * cannot rank them against each other and manufacture separation.
 *
 * FALSE trades that guarantee for spend. `GRADE_CANDIDATE_PROMPT` is
 * deliberately single-candidate-only (§1.1) — this spec does not build a
 * multi-candidate prompt, because building one would reintroduce exactly the
 * ranking risk isolation exists to prevent. So this branch still issues one
 * `grade` call per candidate rather than fabricating a batched response
 * shape nothing here defines; the difference is that the calls fire
 * concurrently instead of being ordered as an isolation boundary. It is kept
 * as a real, distinct code path — not spend-reducing, but the visible toggle
 * the design doc calls for, wired up honestly rather than faked.
 */
async function gradeAllCandidates(
  base: { question: string; referenceAnswer: string; klps: { text: string }[] },
  candidates: { kind: 'reference' | ProbeKind; text: string }[],
  gen: AuthoringGenerator,
): Promise<GradedCandidate[]> {
  const gradeOne = async (c: { kind: 'reference' | ProbeKind; text: string }): Promise<GradedCandidate> => {
    const result = await gen.grade({
      question: base.question,
      referenceAnswer: base.referenceAnswer,
      klps: base.klps,
      candidateAnswer: c.text,
    })
    return { kind: c.kind, text: c.text, verdicts: toOrderedVerdicts(result, base.klps.length) }
  }

  if (GRADE_CANDIDATES_SEPARATELY) {
    const out: GradedCandidate[] = []
    for (const c of candidates) out.push(await gradeOne(c))
    return out
  }

  return Promise.all(candidates.map(gradeOne))
}

export async function authorCard(
  input: { question: string; definition: string; setTitle: string },
  gen: AuthoringGenerator,
): Promise<AuthoringOutcome> {
  const draft = await gen.author(input)

  if (draft.klps.length === 0) {
    return {
      referenceAnswer: draft.referenceAnswer,
      klps: [],
      probes: [],
      relations: [],
      relationStats: { candidates: 0, accepted: 0, droppedForCycles: 0, droppedOutOfRange: 0 },
      separationScore: 0,
      revisions: 0,
      status: 'failed',
      defects: validateKlpSet([], input.question),
    }
  }

  let klps = draft.klps
  let revisions = 0
  let separation: SeparationResult
  let wrong: GradedCandidate[]

  for (;;) {
    const candidates: { kind: 'reference' | ProbeKind; text: string }[] = [
      { kind: 'reference', text: draft.referenceAnswer },
      ...draft.wrongAnswers.map((w) => ({ kind: w.kind, text: w.text })),
    ]

    const graded = await gradeAllCandidates(
      {
        question: input.question,
        referenceAnswer: draft.referenceAnswer,
        klps: klps.map((k) => ({ text: k.text })),
      },
      candidates,
      gen,
    )

    const referenceGrade: CandidateGrade = { kind: 'reference', verdicts: graded[0].verdicts }
    wrong = graded.slice(1)
    const wrongGrades: CandidateGrade[] = wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))

    separation = computeSeparation(referenceGrade, wrongGrades)

    if (separation.separated || revisions >= MAX_REVISIONS) break

    const revised = await gen.revise({
      question: input.question,
      klps: klps.map((k) => ({ text: k.text, kind: k.kind })),
      discrimination: separation.perKlp,
    })
    klps = revised.klps
    revisions += 1
  }

  const relateResult = await gen.relate({
    question: input.question,
    klps: klps.map((k) => ({ text: k.text })),
  })

  // `RelationDraftSchema` bounds `from`/`to` at `.min(0)` only — the upper
  // bound is `klps.length`, which is dynamic and cannot live in the schema.
  // A hallucinated out-of-range index would otherwise reach `klpIds[r.from]`
  // in `persistAuthoring` and be caught only by Prisma throwing on a
  // missing foreign key, mid-run. Dropped here instead, the same posture
  // `extractKlpsForCards` (`src/actions/klp.ts`) takes toward a hallucinated
  // batch ref: "a hallucinated ref must not write another card's KLPs onto
  // this one" — silently dropping beats throwing mid-run.
  const candidateCount = relateResult.relations.length
  const inRange = relateResult.relations.filter((r) => r.from < klps.length && r.to < klps.length)
  const droppedOutOfRange = candidateCount - inRange.length

  // Add edges ONE AT A TIME and drop any whose addition introduces a cycle,
  // so the specific offender is dropped rather than the whole batch — an AI
  // will happily emit X causes Y and Y causes X across two calls with no way
  // to see the conflict itself.
  const canonical = canonicalizeEdges(inRange)
  const accepted: AuthoredRelationDraft[] = []
  for (const edge of canonical) {
    accepted.push(edge)
    if (findCycles(accepted).length > 0) accepted.pop()
  }
  const droppedForCycles = canonical.length - accepted.length

  const radii = blastRadius(klps.length, accepted)
  const weights = radii.map(weightFromBlastRadius)

  const probes = wrong.map((w) => ({
    kind: w.kind as ProbeKind,
    text: w.text,
    score: scoreCandidate(w.verdicts),
    verdicts: Object.fromEntries(w.verdicts.map((v, i) => [String(i), v])),
  }))

  return {
    referenceAnswer: draft.referenceAnswer,
    klps: klps.map((k, i) => ({ text: k.text, kind: k.kind, weight: weights[i] })),
    probes,
    relations: accepted,
    relationStats: {
      candidates: candidateCount,
      accepted: accepted.length,
      droppedForCycles,
      droppedOutOfRange,
    },
    separationScore: separation.separation,
    revisions,
    status: separation.separated ? 'separated' : 'low_discrimination',
    defects: validateKlpSet(klps.map((k) => ({ text: k.text })), input.question),
  }
}
