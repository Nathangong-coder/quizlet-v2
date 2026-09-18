import type { z } from 'zod'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { WRITE_GRADER_PANEL_PROMPT } from '@/lib/ai/prompts/write-grader-panel'
import {
  GraderPanelSchema,
  graderPanelSchemaFor,
  ShortAnswerGradeSchema,
  ShortAnswerGradeWithAnalysisSchema,
  type GraderPanelDraft,
  type ShortAnswerGrade,
} from '@/lib/ai/schemas'
import { GRADER_VERSION } from '@/lib/analysis/version'
import { gradeMaxOutputTokens } from '@/lib/analysis/output-cap'
import { loadGradingContext, promptViewOf } from '@/lib/quiz/grading-context'
import { readPanelResult, type GraderPanelKind } from '@/lib/analysis/benchmark'
import {
  buildPanelVerdicts,
  selectCardResults,
  type BenchPanel,
  type BenchResultKey,
  type ExistingPanel,
  type PanelCandidate,
  type PanelVerdictWarning,
} from '@/lib/analysis/benchmark-plan'
import type { BenchmarkCardRow } from '@/lib/analysis/benchmark-report'

/**
 * `npm run bench-grader`'s DATABASE half (Spec 5 §8). Loads what the pure
 * planners (`benchmark-plan.ts`) decide over, writes the panel the adversary
 * wrote and the result the grader produced, and reads the rows the report
 * formats. The AI seams are injected: the script decides between the set
 * owner's stored pool and `--direct` env keys, a test hands in a fake.
 *
 * Two rules from the spec, load-bearing:
 *
 *  - **Isolation.** `gradePanelAnswer` grades ONE answer per call. The
 *    prompt carries that answer's text and nothing from any sibling — no
 *    level, no rank, no rationale, no other answer. A grader that can see
 *    the panel ranks the answers against each other and manufactures
 *    separation the key points never earned.
 *  - **The shipped grader.** The prompt is `GRADE_SHORT_ANSWER_PROMPT` at
 *    its current version, built from the card's live key points and the
 *    same `loadGradingContext` (relations, form requirements, reference)
 *    the quiz uses, under the same `gradeMaxOutputTokens` ceiling. The
 *    benchmark measures the instrument the learner meets, not a copy.
 */

/** The adversary seam: writes one panel. Task `grader-panel`, writer family. */
export type PanelWriter = (input: {
  prompt: string
  /** The kind's own schema (`graderPanelSchemaFor(kind)`): a levels panel has no `mode` field to fill. */
  schema: z.ZodType<GraderPanelDraft>
  /** `PANEL_MAX_OUTPUT_TOKENS` — reasoning tokens count against it. */
  maxOutputTokens: number
}) => Promise<{ value: GraderPanelDraft; model: string }>

/** The grader seam: grades one answer. Task `grade`, the runtime grader. */
export type BenchGrader = (input: {
  prompt: string
  /** `ShortAnswerGradeWithAnalysisSchema` — key points are always listed here. */
  schema: typeof ShortAnswerGradeWithAnalysisSchema
  maxOutputTokens: number
}) => Promise<{ value: ShortAnswerGrade; model: string }>

const liveKlpSelect = {
  where: { supersededAt: null },
  orderBy: { index: 'asc' },
  select: { id: true, text: true, weight: true, kind: true, version: true },
} satisfies Prisma.Card$klpsArgs

/** The planner's view of every card on a set, in position order, plus every panel the set has. */
export async function loadPanelCandidates(
  setId: string,
): Promise<{ cards: (PanelCandidate & { term: string })[]; panels: ExistingPanel[] }> {
  const cards = await prisma.card.findMany({
    where: { setId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      term: true,
      klps: { where: { supersededAt: null }, select: { version: true }, take: 1 },
      authorings: { orderBy: { createdAt: 'desc' }, select: { klpVersion: true, referenceAnswer: true } },
      graderPanels: { select: { cardId: true, klpVersion: true, kind: true } },
    },
  })
  return {
    cards: cards.map((c) => {
      const liveKlpVersion = c.klps[0]?.version ?? null
      const authoring = liveKlpVersion === null ? undefined : c.authorings.find((a) => a.klpVersion === liveKlpVersion)
      return {
        cardId: c.id,
        term: c.term,
        liveKlpVersion,
        hasReference: !!authoring && authoring.referenceAnswer.trim().length > 0,
      }
    }),
    panels: cards.flatMap((c) => c.graderPanels),
  }
}

export interface AuthorPanelResult {
  panelId: string
  model: string
  answers: number
}

/**
 * Writes the panel for one card at its live klpVersion. The adversary sees
 * the card, the reference answer, the live key points with kinds, the
 * relations and the form requirements — the fixed instrument the grader is
 * measured against. `GraderPanel` is unique on (cardId, klpVersion, kind);
 * the planner guarantees none exists, and the constraint guarantees it if
 * the planner is bypassed.
 */
