import { generateText, Output } from 'ai'
import type { z } from 'zod'
import type { Card } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { DIRECT_PROVIDER_SOURCES, buildDirectPool, comboResolveInput, parseList, type DirectCombo } from '../src/lib/klp/direct-pool'
import { GRADE_CANDIDATE_PROMPT } from '../src/lib/ai/prompts/grade-candidate'
import { SUMMARIZE_KLTS_PROMPT } from '../src/lib/ai/prompts/summarize-klts'
import { MULTIPLE_CHOICE_PROMPT } from '../src/lib/ai/prompts/multiple-choice'
import { CandidateGradeSchema, KltSummarySchema, MultipleChoiceKlpSchema } from '../src/lib/ai/schemas'
import { computeSeparation, type CandidateGrade } from '../src/lib/klp/separation'
import { KLP_VERDICTS, type KlpVerdict } from '../src/lib/klp/verdicts'
import { PROBE_KINDS, type ProbeKind } from '../src/lib/klp/authoring-config'
import { TokenMeter, type UsageSample } from '../src/lib/klp/token-meter'
import { temperatureForTask } from '../src/lib/ai/temperature'

/**
 * Head-to-head model benchmark on the three workloads the owner wants to
 * hand to a Z.ai key: GRADING a written answer, the background CONCEPT-TREE
 * pass, and writing MULTIPLE-CHOICE distractors. Same prompts the app runs,
 * same schemas, same cards, same temperature — the only variable is the model.
 *
 *   npm run bench-models -- [--cards 8] [--set <id>]
 *       [--models zai:glm-5.3-flash@low,zai:glm-5.3-flash,deepseek:deepseek-flash,google:gemini-3.1-flash-lite]
 *       [--tasks grade,tree,mc] [--judge deepseek:deepseek-flash]
 *
 * Keys come from the environment via DIRECT_PROVIDER_SOURCES (ZAI_API_KEY,
 * DEEPSEEK_API_KEY, GOOGLE_API_KEY...). Nothing is written to the database
 * and nothing is logged to AiCallLog — this is an operator probe, like
 * `author-klps --direct`.
 *
 * THE SCORES ARE SUBSTANTIVE, NOT STRUCTURAL (the rule from
 * docs/ai/model-performance.md): well-formed JSON that makes the wrong call
 * counts as wrong.
 *
 *  - grade: each model grades the stored REFERENCE answer and the stored
 *    adversarial PROBES (vague, memorized_template) of authored cards against
 *    the card's live key points, strict mode with kinds. Score = the app's own
 *    separation (reference credit − best wrong credit) plus agreement with the
 *    production grader's stored verdict on the reference.
 *  - tree: each model runs the summarize-klts prompt over a card's points with
 *    the set's existing topic names as candidates. Score = schema held, labels
 *    within the 3-6 word rule, and how often it REUSED an existing topic that
 *    the production pass had linked to that point (Jaccard over names).
 *  - mc: each model writes three distractors per card from its key points.
 *    Score = schema held, refs valid, no option repeats the answer, and — the
 *    substantive part — a fixed JUDGE grades each distractor as if it were a
 *    learner's answer on its targeted point: a distractor the judge marks
 *    "correct" is not wrong at all. Judge defaults to deepseek-flash (the
 *    production grader); pass --judge to change it.
 */

interface Args { cards: number; set?: string; models: string[]; tasks: Set<string>; judge: string }

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
  return {
    cards: Number(get('--cards') ?? 8),
    set: get('--set'),
    models: parseList(get('--models') ?? process.env.BENCH_MODELS ?? 'zai:glm-5.3-flash@low,zai:glm-5.3-flash,deepseek:deepseek-flash,google:gemini-3.1-flash-lite'),
    tasks: new Set(parseList(get('--tasks') ?? 'grade,tree,mc')),
    judge: get('--judge') ?? process.env.BENCH_JUDGE ?? 'deepseek:deepseek-flash',
  }
}

