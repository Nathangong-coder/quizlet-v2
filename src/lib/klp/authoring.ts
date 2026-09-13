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
import {
  computeSeparation,
  discriminationBreadth,
  scoreCandidate,
  type CandidateGrade,
  type SeparationResult,
} from '@/lib/klp/separation'
import { FRAMING_PROBE, classifyPointRoles, substanceSeparation, type PointRole } from '@/lib/klp/framing'
import { carryVerdicts, mergePartial, trapsToReplace } from '@/lib/klp/regrade-plan'
import { referenceNeedsRewrite, type ReferenceReview } from '@/lib/ai/prompts/review-reference'
import { compressionFindings, ratioFinding, wordRatio, type RebuiltReview } from '@/lib/klp/compression'
import { pickBestRound, describeChoice, type RoundSummary } from '@/lib/klp/best-round'
import { validateKlpSet, type KlpDefect } from '@/lib/klp/validate'
import { toOrderedLevels, type AbstractionLevel } from '@/lib/klp/abstraction'
import {
  canonicalizeEdges,
  findCycles,
  blastRadius,
  weightFromSignals,
  type RelationEdge,
  type RelationProvenance,
} from '@/lib/klp/relations'
import { rebuildFindings, rebuildScores, type RebuildDispute } from './rebuild'
import type { CoverageVerdict, ParityVerdict } from '@/lib/ai/prompts/rebuild'
import {
  MAX_REVISIONS,
  REVISION_BAR,
  SEPARATION_FLOOR,
  GRADE_CANDIDATES_SEPARATELY,
  USE_COMPETENCE_PANEL,
  type ProbeKind,
} from '@/lib/klp/authoring-config'
import {
  computePanelCurve,
  diagnoseKlpCurves,
  findNonMonotonicKlps,
  findUnseparatedBoundaries,
  PANEL_LEVELS,
  type PanelLevel,
  type PanelCurve,
  type KlpCurveDiagnosis,
} from '@/lib/klp/panel'
import { mechanicalKlpPrior, targetKlpCount, type DefinitionPointAssessment } from '@/lib/klp/sizing'
import type { KlpVerdict } from '@/lib/klp/verdicts'
import type { KlpDiscrimination } from '@/lib/klp/separation'

export interface AuthorInput {
  question: string
  definition: string
  setTitle: string
  /**
   * The mechanical sizing prior, computed by `authorCard` before the call. A
   * floor the model may exceed, never a quota — see `src/lib/klp/sizing.ts`.
   */
  minKlps: number
}

