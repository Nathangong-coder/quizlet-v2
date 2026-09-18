import type { ShortAnswerGrade } from '@/lib/ai/schemas'
import { resolveSpan } from '@/lib/analysis/spans'
import type { PanelSpan, PanelResultLists, GraderPanelKind } from '@/lib/analysis/benchmark'

/**
 * `npm run bench-grader`'s PURE half (Spec 5 §8, "Re-runnable"). Nothing
 * here touches Prisma or a model; `benchmark-run.ts` loads the inputs and
 * writes the outputs. Three decisions live here so they are testable on
 * hand-built rows:
 *
 *  - `planPanels` — which cards `--author` writes a panel for: one per
 *    (card, current klpVersion, kind), never a second.
 *  - `planBench` — which panel answers the run grades: idempotent per
 *    `(answerId, graderVersion, model)`, and never an answer on a panel whose
 *    klpVersion the card has since superseded (a re-authored card
 *    invalidates its panel; the stale one stays as history).
 *  - `buildPanelVerdicts` — the grader's reply to the persisted entry shapes,
 *    with the spans resolved in TypeScript. Same ref discipline as
 *    `buildAnalysisWrites`: an out-of-range ref is dropped with a warning,
 *    the first of two refs to one item wins, and nothing is ever invented.
 */

export interface PanelCandidate {
  cardId: string
  /** The card's live `CardKlp.version`, or null with no live key points. */
  liveKlpVersion: number | null
  /** `CardAuthoring.referenceAnswer` exists at that version — the adversary needs it. */
  hasReference: boolean
}

export interface ExistingPanel {
  cardId: string
  klpVersion: number
  kind: string
}

export type PanelSkipReason = 'has_panel' | 'no_live_klps' | 'no_reference'

export interface PanelPlan {
  toAuthor: string[]
  skipped: { cardId: string; reason: PanelSkipReason }[]
}

/**
 * Which cards get a panel written. A card is skipped when it already has a
 * panel at its CURRENT klpVersion and this kind (a panel at an older version
 * is history, not a panel), when it has no live key points (nothing to write
 * against), or when it has no reference answer at that version (the
 * adversary writes from the reference; a legacy-extracted card has none).
 * Order is the caller's card order.
 */
export function planPanels(
  cards: readonly PanelCandidate[],
  panels: readonly ExistingPanel[],
  opts: { kind: GraderPanelKind },
): PanelPlan {
  const have = new Set(panels.filter((p) => p.kind === opts.kind).map((p) => `${p.cardId}@${p.klpVersion}`))
  const toAuthor: string[] = []
  const skipped: PanelPlan['skipped'] = []
  for (const c of cards) {
    if (c.liveKlpVersion === null) skipped.push({ cardId: c.cardId, reason: 'no_live_klps' })
    else if (have.has(`${c.cardId}@${c.liveKlpVersion}`)) skipped.push({ cardId: c.cardId, reason: 'has_panel' })
    else if (!c.hasReference) skipped.push({ cardId: c.cardId, reason: 'no_reference' })
    else toAuthor.push(c.cardId)
  }
  return { toAuthor, skipped }
}

export interface BenchPanel {
  id: string
  cardId: string
  klpVersion: number
  /** The card's live `CardKlp.version` now; a mismatch means the panel is stale. */
  liveKlpVersion: number | null
  answers: readonly { id: string }[]
}

export interface BenchResultKey {
  answerId: string
  graderVersion: number
  model: string
}

export type BenchSkipReason = 'already_graded' | 'panel_stale'

export interface BenchPlan {
  toGrade: { answerId: string; panelId: string; cardId: string }[]
  skipped: { answerId: string; reason: BenchSkipReason }[]
}

/**
 * Which panel answers this run grades.
 *
 * `model` is the run's planning key. When it is known in advance (a `--model`
 * pin, or a direct pool with one model) an answer is skipped only when a
 * result exists at `(graderVersion, model)` — so a second grader can be
 * measured against the same fixed panel without re-grading the first. When
 * it is NOT knowable in advance (`null`: a rotating pool decides per call),
 * any result at `graderVersion` counts, because the alternative is a run
 * that re-grades every answer every time it is invoked.
 */
