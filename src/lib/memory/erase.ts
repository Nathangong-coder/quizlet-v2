import { storedScore } from '@/lib/quiz/scoring'
import { RESET_MEMORY_MODELS } from './reset'

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

/**
 * Every scope granularity `planErasure` understands, as a single `as const`
 * with the type DERIVED from it, following `STUDY_SOURCES`
 * (`src/lib/memory/scoring.ts`). Without this, a scope added later could
 * silently escape the regression guard's coverage instead of failing a test.
 */
export const ERASURE_SCOPE_KINDS = [
  'event',
  'answer',
  'attempt',
  'card',
  'set',
  'account',
] as const

export type ErasureScopeKind = (typeof ERASURE_SCOPE_KINDS)[number]

export type ErasureScope =
  | { kind: Extract<ErasureScopeKind, 'event'>; eventId: string }
  | { kind: Extract<ErasureScopeKind, 'answer'>; answerId: string }
  | { kind: Extract<ErasureScopeKind, 'attempt'>; attemptId: string }
  | { kind: Extract<ErasureScopeKind, 'card'>; cardId: string }
  | { kind: Extract<ErasureScopeKind, 'set'>; setId: string }
  | { kind: Extract<ErasureScopeKind, 'account'> }

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
  /**
   * The session this event belonged to, or null if it isn't tied to one.
   * Needed so erasing a standalone review or matching event (one with
   * `quizAnswerId: null`) can invalidate that session's persisted
   * `insight` — review/matching sessions have no `QuizAttempt`, so this is
   * the only path back to the session. A quiz-sourced event's session is
   * already reachable via its answer's attempt, so this field is only
   * consulted for events that end up in `deleteEventIds` directly.
   */
  sessionId: string | null
}

export interface SnapshotAttempt {
  id: string
  sessionId: string | null
  /** EVERY answer on this attempt, deleted or not — the planner needs the
   *  full list to tell a partial deletion from a total one. */
  answers: { id: string; score: number | null }[]
}

export interface SnapshotSession {
  id: string
  /** The STORED planned item count — NOT derived from answers. Written once
   *  when the session starts (`quiz.ts:420` from `selectedIds.length`,
   *  `study-session.ts:35` from callers passing `tiles.length / 2` or
   *  `deckSize`). Erasure decrements it; it never recomputes it from
   *  survivors, or an abandoned 20-question quiz would be permanently
   *  rewritten to "2 items" just because 2 answers happen to remain. */
  itemCount: number
}

/**
 * A read-only view of everything an erasure scope might touch, assembled by
 * the caller inside its transaction.
 *
 * Precondition for the `set` scope: the loader must have already narrowed
 * every array (`answers`, `events`, `attempts`, `sessions`) to rows
 * belonging to that one set — `planErasure` does not filter by set itself,
 * it erases everything it is handed (see the `set` case below). If
 * `narrowedSetId` is supplied, `planErasure` cross-checks it against
 * `scope.setId` and throws on a mismatch, catching a caller that built the
 * snapshot for the wrong set; when omitted, no check is made and the caller
 * is trusted.
 */
export interface ErasureSnapshot {
  answers: SnapshotAnswer[]
  events: SnapshotEvent[]
  attempts: SnapshotAttempt[]
  sessions: SnapshotSession[]
  /** Optional self-check for the `set` scope — see the interface doc above. */
  narrowedSetId?: string
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
    /** Omitted, never guessed, when the session is absent from the
     *  snapshot — see `SnapshotSession`'s doc comment. */
    itemCount?: number
  }[]
  /** The legacy Stage 2 history table, which has no replay. */
  deleteConfidenceEventCardIds: string[]
  /**
   * Set for the `set` scope only — the executor deletes legacy
   * `ConfidenceEvent` rows by `{ userId, card: { setId } }`, matching
   * today's `forgetSet` (`src/actions/memory.ts`) breadth: every card in
   * the set, not only the ones that also appear in `answers`/`events`.
   * `deleteConfidenceEventCardIds` cannot cover this — it is derived from
   * cards present in the snapshot's answers or events, so a card whose only
   * remaining memory is a legacy `ConfidenceEvent` row (no answer, no
   * event) never appears there, and its rows would silently survive
   * "forget this set." Widening `deleteConfidenceEventCardIds` instead
   * would require the snapshot to carry the set's full card list just to
   * delete rows that may not exist, so this is a separate, set-scoped
   * instruction instead.
   */
  deleteConfidenceEventSetId?: string
  /**
   * Card ids whose `CardProgress` row must be deleted OUTRIGHT — never
   * replayed. Set for the `card` scope only (`[scope.cardId]`); every other
   * scope leaves this empty. Distinct from `replayCardIds` and necessary
   * because a card can hold a `CardProgress` row with NO `StudyEvent` or
   * `QuizAnswer` behind it at all: `starCard` and `updateConfidence`
   * (`src/actions/confidence.ts`) both `create` one directly (star-only or
   * manually-rated cards). `replayCardIds`, derived purely from deleted
   * answers/events, would never visit such a card, so "forget this card"
   * would silently leave its star/confidence/mastery standing — the design
   * (`docs/superpowers/specs/2026-08-10-deletion-and-forgetting-design.md`
   * §3.1) lists `CardProgress` as an unconditional delete for this scope,
   * not a replay, and `forgetCard`/`forgetSet` (`src/actions/memory.ts`)
   * already delete it unconditionally today.
   */
  deleteCardProgressCardIds: string[]
  /**
   * Set for the `set` scope only, for the same structural reason as
   * `deleteConfidenceEventSetId`: `deleteCardProgressCardIds` is
   * card-scoped, and the snapshot does not carry the set's full card list,
   * so the `set` scope cannot express "every `CardProgress` row in this
   * set" as a card-id list without loading one just to delete rows that
   * may not exist. The executor is expected to delete by
   * `{ userId, card: { setId } }`, matching `forgetSet`'s unconditional
   * breadth today.
   */
  deleteCardProgressSetId?: string
  replayCardIds: string[]
  replayKlpIds: string[]
  /**
   * Sessions whose persisted `insight`/`insightAt` AI summary must be
   * cleared: every session behind a surviving-but-updated attempt (a
   * non-null `sessionId` in `updateAttempts`), UNION the session of every
   * directly-deleted standalone event (a non-null `sessionId` among the
   * events in `deleteEventIds`) — review/matching sessions have no
   * `QuizAttempt`, so erasing one of their events can only reach the
   * session through the event's own `sessionId`. Sessions already present
   * in `deleteSessionIds` are excluded: clearing a field on a row that is
   * about to be deleted outright is pointless. `insight` makes per-card
   * claims and nothing else invalidates it, so left alone it can go on
   * naming a card the learner explicitly erased. Planner only: this task
   * does not write the executor that performs the clear — that is Task 5's
   * job.
   */
  clearInsightSessionIds: string[]
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

