import { overallQuizScore } from '@/lib/quiz/scoring'
import { RESET_MEMORY_MODELS, type ResetMemoryModel } from './reset'

/**
 * The single place that decides what a deletion removes and what must be
 * replayed afterwards.
 *
 * PURE — no Prisma, no `auth`, no clock. The caller reads a snapshot inside its
 * transaction and passes it in as data. That is what makes every rule here a
 * unit test rather than a database integration test, and it is why the
 * invariant lives in one place instead of five hand-written copies:
 *
 *     no derived number may claim knowledge from evidence that no longer exists
 *
 * `CardProgress` and `KlpState` are incremental and NOT invertible — `stepBkt`
 * mixes two Bayes updates plus a learning term, so several priors map to one
 * posterior. Replaying from surviving rows is the only correct response to a
 * deletion.
 */

export type ErasureScope =
  | { kind: 'event'; eventId: string }
  | { kind: 'answer'; answerId: string }
  | { kind: 'attempt'; attemptId: string }
  | { kind: 'card'; cardId: string }
  | { kind: 'set'; setId: string }
  | { kind: 'account' }

export interface SnapshotAnswer {
  id: string
  attemptId: string
  cardId: string
  /** KLPs this answer credited, via its AnswerKlpResult rows. */
  klpIds: string[]
  score: number | null
}

export interface SnapshotEvent {
  id: string
  cardId: string
  /** Null for `review`/`matching`/`lesson`, which have no graded answer. */
  quizAnswerId: string | null
  source: string
}

export interface SnapshotAttempt {
  id: string
  sessionId: string | null
  /** EVERY answer on this attempt, deleted or not — the planner needs the
   *  full list to tell a partial deletion from a total one. */
  answers: { id: string; score: number | null }[]
}

export interface ErasureSnapshot {
  answers: SnapshotAnswer[]
  events: SnapshotEvent[]
  attempts: SnapshotAttempt[]
}

export interface ErasurePlan {
  deleteAnswerIds: string[]
  /**
   * Events deleted DIRECTLY. Events belonging to a deleted answer are absent:
   * the `quizAnswerId` FK cascade removes them, and listing them here would
   * imply application code owns a deletion the database guarantees.
   */
  deleteEventIds: string[]
  deleteAttemptIds: string[]
  deleteSessionIds: string[]
  /** Attempts that survive but lost answers — stored counters go stale. */
  updateAttempts: {
    attemptId: string
    sessionId: string | null
    score: number | null
    itemCount: number
  }[]
  /** The legacy Stage 2 history table, which has no replay. */
  deleteConfidenceEventCardIds: string[]
  replayCardIds: string[]
  replayKlpIds: string[]
}

/**
 * What the `account` scope truncates. `studySession` is NOT in
 * RESET_MEMORY_MODELS: both StudyEvent.sessionId and QuizAttempt.sessionId are
 * `onDelete: SetNull`, so a full reset used to leave every session standing as
 * an empty husk. Nothing renders sessions yet, which is why it never bit.
 */
export const ERASABLE_MEMORY_MODELS = [
  ...RESET_MEMORY_MODELS,
  'studySession',
] as const

export type ErasableMemoryModel = ResetMemoryModel | 'studySession'

const uniq = (xs: string[]): string[] => [...new Set(xs)]

