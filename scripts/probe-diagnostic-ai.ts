import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import {
  DIAGNOSTIC_QUESTIONS_PROMPT,
  DIAGNOSTIC_GRADING_PROMPT,
} from '../src/lib/ai/prompts/diagnostic'
import {
  selectDiagnosticProbes,
  DIAGNOSTIC_BATCH_SIZE,
  DIAGNOSTIC_MAX_OUTPUT_TOKENS,
  batched,
} from '../src/lib/diagnostic/select'
import { buildAnalysisWrites } from '../src/lib/analysis/persist'
import { parseList } from '../src/lib/klp/direct-pool'

/**
 * A throwaway live probe of the diagnostic's AI half — does a real model
 * actually answer the v2 prompts in the shape the action requires?
 *
 * READ-ONLY against the database. It writes nothing.
 *
 * `--direct`-style: it uses a raw `GOOGLE_API_KEY` rather than a stored
 * `AiCredential`, because stored credentials are encrypted with
 * `GOOGLE_KEY_ENCRYPTION_SECRET`, which the local `.env` does not carry.
 *
 * DELIBERATELY SMALL — 4 questions, so 2 calls. The Google free tier is 20
 * requests per day per model per project, and that budget is spoken for by the
 * corpus re-authoring work. This probe answers one question and gets out:
 * does the model return exactly one entry per probeRef, and exactly one
 * klpResult per question, so `buildAnalysisWrites` has something to write?
 *
 * Usage: npx tsx --env-file=.env scripts/probe-diagnostic-ai.ts
 */

const PROBE_QUESTIONS = Number(process.env.PROBE_QUESTIONS ?? 4)