export interface AuthorResult {
  referenceAnswer: string
  klps: { text: string; kind: string }[]
  wrongAnswers: { kind: ProbeKind; text: string }[]
  /** The judgment half of adaptive sizing; absent means the prior alone sizes the card. */
  definitionPoints?: DefinitionPointAssessment[]
  /** Where the model thinks the owner's own definition is wrong. Never applied to the card. */
  concerns?: string[]
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
  findings?: { index: number | null; issue: string; fix: string }[]
  reason?: string
  /** Per-point roles (framing points are rendered "keep", see src/lib/klp/framing.ts). */
  roles?: PointRole[]
  /** The card's sized target, so revision cannot silently undo the sizing decision. */
  targetCount: number
  /** The parity grader's reference claims, when a round compresses. */
  mustKeep?: string[]
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
  /**
   * Phase A's abstraction classification (R4). OPTIONAL, and its absence means
   * the check does not run — never that every point is `concrete`.
   *
   * Optional because every other Phase A rule is deterministic and must keep
   * working for a caller with no AI budget, and because this adds a call per
   * card to a pipeline already costing 6-16. A generator that omits it gets
   * every mechanical check and no abstraction finding, which is the honest
   * degradation: the points were not examined, so nothing is claimed about
   * them.
   */
  classifyAbstraction?(input: {
    question: string
    klps: { text: string }[]
  }): Promise<{ levels: { klpIndex: number; level: AbstractionLevel }[] }>
  /**
   * The five-level competence panel (build item 4). OPTIONAL.
   *
   * Written from the QUESTION and the reference answer only — never from the
   * key points, or the panel measures how well the model followed an
   * instruction rather than whether the key points discriminate.
   *
   * Absent, or `USE_COMPETENCE_PANEL` off, and the pipeline uses the three
   * failure-kind adversaries exactly as before.
   */
  /**
   * Rotation mode (2026-09-12): the three wrong answers written by a model
   * that did not write the key points and is not shown them. When present,
   * its output REPLACES `draft.wrongAnswers`. Optional so every existing
   * generator and test is unchanged.
   */
  writeAdversaries?(input: { question: string; referenceAnswer: string; kinds?: readonly ProbeKind[] }): Promise<{ wrongAnswers: { kind: ProbeKind; text: string }[] }>
  /**
   * The batched author call (2026-09-13). OPTIONAL and never called by
   * `authorCard` — the operator script pre-authors a group of cards with it
   * and serves the drafts to `author` from a cache, so the per-card
   * orchestration is unchanged. `ref` is the position in `cards`.
   */
  authorBatch?(input: { setTitle: string; cards: { ref: number; question: string; definition: string; minKlps: number }[] }): Promise<{ cards: (AuthorResult & { ref: number })[] }>
  /**
   * THE COMMUNICATION CHECK (2026-09-13). `reviewReference` is served by the
   * GRADER family and labels an answer on accuracy / conciseness / clarity;
   * `reviseReference` is served by the WRITER and rewrites the reference and
   * re-derives the key points when TypeScript says the review warrants it.
   * Both optional; with only the reviewer present the review is recorded and
   * nothing is rewritten. The same reviewer reads the rebuilt answer after
   * the loop (`rebuild.communication`).
   */
  reviewReference?(input: { question: string; answer: string; definition: string }): Promise<ReferenceReview>
  /**
   * Step A of the compression plan (2026-09-13): the grader reviews the
   * REBUILT answer against the numbered points every round and names the
   * points behind each issue; `compressionFindings` turns them into per-point
   * findings for the same revise call. Optional.
   */
  reviewRebuilt?(input: { question: string; definition: string; rebuiltAnswer: string; klps: { text: string }[] }): Promise<RebuiltReview>
  reviseReference?(input: {
    question: string
    definition: string
    referenceAnswer: string
    klps: { text: string; kind: string }[]
    review: ReferenceReview
  }): Promise<{ referenceAnswer: string; klps: { text: string; kind: string }[] }>
  /**
   * The rebuild test (spec 2026-09-12-rebuild-test-design.md). All three
   * optional together: a generator without them produces an outcome without
   * `rebuild`, and nothing existing changes. `rebuild` must be served by a
   * model from a different family than the writer, and receives ONLY the
   * question and the final key points.
   */
  rebuild?(input: { question: string; klps: { text: string }[] }): Promise<{ rebuiltAnswer: string }>
  gradeCoverage?(input: { question: string; definitionPoints: { point: string }[]; rebuiltAnswer: string }): Promise<{
    points: { index: number; verdict: CoverageVerdict; evidence?: string }[]
    disputes: RebuildDispute[]
  }>
  gradeParity?(input: { question: string; referenceAnswer: string; rebuiltAnswer: string }): Promise<{
    claims: { claim: string; verdict: ParityVerdict }[]
  }>
  writePanel?(input: {
    question: string
    referenceAnswer: string
  }): Promise<{ members: { level: PanelLevel; text: string; weakness: string }[] }>
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

export interface RebuildOutcome {
  rebuiltAnswer: string
  cardCoverage: number | null
  referenceParity: number | null
  extractionLoss: number | null
  clearsBar: boolean | null
  clearsParityBar: boolean | null
  /** Definition points the rebuild left missing, by index. */
  missingPoints: number[]
  coverageVerdicts: { index: number; verdict: CoverageVerdict; evidence?: string }[]
  parityVerdicts: { claim: string; verdict: ParityVerdict }[]
  cardDisputes: RebuildDispute[]
  /** The card's definition points the coverage was graded against, for the record. */
  definitionPoints: string[]
  /** The reviewer's read of the REBUILT answer against the points (last round), when a reviewer ran. */
  review?: RebuiltReview
  /** Rebuilt words / reference words; the number that says whether compression worked. */
  wordRatio: number | null
}

export interface AuthoringOutcome {
  referenceAnswer: string
  /**
   * How the REFERENCE answer scored on each final KLP, in KLP order.
   *
   * Persisted because without it the discrimination evidence is one-sided.
   * `AuthoringProbe.verdicts` records how each wrong answer did; this records
   * whether the good answer passed the same point — and a KLP that everybody
   * fails, the reference included, looks maximally discriminating to any
   * measure that reads only the adversaries.
   */
  referenceVerdicts: KlpVerdict[]
  /**
   * `role` (2026-09-12): `framing` for a definition/contrast point the
   * memorized-template trap was credited on — kept, mapped to topics, but
   * outside `substanceSeparation` and the quality bar. See `src/lib/klp/framing.ts`.
   */
  klps: { text: string; kind: string; weight: number; role: PointRole }[]
  probes: { kind: ProbeKind; text: string; score: number; verdicts: Record<string, KlpVerdict> }[]
  relations: AuthoredRelationDraft[]
  relationStats: RelationStats
  /** Over every point, exactly as before — every stored score is on this scale. */
  separationScore: number
  /**
   * Over the substance points only. This is the number the bar and the
   * `status` read; equal to `separationScore` on a card with no framing points.
   */
  substanceSeparation: number
  revisions: number
  /** `failed` only when the author call produced no KLPs at all. */
  status: 'separated' | 'low_discrimination' | 'failed'
  /**
   * The competence curve, when the panel ran. Undefined means it did not —
   * never that the curve was flat.
   *
   * Carried BESIDE `separationScore` rather than replacing it: the two are
   * different quantities on different scales, and every stored score on the
   * corpus was computed the old way. Reporting both on the same run is what
   * makes the panel evaluable at all.
   */
  panelCurve?: PanelCurve
  /** Per-key-point shape diagnosis from the curve. Empty when no panel ran. */
  klpShapes: KlpCurveDiagnosis[]
  /**
   * Competence boundaries NO key point on this card separates — a defect in the
   * SET rather than in any point. Empty when no panel ran, and expected to be
   * empty on a healthy card.
   */
  unseparatedBoundaries: { stronger: PanelLevel; weaker: PanelLevel }[]
  defects: KlpDefect[]
  /**
   * Why each revision round was triggered, one entry per round, from the
   * quality bar (`REVISION_BAR`). Empty when the first draft cleared every
   * check. Persisted nowhere yet; printed by the run so the revised share and
   * its causes are visible.
   */
  revisionReasons?: string[]
  /** The prompt's own classification of the question (v3). */
  questionType?: string
  /**
   * The graders' veto (src/lib/klp/best-round.ts): which round's set this
   * outcome carries, and why, when it is not the last. `revisions` still
   * counts the rounds run.
   */
  keptRound?: number
  keptRoundReason?: string
  /**
   * The communication check on the reference (2026-09-13): the reviewer's
   * labels on the FIRST draft, and whether the writer was sent back for a
   * rewrite. Undefined when no reviewer ran. Not persisted yet.
   */
  referenceReview?: ReferenceReview & { rewritten: boolean }
  /**
   * The rebuild test. Undefined when the generator did not run it — never a
   * zero. `cardCoverage` replaces `referenceScore` as the completeness number;
   * `referenceScore` stays as `klpFidelity` for the smoke test's sake.
   */
  rebuild?: RebuildOutcome
  /**
   * How many KLPs this card was sized for (`src/lib/klp/sizing.ts`), carried
   * out so a reader can tell a correctly-small card from a thin one. With
   * sizing adaptive, the COUNT alone no longer says which it is.
   */
  targetKlpCount: number
  /**
   * The model's objections to the card's own definition, verbatim and
   * NEVER APPLIED. A pipeline that silently corrects the owner's cards is worse
   * than one that flags them, because the owner never learns their card was
   * wrong. Surfaced at the end of an `author-klps` run; there is no column for
   * these and increment A adds no migration.
   */
  concerns: string[]
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

/**
 * A revision round's grading (src/lib/klp/regrade-plan.ts): carry every
 * verdict on an unchanged point, grade only the new or rewritten points for
 * each kept candidate, and grade a replaced trap in full. Candidates are
 * matched to their previous grade by kind — one of each by construction.
 */
async function regradeIncrementally(
  base: { question: string; referenceAnswer: string; klps: { text: string; kind: string }[] },
  previousKlps: { text: string }[],
  previous: GradedCandidate[],
  candidates: { kind: 'reference' | ProbeKind; text: string }[],
  replaced: ReadonlySet<string>,
  gen: AuthoringGenerator,
): Promise<GradedCandidate[]> {
  const out: GradedCandidate[] = []
  for (const c of candidates) {
    const prev = previous.find((g) => g.kind === c.kind)
    if (!prev || replaced.has(c.kind) || prev.text !== c.text) {
      out.push(...(await gradeAllCandidates(base, [c], gen)))
      continue
    }
    const carried = carryVerdicts(previousKlps, prev.verdicts, base.klps)
    if (carried.pending.length === 0) {
      out.push({ kind: c.kind, text: c.text, verdicts: carried.verdicts as KlpVerdict[] })
      continue
    }
    // The partial call carries the SAME key set as a full one (the isolation
    // guard pins it); only the KLP list is shorter.
    const result = await gen.grade({
      question: base.question,
      referenceAnswer: base.referenceAnswer,
      klps: carried.pending.map((i) => ({ text: base.klps[i].text, kind: base.klps[i].kind })),
      candidateAnswer: c.text,
    })
    out.push({ kind: c.kind, text: c.text, verdicts: mergePartial(carried.verdicts, carried.pending, result.verdicts) })
  }
  return out
}

/** The sizing floor the author call states — computed here so a batched pre-pass sizes cards identically. */
export function authorMinKlps(input: { question: string; definition: string }): number {
  const prior = mechanicalKlpPrior({ question: input.question, definition: input.definition })
  return Math.max(prior, targetKlpCount({ prior }))
}

export async function authorCard(
  input: {
    question: string
    definition: string
    setTitle: string
    /**
     * A panel this card was graded against BEFORE, so a re-authoring run uses
     * the same yardstick (`src/lib/klp/panel-reuse.ts`).
     *
     * Without it every run writes a fresh panel, and two runs' separation
     * scores are then incomparable: a higher number could mean the key points
     * got sharper, or merely that this run drew a weaker panel. Supplying it is
     * what turns the panel into a regression suite rather than a one-off
     * measurement.
     */
    existingPanel?: { level: PanelLevel; text: string }[]
  },
  gen: AuthoringGenerator,
): Promise<AuthoringOutcome> {
  // Sizing, in two halves (increment A §5). The mechanical prior is free and
  // is computed BEFORE the call so it can be stated in the prompt as a floor;
  // the model's per-point detail assessment comes back FROM the call and can
  // only raise the target. Both are combined in TypeScript — the model never
  // states a total, for the same reason it never states a weight.
  const prior = mechanicalKlpPrior({ question: input.question, definition: input.definition })
  const draft = await gen.author({ ...input, minKlps: authorMinKlps(input) })
  const target = targetKlpCount({ prior, points: draft.definitionPoints })
  const concerns = draft.concerns ?? []

  // THE COMMUNICATION CHECK, before anything is graded or trapped: a wordy or
  // hedged reference spawns wordy or hedged key points, and the separation
  // test cannot see either. One rewrite at most; best-effort — a failed review
  // or rewrite keeps the first draft rather than failing the card.
  let referenceReview: (ReferenceReview & { rewritten: boolean }) | undefined
  if (gen.reviewReference && draft.klps.length > 0) {
    try {
      const review = await gen.reviewReference({ question: input.question, answer: draft.referenceAnswer, definition: input.definition })
      let rewritten = false
      if (referenceNeedsRewrite(review) && gen.reviseReference) {
        try {
          const fixed = await gen.reviseReference({
            question: input.question,
            definition: input.definition,
            referenceAnswer: draft.referenceAnswer,
            klps: draft.klps.map((k) => ({ text: k.text, kind: k.kind })),
            review,
          })
          if (fixed.klps.length > 0) {
            draft.referenceAnswer = fixed.referenceAnswer
            draft.klps = fixed.klps as typeof draft.klps
            rewritten = true
          }
        } catch {
          rewritten = false
        }
      }
      referenceReview = { ...review, rewritten }
    } catch {
      referenceReview = undefined
    }
  }

  if (gen.writeAdversaries) {
    // Independent adversaries: written from the question and the reference,
    // never the key points, by a different family than wrote them.
    const external = await gen.writeAdversaries({ question: input.question, referenceAnswer: draft.referenceAnswer })
    draft.wrongAnswers = external.wrongAnswers
  }

  if (draft.klps.length === 0) {
    return {
      referenceAnswer: draft.referenceAnswer,
      // No KLPs means no grading happened, so there is nothing the reference
      // was graded against. Empty, not null: the run completed, it simply had
      // nothing to measure.
      referenceVerdicts: [],
      klps: [],
      probes: [],
      relations: [],
      relationStats: { candidates: 0, accepted: 0, droppedForCycles: 0, droppedOutOfRange: 0 },
      separationScore: 0,
      substanceSeparation: 0,
      revisions: 0,
      status: 'failed',
      klpShapes: [],
      unseparatedBoundaries: [],
      defects: validateKlpSet([], input.question, { targetCount: target }),
      targetKlpCount: target,
      concerns,
    }
  }

  let klps = draft.klps
  let revisions = 0
  const revisionReasons: string[] = []
  let separation: SeparationResult
  let substance: SeparationResult
  let roles: PointRole[] = []
  let wrong: GradedCandidate[]
  // Incremental regrading state: last round's grades and points, and the
  // traps the last round decided to rewrite before this one.
  let graded: GradedCandidate[] | undefined
  let previousKlps: { text: string }[] = []
  let replaceKinds: ProbeKind[] = []
  // Kept out of the loop so the FINAL iteration's reference verdicts survive
  // it. They were computed on every pass and discarded on every pass, which
  // made any per-KLP information measure uncomputable after the fact: the
  // stored probes say how each adversary did, and nothing said whether the
  // good answer passed the same point. `discriminationBreadth` works only
  // because it deliberately asks a weaker question.
  let referenceVerdicts: KlpVerdict[] = []

  // THE PANEL IS WRITTEN ONCE, BEFORE THE LOOP, and re-graded unchanged against
  // every revision — the same discipline `draft.wrongAnswers` already has. A
  // panel regenerated per revision would make a rising score ambiguous between
  // "the edit improved the item" and "the new panel was weaker".
  //
  // Best-effort: a failed panel call falls back to the three adversaries rather
  // than failing the card. The panel is a better measurement, not a required
  // one.
  let panel: { level: PanelLevel; text: string; weakness: string }[] | undefined
  // A PANEL THIS CARD ALREADY HAS WINS over writing a new one — that is what
  // makes two runs comparable. `weakness` is not stored and is not needed: it
  // is guidance for the writer, never an input to any score.
  if (USE_COMPETENCE_PANEL && input.existingPanel?.length === PANEL_LEVELS.length) {
    panel = input.existingPanel.map((m) => ({ ...m, weakness: '' }))
  } else if (USE_COMPETENCE_PANEL && gen.writePanel) {
    try {
      const written = await gen.writePanel({
        question: input.question,
        referenceAnswer: draft.referenceAnswer,
      })
      // Ordered strongest-first here rather than trusting the reply's order:
      // every curve statistic downstream reads position as competence.
      const byLevel = new Map(written.members.map((m) => [m.level, m]))
      const ordered = PANEL_LEVELS.map((l) => byLevel.get(l)).filter(
        (m): m is { level: PanelLevel; text: string; weakness: string } => m !== undefined,
      )
      if (ordered.length === PANEL_LEVELS.length) panel = ordered
    } catch {
      panel = undefined
    }
  }

  let rebuild: RebuildOutcome | undefined
  // One snapshot per round, so the best round (not the last) can be kept.
  type Snapshot = {
    klps: typeof klps
    graded: GradedCandidate[]
    separation: SeparationResult
    substance: SeparationResult
    roles: PointRole[]
    rebuild: RebuildOutcome | undefined
    summary: RoundSummary
  }
  const snapshots: Snapshot[] = []
  let panelCurve: PanelCurve | undefined
  let klpShapes: KlpCurveDiagnosis[] = []
  let unseparatedBoundaries: { stronger: PanelLevel; weaker: PanelLevel }[] = []

  for (;;) {
    const candidates: { kind: 'reference' | ProbeKind; text: string }[] = [
      { kind: 'reference', text: draft.referenceAnswer },
      ...(panel
        ? // The panel REPLACES the adversaries. `kind` carries the level so the
          // stored probes say which member produced which verdicts; the string
          // is not a ProbeKind, and that widening is contained to this array.
          panel.map((m) => ({ kind: m.level as unknown as ProbeKind, text: m.text }))
        : draft.wrongAnswers.map((w) => ({ kind: w.kind, text: w.text }))),
    ]

    const base = {
      question: input.question,
      referenceAnswer: draft.referenceAnswer,
      klps: klps.map((k) => ({ text: k.text, kind: k.kind })),
    }
    if (!graded) {
      graded = await gradeAllCandidates(base, candidates, gen)
    } else {
      // A trap that beat the last set is rewritten (same kind, fresh answer)
      // when an independent adversary writer exists; otherwise it is kept and
      // partially regraded like everything else. Best-effort: a failed write
      // keeps the old trap rather than failing the card.
      const replaced = new Set<string>()
      if (replaceKinds.length > 0 && gen.writeAdversaries && !panel) {
        try {
          const fresh = await gen.writeAdversaries({ question: input.question, referenceAnswer: draft.referenceAnswer, kinds: replaceKinds })
          for (const w of fresh.wrongAnswers) {
            if (!replaceKinds.includes(w.kind)) continue
            const slot = candidates.findIndex((c) => c.kind === w.kind)
            if (slot < 0) continue
            candidates[slot] = { kind: w.kind, text: w.text }
            draft.wrongAnswers = draft.wrongAnswers.map((x) => (x.kind === w.kind ? { kind: w.kind, text: w.text } : x))
            replaced.add(w.kind)
          }
        } catch {
          // keep the previous traps
        }
      }
      graded = await regradeIncrementally(base, previousKlps, graded, candidates, replaced, gen)
    }
    previousKlps = klps.map((k) => ({ text: k.text }))

    const referenceGrade: CandidateGrade = { kind: 'reference', verdicts: graded[0].verdicts }
    referenceVerdicts = graded[0].verdicts
    wrong = graded.slice(1)
    const wrongGrades: CandidateGrade[] = wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts }))