/**
 * `source:model[@effort]` → one combo built the way author-klps builds its
 * pool. `@low` / `@high` / `@max` sets the OpenAI-style `reasoning_effort`
 * for the call (Z.ai's GLM cannot switch thinking off, only down — measured
 * 5k reasoning tokens and 60 s per grade at the default, 2026-09-15), so the
 * same model can be benchmarked at two efforts side by side.
 */
function comboFor(spec: string, env = process.env): DirectCombo {
  const [source, ...rest] = spec.split(':')
  const [modelSpec, effort] = rest.join(':').split('@')
  const src = DIRECT_PROVIDER_SOURCES[source]
  if (!src) throw new Error(`unknown source "${source}" — use one of ${Object.keys(DIRECT_PROVIDER_SOURCES).join(', ')}`)
  const keys = [...new Set(src.keyVars.flatMap((v) => parseList(env[v])))]
  if (keys.length === 0) throw new Error(`${spec}: needs ${src.keyVars.join(' or ')} in the environment`)
  const defaults = { ...(src.requestDefaults?.(env) ?? {}), ...(effort ? { reasoning_effort: effort } : {}) }
  const [combo] = buildDirectPool([keys[0]], [modelSpec || src.defaultModel], src.resolveAs ?? source, src.baseUrl, Object.keys(defaults).length ? defaults : undefined, src.schemaInPrompt)
  return { ...combo, id: spec }
}

interface CallResult<T> { value: T | null; error?: string; ms: number; usage?: UsageSample }

async function call<T>(combo: DirectCombo, prompt: string, schema: z.ZodSchema<T>, temperature: number, meter: TokenMeter, step: string): Promise<CallResult<T>> {
  const model = resolveLanguageModel(comboResolveInput(combo))
  const t0 = Date.now()
  try {
    const res = await generateText({ model, prompt, output: Output.object({ schema }), temperature, maxRetries: 0 })
    const usage: UsageSample = {
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
      reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens,
      cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens,
    }
    meter.add(step, combo.id.replace(/^[^:]+:/, ''), usage)
    return { value: res.output as T, ms: Date.now() - t0, usage }
  } catch (err) {
    meter.add(step, combo.id.replace(/^[^:]+:/, ''), undefined)
    return { value: null, error: err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err), ms: Date.now() - t0 }
  }
}

// ------------------------------------------------------------------ data

interface BenchCard {
  id: string
  term: string
  definition: string
  setTitle: string
  klps: { id: string; text: string; kind: string; role: string | null; weight: number }[]
  referenceAnswer: string
  referenceVerdicts: KlpVerdict[] | null
  probes: { kind: ProbeKind; text: string }[]
  /** Existing topic names linked to this card's points, by KLP index. */
  topics: string[][]
  candidates: string[]
  siblings: Card[]
  card: Card
}