export function planErasure(
  snapshot: ErasureSnapshot,
  scope: ErasureScope,
): ErasurePlan {
  const empty: ErasurePlan = {
    deleteAnswerIds: [],
    deleteEventIds: [],
    deleteAttemptIds: [],
    deleteSessionIds: [],
    updateAttempts: [],
    deleteConfidenceEventCardIds: [],
    replayCardIds: [],
    replayKlpIds: [],
  }

  // The account scope is a truncate, not a plan: loading every row in order to
  // decide to delete every row is absurd. `executeErasure` special-cases it
  // onto ERASABLE_MEMORY_MODELS. The variant stays in the union so the
  // vocabulary is complete and the coverage test has something to assert.
  if (scope.kind === 'account') return empty

  // 1. Which answers and which standalone events does this scope remove?
  let answerIds: string[] = []
  let eventIds: string[] = []
  let confidenceCardIds: string[] = []
  let wholeAttemptIds: string[] = []

  switch (scope.kind) {
    case 'answer': {
      answerIds = snapshot.answers.filter((a) => a.id === scope.answerId).map((a) => a.id)
      break
    }
    case 'event': {
      const event = snapshot.events.find((e) => e.id === scope.eventId)
      if (!event) break
      // Erasing an interaction erases every row describing it, from whichever
      // page you reached it. The cascade only runs answer -> event, so a
      // quiz-sourced event must be erased BY its answer.
      if (event.quizAnswerId !== null) {
        answerIds = [event.quizAnswerId]
      } else {
        eventIds = [event.id]
      }
      break
    }
    case 'attempt': {
      wholeAttemptIds = [scope.attemptId]
      answerIds = snapshot.answers.filter((a) => a.attemptId === scope.attemptId).map((a) => a.id)
      break
    }
    case 'card': {
      answerIds = snapshot.answers.filter((a) => a.cardId === scope.cardId).map((a) => a.id)
      eventIds = snapshot.events
        .filter((e) => e.cardId === scope.cardId && e.quizAnswerId === null)
        .map((e) => e.id)
      confidenceCardIds = [scope.cardId]
      break
    }
    case 'set': {
      // The snapshot loader has already narrowed to this set, so everything in
      // hand is in scope.
      answerIds = snapshot.answers.map((a) => a.id)
      eventIds = snapshot.events.filter((e) => e.quizAnswerId === null).map((e) => e.id)
      wholeAttemptIds = snapshot.attempts.map((a) => a.id)
      confidenceCardIds = uniq([
        ...snapshot.answers.map((a) => a.cardId),
        ...snapshot.events.map((e) => e.cardId),
      ])
      break
    }
  }

  const deletedAnswers = snapshot.answers.filter((a) => answerIds.includes(a.id))
  const deletedEvents = snapshot.events.filter((e) => eventIds.includes(e.id))

  // 2. Which attempts are emptied, and which merely lose answers?
  const touchedAttemptIds = uniq([
    ...deletedAnswers.map((a) => a.attemptId),
    ...wholeAttemptIds,
  ])

  const deleteAttemptIds: string[] = []
  const updateAttempts: ErasurePlan['updateAttempts'] = []

  for (const attemptId of touchedAttemptIds) {
    const attempt = snapshot.attempts.find((a) => a.id === attemptId)
    if (!attempt) continue

    const survivors = attempt.answers.filter((a) => !answerIds.includes(a.id))

    // An attempt whose last answer goes would otherwise linger in the activity
    // feed as a ghost quiz with nothing in it.
    if (wholeAttemptIds.includes(attemptId) || survivors.length === 0) {
      deleteAttemptIds.push(attemptId)
      continue
    }

    // Score and itemCount are STORED numbers derived from answers. Deleting one
    // makes both wrong, and nothing else recomputes them.
    //
    // Rounded because `overallQuizScore` returns a float mean and
    // `QuizAttempt.score` is an Int column — the live writer in
    // src/actions/quiz.ts rounds for the same reason.
    const mean = overallQuizScore(survivors)
    updateAttempts.push({
      attemptId,
      sessionId: attempt.sessionId,
      score: mean === null ? null : Math.round(mean),
      itemCount: survivors.length,
    })
  }

  const deleteSessionIds = deleteAttemptIds
    .map((id) => snapshot.attempts.find((a) => a.id === id)?.sessionId ?? null)
    .filter((id): id is string => id !== null)

  // 3. What must be replayed? Every card that lost an answer or an event, and
  //    every KLP a deleted answer credited.
  return {
    deleteAnswerIds: uniq(answerIds),
    deleteEventIds: uniq(eventIds),
    deleteAttemptIds: uniq(deleteAttemptIds),
    deleteSessionIds: uniq(deleteSessionIds),
    updateAttempts,
    deleteConfidenceEventCardIds: uniq(confidenceCardIds),
    replayCardIds: uniq([
      ...deletedAnswers.map((a) => a.cardId),
      ...deletedEvents.map((e) => e.cardId),
    ]),
    replayKlpIds: uniq(deletedAnswers.flatMap((a) => a.klpIds)),
  }
}