    separation = computeSeparation(referenceGrade, wrongGrades)
    // Framing points are classified on the SAME verdicts, then the bar reads
    // the separation over what is left. Recomputed every round: a revision can
    // turn a framing point into a substance one and back. The panel has no
    // template member, so with a panel every point is substance.
    roles = panel ? klps.map((): PointRole => 'substance') : classifyPointRoles(klps, wrongGrades)
    substance = substanceSeparation(referenceGrade, wrongGrades, roles)

    if (panel) {
      // The curve is computed from the SAME verdicts the old number uses, so
      // both are always available and directly comparable on the same run —
      // which is what a toggle is for. `separated` comes from the curve when
      // the panel is on, because that is the quantity being tested.
      const gradedPanel = wrong.map((w) => ({
        level: w.kind as unknown as PanelLevel,
        verdicts: w.verdicts,
      }))
      panelCurve = computePanelCurve(gradedPanel)
      klpShapes = [
        ...diagnoseKlpCurves(gradedPanel, klps.length),
        ...findNonMonotonicKlps(gradedPanel, klps.length),
      ]
      unseparatedBoundaries = findUnseparatedBoundaries(gradedPanel, klps.length)
    }

    // THE REBUILD TEST, EVERY ROUND (2026-09-13): rebuild from this round's
    // points, grade against the card's points and the reference, and hand the
    // parity and coverage misses to the SAME revise call as the separation
    // findings — one combined rewrite, then one regrade. The last round's
    // result is what the outcome carries.
    rebuild = await runRebuildTest(input.question, draft, klps, gen)
    if (rebuild && gen.reviewRebuilt) {
      try {
        rebuild.review = await gen.reviewRebuilt({
          question: input.question,
          definition: input.definition,
          rebuiltAnswer: rebuild.rebuiltAnswer,
          klps: klps.map((k) => ({ text: k.text })),
        })
      } catch {
        rebuild.review = undefined
      }
    }