async function loadCards(n: number, setId?: string): Promise<BenchCard[]> {
  const authored = await prisma.cardAuthoring.findMany({
    where: { status: { not: 'failed' }, ...(setId ? { card: { setId } } : {}), probes: { some: { kind: { in: [...PROBE_KINDS] } } } },
    orderBy: { createdAt: 'desc' },
    take: n * 3,
    select: {
      id: true, cardId: true, klpVersion: true, referenceAnswer: true, referenceVerdicts: true,
      probes: { where: { kind: { in: [...PROBE_KINDS] } }, select: { kind: true, text: true } },
      card: { include: { set: { select: { title: true } } } },
    },
  })
  // One card per cardId, newest authoring first.
  const seen = new Set<string>()
  const picked = authored.filter((a) => (seen.has(a.cardId) ? false : (seen.add(a.cardId), true))).slice(0, n)
  const out: BenchCard[] = []
  for (const a of picked) {
    const klps = await prisma.cardKlp.findMany({
      where: { cardId: a.cardId, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, text: true, kind: true, role: true, weight: true, topics: { select: { klt: { select: { name: true } } } } },
    })
    if (klps.length === 0) continue
    const siblings = await prisma.card.findMany({ where: { setId: a.card.setId, id: { not: a.cardId } }, take: 12 })
    const setTopics = await prisma.klt.findMany({ where: { nodes: { some: { setId: a.card.setId } } }, select: { name: true }, take: 60 })
    const rv = a.referenceVerdicts as unknown
    out.push({
      id: a.cardId,
      term: a.card.term,
      definition: a.card.definition,
      setTitle: a.card.set.title,
      klps: klps.map((k) => ({ id: k.id, text: k.text, kind: k.kind, role: k.role, weight: k.weight })),
      referenceAnswer: a.referenceAnswer,
      referenceVerdicts: Array.isArray(rv) && rv.every((v) => typeof v === 'string' && (KLP_VERDICTS as readonly string[]).includes(v)) ? (rv as KlpVerdict[]) : null,
      probes: a.probes.map((p) => ({ kind: p.kind as ProbeKind, text: p.text })),
      topics: klps.map((k) => k.topics.map((t) => t.klt.name)),
      candidates: setTopics.map((t) => t.name),
      siblings,
      card: a.card,
    })
  }
  return out
}

// ------------------------------------------------------------------ tasks

/** Verdicts in KLP order, missing ones read as `failed` (the app's own rule). */
function verdictsInOrder(grade: z.infer<typeof CandidateGradeSchema> | null, n: number): KlpVerdict[] {
  const out: KlpVerdict[] = Array.from({ length: n }, () => 'failed')
  for (const v of grade?.verdicts ?? []) if (v.klpIndex >= 0 && v.klpIndex < n) out[v.klpIndex] = v.verdict
  return out
}

interface GradeRow { model: string; cards: number; schemaFails: number; separation: number[]; refAgreement: number[]; ms: number[] }

async function benchGrade(cards: BenchCard[], combos: DirectCombo[], meter: TokenMeter): Promise<GradeRow[]> {
  const rows: GradeRow[] = []
  const temperature = temperatureForTask('grade')
  for (const combo of combos) {
    const row: GradeRow = { model: combo.id, cards: 0, schemaFails: 0, separation: [], refAgreement: [], ms: [] }
    for (const c of cards) {
      const klps = c.klps.map((k) => ({ text: k.text, kind: k.kind }))
      const gradeOne = (answer: string) => call(combo, GRADE_CANDIDATE_PROMPT.build({ question: c.term, referenceAnswer: c.referenceAnswer, klps, candidateAnswer: answer, strict: true }), CandidateGradeSchema, temperature, meter, 'grade')
      const ref = await gradeOne(c.referenceAnswer)
      const wrong: CandidateGrade[] = []
      let failed = ref.value === null
      row.ms.push(ref.ms)
      for (const p of c.probes) {
        const g = await gradeOne(p.text)
        row.ms.push(g.ms)
        if (g.value === null) failed = true
        wrong.push({ kind: p.kind, verdicts: verdictsInOrder(g.value, c.klps.length) })
      }
      row.cards += 1
      if (failed) { row.schemaFails += 1; process.stdout.write(`    ${combo.id} ${c.term.slice(0, 40)}: ${ref.error ?? 'a probe failed'}\n`); continue }
      const refVerdicts = verdictsInOrder(ref.value, c.klps.length)
      const sep = computeSeparation({ kind: 'reference', verdicts: refVerdicts }, wrong)
      row.separation.push(sep.separation)
      if (c.referenceVerdicts && c.referenceVerdicts.length === refVerdicts.length) {
        const agree = refVerdicts.filter((v, i) => (v === 'correct') === (c.referenceVerdicts![i] === 'correct')).length / refVerdicts.length
        row.refAgreement.push(agree)
      }
    }
    rows.push(row)
  }
  return rows
}

interface TreeRow { model: string; cards: number; schemaFails: number; labelOk: number[]; reuse: number[]; concepts: number[]; ms: number[] }

