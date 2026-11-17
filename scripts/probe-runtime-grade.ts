import { generateText, Output } from 'ai'
import type { Card } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { resolveLanguageModel, type ProviderId } from '../src/lib/ai/providers'
import { GRADE_SHORT_ANSWER_PROMPT } from '../src/lib/ai/prompts/grade-short-answer'
import { GRADE_CANDIDATE_PROMPT } from '../src/lib/ai/prompts/grade-candidate'
import { ShortAnswerGradeSchema, ShortAnswerGradeWithAnalysisSchema, CandidateGradeSchema, type ShortAnswerGrade } from '../src/lib/ai/schemas'
import { loadGradingContext, promptViewOf } from '../src/lib/quiz/grading-context'
import { gradeMaxOutputTokens } from '../src/lib/analysis/output-cap'
import { resolveSpan } from '../src/lib/analysis/spans'
import { RUNTIME_VERDICTS } from '../src/lib/klp/verdicts'
import { GRADER_VERSION } from '../src/lib/analysis/version'
import { classifyProviderError } from '../src/lib/errors/classify'
import { parseList } from '../src/lib/klp/direct-pool'

/**
 * `npm run probe-runtime-grade -- --model deepseek-flash [--card <cardId>] [--invert-klp <ref> --invert "<old>=><new>"]`
 *
 * The live half of Spec 5 Phase A's testing plan (§13): does a real model,
 * given the v5 runtime grading prompt EXACTLY as the quiz builds it, return
 * the shape the writer requires — and does the ported prompt agree with the
 * authoring grader it was ported from?
 *
 * READ-ONLY against the database: every query is a read; no `QuizAnswer`,
 * `AnswerKlpResult` or `AiCallLog` row is written. `--direct`-style: a raw
 * provider key from env (`DEEPSEEK_API_KEY`, `GOOGLE_API_KEY`/`GOOGLE_API_KEYS`,
 * `ZAI_API_KEY`), never a stored `AiCredential` — those are encrypted with
 * `GOOGLE_KEY_ENCRYPTION_SECRET`, which a bare local `.env` does not carry.
 *
 * ONE authored LBO card (default: "Why do LBOs use leverage?", the first card
 * of the pilot set — override with `--card`), THREE fixed answers:
 *
 *   1. the card's own reference answer (`CardAuthoring.referenceAnswer`),
 *   2. a blank answer (`""`),
 *   3. a hand-inverted copy of the reference: ONE causal point reversed by a
 *      documented string edit (`DEFAULT_INVERSION` below — the exact `old`
 *      substring and its `new` replacement are printed, and the script
 *      refuses to run if `old` is no longer in the reference, i.e. the card
 *      was re-authored since this edit was written).
 *
 * Each is graded through `GRADE_SHORT_ANSWER_PROMPT` v5 with the REAL
 * `loadGradingContext` (relations, form requirements, reference) and the
 * REAL fluid ceiling (`gradeMaxOutputTokens`), then the assertions print as
 * PASS/FAIL lines:
 *
 *   - one verdict per key point, per relation and per form requirement
 *     (refs exactly 0..n-1, no duplicates);
 *   - every label in `RUNTIME_VERDICTS` (form results in met | not_met);
 *   - reference → every key point `correct`;
 *   - blank → every key point `omission`;
 *   - inverted → the reversed point `inversion` or `contradicted`;
 *   - every quote the grader returned resolves to a span via `resolveSpan`
 *     (a paraphrase where a verbatim quote was asked for is a FAIL — that
 *     rate is a grader-quality number);
 *   - `usage.outputTokens` against the ceiling, and `finishReason` not
 *     `length` (an `output_truncated` here means the placeholder constants in
 *     `output-cap.ts` are too low for this card — run `probe-grade-tokens`).
 *
 * Then the SAME three answers go through `GRADE_CANDIDATE_PROMPT` in strict
 * mode — the authoring grader, whose wording is the one the runtime prompt
 * was measured against — and the per-point agreement is printed: for each
 * key point, the runtime verdict beside the authoring verdict, and `k/n`
 * agree. That number is what says the port preserved the measured grader.
 *
 * Exit code 1 if any assertion FAILED. Run it on DeepSeek (the grader family
 * in production) and once on a Google key; record both under "Spec 5 — the
 * content pass, live" in `docs/ai/model-performance.md`.
 */

