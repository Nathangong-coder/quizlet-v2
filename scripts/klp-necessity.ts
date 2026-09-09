import { generateText, Output } from 'ai'
import type { z } from 'zod'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Card } from '@prisma/client'
import { prisma } from '../src/lib/db'
import { generateJson } from '../src/lib/ai/generate'
import { resolveLanguageModel, type ProviderId } from '../src/lib/ai/providers'
import { OMIT_KLP_PROMPT } from '../src/lib/ai/prompts/omit-klp'
import { GRADE_SHORT_ANSWER_PROMPT } from '../src/lib/ai/prompts/grade-short-answer'
import {
  necessityOrder,
  atFloor,
  summarizeNecessity,
  formatNecessityReport,
  NECESSITY_FLOOR,
  type NecessityCandidate,
  type NecessityResult,
} from '../src/lib/klp/necessity'
import { SMOKE_REFERENCE_FLOOR } from '../src/lib/klp/smoke'
import { readDirectPool, nextCombo, markTried, poolStatus } from '../src/lib/klp/direct-pool'
import { Pacer, callWithPacingAndRetry, realClock, rpmToIntervalMs, DEFAULT_RPM } from '../src/lib/klp/authoring-pacing'

/**
 * `npm run klp-necessity` — C4, the last unbuilt hygiene check.
 *
 * READ-ONLY. It deletes nothing. Removing a key point supersedes it, which
 * detaches learner evidence, and "this detail is optional" is a judgment about
 * what a card is for.
 *
 * ## Two calls per candidate, and the second is the verdict
 *
 * 1. **Construct** (`OMIT_KLP_PROMPT`): write the best answer covering the
 *    remaining points while saying nothing about this one.
 * 2. **Judge** (`GRADE_SHORT_ANSWER_PROMPT` with NO key points — the app's own
 *    grader): is that answer good?
 *
 * If the grader likes it, the omitted point was an optional detail. If the
 * answer is visibly worse without it, the point is load-bearing. The verdict
 * comes from a blind judge rather than from the model that wrote the answer —
 * the same discipline C1 uses, because a model asked whether a point matters
 * says yes.
 *
 * ## Greedy-sequential (R2)
 *
 * Each candidate is judged against the set AS REDUCED SO FAR, weakest first.
 * Batch-asking deletes both halves of a two-point idea: each looks optional
 * while the other is still present.
 *
 * Flags:
 *   --set <setId> · --card <cardId> · --limit <n> (cards, default 5)
 *   --direct · --rpm <n> · --out <path>
 */

function flag(args: string[], name: string): boolean {
  return args.includes(name)
}
function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const MAX_OUTPUT_TOKENS = 8192

