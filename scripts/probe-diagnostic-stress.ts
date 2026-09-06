import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import { prisma } from '../src/lib/db'
import {
  DIAGNOSTIC_REPORT_PROMPT,
  DIAGNOSTIC_GRADING_PROMPT,
} from '../src/lib/ai/prompts/diagnostic'
import {
  diagnosticOutputCap,
  diagnosticReportOutputCap,
  excerptForReport,
} from '../src/lib/diagnostic/grading'
import { parseList } from '../src/lib/klp/direct-pool'

/**
 * Stress probe for the two diagnostic calls that were never exercised live:
 * the end-of-run REPORT (which until now had no output ceiling at all, and is
 * the largest output the feature asks for) and a grading call carrying a
 * PATHOLOGICALLY LONG learner answer (the input schema permits 10,000
 * characters).
 *
 * Two AI calls. Read-only against the database.
 *
 * Usage: npx tsx --env-file=.env scripts/probe-diagnostic-stress.ts
 */

async function main() {
  const apiKey = parseList(process.env.GOOGLE_API_KEYS)[0] ?? process.env.GOOGLE_API_KEY
  if (!apiKey) throw new Error('needs GOOGLE_API_KEY or GOOGLE_API_KEYS')
  const model = process.env.KLP_DIRECT_MODEL ?? 'gemini-3.6-flash'
  const google = createGoogle({ apiKey })
  console.log(`model: ${model}\n`)

  let failed = 0
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }

  const klps = await prisma.cardKlp.findMany({
    where: { card: { set: { visibility: 'public' } }, supersededAt: null },
    select: { text: true },
    take: 12,
  })
  if (klps.length < 12) throw new Error('need 12 live key points')

  // ---- 1. The report, at full sitting size ------------------------------
  console.log('report call (12 results, the largest output the feature asks for):')
  const longAnswer = 'The income statement measures profitability over a period. '.repeat(200)
  const reportCap = diagnosticReportOutputCap(12)
  const report = await generateText({
    model: google(model),
    prompt: DIAGNOSTIC_REPORT_PROMPT.build({
      setTitle: 'Accounting - Talking',
      results: klps.map((klp, i) => ({
        question: `Question ${i} about the point below?`,
        keyPoint: klp.text,
        answer: excerptForReport(i % 3 === 0 ? longAnswer : 'A partial answer that misses the mechanism.'),
        score: (i % 10) + 1,
        status: i % 3 === 0 ? 'mastered' : 'missed',
        mistake: i % 3 === 0 ? undefined : 'Missed the mechanism.',
      })),
    }),
    output: Output.object({ schema: DIAGNOSTIC_REPORT_PROMPT.schema }),
    maxOutputTokens: reportCap,
  })
  console.log(`  cap ${reportCap}, finishReason ${report.finishReason}, usage ${JSON.stringify(report.usage)}`)
  check('report finished inside its ceiling', report.finishReason === 'stop')
  try {
    const value = report.output
    check('report parsed', true)
    check('report has recommendations', value.recommendations.length > 0,
      `${value.recommendations.length}`)
    console.log(`  overview: "${value.overview.slice(0, 120)}..."`)
  } catch (err) {
    check('report parsed', false, (err as Error).name)
  }

  // ---- 2. Grading a pathologically long answer --------------------------
  console.log('\ngrading call with a 10,000-character answer (the input schema maximum):')
  const cap = diagnosticOutputCap(1)
  const huge = 'Net income flows into the cash flow statement and retained earnings. '.repeat(150).slice(0, 10_000)
  const graded = await generateText({
    model: google(model),
    prompt: DIAGNOSTIC_GRADING_PROMPT.build({
      questions: [{
        ref: 0,
        question: 'Where does Net Income flow?',
        expectedAnswer: 'Into the cash flow statement and retained earnings.',
        keyPoint: klps[0].text,
        answer: huge,
      }],
    }),
    output: Output.object({ schema: DIAGNOSTIC_GRADING_PROMPT.schema }),
    maxOutputTokens: cap,
  })
  console.log(`  cap ${cap}, finishReason ${graded.finishReason}, usage ${JSON.stringify(graded.usage)}`)
  check('long-answer grading finished inside its ceiling', graded.finishReason === 'stop')
  try {
    const value = graded.output
    check('long-answer grading parsed', true)
    check('returned exactly one grade', value.grades.length === 1)
    check('feedback stayed within its truncation limit',
      (value.grades[0]?.feedback.length ?? 0) <= 1200,
      `${value.grades[0]?.feedback.length} chars`)
  } catch (err) {
    check('long-answer grading parsed', false, (err as Error).name)
  }

  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) FAILED.`)
    process.exit(1)
  }
  console.log('All stress checks passed.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
