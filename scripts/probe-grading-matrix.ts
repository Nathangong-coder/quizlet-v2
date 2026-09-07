import { z } from 'zod'
import { prisma } from '../src/lib/db'
import { DIAGNOSTIC_GRADING_PROMPT } from '../src/lib/ai/prompts/diagnostic'
import { KLP_STATUSES } from '../src/lib/errors/klp-credit'
import { DIMENSIONS, MAX_TAGS_PER_ANSWER } from '../src/lib/errors/taxonomy'

/**
 * The grading benchmark: does a given model/configuration actually grade?
 *
 * WHY IT CALLS THE PROVIDER DIRECTLY instead of going through the AI SDK.
 * Two of the parameters under test are ones the SDK will not send. It decides
 * whether a model supports `reasoningEffort` from a hard-coded list of OpenAI
 * model ids, so for `deepseek-v4-flash` it strips the field and logs
 * "reasoningEffort is not supported for non-reasoning models" — an earlier
 * version of this script measured three conditions that were silently
 * identical because of it. A benchmark whose knobs are quietly discarded is
 * worse than no benchmark.
 *
 * THE PASS CRITERION IS SUBSTANTIVE, not structural. Every run grades the same
 * two answers: one verbatim correct, one the literal string "IDK". A run
 * passes only if it returns one verdict per key point AND marks the first
 * `passed` and the second `failed`. Well-formed JSON that cannot tell those
 * apart is a failure — `liquid/lfm-2.5-2.6b:free` produced exactly that, and a
 * shape-only check would have called it a pass.
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/probe-grading-matrix.ts [samples]
 */

/**
 * The grading schema expressed STRICT-COMPATIBLY: every property required,
 * optionality carried by `.nullable()` rather than `.optional()`.
 *
 * Provider strict mode rejects any object with a property missing from
 * `required` — "Required properties must match all properties in the object".
 * This is the shape the production schemas would have to move to if strict
 * turns out to be worth it, so it is what gets measured.
 */
const StrictGradeSet = z.object({
  grades: z.array(
    z.object({
      questionRef: z.number().int().min(0),
      score: z.number().int().min(1).max(10),
      status: z.enum(['mastered', 'partial', 'missed']),
      feedback: z.string(),
      mistake: z.string().nullable(),
      klpResults: z.array(
        z.object({
          klpRef: z.number().int().min(0),
          status: z.enum(KLP_STATUSES),
          evidence: z.string().nullable(),
        }),
      ),
      errorTags: z
        .array(
          z.object({
            dimension: z.enum(DIMENSIONS),
            type: z.string(),
            klpRef: z.number().int().nullable(),
            secondaryKlpRef: z.number().int().nullable(),
            magnitude: z.number().int().min(1).max(10),
            quote: z.string().nullable(),
          }),
        )
        .max(MAX_TAGS_PER_ANSWER),
    }),
  ),
})

interface Condition {
  label: string
  strict: boolean
  effort?: 'none' | 'minimal' | 'low'
}

const CONDITIONS: Condition[] = [
  { label: 'reason=on   strict=off', strict: false },
  { label: 'reason=on   strict=ON ', strict: true },
  { label: 'reason=none strict=off', strict: false, effort: 'none' },
  { label: 'reason=none strict=ON ', strict: true, effort: 'none' },
]

interface Sample {
  ok: boolean
  ms: number
  out: number
  reasoning: number
  note: string
}