export type ErasableMemoryModel = (typeof ERASABLE_MEMORY_MODELS)[number]

const uniq = (xs: string[]): string[] => [...new Set(xs)]

/**
 * See `ErasureSnapshot`'s doc comment for the `set` scope's narrowing
 * precondition, which this function enforces via `narrowedSetId` when the
 * caller supplies it.
 */
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
    deleteCardProgressCardIds: [],
    replayCardIds: [],
    replayKlpIds: [],
    clearInsightSessionIds: [],
  }

  // The account scope is a truncate, not a plan: loading every row in order to
  // decide to delete every row is absurd. `executeErasure` special-cases it
  // onto ERASABLE_MEMORY_MODELS. The variant stays in the union so the
  // vocabulary is complete and the coverage test has something to assert.
  if (scope.kind === 'account') return empty

  if (
    scope.kind === 'set' &&
    snapshot.narrowedSetId !== undefined &&
    snapshot.narrowedSetId !== scope.setId
  ) {
    throw new Error(
      `planErasure: snapshot is narrowed to set ${snapshot.narrowedSetId}, but the set ` +
        `scope targets ${scope.setId}. The loader built the wrong snapshot for this scope.`,
    )
  }

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
        const answer = snapshot.answers.find((a) => a.id === event.quizAnswerId)
        if (!answer) {
          // Resolving through the snapshot (rather than trusting the FK id
          // directly) matters: if the answer isn't here, deletedAnswers
          // below would be empty while deleteAnswerIds is not, so
          // replayCardIds/replayKlpIds would come back empty. The executor
          // would delete the answer, cascade its AnswerKlpResult rows, and
          // replay nothing — evidence gone, posterior standing, permanent.
          throw new Error(
            `planErasure: event ${event.id} routes to answer ${event.quizAnswerId}, which is ` +
              `absent from the snapshot. The loader must widen to include it — otherwise the ` +
              `delete set and the replay set come from different sources and the KLP posterior ` +
              `survives its own evidence.`,
          )
        }
        answerIds = [answer.id]
      } else {
        eventIds = [event.id]
      }
      break
    }
    case 'attempt': {
      wholeAttemptIds = [scope.attemptId]
      answerIds = snapshot.answers.filter((a) => a.attemptId === scope.attemptId).map((a) => a.id)
      // Pre-Stage-6 StudyEvent rows can be quiz-sourced with a NULL
      // quizAnswerId that Task 3's backfill structurally cannot link. The
      // executor's loader reaches them by the attempt's session as well as
      // by its answers (M-1) — `QuizAttempt.sessionId` is @unique, so a
      // session has at most one attempt and this cannot pull in another
      // attempt's events. Without this, those rows are loaded and then
      // silently dropped: after the session is deleted (`sessionId` is
      // `SetNull`) they survive invisible and unreachable, still feeding
      // CardProgress.
      //
      // This lookup relies on `loadSnapshot` (src/lib/memory/erase-execute.ts)
      // folding `targetedAttemptId` into its attempt query even for a
      // zero-answer attempt — otherwise a never-completed quiz wouldn't
      // appear in `snapshot.attempts` at all and this would find nothing.
      // Nothing but a test enforces that contract across the two modules.
      const targetAttempt = snapshot.attempts.find((a) => a.id === scope.attemptId)
      if (targetAttempt?.sessionId) {
        eventIds = snapshot.events
          .filter((e) => e.sessionId === targetAttempt.sessionId && e.quizAnswerId === null)
          .map((e) => e.id)
      }
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
      // Everything in hand is in scope: loadSnapshot (erase-execute.ts)
      // narrows per scope, so this case erases what it was handed without
      // re-filtering.
      //
      // "Narrowed" does NOT mean "restricted to cards in this set" — the
      // answer query also reaches answers on this set's attempts whose card
      // sits elsewhere. That widening is deliberate: this case deletes
      // snapshot.attempts wholesale, and QuizAttempt cascades to
      // QuizAnswer, so an answer cascade-deleted without appearing in
      // deleteAnswerIds would leave its card out of replayCardIds and its
      // KLPs out of replayKlpIds — a posterior standing above evidence that
      // no longer exists, permanently. Unreachable today (an attempt only
      // answers cards from its own set, and cards cannot move sets), but
      // closed by construction rather than left to chance.
      //
      // Events are NOT widened to match, and that asymmetry is correct: a
      // StudyEvent carries no attempt link to widen through, and an
      // answer-linked event is never listed in the plan anyway — the
      // `quizAnswerId` FK cascade removes it, same as everywhere else in
      // this file.
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

    if (!attempt) {
      // An attempt the caller explicitly targeted (via the `attempt` scope)
      // but that the loader never enumerated — e.g. a zero-answer,
      // never-completed quiz — must still be deleted. Otherwise "reset this
      // quiz" on an abandoned attempt silently deletes nothing.
      if (wholeAttemptIds.includes(attemptId)) deleteAttemptIds.push(attemptId)
      continue
    }

    const survivors = attempt.answers.filter((a) => !answerIds.includes(a.id))

    // An attempt whose last answer goes would otherwise linger in the activity
    // feed as a ghost quiz with nothing in it.
    if (wholeAttemptIds.includes(attemptId) || survivors.length === 0) {
      deleteAttemptIds.push(attemptId)
      continue
    }

    // Score is a STORED number derived from answers. Deleting one makes it
    // wrong, and nothing else recomputes it.
    //
    // `storedScore` (src/lib/quiz/scoring.ts) owns the round-because-Int rule:
    // `overallQuizScore` returns a float mean and `QuizAttempt.score` is an Int
    // column — the live writers in src/actions/quiz.ts round for the same
    // reason, inline. Sharing the helper keeps that rule in one place, so a
    // change to it cannot make erasure and re-scoring disagree about what the
    // same set of answers is worth.
    const session = attempt.sessionId
      ? snapshot.sessions.find((s) => s.id === attempt.sessionId)
      : undefined
    const deletedCountForAttempt = deletedAnswers.filter((a) => a.attemptId === attemptId).length

    updateAttempts.push({
      attemptId,
      sessionId: attempt.sessionId,
      score: storedScore(survivors),
      // itemCount is the STORED planned count minus how many of this
      // attempt's answers are being deleted — never the survivor count
      // (see SnapshotSession) — and omitted, not guessed, when the session
      // itself is absent from the snapshot.
      ...(session ? { itemCount: Math.max(0, session.itemCount - deletedCountForAttempt) } : {}),
    })
  }

  const deleteSessionIds =
    scope.kind === 'set'
      ? // The set scope sweeps every session in the snapshot, including
        // matching/review StudySessions with no QuizAttempt at all —
        // otherwise they survive "forget this set" as an empty husk
        // (verbatim spec defect #3, previously fixed only for `account`).
        uniq(snapshot.sessions.map((s) => s.id))
      : uniq(
          deleteAttemptIds
            .map((id) => snapshot.attempts.find((a) => a.id === id)?.sessionId ?? null)
            .filter((id): id is string => id !== null),
        )

  // 3. What must be replayed? Every card that lost an answer or an event, and
  //    every KLP a deleted answer credited.
  return {
    deleteAnswerIds: uniq(answerIds),
    deleteEventIds: uniq(eventIds),
    deleteAttemptIds: uniq(deleteAttemptIds),
    deleteSessionIds,
    updateAttempts,
    deleteConfidenceEventCardIds: uniq(confidenceCardIds),
    ...(scope.kind === 'set' ? { deleteConfidenceEventSetId: scope.setId } : {}),
    deleteCardProgressCardIds: scope.kind === 'card' ? [scope.cardId] : [],
    ...(scope.kind === 'set' ? { deleteCardProgressSetId: scope.setId } : {}),
    replayCardIds: uniq([
      ...deletedAnswers.map((a) => a.cardId),
      ...deletedEvents.map((e) => e.cardId),
    ]),
    replayKlpIds: uniq(deletedAnswers.flatMap((a) => a.klpIds)),
    clearInsightSessionIds: uniq([
      ...updateAttempts.map((u) => u.sessionId).filter((id): id is string => id !== null),
      ...deletedEvents.map((e) => e.sessionId).filter((id): id is string => id !== null),
    ]).filter((id) => !deleteSessionIds.includes(id)),
  }
}