/**
 * The panel writer's ceiling. Four answers of 60-200 words plus four
 * rationales are ~2k tokens of TEXT, but the writer is the authoring family
 * at `high` reasoning effort, and on the benchmark's first run GLM spent the
 * provider's default budget (8,192) entirely on reasoning and emitted nothing
 * — `finishReason: 'length'`, text length 0 — on 5 of 10 cards. Reasoning
 * tokens count against the ceiling; the ceiling must leave room after them.
 */
export const PANEL_MAX_OUTPUT_TOKENS = 32768

export async function authorPanel(cardId: string, kind: GraderPanelKind, gen: PanelWriter): Promise<AuthorPanelResult> {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { id: true, term: true, definition: true, klps: liveKlpSelect },
  })
  if (!card) throw new Error(`bench-grader: card ${cardId} not found`)
  if (card.klps.length === 0) throw new Error(`bench-grader: card ${cardId} has no live key points`)
  const klpVersion = card.klps[0].version

  const context = await loadGradingContext(card.id, card.klps)
  if (!context.referenceAnswer) throw new Error(`bench-grader: card ${cardId} has no reference answer at klpVersion ${klpVersion}`)
  const { promptRelations, promptFormReqs } = promptViewOf(card.klps, context)

  const prompt = WRITE_GRADER_PANEL_PROMPT.build({
    question: card.term,
    definition: card.definition,
    referenceAnswer: context.referenceAnswer,
    klps: card.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
    relations: promptRelations,
    formReqs: promptFormReqs,
    kind,
  })

  // OUTSIDE the transaction: never an AI call inside one.
  const { value, model } = await gen({ prompt, schema: graderPanelSchemaFor(kind), maxOutputTokens: PANEL_MAX_OUTPUT_TOKENS })

  const panel = await prisma.graderPanel.create({
    data: {
      cardId: card.id,
      klpVersion,
      kind,
      promptVersion: WRITE_GRADER_PANEL_PROMPT.version,
      model,
      answers: {
        create: value.answers.map((a) => ({
          level: 'level' in a ? a.level : null,
          mode: 'mode' in a ? a.mode : null,
          intendedRank: a.intendedRank,
          text: a.text,
          rationale: a.rationale,
        })),
      },
    },
    select: { id: true },
  })
  return { panelId: panel.id, model, answers: value.answers.length }
}

/** The bench planner's view: every panel of one kind on the set, its answers, and every result key. */
export async function loadBenchPanels(
  setId: string,
  kind: GraderPanelKind,
): Promise<{ panels: (BenchPanel & { term: string })[]; results: BenchResultKey[] }> {
  const rows = await prisma.graderPanel.findMany({
    where: { kind, card: { setId } },
    orderBy: { card: { position: 'asc' } },
    select: {
      id: true,
      cardId: true,
      klpVersion: true,
      card: { select: { term: true, klps: { where: { supersededAt: null }, select: { version: true }, take: 1 } } },
      answers: {
        orderBy: { intendedRank: 'asc' },
        select: { id: true, results: { select: { answerId: true, graderVersion: true, model: true } } },
      },
    },
  })
  return {
    panels: rows.map((p) => ({
      id: p.id,
      cardId: p.cardId,
      term: p.card.term,
      klpVersion: p.klpVersion,
      liveKlpVersion: p.card.klps[0]?.version ?? null,
      answers: p.answers.map((a) => ({ id: a.id })),
    })),
    results: rows.flatMap((p) => p.answers.flatMap((a) => a.results)),
  }
}

export type GradePanelAnswerResult =
  | { answerId: string; outcome: 'skipped'; reason: 'panel_stale' }
  | {
      answerId: string
      outcome: 'graded'
      resultId: string
      model: string
      verdicts: number
      relationVerdicts: number
      formVerdicts: number
      unresolvedQuotes: number
      /** Live key points the grader returned no verdict for. */
      unjudged: number
      warnings: PanelVerdictWarning[]
    }

/**
 * Grades ONE panel answer in isolation and writes its `GraderPanelResult`.
 * See the module header for what "isolation" and "the shipped grader" mean
 * here. A panel whose klpVersion the card has superseded is skipped, never
 * graded against points it was not written for.
 */
