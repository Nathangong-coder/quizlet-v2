import { prisma } from '../src/lib/db'
import { generateText, Output, NoObjectGeneratedError } from 'ai'
import { generateJsonWithMeta } from '../src/lib/ai/generate'
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
import {
  loadRegradeCandidates,
  planRegrade,
  regradeAnswer,
  type RegradeGenerator,
  type RegradeAnswerResult,
} from '../src/lib/analysis/regrade'

/**
 * `npm run regrade` — re-run the CURRENT grader over stored short answers.
 *
 * Spec 5 Phase A §6. `GRADER_VERSION` (src/lib/analysis/version.ts) moves
 * whenever the content prompt, the span resolver, the lexicon or the metrics
 * code changes — and "grader changes are recoverable by re-grading" is only
 * true once something re-runs the grader over history. This does. For every
 * answer it grades it writes a NEW generation of analysis rows stamped with
 * the current version and marks the old generation `supersededAt`; nothing is
 * deleted, and every reader of those tables sees live rows only.
 *
 * NOT `npm run regrade-klps`. That is the KLP-EDIT regrade: it moves an
 * answer's evidence after a card's key points CHANGE. This one keeps the key
 * points and changes the instrument. Run that one first if a set's cards have
 * been re-authored; for short answer its remedy is a re-grade against the live
 * points, which is also what this does.
 *
 * Resumable: an answer already at the current `graderVersion` is skipped, so
 * a run that halts on quota picks up where it stopped. Re-grading is not
 * deterministic, so that gate is also what keeps a second run from churning
 * every posterior for no new information.
 *
 * Flags:
 *   --set <setId>         every short answer on the set's cards
 *   --attempt <attemptId> one quiz attempt's answers      (one of the two is required)
 *   --dry-run             print the plan and the skip reasons; grade nothing
 *   --direct              raw provider keys from the environment via the direct
 *                         pool (KLP_DIRECT_PROVIDER / KLP_DIRECT_MODELS), bypassing
 *                         the encrypted credential pool — needed locally, where
 *                         `.env` carries no GOOGLE_KEY_ENCRYPTION_SECRET
 *   --limit <n>           cap the answers graded this run
 *   --include-stranded    also grade answers whose rows point at a superseded
 *                         key-point version (skipped as `klps_superseded` by
 *                         default — that is `regrade-klps`'s job); grades them
 *                         against the live version
 *
 * Without --direct the grading call runs on the SET OWNER's stored
 * credentials, never the answering learner's: a re-measurement is the
 * owner's operation. Ends with the per-model token and list-price table
 * (src/lib/klp/token-meter.ts).
 */

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const METER = new TokenMeter()

/** The pooled path: the set owner's stored credentials, task 'grade'. */
function pooledGenerator(ownerId: string): RegradeGenerator {
  return async ({ prompt, schema, maxOutputTokens }) => {
    const { value, meta } = await generateJsonWithMeta({
      userId: ownerId,
      task: 'grade',
      prompt,
      schema,
      maxOutputTokens,
    })
    METER.add('regrade', meta.model, meta.usage)
    return { value, model: meta.model }
  }
}

/**
 * `--direct`: raw keys, rotating per ANSWER. Safe here for the reason it is
 * safe in `regrade-klps` and NOT in `author-klps`: each answer yields one
 * independent verdict set with no arithmetic across calls, so which model
 * served which answer costs nothing. The model is recorded on the answer.
 *
 * Same temperature as the pooled path (`temperatureForTask('grade')`), so a
 * regraded row is comparable to a quiz-graded one — the direct path in
 * `author-klps` ran a whole corpus at the provider default before anyone
 * noticed.
 */
