import { prisma } from '../src/lib/db'
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import type { z } from 'zod'
import { generateJsonWithMeta } from '../src/lib/ai/generate'
import type { AiTask } from '../src/lib/ai/model-routing'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { temperatureForTask } from '../src/lib/ai/temperature'
import {
  readDirectPool,
  nextCombo,
  markTried,
  markExhausted,
  poolStatus,
  comboResolveInput,
  type DirectCombo,
} from '../src/lib/klp/direct-pool'
import {
  Pacer,
  RunHaltedError,
  callWithPacingAndRetry,
  realClock,
  rpmToIntervalMs,
  DEFAULT_RPM,
} from '../src/lib/klp/authoring-pacing'
import { TokenMeter } from '../src/lib/klp/token-meter'
import { GRADER_VERSION } from '../src/lib/analysis/version'
import { GRADER_PANEL_KINDS, type GraderPanelKind } from '../src/lib/analysis/benchmark'
import { planBench, planPanels } from '../src/lib/analysis/benchmark-plan'
import {
  authorPanel,
  gradePanelAnswer,
  loadBenchPanels,
  loadBenchmarkRows,
  loadPanelCandidates,
  type BenchGrader,
  type PanelWriter,
} from '../src/lib/analysis/benchmark-run'
import { formatBenchmarkReport } from '../src/lib/analysis/benchmark-report'

/**
 * `npm run bench-grader` — the grader benchmark (Spec 5 Phase A §8).
 *
 * The KLP traps proved the key points discriminate. This proves the GRADER,
 * reading those key points, ranks answers the way a knowledgeable adversary
 * intended. Per card: an adversary (writer family, `grader-panel` task)
 * writes four answers to a stated intent — four LEVELS (`expert`,
 * `competent`, `weak`, `wrong`, with intended ranks) or four failure SHAPES
 * (`gap`, `misconception`, `connectivity`, `template`) — and the runtime
 * grader, exactly as shipped, grades each answer IN ISOLATION. TypeScript
 * then scores rank agreement (6 pairs; 6/6 is perfect), the adjacent gaps,
 * shape agreement, and the unresolved-quote rate (`src/lib/analysis/benchmark.ts`).
 *
 * RE-RUNNABLE. A panel is written once per (card, klpVersion, kind) — a
 * re-authored card gets a new one, the old one stays as history. A result is
 * written once per (answer, graderVersion, model): a prompt or model change
 * is a re-grade against the FIXED panel, which is the whole point — the
 * fixed-card-set rule from `bench-models`.
 *
 * Flags:
 *   --set <setId>     required; this never walks the corpus
 *   --author          write panels for cards lacking one at their live klpVersion
 *                     (one adversary call per card); without it, cards with no
 *                     panel are reported and skipped
 *   --kind levels|modes   which panel kind to author and grade (default levels)
 *   --direct          raw provider keys from the environment via the direct pool
 *                     (KLP_DIRECT_PROVIDER / KLP_DIRECT_MODELS grade; KLP_AUTHOR_PROVIDER /
 *                     KLP_AUTHOR_MODELS write the panels when set, else the same pool),
 *                     bypassing the encrypted credential pool — needed locally, where
 *                     `.env` carries no GOOGLE_KEY_ENCRYPTION_SECRET
 *   --model <id>      the planning key: skip answers already graded under this
 *                     model at the current graderVersion. Defaults to the direct
 *                     pool's model when it has exactly one, else "any model"
 *   --dry-run         print the plans (which cards need a panel, which answers
 *                     need grading) and the current report; call nothing, write nothing
 *   --limit <n>       cap the answers graded this run (panels are not capped)
 *   --rpm <n>         pacing for --direct (default DEFAULT_RPM)
 *   --help
 *
 * Without --direct every call runs on the SET OWNER's stored credentials —
 * a benchmark is the owner's operation. Ends with the report and the
 * per-model token and list-price table (`src/lib/klp/token-meter.ts`).
 *
 * Cost: one adversary call + four grading calls per card. The LBO set (10
 * cards) is ~50 calls.
 */

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const USAGE = `usage: npm run bench-grader -- --set <setId> [--author] [--kind levels|modes] [--direct] [--model <id>] [--dry-run] [--limit <n>] [--rpm <n>]

  --set <setId>        required
  --author             write a panel for every card lacking one at its live klpVersion
  --kind levels|modes  panel kind (default levels)
  --direct             raw env keys via the direct pool (KLP_DIRECT_PROVIDER grades;
                       KLP_AUTHOR_PROVIDER writes the panels when set)
  --model <id>         planning key: skip answers already graded under this model
  --dry-run            print the plans and the current report; call nothing
  --limit <n>          cap the answers graded this run
  --rpm <n>            pacing for --direct

The LBO baseline: npx tsx --conditions=react-server --env-file=.env scripts/bench-grader.ts --set cmtj7pxfc000005l4rv4krxxy --author --direct`