    // THE QUALITY BAR (2026-09-12). Separation alone let through cards whose
    // reference failed its own points, compound points, and weak answers at
    // 0.60. Every check here is computed in TypeScript; the model is told
    // exactly which point failed which check and what to do about it.
    const findings = revisionFindings({
      separation: substance,
      roles,
      panelSeparated: panel ? panelCurve?.separated : undefined,
      referenceVerdicts,
      wrong,
      defects: validateKlpSet(klps.map((k) => ({ text: k.text })), input.question, { targetCount: target }),
    })
    if (rebuild) {
      findings.push(
        ...rebuildFindings({
          scores: rebuild,
          parity: rebuild.parityVerdicts,
          definitionPoints: rebuild.definitionPoints,
        }),
      )
      // COMPRESSION (steps A and C): the reviewer's per-point issues and the
      // word ratio, into the same round. Precedence is stated in the revise
      // prompt: cut words, never distinct claims.
      findings.push(...compressionFindings(rebuild.review, klps.length))
      const ratio = ratioFinding(rebuild.wordRatio)
      if (ratio) findings.push(ratio)
    }
    snapshots.push({
      klps,
      graded,
      separation,
      substance,
      roles,
      rebuild,
      summary: {
        round: revisions,
        substanceSeparation: substance.separation,
        separated: panelCurve ? panelCurve.separated : substance.separated,
        referenceParity: rebuild?.referenceParity ?? null,
        clearsParityBar: rebuild?.clearsParityBar ?? null,
        clearsCoverageBar: rebuild?.clearsBar ?? null,
        rebuiltTight: rebuild?.review?.conciseness === 'tight',
        wordRatio: rebuild?.wordRatio ?? null,
      },
    })
    if (findings.length === 0 || revisions >= MAX_REVISIONS) break
    // Decide now, on THIS round's verdicts, which traps the next round rewrites.
    replaceKinds = trapsToReplace(
      wrong.map((w) => ({ kind: w.kind as ProbeKind, verdicts: w.verdicts })),
      roles,
      substance.separation > REVISION_BAR,
    )
    const reason = findings
      .filter((f) => f.index === null)
      .map((f) => f.issue)
      .concat(findings.filter((f) => f.index !== null).map((f) => `[${f.index}] ${f.issue}`))
      .join('; ')
    revisionReasons.push(reason)