export function planBench(
  panels: readonly BenchPanel[],
  results: readonly BenchResultKey[],
  opts: { graderVersion: number; model: string | null },
): BenchPlan {
  const done = new Set<string>()
  for (const r of results) {
    if (r.graderVersion !== opts.graderVersion) continue
    if (opts.model !== null && r.model !== opts.model) continue
    done.add(r.answerId)
  }
  const toGrade: BenchPlan['toGrade'] = []
  const skipped: BenchPlan['skipped'] = []
  for (const p of panels) {
    const stale = p.liveKlpVersion === null || p.liveKlpVersion !== p.klpVersion
    for (const a of p.answers) {
      if (stale) skipped.push({ answerId: a.id, reason: 'panel_stale' })
      else if (done.has(a.id)) skipped.push({ answerId: a.id, reason: 'already_graded' })
      else toGrade.push({ answerId: a.id, panelId: p.id, cardId: p.cardId })
    }
  }
  return { toGrade, skipped }
}

export interface CardBatch {
  cardId: string
  answerIds: string[]
}

/**
 * The plan's answers grouped by card, first-seen card order, answers in
 * plan order. THE UNIT OF PINNING IS THE CARD (`src/lib/klp/direct-pool.ts`):
 * the script takes one combo per batch and grades every answer in it on
 * that combo, so rank agreement never subtracts two graders' scores.
 */
export function groupByCard(toGrade: readonly BenchPlan['toGrade'][number][]): CardBatch[] {
  const byCard = new Map<string, string[]>()
  for (const g of toGrade) {
    const list = byCard.get(g.cardId)
    if (list) list.push(g.answerId)
    else byCard.set(g.cardId, [g.answerId])
  }
  return [...byCard].map(([cardId, answerIds]) => ({ cardId, answerIds }))
}

export interface ResultKey {
  model: string
  createdAt: Date
}

export type CardResultSelection<R extends ResultKey = ResultKey> =
  | { kind: 'complete'; model: string; byAnswer: Record<string, R> }
  | { kind: 'mixed'; models: string[] }
  | { kind: 'incomplete'; ungraded: number }

/**
 * Which results a card is scored over — results sharing ONE model, or none.
 * The caller has narrowed `results` to one graderVersion already.
 *
 * `complete`: some model has a result for every answer; with two such
 * models, the one whose LAST result is most recent wins (the later run is
 * the one the operator meant). `mixed`: every answer has a result but no
 * single model covers the card — graded across two runs on two models, and
 * scoring it would fold the gap between graders into the gap between
 * levels; the report names it and the fix is `--model <id>`. `incomplete`:
 * an answer has no result at all.
 */
export function selectCardResults<R extends ResultKey>(
  answers: readonly { id: string; results: readonly R[] }[],
): CardResultSelection<R> {
  const ungraded = answers.filter((a) => a.results.length === 0).length
  if (ungraded > 0 || answers.length === 0) return { kind: 'incomplete', ungraded }

  const models = new Set<string>()
  for (const a of answers) for (const r of a.results) models.add(r.model)

  let best: { model: string; byAnswer: Record<string, R>; last: number } | null = null
  for (const model of models) {
    const byAnswer: Record<string, R> = {}
    let last = -Infinity
    let covers = true
    for (const a of answers) {
      const mine = a.results.filter((r) => r.model === model)
      if (mine.length === 0) {
        covers = false
        break
      }
      const latest = mine.reduce((x, y) => (y.createdAt > x.createdAt ? y : x))
      byAnswer[a.id] = latest
      last = Math.max(last, latest.createdAt.getTime())
    }
    if (covers && (!best || last > best.last)) best = { model, byAnswer, last }
  }
  if (best) return { kind: 'complete', model: best.model, byAnswer: best.byAnswer }
  return { kind: 'mixed', models: [...models].sort() }
}

/** What the grader's refs resolve against: the same arrays the prompt was built from, in order. */
export interface PanelVerdictContext {
  answerText: string
  klps: readonly { id: string; weight: number }[]
  relations: readonly { id: string }[]
  formReqs: readonly { id: string }[]
}

export type PanelVerdictWarning = {
  reason:
    | 'quote_unresolved'
    | 'unresolved_klp_ref'
    | 'duplicate_klp_ref'
    | 'unresolved_relation_ref'
    | 'duplicate_relation_ref'
    | 'unresolved_form_ref'
    | 'duplicate_form_ref'
    | 'klp_unjudged'
  value: string
}

export interface PanelVerdicts extends PanelResultLists {
  warnings: PanelVerdictWarning[]
}

