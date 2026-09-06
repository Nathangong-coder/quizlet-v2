'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { generateJson, AiGenerationError } from '@/lib/ai/generate'
import {
  DiagnosticGradeSetSchema,
  DiagnosticQuestionSetSchema,
  DiagnosticReportSchema,
  type DiagnosticGradeSet,
  type DiagnosticReport,
} from '@/lib/ai/schemas'
import {
  DIAGNOSTIC_GRADING_PROMPT,
  DIAGNOSTIC_QUESTIONS_PROMPT,
  DIAGNOSTIC_REPORT_PROMPT,
} from '@/lib/ai/prompts/registry'
import { readableSetWhere } from '@/lib/sets/visibility'
import { recordStudyEvent } from '@/lib/memory/record'
import { normalizeLatency } from '@/lib/memory/latency'
import {
  selectDiagnosticProbes,
  MIN_DIAGNOSTIC_KLPS,
  DIAGNOSTIC_BATCH_SIZE,
  DIAGNOSTIC_MAX_OUTPUT_TOKENS,
  batched,
} from '@/lib/diagnostic/select'
import { buildAnalysisWrites, type ErrorTagDraft } from '@/lib/analysis/persist'
import { createAnswerWithAnalysis, DIAGNOSTIC_TX_OPTIONS } from '@/lib/analysis/write-answer'
import type { ActionResult } from '@/types/action'

const DiagnosticStartSchema = z.object({
  setId: z.string().trim().min(1).max(80),
  questionCount: z.number().int().min(12).max(30),
})

const DiagnosticAnswerSchema = z.object({
  questionId: z.string().trim().min(1).max(80),
  answer: z.string().max(10000),
  latencyMs: z.number().int().min(0).max(60 * 60 * 1000).optional(),
})

const DiagnosticSubmitSchema = z.object({
  attemptId: z.string().trim().min(1).max(80),
  answers: z.array(DiagnosticAnswerSchema).max(40),
})

type DiagnosticStartInput = z.input<typeof DiagnosticStartSchema>
type DiagnosticSubmitInput = z.input<typeof DiagnosticSubmitSchema>

export interface DiagnosticSetOption {
  id: string
  title: string
  cardCount: number
}

export interface DiagnosticQuestionView {
  id: string
  position: number
  kind: 'core' | 'follow-up'
  prompt: string
}

export interface DiagnosticResultQuestion extends DiagnosticQuestionView {
  learningPoint: string
  answer: string
  score: number
  status: 'mastered' | 'partial' | 'missed'
  feedback: string
  mistake: string | null
}

export interface DiagnosticResult {
  attemptId: string
  setTitle: string
  score: number
  /**
   * 1 = ran before questions were anchored to key points. The results view
   * uses it to say so rather than letting the reader assume the run moved
   * their key-point mastery when it did not.
   */
  engineVersion: number
  report: DiagnosticReport
  questions: DiagnosticResultQuestion[]
}

export interface DiagnosticHistoryItem {
  id: string
  setTitle: string
  score: number | null
  questionCount: number
  engineVersion: number
  completedAt: Date
}

function invalidInput(error: z.ZodError) {
  return { success: false as const, error: error.issues[0]?.message ?? 'Please check the form' }
}

function statusForScore(score: number): 'mastered' | 'partial' | 'missed' {
  if (score >= 8) return 'mastered'
  if (score >= 5) return 'partial'
  return 'missed'
}

function fallbackReport(
  setTitle: string,
  results: Array<{
    learningPoint: string
    score: number
    status: string
    feedback: string
    mistake?: string
  }>,
): DiagnosticReport {
  const strengths = [...new Set(results.filter((result) => result.score >= 8).map((result) => result.learningPoint))].slice(0, 8)
  const gaps = [...new Set(results.filter((result) => result.score < 8).map((result) => result.learningPoint))].slice(0, 12)
  const recommendations = gaps.length > 0
    ? gaps.slice(0, 5).map((gap) => `Revisit “${gap}”, then answer a fresh follow-up without notes.`)
    : [`Keep ${setTitle} warm with a short mixed review tomorrow.`]

  return DiagnosticReportSchema.parse({
    overview: gaps.length > 0
      ? `Your baseline shows ${strengths.length} strong learning point${strengths.length === 1 ? '' : 's'} and ${gaps.length} point${gaps.length === 1 ? '' : 's'} worth another pass.`
      : 'This baseline is strong across the tested learning points. Keep the set active with spaced review.',
    strengths,
    gaps,
    recommendations,
    learningPoints: results.slice(0, 24).map((result) => ({
      text: result.learningPoint,
      score: result.score,
      evidence: result.feedback,
      nextAction: result.status === 'mastered'
        ? 'Use this point in a mixed review to check that it holds under pressure.'
        : `Review the point and retry a related question. ${result.mistake ?? ''}`.trim(),
    })),
  })
}

