import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import { DIAGNOSTIC_GRADING_PROMPT } from '../src/lib/ai/prompts/diagnostic'
import { diagnosticOutputCap } from '../src/lib/diagnostic/grading'
import { temperatureForTask } from '../src/lib/ai/temperature'
import { GOOGLE_APPROVED_MODELS } from '../src/lib/ai/model-policy'
import { parseList } from '../src/lib/klp/direct-pool'
import { resolveLanguageModel, PROVIDER_META, type ProviderId } from '../src/lib/ai/providers'

/**
 * Does a candidate model actually satisfy this engine's structured-output
 * contract? Run this BEFORE adding one to `GOOGLE_APPROVED_MODELS`.
 *
 * The rule it enforces is the repo's own: a model id is verified by a real
 * generation call, never by a listing call or a benchmark. `gemini-2.5-flash`
 * returned perfectly good prose and could not satisfy the authoring schema at
 * all, which is the entire reason the allowlist exists. No public benchmark
 * measures nested-schema compliance, so the only honest test is this one.
 *
 * ONE CALL PER MODEL, and on Google each model has its own free-tier daily
 * bucket (the quota is per project per MODEL), so this is cheap and does not
 * spend the budget of the model you are already using.
 *
 * WORKS FOR ANY PROVIDER, not just Google. Only Google is subject to
 * `GOOGLE_APPROVED_MODELS`, but `isModelAllowed` returns TRUE for every other
 * provider — meaning an OpenRouter or Qwen model reaches the grading path with
 * no verification at all. That is a bigger risk than the policed case, not a
 * smaller one, and this is the only thing that checks it.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/probe-model-policy.ts
 *   npx tsx --env-file=.env scripts/probe-model-policy.ts gemini-3.4-flash
 *   PROBE_PROVIDER=openrouter PROBE_KEY_ENV=OPENROUTER_API_KEY \
 *     npx tsx --env-file=.env scripts/probe-model-policy.ts minimax/minimax-m2
 *
 * Env:
 *   PROBE_PROVIDER  google | anthropic | openai | openrouter | custom  (default google)
 *   PROBE_KEY_ENV   which env var holds the key (default GOOGLE_API_KEYS/GOOGLE_API_KEY)
 *   PROBE_BASE_URL  required for openrouter/custom; defaults to the provider's own
 *   PROBE_CAP       output-token ceiling override
 */

/** Checked when no models are named on the command line. */
const DEFAULT_CANDIDATES = [
  'gemini-3.4-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.7-flash',
  'gemini-3.8-flash',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]

