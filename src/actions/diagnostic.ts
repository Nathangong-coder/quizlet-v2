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
  type DiagnosticReport,
} from '@/lib/ai/schemas'
import {
  DIAGNOSTIC_GRADING_PROMPT,
  DIAGNOSTIC_QUESTIONS_PROMPT,
  DIAGNOSTIC_REPORT_PROMPT,
} from '@/lib/ai/prompts/registry'
import { readableSetWhere } from '@/lib/sets/visibility'
import { recordStudyEvent } from '@/lib/memory/record'
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
  report: DiagnosticReport
  questions: DiagnosticResultQuestion[]
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
      select: {
        id: true,
        title: true,
        cards: {
          orderBy: { position: 'asc' },
          take: 120,
          select: { id: true, term: true, definition: true },
        },
      },
    })
    if (!set) return { success: false, error: 'That study set is not available' }
    if (set.cards.length === 0) return { success: false, error: 'Add at least one card before running a diagnostic' }

    const generated = await generateJson({
      userId: session.user.id,
      task: 'diagnostic',
      prompt: DIAGNOSTIC_QUESTIONS_PROMPT.build({
        setTitle: set.title,
        questionCount: parsed.data.questionCount,
        cards: set.cards.map((card, ref) => ({ ref, term: card.term, definition: card.definition })),
      }),
      schema: DIAGNOSTIC_QUESTIONS_PROMPT.schema,
    })
    const questionSet = DiagnosticQuestionSetSchema.parse(generated)
    if (questionSet.questions.length < parsed.data.questionCount) {
      return { success: false, error: 'The diagnostic generator returned too few questions. Please try again.' }
    }

    const cardsByRef = new Map(set.cards.map((card, ref) => [ref, card]))
    const questions = questionSet.questions.slice(0, parsed.data.questionCount).map((question, position) => {
      const card = cardsByRef.get(question.cardRef)
      if (!card) throw new Error('Diagnostic generator referenced an unavailable card')
      return { ...question, position, cardId: card.id }
    })
    if (questions.filter((question) => question.kind === 'follow-up').length < 2) {
      return { success: false, error: 'The diagnostic generator did not include enough follow-up questions. Please try again.' }
    }

    const created = await prisma.$transaction(async (tx) => {
      const studySession = await tx.studySession.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          kind: 'diagnostic',
          itemCount: questions.length,
        },
      })
      const attempt = await tx.diagnosticAttempt.create({
        data: {
          userId: session.user!.id,
          setId: set.id,
          sessionId: studySession.id,
          questionCount: questions.length,
          questions: {
            create: questions.map((question) => ({
              cardId: question.cardId,
              position: question.position,
              kind: question.kind,
              learningPoint: question.learningPoint,
              prompt: question.question,
              expectedAnswer: question.expectedAnswer,
            })),
          },
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
          prompt: question.question,
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

    const answers = new Map(parsed.data.answers.map((answer) => [answer.questionId, answer]))
    const generated = await generateJson({
      userId: session.user.id,
      task: 'diagnostic',
      prompt: DIAGNOSTIC_GRADING_PROMPT.build({
        questions: attempt.questions.map((question) => ({
          ref: question.position,
          question: question.prompt,
          expectedAnswer: question.expectedAnswer,
          learningPoint: question.learningPoint,
          answer: answers.get(question.id)?.answer.trim() ?? '',
        })),
      }),
      schema: DIAGNOSTIC_GRADING_PROMPT.schema,
    })
    const gradeSet = DiagnosticGradeSetSchema.parse(generated)
    const grades = new Map(gradeSet.grades.map((grade) => [grade.questionRef, grade]))
    const expectedRefs = new Set(attempt.questions.map((question) => question.position))
    const hasUnknownOrDuplicateGrade = grades.size !== gradeSet.grades.length || gradeSet.grades.some((grade) => !expectedRefs.has(grade.questionRef))
    const missingGrade = attempt.questions.find((question) => !grades.has(question.position))
    if (hasUnknownOrDuplicateGrade || missingGrade) return { success: false, error: 'The diagnostic grader returned an incomplete result. Please try again.' }

    const graded = attempt.questions.map((question) => {
      const grade = grades.get(question.position)!
      const score = grade.score
      return {
        question,
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
            learningPoint: item.question.learningPoint,
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

    await prisma.$transaction(async (tx) => {
      for (const item of graded) {
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
          },
        })
        await recordStudyEvent({
          userId: session.user!.id,
          cardId: item.question.cardId,
          source: 'diagnostic',
          sessionId: attempt.sessionId,
          outcome: { overall: item.score },
          meta: { latencyMs: item.latencyMs },
        }, tx)
      }
      await tx.diagnosticAttempt.update({
        where: { id: attempt.id },
        data: { status: 'completed', score, report, reportAt: completedAt, completedAt },
      })
      await tx.studySession.update({ where: { id: attempt.sessionId }, data: { endedAt: completedAt, durationMs } })
    })

    revalidatePath('/diagnostic')
    revalidatePath('/profile')
    revalidatePath('/profile/memory')
    revalidatePath('/', 'layout')
    return {
      success: true,
      data: {
        attemptId: attempt.id,
        setTitle: attempt.set.title,
        score,
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