export async function getDiagnosticSetOptions(): Promise<ActionResult<DiagnosticSetOption[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const sets = await prisma.set.findMany({
      where: readableSetWhere(session.user.id),
      orderBy: { title: 'asc' },
      take: 200,
      select: { id: true, title: true, _count: { select: { cards: true } } },
    })
    return {
      success: true,
      data: sets.map((set) => ({ id: set.id, title: set.title, cardCount: set._count.cards })),
    }
  } catch (error) {
    console.error('getDiagnosticSetOptions error:', error)
    return { success: false, error: 'Failed to load study sets' }
  }
}

export async function startDiagnosticTest(input: DiagnosticStartInput): Promise<ActionResult<{
  attemptId: string
  setTitle: string
  questions: DiagnosticQuestionView[]
}>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsed = DiagnosticStartSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const set = await prisma.set.findFirst({
      where: { id: parsed.data.setId, ...readableSetWhere(session.user.id) },
      select: { id: true, title: true },
    })
    if (!set) return { success: false, error: 'That study set is not available' }

    // ONE query for the whole set's live key points. Deliberately NOT
    // `ensureKlpsReady` per card: that gap-fills by invoking AI extraction, so
    // across a 120-card set pressing Start would fire a burst of calls against
    // a free tier capped at 20 requests per day per model.
    const klps = await prisma.cardKlp.findMany({
      where: { card: { setId: set.id }, supersededAt: null },
      orderBy: [{ card: { position: 'asc' } }, { index: 'asc' }],
      select: {
        id: true,
        cardId: true,
        index: true,
        text: true,
        weight: true,
        card: { select: { term: true, definition: true } },
      },
    })
    if (klps.length < MIN_DIAGNOSTIC_KLPS) {
      return {
        success: false,
        error: `This set has ${klps.length} key point${klps.length === 1 ? '' : 's'}. A diagnostic needs at least ${MIN_DIAGNOSTIC_KLPS} to be worth your time. Open the set and let its key points finish extracting, then try again.`,
      }
    }

    const states = await prisma.klpState.findMany({
      where: { userId: session.user.id, klpId: { in: klps.map((klp) => klp.id) } },
      select: { klpId: true, pKnown: true },
    })

    // Capped at what exists: asking for 30 questions from a 15-key-point set
    // would either repeat points or invent them.
    const questionCount = Math.min(parsed.data.questionCount, klps.length)
    const probes = selectDiagnosticProbes({
      klps: klps.map((klp) => ({
        id: klp.id, cardId: klp.cardId, index: klp.index, weight: klp.weight,
      })),
      states,
      count: questionCount,
    })
    const klpById = new Map(klps.map((klp) => [klp.id, klp]))

    // BATCHED. One call per DIAGNOSTIC_BATCH_SIZE probes, with refs LOCAL to
    // the batch, because a single call for the whole sitting exhausts the
    // model's output budget and returns nothing — see DIAGNOSTIC_BATCH_SIZE.
    // Sequential, not parallel: fanning several structured-output calls at one
    // credential is how a rate limit turns a slow submit into a failed one.
    const generatedQuestions: { question: string; expectedAnswer: string }[] = []
    for (const batch of batched(probes, DIAGNOSTIC_BATCH_SIZE)) {
      const generated = await generateJson({
        userId: session.user.id,
        task: 'diagnostic',
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
        schema: DIAGNOSTIC_QUESTIONS_PROMPT.schema,
        maxOutputTokens: DIAGNOSTIC_MAX_OUTPUT_TOKENS,
      })
      const questionSet = DiagnosticQuestionSetSchema.parse(generated)

      // Same shape of guard the v1 `cardRef` check provided. An unknown,
      // duplicated or missing ref means the generator did not answer the probes
      // it was given, and accepting a partial set would silently drop key
      // points the selector deliberately chose.
      const byRef = new Map(questionSet.questions.map((question) => [question.probeRef, question]))
      const answersEveryProbe =
        byRef.size === questionSet.questions.length &&
        byRef.size === batch.length &&
        batch.every((_, probeRef) => byRef.has(probeRef))
      if (!answersEveryProbe) {
        return { success: false, error: 'The diagnostic generator returned an incomplete question set. Please try again.' }
      }
      for (let probeRef = 0; probeRef < batch.length; probeRef++) {
        const question = byRef.get(probeRef)!
        generatedQuestions.push({ question: question.question, expectedAnswer: question.expectedAnswer })
      }
    }

    const questions = probes.map((probe, probeRef) => {
      const klp = klpById.get(probe.klpId)!
      const question = generatedQuestions[probeRef]
      return {
        cardId: probe.cardId,
        klpId: probe.klpId,
        position: probeRef,
        kind: probe.kind,
        // Denormalised from CardKlp.text AT ASK TIME. Editing a card supersedes
        // its key points; the question must still render what was actually
        // asked, and the grader must still grade against it.
        learningPoint: klp.text,
        prompt: question.question,
        expectedAnswer: question.expectedAnswer,
      }
    })

    const created = await prisma.$transaction(async (tx) => {
      const studySession = await tx.studySession.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          kind: 'diagnostic',
          itemCount: questions.length,
        },
      })
      // The anchor every AnswerKlpResult needs: its quizAnswerId FK is
      // required, so a diagnostic answer has to BE a QuizAnswer, which has to
      // hang off a QuizAttempt. Created on the SAME StudySession as the
      // DiagnosticAttempt, because "forget this set" reaches sessions by setId
      // — a second session would let erasure take one half and leave the other
      // pointing at nothing.
      await tx.quizAttempt.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          mode: 'diagnostic',
          sessionId: studySession.id,
          questionCount: questions.length,
        },
      })
      const attempt = await tx.diagnosticAttempt.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          sessionId: studySession.id,
          questionCount: questions.length,
          engineVersion: 2,
          questions: { create: questions },
        },
        include: {
          questions: {
            orderBy: { position: 'asc' },
            select: { id: true },
          },
        },
      })
      return attempt
    })

    revalidatePath('/diagnostic')
    revalidatePath('/', 'layout')
    return {
      success: true,
      data: {
        attemptId: created.id,
        setTitle: set.title,
        questions: questions.map((question, position) => ({
          id: created.questions[position].id,
          position,
          kind: question.kind,
          prompt: question.prompt,
        })),
      },
    }
  } catch (error) {
    if (error instanceof AiGenerationError) return { success: false, error: error.detail.title, detail: error.detail }
    console.error('startDiagnosticTest error:', error)
    return { success: false, error: 'Failed to build the diagnostic test' }
  }
}