const METER = new TokenMeter()

/** The pooled path: the set owner's stored credentials, per task. */
function pooledCall<T>(ownerId: string, task: AiTask, step: string) {
  return async (input: { prompt: string; schema: z.ZodSchema<T>; maxOutputTokens?: number }) => {
    const { value, meta } = await generateJsonWithMeta({
      userId: ownerId,
      task,
      prompt: input.prompt,
      schema: input.schema,
      maxOutputTokens: input.maxOutputTokens,
    })
    METER.add(step, meta.model, meta.usage)
    return { value, model: meta.model }
  }
}

/**
 * `--direct`: raw keys, rotating per CALL. Safe here for the reason it is
 * safe in `regrade` and NOT in `author-klps`: a rank agreement compares four
 * answers' coverage scores, and coverage is `STATUS_CREDIT` over categorical
 * verdicts — but two graders on one card would fold the gap between graders
 * into the gap between levels. So `--model` (or a one-model pool) is the
 * intended way to run a baseline; rotation exists for the quota-starved
 * free tier, and the model is recorded on every result row so a mixed run
 * is at least legible.
 *
 * Same temperature as the pooled path (`temperatureForTask`), so a bench
 * result is comparable to a quiz grade.
 */
function directCall<T>(pool: DirectCombo[], pacer: Pacer, task: AiTask, step: string) {
  return async (input: { prompt: string; schema: z.ZodSchema<T>; maxOutputTokens?: number }) => {
    for (;;) {
      const combo = nextCombo(pool)
      if (!combo) throw new Error(`every key x model combo is out of daily quota (${step})`)
      markTried(combo, new Date())
      const model = resolveLanguageModel(comboResolveInput(combo))

      try {
        const value = await callWithPacingAndRetry(
          async () => {
            const attempt = () =>
              generateText({
                model,
                prompt: input.prompt,
                output: Output.object({ schema: input.schema }),
                maxOutputTokens: input.maxOutputTokens,
                temperature: temperatureForTask(task),
                // The pacing layer owns retry; two retry authorities multiply.
                maxRetries: 0,
              })
            let res: Awaited<ReturnType<typeof attempt>>
            try {
              res = await attempt()
            } catch (err) {
              // One retry in place on a malformed reply, never on a truncated
              // one (the ceiling is the problem there, not compliance).
              if (!NoObjectGeneratedError.isInstance(err) || err.finishReason === 'length') throw err
              console.log(`    ${combo.model}: malformed reply; retrying once in place`)
              await pacer.waitTurn()
              res = await attempt()
            }
            // Metered on success only — a failed attempt reports no usage.
            METER.add(step, combo.model, {
              inputTokens: res.usage?.inputTokens,
              outputTokens: res.usage?.outputTokens,
              reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens,
              cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens,
            })
            return res.output
          },
          { pacer, clock: realClock },
        )
        return { value, model: combo.model }
      } catch (err) {
        if (err instanceof RunHaltedError && err.haltReason === 'daily_quota') {
          markExhausted(combo)
          console.error(`    ${combo.id} out of daily quota; ${poolStatus(pool).available} left`)
          continue
        }
        throw err
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (flag(args, '--help') || flag(args, '-h')) {
    console.log(USAGE)
    return
  }
  const setId = opt(args, '--set')
  const author = flag(args, '--author')
  const direct = flag(args, '--direct')
  const dryRun = flag(args, '--dry-run')
  const kindRaw = opt(args, '--kind') ?? 'levels'
  const modelFlag = opt(args, '--model')
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined
  const rpmRaw = opt(args, '--rpm')
  const rpm = rpmRaw !== undefined ? Number.parseInt(rpmRaw, 10) : DEFAULT_RPM

  if (!setId) {
    console.error('[bench-grader] --set <setId> is required. This tool never walks the whole corpus.\n')
    console.error(USAGE)
    process.exitCode = 1
    return
  }
  if (!(GRADER_PANEL_KINDS as readonly string[]).includes(kindRaw)) {
    console.error(`[bench-grader] --kind must be one of ${GRADER_PANEL_KINDS.join(' | ')}, got "${kindRaw}".`)
    process.exitCode = 1
    return
  }
  const kind = kindRaw as GraderPanelKind
  if (limitRaw !== undefined && (!/^\d+$/.test(limitRaw) || limit === undefined || limit < 1)) {
    console.error(`[bench-grader] --limit needs a positive integer, got "${limitRaw}".`)
    process.exitCode = 1
    return
  }
  if (!Number.isFinite(rpm) || rpm <= 0) {
    console.error(`[bench-grader] --rpm must be a positive number, got ${JSON.stringify(rpmRaw)}`)
    process.exitCode = 1
    return
  }

  const set = await prisma.set.findUnique({ where: { id: setId }, select: { id: true, userId: true, title: true } })
  if (!set) {
    console.error(`[bench-grader] set ${setId} not found.`)
    process.exitCode = 1
    return
  }

  // Pools and generators. Read even on a dry run so a missing key fails
  // before the plan is printed, not after an hour of grading.
  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock)
  let gradePool: DirectCombo[] = []
  let panelPool: DirectCombo[] = []
  if (direct) {
    gradePool = readDirectPool()
    const authorPool = author ? readDirectPool(process.env, 'author') : []
    panelPool = authorPool.length > 0 ? authorPool : gradePool
    const gs = poolStatus(gradePool)
    console.log(
      `[bench-grader] --direct: grading on ${gs.total} key x model combo(s), models: ${gs.modelsLeft.join(', ')}` +
        (author
          ? authorPool.length > 0
            ? `; panels on the AUTHOR pool: ${poolStatus(authorPool).modelsLeft.join(', ')}`
            : '; panels on the same pool (set KLP_AUTHOR_PROVIDER for a writer-family adversary)'
          : '') +
        ` — bypassing stored credentials (pacing at ${rpm} req/min)`,
    )
  }
  const grader: BenchGrader = direct
    ? directCall(gradePool, pacer, 'grade', 'grade')
    : pooledCall(set.userId, 'grade', 'grade')
  const writer: PanelWriter = direct
    ? directCall(panelPool, pacer, 'grader-panel', 'panel')
    : pooledCall(set.userId, 'grader-panel', 'panel')

  // The planning key. A direct pool with one model IS the model; otherwise
  // only an explicit --model pins it, and "any result at this graderVersion"
  // is what a rotating pool can promise.
  const poolModels = [...new Set(gradePool.map((c) => c.model))]
  const planModel: string | null = modelFlag ?? (direct && poolModels.length === 1 ? poolModels[0] : null)

  console.log(
    `[bench-grader] "${set.title}" — kind ${kind}, grader v${GRADER_VERSION}, planning model ${planModel ?? 'any'}` +
      `${dryRun ? ' — --dry-run: nothing will be called or written' : ''}`,
  )

  // 1. Panels.
  const { cards, panels: existing } = await loadPanelCandidates(set.id)
  const panelPlan = planPanels(cards, existing, { kind })
  const termOf = new Map(cards.map((c) => [c.cardId, c.term]))
  const byReason = new Map<string, number>()
  for (const s of panelPlan.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
  console.log(
    `[bench-grader] panels: ${cards.length} card(s), ${panelPlan.toAuthor.length} need a ${kind} panel` +
      (byReason.size > 0 ? ` (skipped: ${[...byReason].map(([r, n]) => `${n} ${r}`).join(', ')})` : '') +
      (panelPlan.toAuthor.length > 0 && !author ? ' — pass --author to write them' : ''),
  )
  if (dryRun) {
    for (const id of panelPlan.toAuthor) console.log(`  author  ${id}  ${termOf.get(id) ?? ''}`)
  }

  let panelsWritten = 0
  const cardsTouched = new Set<string>()
  const panelFailures: { cardId: string; error: string }[] = []
  if (author && !dryRun) {
    for (const cardId of panelPlan.toAuthor) {
      try {
        const r = await authorPanel(cardId, kind, writer)
        panelsWritten++
        cardsTouched.add(cardId)
        console.log(`  panel   ${termOf.get(cardId) ?? cardId} — ${r.answers} answers on ${r.model}`)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        panelFailures.push({ cardId, error: message })
        console.error(`  panel   ${termOf.get(cardId) ?? cardId} — FAILED: ${message}`)
        if (err instanceof RunHaltedError) {
          console.error(`[bench-grader] halted (${err.haltReason}) while authoring; re-run to resume — written panels are skipped.`)
          break
        }
      }
    }
  }

  // 2. Grading — one answer per call, never two in one prompt.
  const { panels, results } = await loadBenchPanels(set.id, kind)
  const benchPlan = planBench(panels, results, { graderVersion: GRADER_VERSION, model: planModel })
  const toGrade = limit !== undefined ? benchPlan.toGrade.slice(0, limit) : benchPlan.toGrade
  const skipReasons = new Map<string, number>()
  for (const s of benchPlan.skipped) skipReasons.set(s.reason, (skipReasons.get(s.reason) ?? 0) + 1)
  console.log(
    `[bench-grader] grading: ${panels.length} panel(s), ${benchPlan.toGrade.length} answer(s) to grade` +
      (limit !== undefined && toGrade.length < benchPlan.toGrade.length ? ` (--limit ${limit})` : '') +
      (skipReasons.size > 0 ? `, ${benchPlan.skipped.length} skipped (${[...skipReasons].map(([r, n]) => `${n} ${r}`).join(', ')})` : ''),
  )

  const graded: string[] = []
  const gradeFailures: { answerId: string; error: string }[] = []
  if (dryRun) {
    const termOfPanel = new Map(panels.map((p) => [p.id, p.term]))
    for (const g of toGrade) console.log(`  grade   ${g.answerId}  (${termOfPanel.get(g.panelId) ?? g.cardId})`)
  } else {
    for (const g of toGrade) {
      try {
        const r = await gradePanelAnswer(g.answerId, grader)
        if (r.outcome === 'skipped') {
          console.log(`  ${g.answerId} — skipped (${r.reason})`)
          continue
        }
        graded.push(g.answerId)
        cardsTouched.add(g.cardId)
        console.log(
          `  ${g.answerId} — graded on ${r.model}: ${r.verdicts} key point(s), ${r.relationVerdicts} relation(s), ` +
            `${r.formVerdicts} form, ${r.unresolvedQuotes} unresolved quote(s)` +
            (r.warnings.length > 0 ? `; warnings: ${r.warnings.map((w) => `${w.reason}:${w.value}`).join(' ')}` : ''),
        )
      } catch (err) {
        // One answer's failure must not abandon the run: each result is its
        // own row, so what succeeded stays and a re-run picks this one up.
        const message = err instanceof Error ? err.message : String(err)
        gradeFailures.push({ answerId: g.answerId, error: message })
        console.error(`  ${g.answerId} — FAILED: ${message}`)
        if (err instanceof RunHaltedError) {
          console.error(`[bench-grader] halted (${err.haltReason}); re-run to resume — graded answers are skipped.`)
          break
        }
      }
    }
  }

  // 3. The report, over everything stored for this set at the current grader.
  const rows = await loadBenchmarkRows(set.id, { graderVersion: GRADER_VERSION, model: planModel, kind })
  console.log()
  console.log(formatBenchmarkReport(rows, { title: set.title }))

  console.log()
  console.log(
    `[bench-grader] done — ${panelsWritten} panel(s) written, ${graded.length} answer(s) graded under grader v${GRADER_VERSION}, ` +
      `${panelFailures.length + gradeFailures.length} failed, ${toGrade.length - graded.length - gradeFailures.length} not reached.`,
  )
  if (!dryRun) {
    // Per-card cost is over the cards this run touched (authored or graded).
    console.log(`[bench-grader] tokens (successful calls only; list prices, see src/lib/klp/token-meter.ts):\n${METER.format(cardsTouched.size)}`)
  }
  if (panelFailures.length + gradeFailures.length > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('[bench-grader] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
