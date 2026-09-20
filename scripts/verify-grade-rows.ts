import { prisma } from '../src/lib/db'
import { KLP_STATUSES } from '../src/lib/errors/klp-credit'
import { ANALYSIS_VERSION } from '../src/lib/analysis/persist'
import { GRADER_VERSION } from '../src/lib/analysis/version'

/**
 * `npm run verify:grade-rows -- <attemptId>` — did a real short-answer quiz
 * write the rows Spec 5 Phase A says it writes?
 *
 * READ-ONLY. It writes nothing and takes no AI call. The shape of
 * `verify-diagnostic.ts`: the unit suite mocks Prisma, so it can prove the
 * action CALLS the writer with the right arguments but cannot see a statement
 * Postgres rejects or a KlpState that never moved. This is the row check the
 * queue's "one real short-answer quiz on the LBO set" item owes.
 *
 * For every short-answer `QuizAnswer` of the attempt it prints, and checks:
 *   - `analysisVersion` === ANALYSIS_VERSION (4) and `graderVersion` === GRADER_VERSION;
 *   - every LIVE `AnswerKlpResult.status` is in `KLP_STATUSES` and none is `passed`
 *     (no row says `passed` from v4 on);
 *   - `spanStart` is non-null on every live non-`correct` key-point row
 *     (a `correct` verdict carries no quote by the shared block's rule);
 *   - every live `AnswerRelationResult` carries `provenance 'passive'`
 *     (Spec 3's active probes do not exist yet);
 *   - `KlpState.pKnown` is finite for every key point the attempt touched.
 *
 * Exit 1 on any FAIL, 2 on usage / unknown attempt.
 */

async function main() {
  const attemptId = process.argv[2]
  if (!attemptId) {
    console.error('usage: npm run verify:grade-rows -- <attemptId>')
    process.exit(2)
  }

  const attempt = await prisma.quizAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, userId: true, mode: true, set: { select: { title: true } } },
  })
  if (!attempt) {
    console.error(`No QuizAttempt ${attemptId}`)
    process.exit(2)
  }

  const answers = await prisma.quizAnswer.findMany({
    where: { attemptId, mode: 'short-answer' },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      cardId: true,
      answer: true,
      analysisStatus: true,
      analysisVersion: true,
      graderVersion: true,
      klpResults: {
        where: { supersededAt: null },
        select: { klpId: true, status: true, credit: true, spanStart: true, spanEnd: true },
      },
      relationResults: {
        where: { supersededAt: null },
        select: { relationId: true, status: true, provenance: true, spanStart: true },
      },
      formResults: {
        where: { supersededAt: null },
        select: { formRequirementId: true, status: true, spanStart: true },
      },
      unwarranted: {
        where: { supersededAt: null },
        select: { id: true, magnitude: true, spanStart: true },
      },
    },
  })

  console.log(`attempt ${attempt.id} (${attempt.mode}) on "${attempt.set.title}" — ${answers.length} short-answer answer(s)`)
  if (answers.length === 0) {
    console.error('No short-answer answers on this attempt — nothing to check.')
    process.exit(2)
  }

  let failed = 0
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failed++
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  }
  const statusSet = new Set<string>(KLP_STATUSES)
  const touchedKlpIds = new Set<string>()

  for (const a of answers) {
    console.log(`\nanswer ${a.id} (card ${a.cardId}) analysisStatus ${a.analysisStatus ?? '—'}: ${JSON.stringify((a.answer ?? '').slice(0, 80))}`)
    check(`analysisVersion is ${ANALYSIS_VERSION}`, a.analysisVersion === ANALYSIS_VERSION, `got ${a.analysisVersion ?? 'null'}`)
    check(`graderVersion is ${GRADER_VERSION}`, a.graderVersion === GRADER_VERSION, `got ${a.graderVersion ?? 'null'}`)

    const rows = a.klpResults
    console.log(`  live key-point rows: ${rows.map((r) => `${r.status}(${r.credit}${r.spanStart !== null ? `@${r.spanStart}-${r.spanEnd}` : ''})`).join(' ') || 'none'}`)
    check('at least one live key-point row', rows.length > 0)
    const outOfVocab = rows.filter((r) => !statusSet.has(r.status))
    check('every live status is in KLP_STATUSES', outOfVocab.length === 0, outOfVocab.map((r) => r.status).join(', ') || undefined)
    check('no live row says `passed`', rows.every((r) => r.status !== 'passed'))
    const nonCorrect = rows.filter((r) => r.status !== 'correct' && r.status !== 'passed')
    const unspanned = nonCorrect.filter((r) => r.spanStart === null)
    check(`spanStart set on every non-correct row (${nonCorrect.length - unspanned.length}/${nonCorrect.length})`,
      unspanned.length === 0,
      unspanned.map((r) => `${r.status} ${r.klpId}`).join(', ') || undefined)
    for (const r of rows) touchedKlpIds.add(r.klpId)

    console.log(`  live relation rows: ${a.relationResults.map((r) => `${r.status}/${r.provenance}`).join(' ') || 'none'}`)
    check('every live relation row is provenance `passive`', a.relationResults.every((r) => r.provenance === 'passive'),
      a.relationResults.filter((r) => r.provenance !== 'passive').map((r) => r.provenance).join(', ') || undefined)
    console.log(`  live form rows: ${a.formResults.map((r) => r.status).join(' ') || 'none'}; unwarranted claims: ${a.unwarranted.length}`)
  }

  const states = await prisma.klpState.findMany({
    where: { userId: attempt.userId, klpId: { in: [...touchedKlpIds] } },
    select: { klpId: true, pKnown: true },
  })
  const byKlp = new Map(states.map((s) => [s.klpId, s.pKnown]))
  const missing = [...touchedKlpIds].filter((id) => !byKlp.has(id))
  const nonFinite = states.filter((s) => !Number.isFinite(s.pKnown))
  console.log(`\nKlpState for ${touchedKlpIds.size} touched key point(s): ${states.map((s) => s.pKnown.toFixed(3)).join(' ') || 'none'}`)
  check('a KlpState row exists for every touched key point', missing.length === 0, missing.length ? `${missing.length} missing` : undefined)
  check('every pKnown is finite', nonFinite.length === 0, nonFinite.map((s) => `${s.klpId}=${s.pKnown}`).join(', ') || undefined)

  console.log('')
  if (failed > 0) {
    console.error(`${failed} check(s) FAILED.`)
    process.exit(1)
  }
  console.log('All Spec 5 Phase A row checks passed on a real attempt.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