    // The parity grader objects BEFORE a cut: on a round that compresses,
    // every reference claim it decomposed is handed to the revise call as a
    // claim that must survive.
    const compresses = findings.some((f) => /^(restatement|clause bloat)|rebuild to/.test(f.issue))
    const mustKeep = compresses && rebuild ? rebuild.parityVerdicts.map((v) => v.claim) : undefined
    const revised = await gen.revise({
      question: input.question,
      klps: klps.map((k) => ({ text: k.text, kind: k.kind })),
      discrimination: substance.perKlp,
      roles,
      findings,
      reason,
      targetCount: target,
      ...(mustKeep ? { mustKeep } : {}),
    })
    klps = revised.klps
    revisions += 1
  }

  // THE GRADERS' VETO: keep the best round, not the last. Everything after
  // this point (relations, weights, classification, the outcome) reads the
  // kept round's points and verdicts.
  const keptRound = pickBestRound(snapshots.map((s) => s.summary))
  const keptRoundReason = describeChoice(snapshots.map((s) => s.summary), keptRound)
  if (keptRound >= 0 && keptRound !== snapshots.length - 1) {
    const s = snapshots[keptRound]
    klps = s.klps
    separation = s.separation
    substance = s.substance
    roles = s.roles
    rebuild = s.rebuild
    referenceVerdicts = s.graded[0].verdicts
    wrong = s.graded.slice(1)
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

  // Weight from BOTH signals (increment A §1). The graph term carries
  // derivation chains and the evidence term carries enumerations; a card that
  // is one shape has almost no spread in the other term, which is why the
  // blend exists rather than a choice between them. `wrong` here is the FINAL
  // round's grades — the ones that produced the separation actually reported,
  // not an earlier revision's.
  const radii = blastRadius(klps.length, accepted)
  const breadths = discriminationBreadth(
    wrong.map((w) => ({ kind: w.kind, verdicts: w.verdicts })),
    klps.length,
  )
  const weights = radii.map((radius, i) => weightFromSignals(radius, breadths[i]))

  // PHASE A's one model-dependent check (R4), run LAST on the FINAL key points
  // — classifying an earlier revision's text would report a card that no longer
  // exists. Best-effort: a classifier that throws leaves `abstraction`
  // undefined, and `validateKlpSet` then skips the check entirely rather than
  // defaulting every point to a level nobody judged. A failed call must cost a
  // finding, never invent one.
  let abstraction: (AbstractionLevel | undefined)[] | undefined
  if (gen.classifyAbstraction) {
    try {
      const reply = await gen.classifyAbstraction({
        question: input.question,
        klps: klps.map((k) => ({ text: k.text })),
      })
      abstraction = toOrderedLevels(reply, klps.length)
    } catch {
      abstraction = undefined
    }
  }

  const probes = wrong.map((w) => ({
    kind: w.kind as ProbeKind,
    text: w.text,
    score: scoreCandidate(w.verdicts),
    verdicts: Object.fromEntries(w.verdicts.map((v, i) => [String(i), v])),
  }))

  return {
    referenceAnswer: draft.referenceAnswer,
    klps: klps.map((k, i) => ({ text: k.text, kind: k.kind, weight: weights[i], role: roles[i] ?? 'substance' })),
    probes,
    relations: accepted,
    relationStats: {
      candidates: candidateCount,
      accepted: accepted.length,
      droppedForCycles,
      droppedOutOfRange,
    },
    separationScore: separation.separation,
    substanceSeparation: substance.separation,
    referenceVerdicts,
    revisions,
    // The PANEL's verdict wins when a panel ran, because that is the quantity
    // the run was testing. Otherwise the SUBSTANCE separation decides: a card
    // whose only unseparated points are framing is not low-discrimination.
    status: (panelCurve ? panelCurve.separated : substance.separated)
      ? 'separated'
      : 'low_discrimination',
    panelCurve,
    klpShapes,
    unseparatedBoundaries,
    // The ordering cross-check needs the ACCEPTED edges, so validation runs
    // after pruning rather than beside the KLP text: an edge dropped for
    // introducing a cycle or pointing out of range is not evidence of anything,
    // and flagging a card's order against one would be a defect invented from a
    // relation the pipeline itself refused.
    defects: validateKlpSet(
      klps.map((k) => ({ text: k.text })),
      input.question,
      { edges: accepted, targetCount: target, abstraction },
    ),
    targetKlpCount: target,
    concerns,
    revisionReasons,
    questionType: (draft as { questionType?: string }).questionType,
    ...(referenceReview ? { referenceReview } : {}),
    ...(keptRound >= 0 ? { keptRound } : {}),
    ...(keptRoundReason ? { keptRoundReason } : {}),
    ...(rebuild ? { rebuild } : {}),
  }
}