export async function submitDiagnosticTest(input: DiagnosticSubmitInput): Promise<ActionResult<DiagnosticResult>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  const parsed = DiagnosticSubmitSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const attempt = await prisma.diagnosticAttempt.findFirst({
      where: { id: parsed.data.attemptId, userId: session.user.id },
      include: {
        set: { select: { title: true } },
        session: { select: { startedAt: true } },
        questions: { orderBy: { position: 'asc' } },
      },
    })
    if (!attempt) return { success: false, error: 'Diagnostic test not found' }
    if (attempt.status !== 'in_progress') return { success: false, error: 'This diagnostic has already been submitted' }

    // The key point behind each question, for the weight that feeds
    // significance. Read now rather than inside the write transaction, which
    // is already doing a lock-read-write per key point.
    const anchorIds = attempt.questions
      .map((question) => question.klpId)
      .filter((klpId): klpId is string => klpId !== null)
    const anchors = new Map(
      (await prisma.cardKlp.findMany({
        where: { id: { in: anchorIds } },
        select: { id: true, weight: true },
      })).map((klp) => [klp.id, klp]),
    )

    // `starred` is an input to significance and must be read AS OF THIS ANSWER.
    // No progress row means the learner has never interacted with the card — a
    // definite "not starred", not missing data.
    const starredByCard = new Map(
      (await prisma.cardProgress.findMany({
        where: {
          userId: session.user.id,
          cardId: { in: attempt.questions.map((question) => question.cardId) },
        },
        select: { cardId: true, starred: true },
      })).map((progress) => [progress.cardId, progress.starred]),
    )

    // Created alongside the DiagnosticAttempt at start. Absent only for a
    // pre-key-point attempt, and those were marked abandoned by the migration,
    // so they cannot reach here — but refuse rather than write half a sitting.
    const quizAttempt = await prisma.quizAttempt.findFirst({
      where: { sessionId: attempt.sessionId, mode: 'diagnostic' },
      select: { id: true },
    })
    if (!quizAttempt) {
      return { success: false, error: 'This diagnostic cannot be scored. Please start a new one.' }
    }

    const answers = new Map(parsed.data.answers.map((answer) => [answer.questionId, answer]))

    // BATCHED, for the same reason generation is: grading one question costs
    // ~900 reasoning tokens, so a whole sitting in one call exhausts the output
    // budget and returns nothing. Failing here is the worst case available —
    // the learner has already answered everything — so the call is kept small
    // enough that the budget is never the binding constraint.
    //
    // Refs are LOCAL to the batch and mapped back by position, so a grader that
    // renumbers cannot silently attach one question's verdict to another.
    const grades = new Map<number, DiagnosticGradeSet['grades'][number]>()
    for (const batch of batched(attempt.questions, DIAGNOSTIC_BATCH_SIZE)) {
      const generated = await generateJson({
        userId: session.user.id,
        task: 'diagnostic',
        prompt: DIAGNOSTIC_GRADING_PROMPT.build({
          questions: batch.map((question, ref) => ({
            ref,
            question: question.prompt,
            expectedAnswer: question.expectedAnswer,
            keyPoint: question.learningPoint,
            answer: answers.get(question.id)?.answer.trim() ?? '',
          })),
        }),
        schema: DIAGNOSTIC_GRADING_PROMPT.schema,
        maxOutputTokens: DIAGNOSTIC_MAX_OUTPUT_TOKENS,
      })
      const gradeSet = DiagnosticGradeSetSchema.parse(generated)
      const byRef = new Map(gradeSet.grades.map((grade) => [grade.questionRef, grade]))
      const complete =
        byRef.size === gradeSet.grades.length &&
        byRef.size === batch.length &&
        batch.every((_, ref) => byRef.has(ref))
      if (!complete) {
        return { success: false, error: 'The diagnostic grader returned an incomplete result. Please try again.' }
      }
      batch.forEach((question, ref) => grades.set(question.position, byRef.get(ref)!))
    }

    const graded = attempt.questions.map((question) => {
      const grade = grades.get(question.position)!
      const score = grade.score
      return {
        question,
        // The whole grade, not three fields of it: `klpResults` and
        // `errorTags` are what buildAnalysisWrites turns into evidence.
        grade,
        answer: answers.get(question.id)?.answer.trim() ?? '',
        latencyMs: answers.get(question.id)?.latencyMs,
        score,
        status: statusForScore(score),
        feedback: grade.feedback,
        mistake: grade.mistake?.trim() || null,
      }
    })

    let report: DiagnosticReport
    try {
      const reportOutput = await generateJson({
        userId: session.user.id,
        task: 'diagnostic',
        prompt: DIAGNOSTIC_REPORT_PROMPT.build({
          setTitle: attempt.set.title,
          results: graded.map((item) => ({
            question: item.question.prompt,
            keyPoint: item.question.learningPoint,
            answer: item.answer,
            score: item.score,
            status: item.status,
            mistake: item.mistake ?? undefined,
          })),
        }),
        schema: DIAGNOSTIC_REPORT_PROMPT.schema,
      })
      report = DiagnosticReportSchema.parse(reportOutput)
    } catch (reportError) {
      if (!(reportError instanceof AiGenerationError)) console.error('Diagnostic report fallback:', reportError)
      report = fallbackReport(attempt.set.title, graded.map((item) => ({
        learningPoint: item.question.learningPoint,
        score: item.score,
        status: item.status,
        feedback: item.feedback,
        mistake: item.mistake ?? undefined,
      })))
    }

    const score = Math.round((graded.reduce((sum, item) => sum + item.score, 0) / graded.length) * 10)
    const completedAt = new Date()
    const durationMs = Math.max(0, completedAt.getTime() - attempt.session.startedAt.getTime())

    // ONE transaction for the whole sitting. A half-graded diagnostic is worse
    // than a failed one: the learner cannot tell which half counted, and
    // KlpState cannot be stepped backward to undo the half that did.
    await prisma.$transaction(async (tx) => {
      for (const item of graded) {
        const anchorId = item.question.klpId
        const anchor = anchorId ? anchors.get(anchorId) : undefined
        // Exactly the key point this question asked, never the card's others.
        // A verdict on an unprobed point is a fabricated observation, and once
        // written it is indistinguishable from a real one.
        const klps = anchor ? [{ id: anchor.id, weight: anchor.weight }] : []
        // Empty klpResults on a question that HAD an anchor means the grader
        // did not do the per-key-point judgment it was asked for — never a
        // legitimately clean grade. Same rule short answer uses, and the only
        // way to tell "analyzed and clean" from "could not analyze", since a
        // relational tag table records both as zero rows.
        const forcedStatus =
          klps.length > 0 && (item.grade.klpResults ?? []).length === 0
            ? ('no_provenance' as const)
            : undefined

        const writes = buildAnalysisWrites({
          mode: 'diagnostic',
          klps,
          starred: starredByCard.get(item.question.cardId) ?? false,
          klpResults: item.grade.klpResults ?? [],
          errorTags: (item.grade.errorTags ?? []) as ErrorTagDraft[],
          forcedStatus,
        })

        const answer = await createAnswerWithAnalysis(
          {
            attemptId: quizAttempt.id,
            userId: session.user!.id,
            cardId: item.question.cardId,
            mode: 'diagnostic',
            prompt: item.question.prompt,
            answer: item.answer,
            correctAnswer: item.question.expectedAnswer,
            grade: { ...item.grade, promptVersion: DIAGNOSTIC_GRADING_PROMPT.version },
            score: item.score * 10,
            isCorrect: item.score >= 8,
            latencyMs: normalizeLatency(item.latencyMs),
            feedback: item.feedback,
          },
          writes,
          // No `replace`: a diagnostic question is answered exactly once, so
          // there is never a prior answer to supersede.
          undefined,
          tx,
        )

        await tx.diagnosticQuestion.update({
          where: { id: item.question.id },
          data: {
            answer: item.answer,
            score: item.score,
            status: item.status,
            feedback: item.feedback,
            mistake: item.mistake,
            latencyMs: item.latencyMs ?? null,
            answeredAt: completedAt,
            quizAnswerId: answer.id,
          },
        })
        await recordStudyEvent({
          userId: session.user!.id,
          cardId: item.question.cardId,
          source: 'diagnostic',
          sessionId: attempt.sessionId,
          // NEW. Without it the event outlives the answer it describes, and
          // erasing one leaves the other behind to disagree about what
          // happened.
          quizAnswerId: answer.id,
          outcome: { overall: item.score },
          meta: { latencyMs: item.latencyMs },
        }, tx)
      }
      await tx.quizAttempt.update({ where: { id: quizAttempt.id }, data: { score } })
      await tx.diagnosticAttempt.update({
        where: { id: attempt.id },
        data: { status: 'completed', score, report, reportAt: completedAt, completedAt },
      })
      await tx.studySession.update({ where: { id: attempt.sessionId }, data: { endedAt: completedAt, durationMs } })
    }, DIAGNOSTIC_TX_OPTIONS)

    revalidatePath('/diagnostic')
    revalidatePath('/profile')
    revalidatePath('/profile/memory')
    // Key-point mastery moves now, not just card confidence.
    revalidatePath('/profile/learner')
    revalidatePath('/', 'layout')
    return {
      success: true,
      data: {
        attemptId: attempt.id,
        setTitle: attempt.set.title,
        score,
        engineVersion: attempt.engineVersion,
        report,
        questions: graded.map((item) => ({
          id: item.question.id,
          position: item.question.position,
          kind: item.question.kind as 'core' | 'follow-up',
          prompt: item.question.prompt,
          learningPoint: item.question.learningPoint,
          answer: item.answer,
          score: item.score,
          status: item.status,
          feedback: item.feedback,
          mistake: item.mistake,
        })),
      },
    }
  } catch (error) {
    if (error instanceof AiGenerationError) return { success: false, error: error.detail.title, detail: error.detail }
    console.error('submitDiagnosticTest error:', error)
    return { success: false, error: 'Failed to score the diagnostic test' }
  }
}