function words(s: string): number { return s.trim().split(/\s+/).filter(Boolean).length }
function norm(s: string): string { return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim() }

async function benchTree(cards: BenchCard[], combos: DirectCombo[], meter: TokenMeter): Promise<TreeRow[]> {
  const rows: TreeRow[] = []
  const temperature = temperatureForTask('concept-tree')
  for (const combo of combos) {
    const row: TreeRow = { model: combo.id, cards: 0, schemaFails: 0, labelOk: [], reuse: [], concepts: [], ms: [] }
    for (const c of cards) {
      const prompt = SUMMARIZE_KLTS_PROMPT.build({ setTitle: c.setTitle, klps: c.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })), candidates: c.candidates })
      const r = await call(combo, prompt, KltSummarySchema, temperature, meter, 'tree')
      row.cards += 1
      row.ms.push(r.ms)
      if (!r.value) { row.schemaFails += 1; process.stdout.write(`    ${combo.id} ${c.term.slice(0, 40)}: ${r.error}\n`); continue }
      const byRef = new Map(r.value.klps.map((k) => [k.ref, k]))
      let ok = 0, reuseHits = 0, reuseTotal = 0, concepts = 0
      c.klps.forEach((_, i) => {
        const k = byRef.get(i)
        if (!k) return
        const w = words(k.label)
        if (w >= 3 && w <= 6) ok += 1
        concepts += k.concepts.length
        const existing = new Set(c.topics[i].map(norm))
        if (existing.size > 0) {
          reuseTotal += 1
          const mine = new Set(k.concepts.map(norm))
          const inter = [...mine].filter((x) => existing.has(x)).length
          const union = new Set([...mine, ...existing]).size
          reuseHits += union === 0 ? 0 : inter / union
        }
      })
      row.labelOk.push(ok / c.klps.length)
      if (reuseTotal > 0) row.reuse.push(reuseHits / reuseTotal)
      row.concepts.push(concepts / c.klps.length)
    }
    rows.push(row)
  }
  return rows
}

interface McRow { model: string; cards: number; schemaFails: number; structural: number[]; wrongness: number[]; ms: number[] }

async function benchMc(cards: BenchCard[], combos: DirectCombo[], judge: DirectCombo, meter: TokenMeter): Promise<McRow[]> {
  const rows: McRow[] = []
  const temperature = temperatureForTask('distractors')
  for (const combo of combos) {
    const row: McRow = { model: combo.id, cards: 0, schemaFails: 0, structural: [], wrongness: [], ms: [] }
    for (const c of cards) {
      const prompt = MULTIPLE_CHOICE_PROMPT.build({ card: c.card, siblingCards: c.siblings, klps: c.klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })) })
      const r = await call(combo, prompt, MultipleChoiceKlpSchema, temperature, meter, 'mc')
      row.cards += 1
      row.ms.push(r.ms)
      if (!r.value) { row.schemaFails += 1; process.stdout.write(`    ${combo.id} ${c.term.slice(0, 40)}: ${r.error}\n`); continue }
      const texts = new Set<string>()
      let structural = 0
      for (const d of r.value.distractors) {
        const t = norm(d.text)
        const okRef = d.klpRef >= 0 && d.klpRef < c.klps.length
        const distinct = t !== norm(r.value.correctAnswer) && !texts.has(t)
        texts.add(t)
        if (okRef && distinct) structural += 1
      }
      row.structural.push(structural / 3)
      // The judge grades each distractor as an answer against ONLY its targeted point.
      let wrong = 0, judged = 0
      for (const d of r.value.distractors) {
        if (d.klpRef < 0 || d.klpRef >= c.klps.length) continue
        const k = c.klps[d.klpRef]
        const g = await call(judge, GRADE_CANDIDATE_PROMPT.build({ question: c.term, referenceAnswer: c.referenceAnswer, klps: [{ text: k.text, kind: k.kind }], candidateAnswer: d.text, strict: true }), CandidateGradeSchema, 0, meter, 'mc-judge')
        if (!g.value) continue
        judged += 1
        if (verdictsInOrder(g.value, 1)[0] !== 'correct') wrong += 1
      }
      if (judged > 0) row.wrongness.push(wrong / judged)
    }
    rows.push(row)
  }
  return rows
}