/** One rebuild-test round: rebuild from the points, grade coverage and parity. Undefined when the generator lacks the test. */
async function runRebuildTest(
  question: string,
  draft: { referenceAnswer: string; definitionPoints?: { point: string }[] },
  klps: { text: string }[],
  gen: AuthoringGenerator,
): Promise<RebuildOutcome | undefined> {
  if (!gen.rebuild || !gen.gradeCoverage || !gen.gradeParity) return undefined
  const built = await gen.rebuild({ question, klps: klps.map((k) => ({ text: k.text })) })
  const definitionPoints = (draft.definitionPoints ?? []).map((p) => ({ point: p.point }))
  const [coverage, parity] = await Promise.all([
    gen.gradeCoverage({ question, definitionPoints, rebuiltAnswer: built.rebuiltAnswer }),
    gen.gradeParity({ question, referenceAnswer: draft.referenceAnswer, rebuiltAnswer: built.rebuiltAnswer }),
  ])
  const scores = rebuildScores({ coverage: coverage.points, definitionPointCount: definitionPoints.length, parity: parity.claims })
  return {
    rebuiltAnswer: built.rebuiltAnswer,
    cardCoverage: scores.cardCoverage,
    referenceParity: scores.referenceParity,
    extractionLoss: scores.extractionLoss,
    clearsBar: scores.clearsBar,
    clearsParityBar: scores.clearsParityBar,
    missingPoints: scores.missingPoints,
    coverageVerdicts: coverage.points,
    parityVerdicts: parity.claims,
    cardDisputes: coverage.disputes ?? [],
    definitionPoints: definitionPoints.map((p) => p.point),
    wordRatio: wordRatio(built.rebuiltAnswer, draft.referenceAnswer),
  }
}