async function main() {
  const args = process.argv.slice(2)
  const setId = opt(args, '--set')
  const cardId = opt(args, '--card')
  const direct = flag(args, '--direct')
  const limit = Number.parseInt(opt(args, '--limit') ?? '5', 10)
  const rpm = Number.parseInt(opt(args, '--rpm') ?? String(DEFAULT_RPM), 10)
  const outPath = opt(args, '--out') ?? 'docs/ai/klp-necessity-run.json'

  const cards = await prisma.card.findMany({
    where: {
      ...(cardId ? { id: cardId } : {}),
      ...(setId ? { setId } : {}),
      klps: { some: { supersededAt: null } },
    },
    orderBy: { id: 'asc' },
    take: limit,
    select: {
      id: true,
      term: true,
      definition: true,
      klps: {
        where: { supersededAt: null },
        orderBy: { index: 'asc' },
        select: { index: true, text: true, weight: true },
      },
    },
  })

  const pacer = new Pacer(rpmToIntervalMs(rpm), realClock)
  const pool = direct ? readDirectPool() : []
  let ownerId: string | undefined
  if (direct) {
    console.log(`[klp-necessity] --direct: ${poolStatus(pool).modelsLeft.join(', ')}`)
  } else {
    const owner = await prisma.set.findFirst({
      where: setId ? { id: setId } : { cards: { some: { id: cards[0]?.id } } },
      select: { userId: true },
    })
    ownerId = owner?.userId
    if (!ownerId) {
      console.error('[klp-necessity] could not resolve a credential owner; use --direct')
      process.exitCode = 1
      return
    }
  }

  async function call<T>(prompt: string, schema: z.ZodTypeAny): Promise<T> {
    if (!direct) {
      return generateJson({
        userId: ownerId!,
        task: 'author',
        prompt,
        schema: schema as z.ZodSchema<T>,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      })
    }
    const combo = nextCombo(pool)
    if (!combo) throw new Error('every key x model combo is out of daily quota')
    markTried(combo, new Date())
    const model = resolveLanguageModel({
      provider: combo.provider as ProviderId,
      apiKey: combo.apiKey,
      model: combo.model,
    })
    return callWithPacingAndRetry(
      async () => {
        const res = await generateText({
          model,
          prompt,
          output: Output.object({ schema }),
          maxRetries: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        })
        return res.output as T
      },
      { pacer, clock: realClock },
    )
  }

  const all: { cardId: string; term: string; results: NecessityResult[]; starting: number }[] = []

  for (const card of cards) {
    if (card.klps.length <= NECESSITY_FLOOR) {
      console.log(
        `${card.term.slice(0, 60)} — ${card.klps.length} points, already at or below the floor ` +
          `(${NECESSITY_FLOOR}); nothing to test`,
      )
      continue
    }

    const candidates: NecessityCandidate[] = card.klps.map((k) => ({
      index: k.index,
      text: k.text,
      weight: k.weight,
    }))

    // THE GREEDY STATE: which points are still standing. A point judged
    // unnecessary leaves this set immediately, so every later candidate is
    // tested against the reduced card — R2.
    const surviving = new Set(candidates.map((c) => c.index))
    const results: NecessityResult[] = []

    console.log(`\n=== ${card.term.slice(0, 70)} (${candidates.length} points)`)

    for (const c of necessityOrder(candidates)) {
      if (atFloor(surviving.size)) {
        results.push({
          index: c.index,
          text: c.text,
          verdict: 'unexamined',
          answerWithout: '',
          judgeOverall: null,
          reason: `the set is at the floor of ${NECESSITY_FLOOR}; reducing further would break the card`,
        })
        continue
      }

      const keep = candidates.filter((k) => surviving.has(k.index) && k.index !== c.index)

      try {
        const written = await call<{ answer: string; impossible: boolean; note: string }>(
          OMIT_KLP_PROMPT.build({ question: card.term, keep, omit: c.text }),
          OMIT_KLP_PROMPT.schema,
        )

        if (written.impossible || written.answer.trim().length === 0) {
          // Every route to the question runs through this point. Necessary, and
          // demonstrated more strongly than by any grade.
          results.push({
            index: c.index,
            text: c.text,
            verdict: 'necessary',
            answerWithout: '',
            judgeOverall: null,
            reason: `no coherent answer avoids it: ${written.note.slice(0, 160)}`,
          })
          continue
        }

        const grade = await call<{ overall: number }>(
          GRADE_SHORT_ANSWER_PROMPT.build({
            card: { term: card.term, definition: card.definition } as Card,
            answer: written.answer,
          }),
          GRADE_SHORT_ANSWER_PROMPT.schema,
        )

        // The BLIND judge decides, not the model that wrote the answer. Reusing
        // the smoke test's reference floor deliberately: "an acceptable answer"
        // should mean the same thing in both checks.
        const unnecessary = grade.overall >= SMOKE_REFERENCE_FLOOR * 10
        if (unnecessary) surviving.delete(c.index)

        results.push({
          index: c.index,
          text: c.text,
          verdict: unnecessary ? 'unnecessary' : 'necessary',
          answerWithout: written.answer,
          judgeOverall: grade.overall,
          reason: unnecessary
            ? `an answer omitting it still scored ${grade.overall}/10`
            : `omitting it dropped the answer to ${grade.overall}/10`,
        })
        console.log(
          `  [${c.index}] w${c.weight} ${unnecessary ? 'UNNECESSARY' : 'necessary  '} ` +
            `(judge ${grade.overall}/10) — ${c.text.slice(0, 66)}`,
        )
      } catch (err) {
        // A failed probe is NOT a verdict, and specifically not `unnecessary` —
        // that is the outcome that proposes a deletion.
        results.push({
          index: c.index,
          text: c.text,
          verdict: 'unexamined',
          answerWithout: '',
          judgeOverall: null,
          reason: `probe failed: ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }

    all.push({ cardId: card.id, term: card.term, results, starting: candidates.length })
    console.log(formatNecessityReport(summarizeNecessity(results, candidates.length)))
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify({ runAt: new Date().toISOString(), cards: all }, null, 2), 'utf-8')
  console.log(`\n[klp-necessity] full report written to ${outPath}`)
}

main()
  .catch((err) => {
    console.error('[klp-necessity] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