/** The LBO pilot set's first card: "Why do LBOs use leverage? How do they use leverage to increase returns?" */
const DEFAULT_CARD_ID = 'cmtj7pxht000105l4xxtnhlbk'

/**
 * The documented inversion for the default card. Key point [3] (causal):
 * "Each dollar of debt principal paid down converts creditor claims into
 * equity value, so the sponsor's ownership of the business grows over the
 * hold." The reference states it as the `old` sentence fragment below; the
 * `new` fragment reverses the direction — paydown ERODES equity and
 * ownership SHRINKS — while leaving every other sentence of the reference
 * untouched, so points [0], [1], [2] and [4] are still fully stated and only
 * [3] (and the `precedes`/`requires` relations that lean on it) should move.
 */
const DEFAULT_INVERSION = {
  klpRef: 3,
  old: 'each dollar of debt paid down converts into equity value, so the sponsor\'s ownership grows over the hold',
  new: 'each dollar of debt paid down erodes equity value, so the sponsor\'s ownership shrinks over the hold',
}

/**
 * Model id -> provider. Add an entry before passing a new id via `--model`;
 * there is no listing call this could resolve automatically (CLAUDE.md:
 * "Model ids must be verified by a real generation call, never a listing call").
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

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

const USAGE = `usage: npm run probe-runtime-grade -- --model <id> [--card <cardId>] [--invert-klp <ref> --invert "<old>=><new>"]

  --model <id>          required; one of: ${Object.keys(MODEL_PROVIDER).join(', ')}
                        (raw key from env: DEEPSEEK_API_KEY / GOOGLE_API_KEY(S) / ZAI_API_KEY)
  --card <cardId>       an authored card (default: the LBO pilot's first card, ${DEFAULT_CARD_ID})
  --invert-klp <ref>    with --invert: the key point the edit reverses (required with --card)
  --invert "<old>=><new>"
                        the string edit applied to the reference to build the inverted answer
  --help

Read-only against the database. Grades three fixed answers (reference, blank, inverted) through
the v5 runtime prompt with the real grading context and ceiling, prints PASS/FAIL assertions,
then grades the same three through GRADE_CANDIDATE_PROMPT (strict) and prints per-point agreement.

Record both runs (DeepSeek, and once on a Google key) in docs/ai/model-performance.md under
"Spec 5 — the content pass, live".`

interface Inversion {
  klpRef: number
  old: string
  new: string
}

function parseInversion(args: string[], cardId: string): Inversion {
  const refRaw = opt(args, '--invert-klp')
  const editRaw = opt(args, '--invert')
  if (refRaw === undefined && editRaw === undefined) {
    if (cardId !== DEFAULT_CARD_ID) {
      throw new Error('--card without --invert-klp/--invert: the documented inversion is written for the default card only.')
    }
    return DEFAULT_INVERSION
  }
  if (refRaw === undefined || editRaw === undefined) {
    throw new Error('--invert-klp and --invert must be given together.')
  }
  const klpRef = Number(refRaw)
  if (!Number.isInteger(klpRef) || klpRef < 0) throw new Error(`--invert-klp must be a non-negative integer, got "${refRaw}".`)
  const sep = editRaw.indexOf('=>')
  if (sep < 0) throw new Error('--invert must be "<old>=><new>".')
  const oldText = editRaw.slice(0, sep)
  const newText = editRaw.slice(sep + 2)
  if (!oldText || !newText) throw new Error('--invert: both sides of "=>" must be non-empty.')
  return { klpRef, old: oldText, new: newText }
}

type Verdicts = NonNullable<ShortAnswerGrade['klpResults']>

interface RuntimeRun {
  label: string
  answer: string
  grade: ShortAnswerGrade | null
  outputTokens: number
  finishReason: string
  error?: string
}

/** Every quote the grader returned on this grade, with where it came from. */
function quotesOf(grade: ShortAnswerGrade): { from: string; quote: string }[] {
  const out: { from: string; quote: string }[] = []
  for (const r of grade.klpResults ?? []) {
    const q = r.quote ?? r.evidence
    if (q) out.push({ from: `klp[${r.klpRef}]`, quote: q })
  }
  for (const r of grade.relationResults ?? []) if (r.quote) out.push({ from: `rel[${r.relationRef}]`, quote: r.quote })
  for (const r of grade.formResults ?? []) if (r.quote) out.push({ from: `form[${r.formRef}]`, quote: r.quote })
  for (const u of grade.unwarranted ?? []) if (u.quote) out.push({ from: 'unwarranted', quote: u.quote })
  for (const t of grade.errorTags ?? []) if (t.quote) out.push({ from: `tag:${t.type}`, quote: t.quote })
  return out
}