function directGenerator(pool: DirectCombo[], pacer: Pacer): RegradeGenerator {
  return async ({ prompt, schema, maxOutputTokens }) => {
    for (;;) {
      const combo = nextCombo(pool)
      if (!combo) throw new Error('every key x model combo is out of daily quota')
      markTried(combo, new Date())
      const model = resolveLanguageModel(comboResolveInput(combo))

      try {
        const value = await callWithPacingAndRetry(
          async () => {
            const attempt = () =>
              generateText({
                model,
                prompt,
                output: Output.object({ schema }),
                maxOutputTokens,
                temperature: temperatureForTask('grade'),
                // The pacing layer owns retry; two retry authorities multiply.
                maxRetries: 0,
              })
            let res: Awaited<ReturnType<typeof attempt>>
            try {
              res = await attempt()
            } catch (err) {
              // D6, the same rule the quiz applies: one retry in place on a
              // malformed reply, never on a truncated one (the ceiling is
              // the problem there, not the model's compliance).
              if (!NoObjectGeneratedError.isInstance(err) || err.finishReason === 'length') throw err
              console.log(`    ${combo.model}: malformed reply; retrying once in place`)
              await pacer.waitTurn()
              res = await attempt()
            }
            // Metered on success only — a failed attempt reports no usage.
            METER.add('regrade', combo.model, {
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
  const setId = opt(args, '--set')
  const attemptId = opt(args, '--attempt')
  const dryRun = flag(args, '--dry-run')
  const direct = flag(args, '--direct')
  const includeStranded = flag(args, '--include-stranded')
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined

  if ((!setId && !attemptId) || (setId && attemptId)) {
    console.error('[regrade] exactly one of --set <setId> or --attempt <attemptId> is required.')
    process.exitCode = 1
    return
  }
  if (limitRaw !== undefined && (!/^\d+$/.test(limitRaw) || limit === undefined || limit < 1)) {
    // `Number.parseInt('abc')` is NaN, and `.slice(0, NaN)` is an empty slice
    // — a typo would have silently graded nothing and reported "done".
    console.error(`[regrade] --limit needs a positive integer, got "${limitRaw}".`)
    process.exitCode = 1
    return
  }

  // The owner whose credentials grade, and the scope's existence, in one read.
  const set = setId
    ? await prisma.set.findUnique({ where: { id: setId }, select: { id: true, userId: true, title: true } })
    : await prisma.quizAttempt
        .findUnique({ where: { id: attemptId! }, select: { set: { select: { id: true, userId: true, title: true } } } })
        .then((a) => a?.set ?? null)
  if (!set) {
    console.error(`[regrade] ${setId ? `set ${setId}` : `attempt ${attemptId}`} not found.`)
    process.exitCode = 1
    return
  }

  const candidates = await loadRegradeCandidates(setId ? { setId } : { attemptId: attemptId! })
  const plan = planRegrade(candidates, { graderVersion: GRADER_VERSION, includeStranded })
  const toGrade = limit !== undefined ? plan.toGrade.slice(0, limit) : plan.toGrade

  const byReason = new Map<string, number>()
  for (const s of plan.skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1)
  console.log(
    `[regrade] "${set.title}" — ${candidates.length} answer(s) in scope, grader v${GRADER_VERSION}: ` +
      `${plan.toGrade.length} to grade${limit !== undefined && toGrade.length < plan.toGrade.length ? ` (--limit ${limit})` : ''}, ` +
      `${plan.skipped.length} skipped` +
      (byReason.size > 0 ? ` (${[...byReason].map(([r, n]) => `${n} ${r}`).join(', ')})` : '') +
      `${dryRun ? ' — --dry-run: nothing will be written' : ''}`,
  )

  if (dryRun) {
    for (const id of toGrade) console.log(`  grade  ${id}`)
    for (const s of plan.skipped) console.log(`  skip   ${s.id}  ${s.reason}`)
    return
  }
  if (toGrade.length === 0) {
    console.log('[regrade] nothing to do — every answer in scope is already at the current grader version.')
    return
  }

  const pacer = new Pacer(rpmToIntervalMs(DEFAULT_RPM), realClock)
  const pool = direct ? readDirectPool() : []
  if (direct) {
    const status = poolStatus(pool)
    console.log(
      `[regrade] --direct: ${status.total} key x model combo(s), ` +
        `models: ${status.modelsLeft.join(', ')} — bypassing stored credentials`,
    )
  }
  const gen = direct ? directGenerator(pool, pacer) : pooledGenerator(set.userId)

  const results: RegradeAnswerResult[] = []
  const failed: { id: string; error: string }[] = []
  for (const id of toGrade) {
    try {
      const r = await regradeAnswer(id, gen, { includeStranded })
      results.push(r)
      if (r.outcome === 'skipped') {
        console.log(`  ${id} — skipped (${r.reason})`)
        continue
      }
      const w = r.written
      console.log(
        `  ${id} — ${r.status} on ${r.model ?? 'unknown model'}: ` +
          `${w.klpResults} key point(s), ${w.errorTags} tag(s), ${w.relationResults} relation(s), ` +
          `${w.formResults} form, ${w.unwarranted} claim(s); ${r.superseded} row(s) superseded` +
          (r.warnings.length > 0 ? `; warnings: ${r.warnings.map((x) => `${x.reason}:${x.value}`).join(' ')}` : ''),
      )
    } catch (err) {
      // One answer's failure must not abandon the run: each answer commits
      // its own transaction, so what already succeeded stays regraded and a
      // re-run picks this one up again — the version gate is a predicate over
      // current state, not a list that can get consumed.
      const message = err instanceof Error ? err.message : String(err)
      failed.push({ id, error: message })
      console.error(`  ${id} — FAILED: ${message}`)
      if (err instanceof RunHaltedError) {
        console.error(`[regrade] halted (${err.haltReason}); re-run to resume — graded rows are skipped.`)
        break
      }
    }
  }

  const regraded = results.filter((r) => r.outcome === 'regraded').length
  const skipped = results.length - regraded
  console.log()
  console.log(
    `[regrade] done — ${regraded} answer(s) regraded under grader v${GRADER_VERSION}, ` +
      `${skipped} skipped at grade time, ${failed.length} failed, ` +
      `${toGrade.length - results.length - failed.length} not reached.`,
  )
  console.log(`[regrade] tokens (successful calls only; list prices, see src/lib/klp/token-meter.ts):\n${METER.format(regraded)}`)
  if (failed.length > 0) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error('[regrade] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
