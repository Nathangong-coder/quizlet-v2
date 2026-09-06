import { prisma } from '../src/lib/db'

/**
 * `npm run verify:diagnostic -- <attemptId>` — did a real diagnostic actually
 * write the evidence it is supposed to write?
 *
 * READ-ONLY. It writes nothing and takes no AI call, so it is safe against
 * production and costs nothing to re-run.
 *
 * WHY THIS EXISTS AS ITS OWN COMMAND. The unit suite mocks Prisma, so it can
 * only prove the action CALLS the writer with the right arguments — it cannot
 * see a constraint Postgres rejects, a transaction that timed out halfway, or
 * a KlpState that silently never moved. That gap has produced a green suite
 * over a broken statement in this repo before. The gate on /diagnostic came off
 * only after this reported clean on a real run.
 *
 * The checks are equalities, not eyeballing: a count that is merely "about
 * right" is the shape of a bug that survives review.
 */

interface Check {
  label: string
  actual: number
  expected: number | ((n: number) => boolean)
  note?: string
}

async function main() {
  const attemptId = process.argv[2]
  if (!attemptId) {
    console.error('usage: npm run verify:diagnostic -- <attemptId>')
    process.exit(2)
  }

  const attempt = await prisma.diagnosticAttempt.findUnique({
    where: { id: attemptId },
    include: {
      set: { select: { title: true } },
      questions: { orderBy: { position: 'asc' } },
    },
  })
  if (!attempt) {
    console.error(`No DiagnosticAttempt ${attemptId}`)
    process.exit(2)
  }

  const questionCount = attempt.questions.length
  const anchoredIds = attempt.questions
    .map((q) => q.klpId)
    .filter((id): id is string => id !== null)
  const distinctAnchors = new Set(anchoredIds)

  const quizAttempt = await prisma.quizAttempt.findFirst({
    where: { sessionId: attempt.sessionId, mode: 'diagnostic' },
    select: { id: true },
  })

  const quizAnswers = quizAttempt
    ? await prisma.quizAnswer.findMany({
        where: { attemptId: quizAttempt.id },
        select: { id: true, mode: true, analysisStatus: true },
      })
    : []

  const klpResults = await prisma.answerKlpResult.count({
    where: { quizAnswerId: { in: quizAnswers.map((a) => a.id) } },
  })
  const errorTags = await prisma.answerErrorTag.count({
    where: { quizAnswerId: { in: quizAnswers.map((a) => a.id) } },
  })
  const studyEvents = await prisma.studyEvent.findMany({
    where: { sessionId: attempt.sessionId },
    select: { quizAnswerId: true, source: true },
  })
  const klpStates = await prisma.klpState.count({
    where: { userId: attempt.userId, klpId: { in: [...distinctAnchors] } },
  })

  const statusBreakdown = quizAnswers.reduce<Record<string, number>>((acc, a) => {
    const key = a.analysisStatus ?? 'null'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  console.log(`Attempt ${attempt.id} — "${attempt.set.title}"`)
  console.log(`  status ${attempt.status}, engineVersion ${attempt.engineVersion}, score ${attempt.score}`)
  console.log(`  analysisStatus breakdown: ${JSON.stringify(statusBreakdown)}`)
  console.log(`  distinct key points probed: ${distinctAnchors.size} (follow-ups re-ask, so this is <= questions)`)
  console.log('')

  const checks: Check[] = [
    { label: 'DiagnosticQuestion rows', actual: questionCount, expected: (n) => n > 0 },
    {
      label: 'questions with a klpId',
      actual: anchoredIds.length,
      expected: questionCount,
      note: 'an unanchored question can credit nothing',
    },
    {
      label: 'questions linked to a QuizAnswer',
      actual: attempt.questions.filter((q) => q.quizAnswerId !== null).length,
      expected: questionCount,
    },
    { label: 'sibling QuizAttempt', actual: quizAttempt ? 1 : 0, expected: 1 },
    { label: 'QuizAnswer rows', actual: quizAnswers.length, expected: questionCount },
    {
      label: "QuizAnswer rows in mode 'diagnostic'",
      actual: quizAnswers.filter((a) => a.mode === 'diagnostic').length,
      expected: questionCount,
    },
    {
      label: 'AnswerKlpResult rows',
      actual: klpResults,
      expected: questionCount,
      note: 'exactly one per question — only the key point it asked',
    },
    {
      label: 'KlpState rows for the probed key points',
      actual: klpStates,
      expected: distinctAnchors.size,
    },
    {
      label: "StudyEvent rows with source 'diagnostic'",
      actual: studyEvents.filter((e) => e.source === 'diagnostic').length,
      expected: questionCount,
    },
    {
      label: 'StudyEvent rows carrying quizAnswerId',
      actual: studyEvents.filter((e) => e.quizAnswerId !== null).length,
      expected: questionCount,
      note: 'without it the event outlives the answer it describes',
    },
  ]

  let failed = 0
  for (const check of checks) {
    const ok =
      typeof check.expected === 'function'
        ? check.expected(check.actual)
        : check.actual === check.expected
    const expectation = typeof check.expected === 'function' ? '(predicate)' : String(check.expected)
    console.log(
      `  ${ok ? 'OK  ' : 'FAIL'}  ${check.label}: ${check.actual}` +
        (ok ? '' : ` (expected ${expectation})`) +
        (check.note && !ok ? ` — ${check.note}` : ''),
    )
    if (!ok) failed++
  }

  console.log('')
  console.log(`  AnswerErrorTag rows: ${errorTags} (informational — a clean run legitimately has few)`)
  console.log('')

  if (failed > 0) {
    console.error(`${failed} check(s) FAILED. This is a finding, not a rounding error.`)
    process.exit(1)
  }
  console.log('All checks passed.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