function refsExact(refs: number[], n: number): boolean {
  return refs.length === n && new Set(refs).size === n && refs.every((r) => r >= 0 && r < n)
}

async function main() {
  const args = process.argv.slice(2)
  if (flag(args, '--help') || flag(args, '-h')) {
    console.log(USAGE)
    return
  }

  const modelId = opt(args, '--model')
  if (!modelId) {
    console.error('[probe-runtime-grade] --model <id> is required.\n')
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const provider = MODEL_PROVIDER[modelId]
  if (!provider) throw new Error(`Unknown model "${modelId}" — add it to MODEL_PROVIDER in this script.`)
  const apiKey = apiKeyFor(provider)
  if (!apiKey) throw new Error(`No API key in env for provider "${provider}" (model "${modelId}").`)

  const cardId = opt(args, '--card') ?? DEFAULT_CARD_ID
  const inversion = parseInversion(args, cardId)

  const languageModel = resolveLanguageModel({
    provider,
    apiKey,
    model: modelId,
    baseUrl: null,
    // Runtime grading always runs Z.ai at low effort — see task-defaults.ts.
    reasoningEffort: provider === 'zai' ? 'low' : undefined,
  })

  let failed = 0
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }

  // ---- The card, exactly as the quiz would see it -------------------------
  const card = await prisma.card.findUnique({ where: { id: cardId } })
  if (!card) throw new Error(`Card ${cardId} not found.`)
  const klps = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, index: true, text: true, kind: true, version: true, weight: true, role: true },
  })
  if (klps.length === 0) throw new Error(`Card ${cardId} has no live key points — pick an authored card.`)
  const context = await loadGradingContext(cardId, klps)
  if (!context.referenceAnswer) throw new Error(`Card ${cardId} has no reference answer at its live klpVersion — pick an authored card.`)
  const reference = context.referenceAnswer
  const { promptRelations, promptFormReqs } = promptViewOf(klps, context)
  const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }))
  const itemCount = promptKlps.length + promptRelations.length + promptFormReqs.length
  const ceiling = gradeMaxOutputTokens(itemCount)

  if (inversion.klpRef >= klps.length) {
    throw new Error(`--invert-klp ${inversion.klpRef} is out of range: the card has ${klps.length} key points.`)
  }
  if (!reference.includes(inversion.old)) {
    throw new Error(
      `The inversion's "old" text is not in the reference — the card was re-authored since it was written. ` +
        `Rewrite DEFAULT_INVERSION (or pass --invert-klp/--invert).\n  old: ${JSON.stringify(inversion.old)}\n  reference: ${JSON.stringify(reference)}`,
    )
  }
  const inverted = reference.replace(inversion.old, inversion.new)

  console.log(`model: ${modelId} (${provider}) · graderVersion ${GRADER_VERSION} · prompt ${GRADE_SHORT_ANSWER_PROMPT.id} v${GRADE_SHORT_ANSWER_PROMPT.version}`)
  console.log(`card: ${cardId} — "${card.term}" (klpVersion ${klps[0].version})`)
  console.log(`key points (${klps.length}):`)
  for (const k of promptKlps) console.log(`  [${k.ref}] (${k.kind}) ${k.text}`)
  console.log(`relations (${promptRelations.length}):${promptRelations.length ? '' : ' none'}`)
  for (const r of promptRelations) console.log(`  [R${r.ref}] (${r.type}) [${r.fromRef}] → [${r.toRef}]`)
  console.log(`form requirements (${promptFormReqs.length}):${promptFormReqs.length ? '' : ' none — run `npm run author-form-reqs -- --set <setId>` to author them; the form assertions below are vacuous until then'}`)
  for (const f of promptFormReqs) console.log(`  [F${f.ref}] ${f.text}`)
  console.log(`items ${itemCount} → ceiling gradeMaxOutputTokens = ${ceiling}`)
  console.log(`\ninversion (key point [${inversion.klpRef}]):\n  old: ${JSON.stringify(inversion.old)}\n  new: ${JSON.stringify(inversion.new)}\n`)

  // ---- Runtime grader: three answers, one call each ------------------------
  const answers: { label: string; answer: string }[] = [
    { label: 'reference', answer: reference },
    { label: 'blank', answer: '' },
    { label: 'inverted', answer: inverted },
  ]
  const runs: RuntimeRun[] = []

  console.log('runtime grader (GRADE_SHORT_ANSWER_PROMPT v5, real context, real ceiling):')
  for (const { label, answer } of answers) {
    const prompt = GRADE_SHORT_ANSWER_PROMPT.build({
      card: card as Card,
      answer,
      klps: promptKlps,
      relations: promptRelations.length ? promptRelations : undefined,
      formReqs: promptFormReqs.length ? promptFormReqs : undefined,
      referenceAnswer: reference,
    })
    try {
      const res = await generateText({
        model: languageModel,
        prompt,
        output: Output.object({ schema: ShortAnswerGradeWithAnalysisSchema }),
        maxOutputTokens: ceiling,
        maxRetries: 0,
      })
      const outputTokens = res.usage?.outputTokens ?? 0
      const finishReason = res.finishReason ?? 'unknown'
      let grade: ShortAnswerGrade | null = null
      let error: string | undefined
      try {
        grade = res.output
      } catch (err) {
        error = `${classifyProviderError(err)}: ${err instanceof Error ? err.message : String(err)}`
        console.log(`  ${label}: OUTPUT THREW — ${error}`)
        console.log(`  raw text (first 400): ${JSON.stringify(res.text?.slice(0, 400))}`)
      }
      runs.push({ label, answer, grade, outputTokens, finishReason, error })
      console.log(`  ${label}: finishReason ${finishReason}, outputTokens ${outputTokens} / ${ceiling}`)
    } catch (err) {
      const kind = classifyProviderError(err)
      const message = err instanceof Error ? err.message : String(err)
      runs.push({ label, answer, grade: null, outputTokens: 0, finishReason: 'error', error: `${kind}: ${message}` })
      console.log(`  ${label}: CALL FAILED — ${kind}: ${message}`)
    }
  }

  console.log('\nassertions:')
  const n = promptKlps.length
  const m = promptRelations.length
  const f = promptFormReqs.length
  const runtimeVerdictSet = new Set<string>(RUNTIME_VERDICTS)

  for (const run of runs) {
    console.log(`\n  [${run.label}]`)
    if (!run.grade) {
      check(`${run.label}: the call returned a parseable grade`, false, run.error)
      continue
    }
    const g = run.grade
    const klpResults: Verdicts = g.klpResults ?? []
    const relResults = g.relationResults ?? []
    const formResults = g.formResults ?? []

    check(`one verdict per key point (refs exactly 0..${n - 1})`,
      refsExact(klpResults.map((r) => r.klpRef), n),
      `got ${klpResults.length}: ${JSON.stringify(klpResults.map((r) => r.klpRef))}`)
    if (m > 0) {
      check(`one verdict per relation (refs exactly 0..${m - 1})`,
        refsExact(relResults.map((r) => r.relationRef), m),
        `got ${relResults.length}: ${JSON.stringify(relResults.map((r) => r.relationRef))}`)
    }
    if (f > 0) {
      check(`one result per form requirement (refs exactly 0..${f - 1})`,
        refsExact(formResults.map((r) => r.formRef), f),
        `got ${formResults.length}: ${JSON.stringify(formResults.map((r) => r.formRef))}`)
    }
    const labels = [...klpResults.map((r) => r.status), ...relResults.map((r) => r.status)]
    check('every key-point and relation label is in RUNTIME_VERDICTS',
      labels.every((s) => runtimeVerdictSet.has(s)),
      labels.filter((s) => !runtimeVerdictSet.has(s)).join(', ') || undefined)
    if (f > 0) {
      check('every form result is met | not_met',
        formResults.every((r) => r.status === 'met' || r.status === 'not_met'))
    }

    const byRef = new Map(klpResults.map((r) => [r.klpRef, r.status]))
    const verdictLine = promptKlps.map((k) => `[${k.ref}] ${byRef.get(k.ref) ?? '—'}`).join('  ')
    console.log(`        verdicts: ${verdictLine}`)
    if (m > 0) {
      const relLine = relResults.map((r) => `[R${r.relationRef}] ${r.status}`).join('  ')
      console.log(`        relations: ${relLine}`)
    }
    if (f > 0) {
      const formLine = formResults.map((r) => `[F${r.formRef}] ${r.status}`).join('  ')
      console.log(`        form: ${formLine}`)
    }
    if ((g.unwarranted ?? []).length) {
      console.log(`        unwarranted: ${(g.unwarranted ?? []).map((u) => `(${u.magnitude}) ${u.text}`).join(' | ')}`)
    }
    if ((g.errorTags ?? []).length) {
      console.log(`        tags: ${(g.errorTags ?? []).map((t) => `${t.dimension}/${t.type}${t.klpRef !== undefined ? `@${t.klpRef}` : ''}(${t.magnitude})`).join(' ')}`)
    }
    console.log(`        rubric: overall ${g.overall}, correctness ${g.correctness.score}, clarity ${g.clarity.score}, conciseness ${g.conciseness.score}`)

    if (run.label === 'reference') {
      check('reference: every key point is `correct`',
        n > 0 && promptKlps.every((k) => byRef.get(k.ref) === 'correct'),
        promptKlps.filter((k) => byRef.get(k.ref) !== 'correct').map((k) => `[${k.ref}] ${byRef.get(k.ref) ?? '—'}`).join(', ') || undefined)
      if (m > 0) {
        // Reported, not asserted: a relation the reference states only implicitly may honestly read `omission`.
        const relCorrect = relResults.filter((r) => r.status === 'correct').length
        console.log(`        (report) reference relations correct: ${relCorrect}/${m}`)
      }
    }
    if (run.label === 'blank') {
      check('blank: every key point is `omission`',
        n > 0 && promptKlps.every((k) => byRef.get(k.ref) === 'omission'),
        promptKlps.filter((k) => byRef.get(k.ref) !== 'omission').map((k) => `[${k.ref}] ${byRef.get(k.ref) ?? '—'}`).join(', ') || undefined)
    }
    if (run.label === 'inverted') {
      const got = byRef.get(inversion.klpRef)
      check(`inverted: key point [${inversion.klpRef}] is \`inversion\` or \`contradicted\``,
        got === 'inversion' || got === 'contradicted',
        `got ${got ?? '—'}`)
      const others = promptKlps.filter((k) => k.ref !== inversion.klpRef)
      const othersCorrect = others.filter((k) => byRef.get(k.ref) === 'correct').length
      console.log(`        (report) inverted: the other ${others.length} points read correct on ${othersCorrect} — the edit touched one sentence`)
    }

    // Quotes → spans, in TypeScript. On the blank answer there is nothing to
    // quote, so any non-empty quote is by construction unresolvable.
    const quotes = quotesOf(g)
    const unresolved = quotes.filter((q) => resolveSpan(run.answer, q.quote) === null)
    check(`every quote resolves via resolveSpan (${quotes.length - unresolved.length}/${quotes.length})`,
      unresolved.length === 0,
      unresolved.map((q) => `${q.from}: ${JSON.stringify(q.quote.slice(0, 60))}`).join('; ') || undefined)

    check(`output tokens under the ceiling (${run.outputTokens} / ${ceiling}, finishReason ${run.finishReason})`,
      run.finishReason !== 'length' && run.outputTokens < ceiling)
  }

  // ---- The authoring grader, strict: the wording the port was measured against ----
  console.log('\nauthoring grader (GRADE_CANDIDATE_PROMPT strict — the measured wording), per-point agreement:')
  let agreeTotal = 0
  let comparedTotal = 0
  for (const run of runs) {
    const prompt = GRADE_CANDIDATE_PROMPT.build({
      question: card.term,
      referenceAnswer: reference,
      klps: klps.map((k) => ({ text: k.text, kind: k.kind })),
      candidateAnswer: run.answer,
      strict: true,
    })
    let candidate: { klpIndex: number; verdict: string }[] | null = null
    let usage = ''
    try {
      // No ceiling: the authoring grader runs at the SDK default, as
      // `generators.ts` calls it — this is the instrument as measured.
      const res = await generateText({
        model: languageModel,
        prompt,
        output: Output.object({ schema: CandidateGradeSchema }),
        maxRetries: 0,
      })
      usage = `outputTokens ${res.usage?.outputTokens ?? 0}, finishReason ${res.finishReason}`
      candidate = res.output.verdicts
    } catch (err) {
      console.log(`  ${run.label}: CALL FAILED — ${classifyProviderError(err)}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    console.log(`\n  [${run.label}] ${usage}`)
    const authoring = new Map(candidate.map((v) => [v.klpIndex, v.verdict]))
    const runtime = new Map((run.grade?.klpResults ?? []).map((r) => [r.klpRef, r.status]))
    let agree = 0
    let compared = 0
    for (const k of promptKlps) {
      const a = authoring.get(k.ref)
      const r = runtime.get(k.ref)
      const same = a !== undefined && r !== undefined && a === r
      if (a !== undefined && r !== undefined) compared++
      if (same) agree++
      console.log(`    [${k.ref}] runtime ${r ?? '—'}  ·  authoring ${a ?? '—'}  ${same ? '=' : '≠'}`)
    }
    agreeTotal += agree
    comparedTotal += compared
    console.log(`    agreement ${agree}/${compared}${compared < n ? ` (${n - compared} point(s) missing on one side)` : ''}`)
  }
  console.log(`\n  pooled per-point agreement: ${agreeTotal}/${comparedTotal}${comparedTotal ? ` (${((100 * agreeTotal) / comparedTotal).toFixed(0)}%)` : ''}`)
  console.log('  (the authoring grader may also answer `fabrication` / `unsupported_leap`, which the runtime vocabulary routes to unwarranted[] — a disagreement on those two is the vocabulary split, not the port)')

  console.log('')
  if (failed > 0) {
    console.error(`${failed} assertion(s) FAILED.`)
    process.exit(1)
  }
  console.log('All runtime-grader assertions passed against a real model.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
