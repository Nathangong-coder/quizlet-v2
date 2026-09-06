import { prisma } from '../src/lib/db'
import { buildAnalysisWrites } from '../src/lib/analysis/persist'
import { createAnswerWithAnalysis, DIAGNOSTIC_TX_OPTIONS } from '../src/lib/analysis/write-answer'
import { recordStudyEvent } from '../src/lib/memory/record'
import { selectDiagnosticProbes } from '../src/lib/diagnostic/select'

/**
 * A throwaway live probe of the diagnostic WRITE path — the half no mocked test
 * can reach.
 *
 * The unit suite fakes Prisma, so it proves the action calls the writer with
 * the right arguments and nothing more. It cannot see a statement Postgres
 * rejects, a foreign key that does not hold, a unique index that fires, or an
 * advisory lock that fails to deserialize. That last one is not hypothetical:
 * `$queryRaw` on a void-returning `pg_advisory_xact_lock` took down quiz
 * submission here for three days behind a fully green suite.
 *
 * So this drives the real statements against the real database with the AI
 * stubbed out — no generation call, no quota spent — then DELETES everything
 * it created. It is a gate, not a fixture: nothing it writes is meant to
 * survive, and it refuses to run against a user who owns real study data.
 *
 * Usage: npx tsx --env-file=.env scripts/probe-diagnostic-writes.ts
 */

const PROBE_QUESTIONS = 6