// ------------------------------------------------------------------ report

const mean = (xs: number[]) => (xs.length === 0 ? NaN : xs.reduce((a, b) => a + b, 0) / xs.length)
const pct = (x: number) => (Number.isNaN(x) ? '  n/a' : `${Math.round(x * 100).toString().padStart(4)}%`)
const f2 = (x: number) => (Number.isNaN(x) ? '  n/a' : x.toFixed(2).padStart(5))
const secs = (ms: number[]) => (ms.length === 0 ? '  n/a' : `${(mean(ms) / 1000).toFixed(1).padStart(5)}s`)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const combos = args.models.map((m) => comboFor(m))
  const judge = comboFor(args.judge)
  console.log(`[bench] models: ${combos.map((c) => c.id).join(', ')} · judge: ${judge.id} · tasks: ${[...args.tasks].join(',')}`)
  const cards = await loadCards(args.cards, args.set)
  if (cards.length === 0) {
    console.error('[bench] no authored cards with probes found — run npm run author-klps on a set first')
    process.exit(1)
  }
  console.log(`[bench] ${cards.length} authored cards: ${cards.map((c) => c.term.slice(0, 32)).join(' | ')}`)
  const meter = new TokenMeter()

  if (args.tasks.has('grade')) {
    console.log('\n== GRADING — separation (reference credit − best wrong credit; the app passes at ≥ 0.4) and agreement with the stored grader')
    const rows = await benchGrade(cards, combos, meter)
    console.log(`  ${'model'.padEnd(34)} cards  schema-fail  separation  ref-agree   latency`)
    for (const r of rows) console.log(`  ${r.model.padEnd(34)} ${String(r.cards).padStart(5)}  ${String(r.schemaFails).padStart(11)}  ${f2(mean(r.separation)).padStart(10)}  ${pct(mean(r.refAgreement)).padStart(9)}   ${secs(r.ms)}`)
  }
  if (args.tasks.has('tree')) {
    console.log('\n== CONCEPT TREE — schema held, labels within 3-6 words, reuse of the topics production linked (Jaccard), concepts per point')
    const rows = await benchTree(cards, combos, meter)
    console.log(`  ${'model'.padEnd(34)} cards  schema-fail  label-ok   reuse  concepts   latency`)
    for (const r of rows) console.log(`  ${r.model.padEnd(34)} ${String(r.cards).padStart(5)}  ${String(r.schemaFails).padStart(11)}  ${pct(mean(r.labelOk)).padStart(8)}  ${pct(mean(r.reuse)).padStart(6)}  ${f2(mean(r.concepts)).padStart(8)}   ${secs(r.ms)}`)
  }
  if (args.tasks.has('mc')) {
    console.log(`\n== MULTIPLE CHOICE — schema held, structurally valid distractors, and share the judge (${judge.id}) agrees are actually WRONG on their point`)
    const rows = await benchMc(cards, combos, judge, meter)
    console.log(`  ${'model'.padEnd(34)} cards  schema-fail  structural  wrongness   latency`)
    for (const r of rows) console.log(`  ${r.model.padEnd(34)} ${String(r.cards).padStart(5)}  ${String(r.schemaFails).padStart(11)}  ${pct(mean(r.structural)).padStart(10)}  ${pct(mean(r.wrongness)).padStart(9)}   ${secs(r.ms)}`)
  }

  console.log('\n== TOKENS AND COST (list prices; DeepSeek off-peak factor applied by the clock; Google unpriced)')
  console.log(meter.format(0).split('\n').map((l) => '  ' + l).join('\n'))
}

main()
  .catch((err) => { console.error(err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
