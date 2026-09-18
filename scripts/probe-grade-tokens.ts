import { generateText, Output } from 'ai'
import type { Card } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel, type ProviderId } from '../src/lib/ai/providers'
import { GRADE_SHORT_ANSWER_PROMPT, type PromptRelation, type PromptFormReq } from '../src/lib/ai/prompts/grade-short-answer'
import { ShortAnswerGradeSchema, ShortAnswerGradeWithAnalysisSchema } from '../src/lib/ai/schemas'
import { parseList } from '../src/lib/klp/direct-pool'

/**
 * `npm run probe-grade-tokens -- [--models deepseek-flash,gemini-3.1-flash-lite] [--limit 20]`
 *
 * Sets `GRADE_TOKENS_BASE` / `GRADE_TOKENS_PER_ITEM`
 * (`src/lib/analysis/output-cap.ts`) FROM MEASUREMENT rather than the
 * controller-ruled placeholder 2048/600 those constants ship with.
 *
 * READ-ONLY against the database — every query is a `findMany`/`findFirst`;
 * nothing is written, no `QuizAnswer` row is touched. `--direct`-style: raw
 * provider keys from env (never a stored, encrypted `AiCredential` — those
 * need `GOOGLE_KEY_ENCRYPTION_SECRET`, which a bare local `.env` does not
 * carry), so this is a tool for the owner's own shell, not CI.
 *
 * For up to `--limit` (default 20) stored short-answer `QuizAnswer` rows on
 * cards with 4-9 LIVE key points, this rebuilds the exact v5 grading prompt
 * (`GRADE_SHORT_ANSWER_PROMPT`) — key points, plus the card's relations and
 * form requirements where it has them — and calls each `--models` entry with
 * a deliberately generous `maxOutputTokens: 16384`. Generous ON PURPOSE: the
 * ceiling this probe measures TOWARD must not be the ceiling it measures
 * UNDER, or a truncated call would silently under-report the true cost of a
 * card's item count.
 *
 * Per call it prints `items` (KLPs + relations + form requirements —
 * `output-cap.ts`'s `itemCount`), `usage.outputTokens`, and `finishReason`
 * (a `'length'` here, even at 16384, means the sample card is pathological
 * and worth a look, not just a data point). Across every call it fits
 * `outputTokens ~ intercept + slope * items` by ordinary least squares, prints
 * the p95 of `outputTokens`, and recommends a pair sized so a card at the
 * MEAN item count in this sample gets a ceiling of ~2x that p95 — scaling the
 * fitted line's intercept and slope by the same factor, so the recommended
 * pair keeps the fit's shape (a card with more items still gets a
 * proportionally bigger allowance) rather than flattening it into a single
 * padded constant.
 */

interface ModelSpec {
  /** The exact model id, also the `--models` entry — no separate display name. */
  model: string
  provider: ProviderId
  apiKey: string
}

/**
 * Model id -> provider. Add an entry here before passing a new id via
 * `--models`; there is no listing call this could resolve automatically (see
 * CLAUDE.md: "Model ids must be verified by a real generation call, never a
 * listing call").
 */
const MODEL_PROVIDER: Record<string, ProviderId> = {
  'deepseek-flash': 'deepseek',
  'deepseek-v4-flash': 'deepseek',
  'gemini-3.6-flash': 'google',
  'gemini-3.5-flash': 'google',
  'gemini-3.1-flash-lite': 'google',
  'gemini-3.5-flash-lite': 'google',
  'glm-5.3-flash': 'zai',
}