async function main() {
  const provider = (process.env.PROBE_PROVIDER ?? 'google') as ProviderId
  const keyEnv = process.env.PROBE_KEY_ENV
  const apiKey = keyEnv
    ? process.env[keyEnv]
    : parseList(process.env.GOOGLE_API_KEYS)[0] ?? process.env.GOOGLE_API_KEY
  if (!apiKey) {
    throw new Error(
      keyEnv
        ? `${keyEnv} is not set. If it is in .env, check the line is not commented out.`
        : 'needs GOOGLE_API_KEY or GOOGLE_API_KEYS',
    )
  }
  const baseUrl = process.env.PROBE_BASE_URL ?? PROVIDER_META[provider]?.defaultBaseUrl
  const languageModel = (model: string) =>
    resolveLanguageModel({ provider, apiKey, baseUrl, model })

  const candidates = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_CANDIDATES

  const klps = await prisma.cardKlp.findMany({
    where: { card: { set: { visibility: 'public' } }, supersededAt: null },
    select: { text: true },
    take: 2,
  })
  if (klps.length < 2) throw new Error('need 2 live key points to build the probe')

  // Two questions: one answered well, one answered vacuously. The vacuous one
  // is deliberate — it is the input that made gemini-3.6-flash ramble to
  // 15,001 tokens, so a candidate that cannot handle it is not a safe backup.
  const build = () =>
    DIAGNOSTIC_GRADING_PROMPT.build({
      questions: [
        {
          ref: 0,
          question: 'What does this key point say?',
          expectedAnswer: klps[0].text,
          keyPoint: klps[0].text,
          answer: klps[0].text,
        },
        {
          ref: 1,
          question: 'What does this key point say?',
          expectedAnswer: klps[1].text,
          keyPoint: klps[1].text,
          answer: 'IDK',
        },
      ],
    })

  console.log(`Provider: ${provider}${baseUrl ? ` (${baseUrl})` : ''}`)
  console.log(`Google approved list: ${GOOGLE_APPROVED_MODELS.join(', ')}`)
  if (provider !== 'google') {
    console.log(
      'NOTE: only Google is policed by that list. Models on this provider are\n' +
      '      UNRESTRICTED — they reach grading with no allowlist between them and\n' +
      '      a learner\'s history, so this probe is the only check there is.\n',
    )
  } else {
    console.log('')
  }
  console.log(`Testing ${candidates.length} candidate(s) against the diagnostic grading schema.\n`)

  const results: Array<{ model: string; verdict: string; detail: string }> = []

  for (const model of candidates) {
    const started = Date.now()
    try {
      const res = await generateText({
        model: languageModel(model),
        prompt: build(),
        output: Output.object({ schema: DIAGNOSTIC_GRADING_PROMPT.schema }),
        temperature: temperatureForTask('diagnostic'),
        maxOutputTokens: Number(process.env.PROBE_CAP ?? diagnosticOutputCap(2)),
        maxRetries: 0,
      })
      const ms = Date.now() - started
      const out = res.usage?.outputTokens ?? 0
      let value
      try {
        value = res.output
      } catch (err) {
        results.push({
          model,
          verdict: 'FAIL schema',
          detail: `${(err as Error).name}, finishReason ${res.finishReason}, ${out} output tokens in ${ms}ms`,
        })
        continue
      }

      const grades = value.grades
      const refs = grades.map((g) => g.questionRef).sort()
      const oneVerdictEach = grades.every((g) => (g.klpResults ?? []).length === 1)
      const separates =
        grades.find((g) => g.questionRef === 0)?.klpResults?.[0]?.status === 'passed' &&
        grades.find((g) => g.questionRef === 1)?.klpResults?.[0]?.status === 'failed'

      const problems: string[] = []
      if (grades.length !== 2 || refs.join(',') !== '0,1') problems.push(`refs ${JSON.stringify(refs)}`)
      if (!oneVerdictEach) problems.push('missing per-key-point verdict')
      if (!separates) problems.push('did not separate a correct answer from "IDK"')

      results.push({
        model,
        verdict: problems.length === 0 ? 'PASS' : 'FAIL contract',
        detail: `${problems.join('; ') || 'all checks'} — ${out} output tokens in ${ms}ms`,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const short = /quota/i.test(message)
        ? 'quota exhausted for this model today'
        : /not found|404/i.test(message)
          ? 'MODEL DOES NOT EXIST'
          : message.slice(0, 140).replace(/\s+/g, ' ')
      results.push({ model, verdict: 'ERROR', detail: short })
    }
  }

  console.log('Results:')
  for (const r of results) {
    console.log(`  ${r.verdict.padEnd(14)} ${r.model.padEnd(24)} ${r.detail}`)
  }

  const passed = results.filter((r) => r.verdict === 'PASS').map((r) => r.model)
  console.log('')
  if (passed.length > 0 && provider === 'google') {
    console.log(`Safe to add to GOOGLE_APPROVED_MODELS: ${passed.join(', ')}`)
  } else if (passed.length > 0) {
    console.log(`Held the grading contract on ${provider}: ${passed.join(', ')}`)
  } else {
    console.log('Nothing passed. Do not widen the allowlist on this evidence.')
  }
  console.log('\nNote: passing here proves GRADING compliance. Authoring uses a')
  console.log('larger schema and is a separate bar — that is the one 2.5-flash failed.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
