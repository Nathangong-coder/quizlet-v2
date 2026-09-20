import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { prisma } from '../src/lib/db'
import { generateJsonWithMeta } from '../src/lib/ai/generate'
import { resolveLanguageModel } from '../src/lib/ai/providers'
import { classifyProviderError } from '../src/lib/errors/classify'
import { FormRequirementsSchema } from '../src/lib/ai/schemas'
import { authorFormRequirements, planFormReqs, type FormReqGen } from '../src/lib/klp/form-requirements'
import { readDirectPool, nextCombo, markTried, markExhausted, poolStatus, comboResolveInput, type DirectCombo } from '../src/lib/klp/direct-pool'
import { Pacer, RunHaltedError, callWithPacingAndRetry, realClock, rpmToIntervalMs, DEFAULT_RPM } from '../src/lib/klp/authoring-pacing'
import { TokenMeter } from '../src/lib/klp/token-meter'

/**
 * `npm run author-form-reqs -- --set <setId> [--direct] [--limit N] [--skip N]
 * [--cards id,id,...] [--rpm N]` — the form-requirements pass (Spec 5 §5) over
 * one set.
 *
 * For every card authored at its current `klpVersion` that has no
 * `CardFormRequirement` rows there, ONE call writes 3-5 shape rules over the
 * stored reference answer and live key points, and ONE grading call checks
 * the stored memorised-template trap against them — `weak` when the trap
 * meets every rule. Never a re-author: a card with no authoring at its
 * version is reported and left alone (`npm run author-klps` is the fix).
 *
 * RESUMABLE. Rows at the current version mean skip, so re-running the same
 * command after a halt continues where it stopped, and a re-authored card
 * (new `klpVersion`) is picked up again.
 *
 * GENERATOR. By default the set owner's stored credential pool, as task
 * `form-reqs` (DeepSeek-first; `generateJsonWithMeta` so every row records
 * the model that wrote it, and every call lands in `AiCallLog`). `--direct`
 * bypasses stored credentials for the `KLP_DIRECT_PROVIDER` /
 * `KLP_DIRECT_MODELS` env keys (the grader pool — form rules are judgments,
 * not writing), pinned one combo per card and rotated between cards like
 * `author-klps`; a per-day quota retires the combo and the run continues on
 * the next. Direct calls are metered (`src/lib/klp/token-meter.ts`) and the
 * per-step table is printed at the end; pooled calls are accounted for in
 * `AiCallLog` and `/staff/ai-history` instead.
 */

const NAME = '[author-form-reqs]'
const METER = new TokenMeter()
const DIRECT_TEMPERATURE = process.env.KLP_TEMPERATURE !== undefined && process.env.KLP_TEMPERATURE !== '' ? Number(process.env.KLP_TEMPERATURE) : 0

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

/** The set owner's pool, as task `form-reqs`. */
function pooledGen(userId: string): FormReqGen {
  return async (prompt, schema) => {
    const { value, meta } = await generateJsonWithMeta({ userId, task: 'form-reqs', prompt, schema })
    return { value, model: meta.model }
  }
}

/**
 * One env-key combo, pinned for the card. Built through the same
 * `resolveLanguageModel` the website uses (DeepSeek's reasoning-off default,
 * Z.ai's schema-in-prompt), paced and retried by the shared layer; the SDK's
 * own retry is off so the two do not multiply.
 */