export async function gradePanelAnswer(answerId: string, gen: BenchGrader): Promise<GradePanelAnswerResult> {
  const answer = await prisma.graderPanelAnswer.findUnique({
    where: { id: answerId },
    select: {
      id: true,
      text: true,
      panel: { select: { cardId: true, klpVersion: true } },
    },
  })
  if (!answer) throw new Error(`bench-grader: panel answer ${answerId} not found`)

  // The prompt takes a `Card`; the full row is loaded for the type, as the regrade does.
  const card = await prisma.card.findUnique({ where: { id: answer.panel.cardId } })
  if (!card) throw new Error(`bench-grader: card ${answer.panel.cardId} not found`)
  const klps = await prisma.cardKlp.findMany({
    where: { cardId: card.id, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, text: true, weight: true, kind: true, version: true },
  })
  if (klps.length === 0 || klps[0].version !== answer.panel.klpVersion) {
    return { answerId, outcome: 'skipped', reason: 'panel_stale' }
  }

  const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }))
  const context = await loadGradingContext(card.id, klps)
  const { promptRelations, promptFormReqs } = promptViewOf(klps, context)
  const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
    card,
    answer: answer.text,
    klps: promptKlps,
    relations: promptRelations.length > 0 ? promptRelations : undefined,
    formReqs: promptFormReqs.length > 0 ? promptFormReqs : undefined,
    referenceAnswer: context.referenceAnswer ?? undefined,
  })
  const maxOutputTokens = gradeMaxOutputTokens(promptKlps.length + promptRelations.length + promptFormReqs.length)

  const { value: grade, model } = await gen({ prompt, schema: ShortAnswerGradeWithAnalysisSchema, maxOutputTokens })

  const built = buildPanelVerdicts(grade, {
    answerText: answer.text,
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    relations: context.relations,
    formReqs: context.formReqs,
  })

  const result = await prisma.graderPanelResult.create({
    data: {
      answerId,
      graderVersion: GRADER_VERSION,
      model,
      promptVersion: GRADE_SHORT_ANSWER_PROMPT.version,
      verdicts: built.verdicts as unknown as Prisma.InputJsonValue,
      relationVerdicts: built.relationVerdicts as unknown as Prisma.InputJsonValue,
      formVerdicts: built.formVerdicts as unknown as Prisma.InputJsonValue,
      unresolvedQuotes: built.unresolvedQuotes,
      judgedOf: built.judgedOf,
      unjudged: built.unjudged as unknown as Prisma.InputJsonValue,
      // The expression axis, legacy rubric until Phase B — see the column's doc.
      expression: {
        clarity: grade.clarity.score,
        conciseness: grade.conciseness.score,
        correctness: grade.correctness.score,
        overall: grade.overall,
      } as Prisma.InputJsonValue,
    },
    select: { id: true },
  })

  return {
    answerId,
    outcome: 'graded',
    resultId: result.id,
    model,
    verdicts: built.verdicts.length,
    relationVerdicts: built.relationVerdicts.length,
    formVerdicts: built.formVerdicts.length,
    unresolvedQuotes: built.unresolvedQuotes,
    unjudged: built.unjudged.length,
    warnings: built.warnings,
  }
}

/**
 * The report's rows for one set: every panel of the kind (or both kinds),
 * each card scored over results sharing ONE model at `graderVersion`
 * (`selectCardResults`) — narrowed to `model` when given, so two graders
 * measured against the same panel can each be read alone. A card whose
 * results are split across models with none covering every answer comes
 * back `mixed` (named in the report, excluded from totals): scoring it would
 * fold the gap between graders into the gap between levels. Only panels at
 * the card's live klpVersion: a stale panel's results describe points the
 * card no longer teaches.
 */
export async function loadBenchmarkRows(
  setId: string,
  opts: { graderVersion: number; model?: string | null; kind?: GraderPanelKind },
): Promise<BenchmarkCardRow[]> {
  const panels = await prisma.graderPanel.findMany({
    where: { card: { setId }, ...(opts.kind ? { kind: opts.kind } : {}) },
    orderBy: [{ card: { position: 'asc' } }, { kind: 'asc' }],
    select: {
      id: true,
      cardId: true,
      kind: true,
      klpVersion: true,
      card: { select: { term: true, klps: { where: { supersededAt: null }, select: { version: true }, take: 1 } } },
      answers: {
        orderBy: { intendedRank: 'asc' },
        select: {
          id: true,
          level: true,
          mode: true,
          intendedRank: true,
          rationale: true,
          results: {
            where: { graderVersion: opts.graderVersion, ...(opts.model ? { model: opts.model } : {}) },
            orderBy: { createdAt: 'desc' },
            select: {
              model: true,
              graderVersion: true,
              createdAt: true,
              verdicts: true,
              relationVerdicts: true,
              formVerdicts: true,
              unresolvedQuotes: true,
              judgedOf: true,
              unjudged: true,
            },
          },
        },
      },
    },
  })
  return panels
    .filter((p) => p.card.klps[0]?.version === p.klpVersion)
    .map((p) => {
      const selection = selectCardResults(p.answers)
      const answers = p.answers.map((a) => {
        const r = selection.kind === 'complete' ? selection.byAnswer[a.id] : undefined
        return {
          id: a.id,
          level: a.level,
          mode: a.mode,
          intendedRank: a.intendedRank,
          rationale: a.rationale,
          result: r ? { model: r.model, graderVersion: r.graderVersion, ...readPanelResult(r) } : null,
        }
      })
      return {
        cardId: p.cardId,
        term: p.card.term,
        kind: p.kind as GraderPanelKind,
        klpVersion: p.klpVersion,
        answers,
        ...(selection.kind === 'mixed' ? { mixed: selection.models } : {}),
      }
    })
}