/**
 * The grader's reply → the persisted entry shapes. The MODEL quotes;
 * TypeScript locates (`resolveSpan`): exact, then normalised, then null —
 * and a null with a quote present is counted in `unresolvedQuotes`, the
 * grader-quality number the report prints. An empty or blank quote is "no
 * quote", not a paraphrase. `passed` (the legacy alias) is written as
 * `correct`, the same rule every other writer applies.
 */
export function buildPanelVerdicts(grade: ShortAnswerGrade, ctx: PanelVerdictContext): PanelVerdicts {
  const warnings: PanelVerdictWarning[] = []
  let unresolvedQuotes = 0

  const quoteOf = (q: string | undefined): string | undefined => (q && q.trim() ? q : undefined)
  const locate = (quote: string | undefined, ref: string): PanelSpan => {
    if (quote === undefined) return { spanStart: null, spanEnd: null }
    const span = resolveSpan(ctx.answerText, quote)
    if (!span) {
      unresolvedQuotes++
      warnings.push({ reason: 'quote_unresolved', value: ref })
      return { spanStart: null, spanEnd: null }
    }
    return { spanStart: span.start, spanEnd: span.end }
  }
  const withQuote = <T extends object>(entry: T, quote: string | undefined): T & { quote?: string } =>
    quote === undefined ? entry : { ...entry, quote }

  const verdicts: PanelVerdicts['verdicts'] = []
  const seenKlp = new Set<string>()
  for (const r of grade.klpResults ?? []) {
    const klp = ctx.klps[r.klpRef]
    if (!klp) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(r.klpRef) })
      continue
    }
    if (seenKlp.has(klp.id)) {
      warnings.push({ reason: 'duplicate_klp_ref', value: String(r.klpRef) })
      continue
    }
    seenKlp.add(klp.id)
    const quote = quoteOf(r.quote ?? r.evidence)
    const status = (r.status as string) === 'passed' ? 'correct' : r.status
    verdicts.push({
      ...withQuote({ klpRef: r.klpRef, klpId: klp.id, status, weight: klp.weight }, quote),
      ...locate(quote, `klp:${r.klpRef}`),
    })
  }

  const relationVerdicts: PanelVerdicts['relationVerdicts'] = []
  const seenRel = new Set<string>()
  for (const r of grade.relationResults ?? []) {
    const rel = ctx.relations[r.relationRef]
    if (!rel) {
      warnings.push({ reason: 'unresolved_relation_ref', value: String(r.relationRef) })
      continue
    }
    if (seenRel.has(rel.id)) {
      warnings.push({ reason: 'duplicate_relation_ref', value: String(r.relationRef) })
      continue
    }
    seenRel.add(rel.id)
    const quote = quoteOf(r.quote)
    relationVerdicts.push({
      ...withQuote({ relationRef: r.relationRef, relationId: rel.id, status: r.status }, quote),
      ...locate(quote, `rel:${r.relationRef}`),
    })
  }

  const formVerdicts: PanelVerdicts['formVerdicts'] = []
  const seenForm = new Set<string>()
  for (const f of grade.formResults ?? []) {
    const req = ctx.formReqs[f.formRef]
    if (!req) {
      warnings.push({ reason: 'unresolved_form_ref', value: String(f.formRef) })
      continue
    }
    if (seenForm.has(req.id)) {
      warnings.push({ reason: 'duplicate_form_ref', value: String(f.formRef) })
      continue
    }
    seenForm.add(req.id)
    const quote = quoteOf(f.quote)
    formVerdicts.push({
      ...withQuote({ formRef: f.formRef, formRequirementId: req.id, status: f.status }, quote),
      ...locate(quote, `form:${f.formRef}`),
    })
  }

  // Every live point the grader said nothing about. Persisted with its
  // weight so `coverageScore` puts it in the denominator at 0 credit —
  // otherwise a grader that judged one of seven points scored 1.0.
  const unjudged: PanelVerdicts['unjudged'] = []
  for (const k of ctx.klps) {
    if (seenKlp.has(k.id)) continue
    unjudged.push({ klpId: k.id, weight: k.weight })
    warnings.push({ reason: 'klp_unjudged', value: k.id })
  }

  return { verdicts, relationVerdicts, formVerdicts, unresolvedQuotes, judgedOf: ctx.klps.length, unjudged, warnings }
}