/**
 * The signed-in user's completed diagnostics, newest first.
 *
 * OWNER-SCOPED, like quiz attempts and unlike sets: a diagnostic is personal
 * study data — what somebody did not know, in their own words — not a shareable
 * artifact.
 *
 * Completed only. An abandoned or in-flight attempt is not a result, and
 * listing one would offer a link to a page that has nothing to render.
 */
export async function getDiagnosticHistory(): Promise<ActionResult<DiagnosticHistoryItem[]>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const attempts = await prisma.diagnosticAttempt.findMany({
      where: { userId: session.user.id, status: 'completed' },
      orderBy: { completedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        score: true,
        questionCount: true,
        engineVersion: true,
        completedAt: true,
        createdAt: true,
        set: { select: { title: true } },
      },
    })
    return {
      success: true,
      data: attempts.map((attempt) => ({
        id: attempt.id,
        setTitle: attempt.set.title,
        score: attempt.score,
        questionCount: attempt.questionCount,
        engineVersion: attempt.engineVersion,
        // `completedAt` is set on the same update that sets status 'completed',
        // so it is non-null for every row this query returns. `createdAt` is
        // the fallback only so the type is honest about the column's nullability.
        completedAt: attempt.completedAt ?? attempt.createdAt,
      })),
    }
  } catch (error) {
    console.error('getDiagnosticHistory error:', error)
    return { success: false, error: 'Failed to load your diagnostics' }
  }
}