async function main() {
  // A set anyone can read, with enough live key points to select from.
  const set = await prisma.set.findFirst({
    where: { visibility: 'public' },
    select: { id: true, title: true, userId: true },
    orderBy: { title: 'asc' },
  })
  if (!set) throw new Error('No public set to probe against')

  const klps = await prisma.cardKlp.findMany({
    where: { card: { setId: set.id }, supersededAt: null },
    orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
    select: { id: true, cardId: true, index: true, text: true, weight: true },
    take: 60,
  })
  if (klps.length < PROBE_QUESTIONS) throw new Error(`Only ${klps.length} live key points on "${set.title}"`)

  // A throwaway user, created and destroyed by this script. Never a real one:
  // this writes StudyEvent and KlpState rows, which are somebody's learner
  // model, and a probe must not move it.
  const user = await prisma.user.create({
    data: {
      email: `probe-${Date.now()}@localhost.invalid`,
      name: 'diagnostic write probe',
    },
    select: { id: true },
  })
  console.log(`probe user ${user.id}`)

  let failed = 0
  try {
    const probes = selectDiagnosticProbes({
      klps: klps.map((k) => ({ id: k.id, cardId: k.cardId, index: k.index, weight: k.weight })),
      states: [],
      count: PROBE_QUESTIONS,
    })
    console.log(`selected ${probes.length} probes across ${new Set(probes.map((p) => p.cardId)).size} cards`)

    const klpById = new Map(klps.map((k) => [k.id, k]))

    const created = await prisma.$transaction(async (tx) => {
      const studySession = await tx.studySession.create({
        data: { userId: user.id, setId: set.id, kind: 'diagnostic', itemCount: probes.length },
      })
      const quizAttempt = await tx.quizAttempt.create({
        data: {
          userId: user.id, setId: set.id, mode: 'diagnostic',
          sessionId: studySession.id, questionCount: probes.length,
        },
      })
      const attempt = await tx.diagnosticAttempt.create({
        data: {
          userId: user.id, setId: set.id, sessionId: studySession.id,
          questionCount: probes.length, engineVersion: 2,
          questions: {
            create: probes.map((probe, position) => ({
              cardId: probe.cardId,
              klpId: probe.klpId,
              position,
              kind: probe.kind,
              learningPoint: klpById.get(probe.klpId)!.text,
              prompt: `Probe question ${position}`,
              expectedAnswer: `Probe expected answer ${position}`,
            })),
          },
        },
        include: { questions: { orderBy: { position: 'asc' } } },
      })
      return { studySession, quizAttempt, attempt }
    })

    // The write path itself, exactly as submitDiagnosticTest drives it: one
    // transaction for the whole sitting, one createAnswerWithAnalysis and one
    // recordStudyEvent per question, sharing the caller's tx.
    const startedAt = Date.now()
    await prisma.$transaction(async (tx) => {
      for (const question of created.attempt.questions) {
        const klp = klpById.get(question.klpId!)!
        const writes = buildAnalysisWrites({
          mode: 'diagnostic',
          klps: [{ id: klp.id, weight: klp.weight }],
          starred: false,
          klpResults: [{ klpRef: 0, status: question.position === 0 ? 'failed' : 'passed' }],
          errorTags: question.position === 0
            ? [{ dimension: 'accuracy', type: 'omission', klpRef: 0, magnitude: 6 }]
            : [],
        })

        const answer = await createAnswerWithAnalysis(
          {
            attemptId: created.quizAttempt.id,
            userId: user.id,
            cardId: question.cardId,
            mode: 'diagnostic',
            prompt: question.prompt,
            answer: 'probe answer',
            correctAnswer: question.expectedAnswer,
            score: question.position === 0 ? 40 : 90,
            isCorrect: question.position !== 0,
            feedback: 'probe feedback',
          },
          writes,
          undefined,
          tx,
        )

        await tx.diagnosticQuestion.update({
          where: { id: question.id },
          data: { answer: 'probe answer', score: 9, status: 'mastered', quizAnswerId: answer.id },
        })

        await recordStudyEvent({
          userId: user.id,
          cardId: question.cardId,
          source: 'diagnostic',
          sessionId: created.studySession.id,
          quizAnswerId: answer.id,
          outcome: { overall: question.position === 0 ? 4 : 9 },
        }, tx)
      }
      await tx.diagnosticAttempt.update({
        where: { id: created.attempt.id },
        data: { status: 'completed', score: 83, completedAt: new Date() },
      })
    }, DIAGNOSTIC_TX_OPTIONS)
    const elapsed = Date.now() - startedAt

    const answers = await prisma.quizAnswer.count({ where: { attemptId: created.quizAttempt.id } })
    const results = await prisma.answerKlpResult.count({
      where: { quizAnswer: { attemptId: created.quizAttempt.id } },
    })
    const tags = await prisma.answerErrorTag.count({
      where: { quizAnswer: { attemptId: created.quizAttempt.id } },
    })
    const states = await prisma.klpState.count({ where: { userId: user.id } })
    const events = await prisma.studyEvent.findMany({
      where: { userId: user.id },
      select: { quizAnswerId: true },
    })
    const linkedQuestions = await prisma.diagnosticQuestion.count({
      where: { attemptId: created.attempt.id, quizAnswerId: { not: null } },
    })
    const distinctKlps = new Set(probes.map((p) => p.klpId)).size

    const checks: Array<[string, number, number]> = [
      ['QuizAnswer rows', answers, probes.length],
      ['AnswerKlpResult rows', results, probes.length],
      ['AnswerErrorTag rows', tags, 1],
      ['KlpState rows', states, distinctKlps],
      ['StudyEvent rows', events.length, probes.length],
      ['StudyEvent rows linked to an answer', events.filter((e) => e.quizAnswerId).length, probes.length],
      ['DiagnosticQuestion rows linked to an answer', linkedQuestions, probes.length],
    ]

    console.log('')
    for (const [label, actual, expected] of checks) {
      const ok = actual === expected
      if (!ok) failed++
      console.log(`  ${ok ? 'OK  ' : 'FAIL'}  ${label}: ${actual}${ok ? '' : ` (expected ${expected})`}`)
    }
    console.log('')
    console.log(`  sitting transaction: ${elapsed}ms (ceiling ${DIAGNOSTIC_TX_OPTIONS.timeout}ms)`)
    if (elapsed > DIAGNOSTIC_TX_OPTIONS.timeout / 2) {
      console.log('  WARNING: over half the transaction ceiling for a short run.')
    }
  } finally {
    // Cascades take the session, both attempts, every answer, every analysis
    // row, KlpState and CardProgress with it.
    await prisma.user.delete({ where: { id: user.id } })
    console.log('probe user deleted')
  }

  if (failed > 0) {
    console.error(`${failed} check(s) FAILED.`)
    process.exit(1)
  }
  console.log('All write-path checks passed against the live database.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
