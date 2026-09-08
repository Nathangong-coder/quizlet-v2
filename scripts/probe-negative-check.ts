import { readFileSync } from 'node:fs'
import { generateText, Output } from 'ai'
import { resolveLanguageModel, type ProviderId } from '../src/lib/ai/providers'
import { prisma } from '../src/lib/db'
import { GRADE_SHORT_ANSWER_PROMPT } from '../src/lib/ai/prompts/grade-short-answer'
import { buildAnalysisWrites } from '../src/lib/analysis/persist'
import { contaminationFactor, isContaminated } from '../src/lib/errors/contamination'
import { klpCredit } from '../src/lib/errors/klp-credit'
import { readDirectPool, nextCombo, markTried } from '../src/lib/klp/direct-pool'
import { Pacer, callWithPacingAndRetry, realClock, rpmToIntervalMs } from '../src/lib/klp/authoring-pacing'
import type { KlpStatus } from '../src/lib/errors/klp-credit'
import type { Card } from '@prisma/client'

/**
 * `npm run probe-negative-check` — does the negative check actually catch a
 * contaminated answer?
 *
 * ## Why this probe and not a unit test
 *
 * `tests/errors/contamination.test.ts` proves the ARITHMETIC: given a
 * whole-answer accuracy tag, credit is docked. It cannot prove the thing that
 * actually matters, which is whether a real grader EMITS that tag on a real
 * contaminated answer. A dock for a tag no model ever produces is a dock that
 * never happens — and this project has shipped exactly that failure before, when
 * the grading prompt did not name the closed error vocabulary and every tag a
 * real model returned was silently dropped while the unit tests passed on a
 * hand-written type no model produces.
 *
 * ## The test set is real, and it was expensive
 *
 * `npm run klp-exploit` already produced labelled contaminated answers: text
 * written to satisfy every key point on a card while asserting something false,
 * with an independent grader confirming the key points accepted it. That is a
 * ready-made adversarial set for exactly this check, and it costs nothing more
 * to reuse. It is read from the run's JSON output.
 *
 * A pass is: the grader tags the answer at whole-answer scope with an accuracy
 * type, so `contaminationFactor` drops below 1 and credit is docked. A fail is
 * an answer the exploit test says is contaminated and the grader waves through.
 *
 * **The model used here should NOT be the one that wrote the exploits.** A model
 * asked to find fault with its own adversarial text is grading its own work, and
 * the run prints which model it used so that is visible rather than assumed.
 */

function opt(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface ExploitRun {
  results: {
    cardId: string
    term: string
    attempts: { strategy: string; outcome: string; answer: string; rationale: string }[]
  }[]
}

async function main() {
  const file = opt('--in') ?? 'docs/ai/klp-exploit-judged.json'
  const run = JSON.parse(readFileSync(file, 'utf-8')) as ExploitRun

  // Contamination exploits only, and only those with real answer text. A
  // `refuted` one is still useful: the key points caught it, but the question
  // here is whether the GRADER independently notices the falsehood.
  const cases = run.results.flatMap((r) =>
    r.attempts
      .filter(
        (a) =>
          a.strategy === 'contamination' &&
          (a.outcome === 'confirmed' || a.outcome === 'refuted' || a.outcome === 'judged_fine') &&
          a.answer.trim().length > 0,
      )
      .map((a) => ({ cardId: r.cardId, term: r.term, outcome: a.outcome, answer: a.answer, why: a.rationale })),
  )

  if (cases.length === 0) {
    console.log(`[probe] no contamination exploits with answer text in ${file}`)
    return
  }

  const pool = readDirectPool()
  const combo = nextCombo(pool)
  if (!combo) throw new Error('no usable key x model combo')
  markTried(combo, new Date())
  const model = resolveLanguageModel({
    provider: combo.provider as ProviderId,
    apiKey: combo.apiKey,
    model: combo.model,
  })
  const pacer = new Pacer(rpmToIntervalMs(30), realClock)

  console.log(`[probe] ${cases.length} contaminated answer(s) from ${file}`)
  console.log(`[probe] grading model: ${combo.model} — must NOT be the model that wrote them\n`)

  let caught = 0
  let missed = 0

  for (const c of cases) {
    const card = await prisma.card.findUnique({
      where: { id: c.cardId },
      select: { term: true, definition: true },
    })
    const klps = await prisma.cardKlp.findMany({
      where: { cardId: c.cardId, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, text: true, kind: true, weight: true },
    })
    if (!card || klps.length === 0) continue

    const grade = await callWithPacingAndRetry(
      async () => {
        const res = await generateText({
          model,
          prompt: GRADE_SHORT_ANSWER_PROMPT.build({
            card: { term: card.term, definition: card.definition } as Card,
            answer: c.answer,
            klps: klps.map((k, i) => ({ ref: i, text: k.text, kind: k.kind })),
          }),
          output: Output.object({ schema: GRADE_SHORT_ANSWER_PROMPT.schema }),
          maxRetries: 0,
          maxOutputTokens: 16384,
        })
        return res.output
      },
      { pacer, clock: realClock },
    )

    // Through the REAL write path, so the probe measures what would actually be
    // persisted — vocabulary validation, severity bands, the per-dimension cap
    // and the factor — not a hand-assembled approximation of it.
    const writes = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
      starred: false,
      klpResults: (grade.klpResults ?? []) as { klpRef: number; status: KlpStatus }[],
      errorTags: grade.errorTags ?? [],
    })

    const factor = contaminationFactor(writes.errorTags)
    const hit = isContaminated(writes.errorTags)
    if (hit) caught += 1
    else missed += 1

    const wholeAnswerTags = writes.errorTags.filter((t) => t.klpId === null)
    console.log(
      `${hit ? 'CAUGHT ' : 'MISSED '} [${c.outcome}] factor ${factor.toFixed(2)} — ` +
        `credit ${klpCredit('passed', 'quiz-sa').toFixed(2)} -> ` +
        `${klpCredit('passed', 'quiz-sa', factor).toFixed(2)}  ${c.term.slice(0, 52)}`,
    )
    console.log(
      `         whole-answer tags: ` +
        `${wholeAnswerTags.map((t) => `${t.dimension}/${t.type}@sev${t.severity}`).join(', ') || 'none'}`,
    )
    if (!hit) console.log(`         the exploit claimed: ${c.why.slice(0, 150)}`)
  }

  const total = caught + missed
  console.log()
  console.log(
    `[probe] caught ${caught}/${total} (${total ? ((caught / total) * 100).toFixed(0) : 0}%), ` +
      `missed ${missed}. A MISS is an answer the exploit test says asserts something false and ` +
      `the grader waved through at full credit.`,
  )
}

main()
  .catch((err) => {
    console.error('[probe] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