/**
 * Turns the quality bar into named, per-point findings for the revise call.
 * Pure. Empty means "clears the bar". Every finding carries the FIX the model
 * is asked to make, so revision is a list of edits, not a request to
 * self-critique.
 */
export function revisionFindings(input: {
  /** The SUBSTANCE separation when roles are given; the full one otherwise. */
  separation: SeparationResult
  /**
   * Per-point roles. A `framing` point's acceptance by the memorized-template
   * answer is expected and is not a finding; every other trap's acceptance
   * still is. Absent means every point is substance.
   */
  roles?: PointRole[]
  /** When the competence panel ran, its own verdict on separation. */
  panelSeparated?: boolean
  referenceVerdicts: KlpVerdict[]
  wrong: GradedCandidate[]
  defects: KlpDefect[]
}): { index: number | null; issue: string; fix: string }[] {
  const out: { index: number | null; issue: string; fix: string }[] = []
  const sep = input.separation
  const separated = input.panelSeparated ?? sep.separated

  // Separation: the floor decides the flag, the bar decides revision.
  if (!separated) {
    out.push({
      index: null,
      issue: `separation ${sep.separation.toFixed(2)} is below the ${SEPARATION_FLOOR.toFixed(2)} floor`,
      fix: 'the points marked CARRIES NO INFORMATION let a wrong answer score as well as the strong one; split each into the specific claim it hides',
    })
  } else if (sep.separation <= REVISION_BAR) {
    // Inclusive: a card must CLEAR the bar to skip revision. Measured
    // 2026-09-12 on six role-split cards: two sat at exactly 0.60 and one
    // below, so `<` revised 17% and `<=` revises 50%; the owner asked for at
    // least a fifth.
    const best = input.wrong.reduce<GradedCandidate | undefined>(
      (b, w) => (!b || scoreCandidate(w.verdicts) > scoreCandidate(b.verdicts) ? w : b),
      undefined,
    )
    out.push({
      index: null,
      issue: `separation ${sep.separation.toFixed(2)} does not clear the ${REVISION_BAR.toFixed(2)} bar`,
      fix: `the "${best?.kind ?? 'weak'}" answer scored ${best ? scoreCandidate(best.verdicts).toFixed(2) : '?'}; tighten the points it passed (marked below) to the specific claim a weak answer cannot make`,
    })
  }
  // Points a weak answer passed outright — named per point so the fix is local.
  input.wrong.forEach((w) => {
    w.verdicts.forEach((v, i) => {
      if (v === 'correct' && !(w.kind === FRAMING_PROBE && input.roles?.[i] === 'framing')) {
        out.push({
          index: i,
          issue: `accepted by the ${w.kind} answer`,
          fix: 'this wrong answer satisfied the point fully; state the claim so that only a correct answer can meet it',
        })
      }
    })
  })
  // Reference misses: the author wrote a point its own best answer does not satisfy.
  input.referenceVerdicts.forEach((v, i) => {
    if (v !== 'correct') {
      out.push({
        index: i,
        issue: `reference answer scored ${v} on this point`,
        fix: 'the strong answer does not establish this claim; rewrite it to what the answer actually says, or cut it',
      })
    }
  })
  // Hygiene, from the deterministic checks, with the fix each rule implies.
  const FIX: Record<string, string> = {
    compound: 'two claims joined in one point; split it into two points that can pass or fail independently',
    restatement: 'this repeats another point in different words; drop it or merge the two',
    duplicate: 'this duplicates another point; drop it',
    not_self_contained: 'it refers to "this", "it" or "the above"; rewrite it so it stands alone with its subject named',
    meta_language: 'it describes that a claim exists instead of stating the claim; state the claim',
    numeric_inconsistency: 'a number here disagrees with the card; correct it to the card',
    ordering: 'this point uses a result that a later point derives; reorder so prerequisites come first',
    count: 'the set is outside its size target; add the missing claim or cut the padding',
    disposition: 'this is advice or a judgement, not a testable proposition; restate it as a claim about the world',
    abstraction_spread: 'this point is at a different level of abstraction from the rest; bring it to the level of the others',
    verbose: 'cut it to one claim in about 25 words; a because-clause stays only if the claim is ambiguous without it, and becomes its own point only if a wrong answer could fail it on its own',
  }
  for (const d of input.defects) {
    out.push({ index: d.index, issue: d.rule.replace(/_/g, ' '), fix: FIX[d.rule] ?? d.detail ?? 'fix this point' })
  }
  return out
}