/**
 * One completed diagnostic, for reading back later.
 *
 * Before this existed there was no way to view a finished diagnostic at all:
 * the report was written to the database and rendered nowhere once the tab was
 * closed.
 *
 * Scoped to the owner in the `where`, not checked afterwards — a forgotten
 * comparison returns somebody else's answers, while a forgotten `where` clause
 * returns nothing.
 */
export async function getDiagnosticAttempt(attemptId: string): Promise<ActionResult<DiagnosticResult>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' }

  try {
    const attempt = await prisma.diagnosticAttempt.findFirst({
      where: { id: attemptId, userId: session.user.id, status: 'completed' },
      include: {
        set: { select: { title: true } },
        questions: { orderBy: { position: 'asc' } },
      },
    })
    if (!attempt) return { success: false, error: 'Diagnostic test not found' }

    const report = DiagnosticReportSchema.safeParse(attempt.report)
    if (!report.success) return { success: false, error: 'This diagnostic report could not be read' }

    return {
      success: true,
      data: {
        attemptId: attempt.id,
        setTitle: attempt.set.title,
        score: attempt.score ?? 0,
        engineVersion: attempt.engineVersion,
        report: report.data,
        questions: attempt.questions.map((question) => ({
          id: question.id,
          position: question.position,
          kind: question.kind as 'core' | 'follow-up',
          prompt: question.prompt,
          learningPoint: question.learningPoint,
          answer: question.answer ?? '',
          score: question.score ?? 0,
          status: (question.status ?? 'missed') as 'mastered' | 'partial' | 'missed',
          feedback: question.feedback ?? '',
          mistake: question.mistake,
        })),
      },
    }
  } catch (error) {
    console.error('getDiagnosticAttempt error:', error)
    return { success: false, error: 'Failed to load that diagnostic' }
  }
}