function directGen(combo: DirectCombo, pacer: Pacer): FormReqGen {
  const model = resolveLanguageModel(comboResolveInput(combo))
  return async <T>(prompt: string, schema: z.ZodSchema<T>) => {
    const res = await callWithPacingAndRetry(
      () => generateText({ model, prompt, output: Output.object({ schema }), maxRetries: 0, temperature: DIRECT_TEMPERATURE }),
      {
        pacer,
        clock: realClock,
        onRetryWait: ({ attempt, waitMs, kind }) => console.log(`${NAME} ${kind} — retry ${attempt}, waiting ${(waitMs / 1000).toFixed(1)}s`),
      },
    )
    const step = (schema as unknown) === FormRequirementsSchema ? 'write' : 'weak-check'
    METER.add(step, combo.model, {
      inputTokens: res.usage?.inputTokens,
      outputTokens: res.usage?.outputTokens,
      reasoningTokens: res.usage?.outputTokenDetails?.reasoningTokens,
      cachedTokens: res.usage?.inputTokenDetails?.cacheReadTokens,
    })
    return { value: res.output as T, model: combo.model }
  }
}

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  const direct = args.includes('--direct')
  const skip = Number.parseInt(opt(args, '--skip') ?? '0', 10) || 0
  const limitRaw = opt(args, '--limit')
  const limit = limitRaw !== undefined ? Number.parseInt(limitRaw, 10) : undefined
  const rpm = Number.parseInt(opt(args, '--rpm') ?? String(DEFAULT_RPM), 10) || DEFAULT_RPM

  if (!setId) {
    console.error(`${NAME} --set <setId> is required`)
    process.exitCode = 1
    return
  }

  const set = await prisma.set.findUnique({ where: { id: setId }, select: { id: true, title: true, userId: true } })
  if (!set) {
    console.error(`${NAME} no set ${setId}`)
    process.exitCode = 1
    return
  }

  const allCards = await prisma.card.findMany({
    where: { setId: set.id },
    orderBy: { position: 'asc' },
    select: { id: true, term: true, klpVersion: true, formRequirements: { select: { klpVersion: true } } },
  })
  const onlyIds = (opt(args, '--cards') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  const selected = onlyIds.length
    ? onlyIds.map((id) => allCards.find((c) => c.id === id)).filter((c): c is (typeof allCards)[number] => !!c)
    : limit !== undefined ? allCards.slice(skip, skip + limit) : allCards.slice(skip)
  const planned = planFormReqs(selected.map((c) => ({ ...c, formReqVersions: c.formRequirements.map((f) => f.klpVersion) })))

  console.log(`${NAME} ${set.title} — ${selected.length} card(s) selected, ${planned.length} need form requirements, ${selected.length - planned.length} already have them at their version`)
  if (planned.length === 0) return

  const pool = direct ? readDirectPool() : []
  if (direct) {
    const status = poolStatus(pool)
    console.log(`${NAME} --direct: ${(process.env.KLP_DIRECT_PROVIDER ?? 'google').toLowerCase()} keys from the environment, ${status.total} key x model combo(s), models: ${status.modelsLeft.join(', ')} (pacing at ${rpm} req/min)`)
    if (status.total === 0) {
      console.error(`${NAME} no direct pool: set KLP_DIRECT_PROVIDER / KLP_DIRECT_MODELS and the provider key`)
      process.exitCode = 1
      return
    }
  } else {
    console.log(`${NAME} using the set owner's stored credentials as task form-reqs (pass --direct for env keys)`)
  }
  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock, (waitMs) => console.log(`${NAME} pacing — waiting ${(waitMs / 1000).toFixed(1)}s`))
  const pooled = direct ? undefined : pooledGen(set.userId)

  let written = 0
  let weak = 0
  let skipped = 0
  let failed = 0
  const weakCards: string[] = []

  for (const [i, card] of planned.entries()) {
    const label = `${i + 1}/${planned.length} ${card.term.replace(/\s+/g, ' ').slice(0, 60)}`
    // One combo per card, rotated between cards; a quota halt retires it and
    // the same card is retried on the next.
    for (;;) {
      let combo: DirectCombo | undefined
      if (direct) {
        combo = nextCombo(pool)
        if (!combo) {
          console.log(`${NAME} every key x model combo is exhausted — stopping; re-run to resume`)
          printSummary()
          return
        }
        markTried(combo, new Date())
      }
      const gen = combo ? directGen(combo, pacer) : pooled!
      try {
        const out = await authorFormRequirements(card.id, gen)
        if (out.skipped) {
          skipped++
          console.log(`  ${label}: skipped (${out.skipped})${out.skipped === 'no_authoring' ? ' — author-klps first' : ''}`)
        } else {
          written++
          if (out.weak) { weak++; weakCards.push(card.id) }
          console.log(`  ${label}: wrote ${out.written} (${out.model}${combo ? `, ${combo.id}` : ''})${out.probeChecked ? `${out.weak ? ' — WEAK: the template trap met every rule' : ' — trap fails at least one rule'}` : ' — no template probe, weak check skipped'}`)
          for (const [n, text] of out.requirements.entries()) console.log(`      [F${n}] ${text}`)
        }
        break
      } catch (error) {
        const kind = error instanceof RunHaltedError ? (error.haltReason === 'daily_quota' ? 'quota_exhausted' : 'rate_limited') : classifyProviderError(error)
        if (combo && kind === 'quota_exhausted') {
          markExhausted(combo)
          console.log(`  ${label}: ${combo.id} hit its daily quota — retired for this run, retrying on the next combo`)
          continue
        }
        failed++
        console.log(`  ${label}: FAILED (${kind}) ${(error as Error).message?.slice(0, 200)}`)
        if (kind === 'quota_exhausted' || kind === 'no_credentials' || kind === 'credentials_unavailable') {
          console.log(`${NAME} stopping on ${kind}; re-run to resume`)
          printSummary()
          return
        }
        break
      }
    }
  }
  printSummary()

  function printSummary() {
    console.log(`${NAME} done: ${written} card(s) written, ${weak} weak, ${skipped} skipped, ${failed} failed`)
    if (weakCards.length) console.log(`${NAME} weak (the memorised-template trap met every requirement; reported, not retried): ${weakCards.join(', ')}`)
    if (direct) console.log(`${NAME} tokens by step (successful calls only; list prices, see src/lib/klp/token-meter.ts):\n${METER.format(written)}`)
  }
}

main()
  .catch((error) => {
    console.error(`${NAME} failed:`, error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