function apiKeyFor(provider: ProviderId): string | undefined {
  switch (provider) {
    case 'google':
      return parseList(process.env.GOOGLE_API_KEYS)[0] ?? process.env.GOOGLE_API_KEY
    case 'deepseek':
      return process.env.DEEPSEEK_API_KEY
    case 'zai':
      return process.env.ZAI_API_KEY
    case 'anthropic':
      return process.env.ANTHROPIC_API_KEY
    case 'openrouter':
      return process.env.OPENROUTER_API_KEY
    default:
      return undefined
  }
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

function parseModels(args: string[]): ModelSpec[] {
  const raw = opt(args, '--models') ?? 'deepseek-flash'
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((model) => {
      const provider = MODEL_PROVIDER[model]
      if (!provider) {
        throw new Error(`Unknown model "${model}" — add it to MODEL_PROVIDER in this script.`)
      }
      const apiKey = apiKeyFor(provider)
      if (!apiKey) {
        throw new Error(`No API key in env for provider "${provider}" (model "${model}").`)
      }
      return { model, provider, apiKey }
    })
}

const PROBE_MAX_OUTPUT_TOKENS = 16384
const DEFAULT_LIMIT = 20
const MIN_KLPS = 4
const MAX_KLPS = 9

interface SampleRow {
  answerId: string
  cardId: string
  answer: string
  card: { term: string; definition: string }
  klps: { ref: number; text: string; kind: string }[]
  relations: PromptRelation[]
  formReqs: PromptFormReq[]
  /** KLPs + relations + form requirements — what `output-cap.ts` calls `itemCount`. */
  itemCount: number
}

/**
 * Loads up to `limit` stored short-answer rows on cards with 4-9 live KLPs,
 * with each card's live relations and form requirements resolved to prompt
 * refs. Over-fetches candidate answers because some may land on a card
 * outside the KLP-count window or with no card at all (a stale FK from a
 * deleted set) — those are skipped, not padded.
 */
async function loadSample(limit: number): Promise<SampleRow[]> {
  const klpCounts = await prisma.cardKlp.groupBy({
    by: ['cardId'],
    where: { supersededAt: null },
    _count: { _all: true },
  })
  const eligibleCardIds = klpCounts
    .filter((c) => c._count._all >= MIN_KLPS && c._count._all <= MAX_KLPS)
    .map((c) => c.cardId)
  if (eligibleCardIds.length === 0) {
    throw new Error(`No cards with ${MIN_KLPS}-${MAX_KLPS} live KLPs found — nothing to sample.`)
  }

  const candidates = await prisma.quizAnswer.findMany({
    where: { mode: 'short-answer', cardId: { in: eligibleCardIds }, answer: { not: null } },
    orderBy: { id: 'desc' },
    take: limit * 3,
    select: { id: true, cardId: true, answer: true },
  })

  const cardIds = [...new Set(candidates.map((a) => a.cardId))]
  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
    select: { id: true, term: true, definition: true },
  })
  const cardById = new Map(cards.map((c) => [c.id, c]))

  const klps = await prisma.cardKlp.findMany({
    where: { cardId: { in: cardIds }, supersededAt: null },
    orderBy: [{ cardId: 'asc' }, { index: 'asc' }],
    select: { id: true, cardId: true, text: true, kind: true },
  })
  const klpsByCard = new Map<string, typeof klps>()
  for (const k of klps) {
    if (!klpsByCard.has(k.cardId)) klpsByCard.set(k.cardId, [])
    klpsByCard.get(k.cardId)!.push(k)
  }

  const relations = await prisma.klpRelation.findMany({
    where: { from: { cardId: { in: cardIds } }, to: { cardId: { in: cardIds } } },
    select: {
      type: true,
      from: { select: { id: true, cardId: true } },
      to: { select: { id: true, cardId: true } },
    },
  })

  const formReqs = await prisma.cardFormRequirement.findMany({
    where: { cardId: { in: cardIds } },
    orderBy: [{ cardId: 'asc' }, { index: 'asc' }],
    select: { cardId: true, text: true },
  })
  const formReqsByCard = new Map<string, typeof formReqs>()
  for (const f of formReqs) {
    if (!formReqsByCard.has(f.cardId)) formReqsByCard.set(f.cardId, [])
    formReqsByCard.get(f.cardId)!.push(f)
  }

  const rows: SampleRow[] = []
  for (const a of candidates) {
    if (rows.length >= limit) break
    const card = cardById.get(a.cardId)
    const cardKlps = klpsByCard.get(a.cardId) ?? []
    if (!card || !a.answer || cardKlps.length < MIN_KLPS || cardKlps.length > MAX_KLPS) continue

    const klpRefById = new Map(cardKlps.map((k, ref) => [k.id, ref]))
    // Same-card relations only — cross-card edges (there should be none) would
    // have no valid fromRef/toRef in THIS prompt's numbering.
    const relRows: PromptRelation[] = relations
      .filter((r) => r.from.cardId === a.cardId && r.to.cardId === a.cardId)
      .map((r, ref) => {
        const fromRef = klpRefById.get(r.from.id)
        const toRef = klpRefById.get(r.to.id)
        return fromRef === undefined || toRef === undefined ? null : { ref, type: r.type, fromRef, toRef }
      })
      .filter((r): r is PromptRelation => r !== null)

    const cardFormReqs: PromptFormReq[] = (formReqsByCard.get(a.cardId) ?? []).map((f, ref) => ({ ref, text: f.text }))

    rows.push({
      answerId: a.id,
      cardId: a.cardId,
      answer: a.answer,
      card,
      klps: cardKlps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      relations: relRows,
      formReqs: cardFormReqs,
      itemCount: cardKlps.length + relRows.length + cardFormReqs.length,
    })
  }
  return rows
}