async function main() {
  const apiKey = parseList(process.env.GOOGLE_API_KEYS)[0] ?? process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('needs GOOGLE_API_KEY or GOOGLE_API_KEYS')
  const model = process.env.KLP_DIRECT_MODEL ?? 'gemini-3.6-flash'
  const google = createGoogle({ apiKey })
  console.log(`model: ${model}`)

  const set = await prisma.set.findFirst({
    where: { visibility: 'public' },
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  })
  if (!set) throw new Error('No public set to probe against')

  const klps = await prisma.cardKlp.findMany({
    where: { card: { setId: set.id }, supersededAt: null },
    orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
    select: {
      id: true, cardId: true, index: true, text: true, weight: true,
      card: { select: { term: true, definition: true } },
    },
    take: 40,
  })
  const probes = selectDiagnosticProbes({
    klps: klps.map((k) => ({ id: k.id, cardId: k.cardId, index: k.index, weight: k.weight })),
    states: [],
    count: PROBE_QUESTIONS,
  })
  const klpById = new Map(klps.map((k) => [k.id, k]))
  console.log(`set "${set.title}", ${probes.length} probes\n`)

  let failed = 0
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }

  // ---- Generation, BATCHED exactly as the action does it -----------------
  console.log('generation:')
  const questions: { question: string; expectedAnswer: string }[] = []
  let genOutputTokens = 0
  for (const batch of batched(probes, DIAGNOSTIC_BATCH_SIZE)) {
    const generated = await generateText({
      model: google(model),
      prompt: DIAGNOSTIC_QUESTIONS_PROMPT.build({
        setTitle: set.title,
        probes: batch.map((probe, probeRef) => {
          const klp = klpById.get(probe.klpId)!
          return {
            probeRef,
            kind: probe.kind,
            term: klp.card.term,
            definition: klp.card.definition,
            keyPoint: klp.text,
          }
        }),
      }),
      output: Output.object({ schema: DIAGNOSTIC_QUESTIONS_PROMPT.schema }),
      maxOutputTokens: DIAGNOSTIC_MAX_OUTPUT_TOKENS,
    })
    genOutputTokens += generated.usage?.outputTokens ?? 0
    const questionSet = generated.output
    const refs = questionSet.questions.map((q) => q.probeRef)
    check(`batch of ${batch.length}: one question per probe, refs exactly 0..${batch.length - 1}`,
      questionSet.questions.length === batch.length &&
        new Set(refs).size === refs.length &&
        batch.every((_, i) => refs.includes(i)),
      `got ${questionSet.questions.length}, refs ${JSON.stringify([...refs].sort())}`)
    for (let ref = 0; ref < batch.length; ref++) {
      const q = questionSet.questions.find((x) => x.probeRef === ref)!
      questions.push({ question: q.question, expectedAnswer: q.expectedAnswer })
    }
  }
  check('every probe produced a question', questions.length === probes.length,
    `${questions.length} of ${probes.length}`)
  console.log(`  generation output tokens: ${genOutputTokens}`)
  console.log(`\n  sample: "${questions[0]?.question}"`)
  console.log(`  key point it was built from: "${klpById.get(probes[0].klpId)!.text}"\n`)

  // ---- Grading, BATCHED, with one deliberately empty answer --------------
  console.log('grading:')
  // Global position -> grade, assembled from batch-local refs like the action.
  const grades = new Map<number, Awaited<ReturnType<typeof gradeBatch>>['grades'][number]>()
  let gradeOutputTokens = 0
  let maxGradeOutput = 0

  async function gradeBatch(indices: number[]) {
    const res = await generateText({
      model: google(model),
      prompt: DIAGNOSTIC_GRADING_PROMPT.build({
        questions: indices.map((globalIndex, ref) => ({
          ref,
          question: questions[globalIndex].question,
          expectedAnswer: questions[globalIndex].expectedAnswer,
          keyPoint: klpById.get(probes[globalIndex].klpId)!.text,
          // One good answer, one blank, the rest vague — enough to see whether
          // the verdicts actually differentiate.
          answer:
            globalIndex === 0 ? questions[globalIndex].expectedAnswer
              : globalIndex === 1 ? ''
              : 'I think it is about the numbers.',
        })),
      }),
      output: Output.object({ schema: DIAGNOSTIC_GRADING_PROMPT.schema }),
      maxOutputTokens: DIAGNOSTIC_MAX_OUTPUT_TOKENS,
    })
    const used = res.usage?.outputTokens ?? 0
    gradeOutputTokens += used
    maxGradeOutput = Math.max(maxGradeOutput, used)
    if (res.finishReason !== 'stop') console.log(`  finishReason: ${res.finishReason}`)
    return res.output
  }

  for (const batch of batched(probes.map((_, i) => i), DIAGNOSTIC_BATCH_SIZE)) {
    const gradeSet = await gradeBatch(batch)
    const refs = gradeSet.grades.map((g) => g.questionRef)
    check(`batch of ${batch.length}: one grade per question, refs exactly 0..${batch.length - 1}`,
      gradeSet.grades.length === batch.length &&
        new Set(refs).size === refs.length &&
        batch.every((_, i) => refs.includes(i)),
      `got ${gradeSet.grades.length}, refs ${JSON.stringify([...refs].sort())}`)
    batch.forEach((globalIndex, ref) => {
      const g = gradeSet.grades.find((x) => x.questionRef === ref)
      if (g) grades.set(globalIndex, g)
    })
  }

  const gradeSet = { grades: [...grades.entries()].sort((a, b) => a[0] - b[0]).map(([questionRef, g]) => ({ ...g, questionRef })) }

  check('every question graded', gradeSet.grades.length === probes.length,
    `${gradeSet.grades.length} of ${probes.length}`)
  check('every grade carries exactly one klpResult',
    gradeSet.grades.every((g) => (g.klpResults ?? []).length === 1),
    JSON.stringify(gradeSet.grades.map((g) => (g.klpResults ?? []).length)))
  check('every klpResult targets klpRef 0 — only the point that was asked',
    gradeSet.grades.every((g) => (g.klpResults ?? []).every((r) => r.klpRef === 0)))
  check('verdicts differentiate a correct answer from a blank one',
    gradeSet.grades[0]?.klpResults?.[0]?.status === 'passed' &&
      gradeSet.grades[1]?.klpResults?.[0]?.status === 'failed',
    `got ${gradeSet.grades[0]?.klpResults?.[0]?.status} / ${gradeSet.grades[1]?.klpResults?.[0]?.status}`)
  console.log(`  grading output tokens: ${gradeOutputTokens} total, ${maxGradeOutput} worst batch`)

  // ---- What buildAnalysisWrites would actually persist -------------------
  console.log('\nanalysis writes (computed in TypeScript, not by the model):')
  for (const grade of gradeSet.grades) {
    const klp = klpById.get(probes[grade.questionRef].klpId)!
    const writes = buildAnalysisWrites({
      mode: 'diagnostic',
      klps: [{ id: klp.id, weight: klp.weight }],
      starred: false,
      klpResults: grade.klpResults ?? [],
      errorTags: (grade.errorTags ?? []) as never,
      forcedStatus: (grade.klpResults ?? []).length === 0 ? 'no_provenance' : undefined,
    })
    const credit = writes.klpResults[0]?.credit
    console.log(
      `  q${grade.questionRef}: score ${grade.score}/10, status ${writes.status}, ` +
      `verdict ${writes.klpResults[0]?.status ?? '—'}, credit ${credit ?? '—'}, ` +
      `${writes.errorTags.length} tag(s)${writes.warnings.length ? `, warnings ${JSON.stringify(writes.warnings)}` : ''}`,
    )
  }

  const passedCredit = gradeSet.grades
    .flatMap((g) => buildAnalysisWrites({
      mode: 'diagnostic',
      klps: [{ id: 'x', weight: 3 }],
      starred: false,
      klpResults: g.klpResults ?? [],
      errorTags: [],
    }).klpResults)
    .find((r) => r.status === 'passed')
  console.log('')
  check('a passed diagnostic verdict is credited at 0.95, not the 0.75 fallback (G8)',
    passedCredit === undefined || Math.abs(passedCredit.credit - 0.95) < 1e-9,
    passedCredit ? `credit ${passedCredit.credit}` : 'no passed verdict in this run')

  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) FAILED.`)
    process.exit(1)
  }
  console.log('All AI-contract checks passed against a real model.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