async function main() {
  const samples = Number(process.argv[2] ?? 5)
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set')
  const model = process.env.PROBE_MODEL ?? 'deepseek-v4-flash'
  const endpoint = process.env.PROBE_ENDPOINT ?? 'https://api.deepseek.com/v1/responses'

  const klps = await prisma.cardKlp.findMany({
    where: { card: { set: { visibility: 'public' } }, supersededAt: null },
    select: { text: true },
    take: 2,
  })
  if (klps.length < 2) throw new Error('need 2 live key points')

  const prompt = DIAGNOSTIC_GRADING_PROMPT.build({
    questions: [
      { ref: 0, question: 'What does this key point say?', expectedAnswer: klps[0].text, keyPoint: klps[0].text, answer: klps[0].text },
      { ref: 1, question: 'What does this key point say?', expectedAnswer: klps[1].text, keyPoint: klps[1].text, answer: 'IDK' },
    ],
  })

  const looseSchema = z.toJSONSchema(DIAGNOSTIC_GRADING_PROMPT.schema, { io: 'input' })
  const strictSchema = z.toJSONSchema(StrictGradeSet, { io: 'input' })

  console.log(`model ${model} @ ${endpoint}`)
  console.log(`${samples} sample(s) per condition, temperature 0\n`)

  for (const cond of CONDITIONS) {
    const results: Sample[] = []
    for (let i = 0; i < samples; i++) {
      const body: Record<string, unknown> = {
        model,
        input: prompt,
        temperature: 0,
        text: {
          format: {
            type: 'json_schema',
            name: 'grades',
            schema: cond.strict ? strictSchema : looseSchema,
            ...(cond.strict ? { strict: true } : {}),
          },
        },
      }
      if (cond.effort) body.reasoning = { effort: cond.effort }

      const started = Date.now()
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        // Body parsed BEFORE the clock stops. `await fetch()` alone resolves on
        // HEADERS, which made an earlier run report 1,734 tokens in 0.4s —
        // 4,300 tok/s, and obviously wrong.
        const json = (await res.json()) as Record<string, never>
        const ms = Date.now() - started
        if (!res.ok) {
          results.push({ ok: false, ms, out: 0, reasoning: 0, note: JSON.stringify(json).slice(0, 90) })
          continue
        }
        const usage = (json as Record<string, never>).usage as Record<string, never> | undefined
        const out = Number(usage?.output_tokens ?? 0)
        const reasoning = Number(
          (usage?.output_tokens_details as Record<string, never> | undefined)?.reasoning_tokens ?? 0,
        )
        const message = (json.output as unknown as { type: string; content?: { text?: string }[] }[])
          ?.find((o) => o.type === 'message')
        const text = message?.content?.[0]?.text ?? ''

        let ok = false
        let note = ''
        try {
          const grades = (JSON.parse(text).grades ?? []) as {
            questionRef: number
            klpResults?: { status: string }[]
          }[]
          const shaped = grades.length === 2 && grades.every((g) => (g.klpResults ?? []).length === 1)
          const correct = grades.find((g) => g.questionRef === 0)?.klpResults?.[0]?.status === 'passed'
          const vacuous = grades.find((g) => g.questionRef === 1)?.klpResults?.[0]?.status === 'failed'
          ok = shaped && correct && vacuous
          if (!ok) {
            note = shaped
              ? `verdicts ${grades.map((g) => g.klpResults?.[0]?.status).join('/')}`
              : 'wrong shape'
          }
        } catch {
          note = 'unparseable'
        }
        results.push({ ok, ms, out, reasoning, note })
      } catch (err) {
        results.push({
          ok: false, ms: Date.now() - started, out: 0, reasoning: 0,
          note: (err as Error).message.slice(0, 80).replace(/\s+/g, ' '),
        })
      }
    }

    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
    const ms = results.map((r) => r.ms)
    const notes = [...new Set(results.filter((r) => r.note).map((r) => r.note))]
    console.log(
      `${cond.label}  ${results.filter((r) => r.ok).length}/${samples} pass  ` +
        `${(mean(ms) / 1000).toFixed(1)}s (${(Math.min(...ms) / 1000).toFixed(1)}-${(Math.max(...ms) / 1000).toFixed(1)})  ` +
        `out ${mean(results.map((r) => r.out)).toFixed(0)} ` +
        `(reasoning ${mean(results.map((r) => r.reasoning)).toFixed(0)})` +
        (notes.length ? `  — ${notes.join('; ')}` : ''),
    )
  }

  console.log('\nRead the pass column first. A faster or cheaper condition that')
  console.log('cannot separate a correct answer from "IDK" is not a saving.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