interface Point {
  x: number
  y: number
}

/** Ordinary least squares over (itemCount, outputTokens) pairs. */
function fitLine(points: Point[]): { slope: number; intercept: number } {
  const n = points.length
  const sumX = points.reduce((s, p) => s + p.x, 0)
  const sumY = points.reduce((s, p) => s + p.y, 0)
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0)
  const sumXX = points.reduce((s, p) => s + p.x * p.x, 0)
  const denom = n * sumXX - sumX * sumX
  if (denom === 0) return { slope: 0, intercept: n === 0 ? 0 : sumY / n }
  const slope = (n * sumXY - sumX * sumY) / denom
  const intercept = (sumY - slope * sumX) / n
  return { slope, intercept }
}

function p95(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(0.95 * sorted.length) - 1))
  return sorted[idx]
}

async function main() {
  const args = process.argv.slice(2)
  const limit = Number(opt(args, '--limit') ?? DEFAULT_LIMIT)
  const models = parseModels(args)

  console.log(`models: ${models.map((m) => m.model).join(', ')}`)
  const sample = await loadSample(limit)
  console.log(`sample: ${sample.length} short-answer rows on cards with ${MIN_KLPS}-${MAX_KLPS} live KLPs\n`)

  const results: { model: string; answerId: string; itemCount: number; outputTokens: number; finishReason: string }[] = []

  for (const spec of models) {
    console.log(`--- ${spec.model} ---`)
    const languageModel = resolveLanguageModel({
      provider: spec.provider,
      apiKey: spec.apiKey,
      model: spec.model,
      baseUrl: null,
      // Runtime grading always runs Z.ai at low effort — see task-defaults.ts.
      reasoningEffort: spec.provider === 'zai' ? 'low' : undefined,
    })

    for (const row of sample) {
      const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
        card: { term: row.card.term, definition: row.card.definition } as unknown as Card,
        answer: row.answer,
        klps: row.klps,
        relations: row.relations.length ? row.relations : undefined,
        formReqs: row.formReqs.length ? row.formReqs : undefined,
      })

      try {
        const res = await generateText({
          model: languageModel,
          prompt,
          output: Output.object({ schema: ShortAnswerGradeWithAnalysisSchema }),
          maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
          maxRetries: 0,
        })
        const outputTokens = res.usage?.outputTokens ?? 0
        results.push({ model: spec.model, answerId: row.answerId, itemCount: row.itemCount, outputTokens, finishReason: res.finishReason ?? 'unknown' })
        console.log(`  answer ${row.answerId}: items ${row.itemCount}, outputTokens ${outputTokens}, finishReason ${res.finishReason}`)
      } catch (err) {
        console.log(`  answer ${row.answerId}: FAILED — ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }

  console.log('')
  if (results.length === 0) {
    console.log('No successful calls — nothing to fit.')
    return
  }

  const points = results.map((r) => ({ x: r.itemCount, y: r.outputTokens }))
  const { slope, intercept } = fitLine(points)
  const observedP95 = p95(results.map((r) => r.outputTokens))
  const meanItemCount = points.reduce((s, p) => s + p.x, 0) / points.length
  const fittedAtMean = intercept + slope * meanItemCount
  const target = 2 * observedP95
  // Scale the fitted line up so it hits `target` at the mean item count,
  // keeping its shape (the intercept/slope ratio) rather than padding a flat
  // constant on top.
  const scale = fittedAtMean > 0 ? target / fittedAtMean : 1
  const recommendedBase = Math.round(intercept * scale)
  const recommendedPerItem = Math.round(slope * scale)

  console.log(`fitted: outputTokens ~= ${intercept.toFixed(0)} + ${slope.toFixed(1)} * items`)
  console.log(`p95(outputTokens) = ${observedP95}`)
  console.log(`mean item count = ${meanItemCount.toFixed(1)}`)
  console.log(`recommended GRADE_TOKENS_BASE ~= ${recommendedBase}`)
  console.log(`recommended GRADE_TOKENS_PER_ITEM ~= ${recommendedPerItem}`)
  console.log('')
  console.log('Paste the pair above into src/lib/analysis/output-cap.ts, and record this run')
  console.log('(sample size, models, fitted line, p95, recommended pair) in')
  console.log('docs/ai/model-performance.md under "Spec 5 — the grading ceiling".')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
