import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { lockKlpStates, rebuildKlpStates } from '@/lib/metrics/state-writer'
import { recomputeCardProgress } from './recompute'
import {
  ERASABLE_MEMORY_MODELS,
  planErasure,
  type ErasableMemoryModel,
  type ErasureScope,
  type ErasureSnapshot,
} from './erase'

type Tx = Prisma.TransactionClient

/** Every scope except `account`, which never builds a snapshot. */
type PlannedScope = Exclude<ErasureScope, { kind: 'account' }>

/**
 * Runs an erasure: read a snapshot, plan, delete, replay — all inside ONE
 * transaction, so a replay that throws rolls the deletes back rather than
 * leaving evidence gone and aggregates stale. That failure mode is the whole
 * reason this module exists:
 *
 *     no derived number may claim knowledge from evidence that no longer exists
 *
 * and it is PERMANENT when it happens, because the backfill script only ever
 * rebuilds from surviving rows — a posterior whose evidence is gone is beyond
 * its reach forever.
 *
 * Ownership is checked on the MEMORY ROWS, not the content. Since set
 * visibility landed a learner can study a link-shared set they do not own, and
 * their events and answers for someone else's card are legitimately theirs to
 * erase. So `card`/`set` filter by userId and deliberately do NOT require set
 * ownership; `answer`/`event`/`attempt` verify the root row's userId and throw
 * `Not found` for both absent and not-yours — a distinguishable error would
 * confirm the row exists to someone probing ids.
 */
export async function executeErasure(userId: string, scope: ErasureScope): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (scope.kind === 'account') {
      await eraseAccount(tx, userId)
      return
    }

    const snapshot = await loadSnapshot(tx, userId, scope)
    const plan = planErasure(snapshot, scope)

    // BEFORE any posterior read or write. `rebuildKlpStates` is
    // read-modify-write with an ABSOLUTE write under READ COMMITTED, so two
    // concurrent writers would otherwise both read the same pre-state and the
    // second would silently drop the first's observation — unrecoverable,
    // since the BKT update is not invertible.
    await lockKlpStates(tx, userId, plan.replayKlpIds)

    // --- deletes ---------------------------------------------------------
    // Answers first: the `quizAnswerId` FK cascades their StudyEvent rows,
    // which is why the plan never lists those events explicitly.
    if (plan.deleteAnswerIds.length > 0) {
      await tx.quizAnswer.deleteMany({ where: { userId, id: { in: plan.deleteAnswerIds } } })
    }
    if (plan.deleteEventIds.length > 0) {
      await tx.studyEvent.deleteMany({ where: { userId, id: { in: plan.deleteEventIds } } })
    }
    if (plan.deleteAttemptIds.length > 0) {
      await tx.quizAttempt.deleteMany({ where: { userId, id: { in: plan.deleteAttemptIds } } })
    }
    if (plan.deleteSessionIds.length > 0) {
      await tx.studySession.deleteMany({ where: { userId, id: { in: plan.deleteSessionIds } } })
    }
    if (plan.deleteConfidenceEventCardIds.length > 0) {
      await tx.confidenceEvent.deleteMany({
        where: { userId, cardId: { in: plan.deleteConfidenceEventCardIds } },
      })
    }

    // --- stored counters on survivors ------------------------------------
    // `updateMany` with the userId in the predicate rather than `update` by id:
    // every other write here is owner-scoped, and a plan that somehow named a
    // foreign row should touch nothing rather than rewrite it.
    for (const update of plan.updateAttempts) {
      await tx.quizAttempt.updateMany({
        where: { id: update.attemptId, userId },
        data: { score: update.score },
      })
      // itemCount is OPTIONAL and is a DECREMENT of the stored planned count,
      // not a recount. The planner omits rather than guesses when the session
      // was absent from the snapshot, and an absent value must leave the
      // stored count alone — see `SnapshotSession` in ./erase.
      if (update.sessionId !== null && update.itemCount !== undefined) {
        await tx.studySession.updateMany({
          where: { id: update.sessionId, userId },
          data: { itemCount: update.itemCount },
        })
      }
    }

    // `StudySession.insight` is a persisted AI summary making per-card claims,
    // and nothing else invalidates it — left standing it goes on naming a card
    // the learner explicitly erased. `Prisma.DbNull` (not `null`) is how a
    // nullable Json column is cleared; `null` there means "leave unchanged".
    if (plan.clearInsightSessionIds.length > 0) {
      await tx.studySession.updateMany({
        where: { userId, id: { in: plan.clearInsightSessionIds } },
        data: { insight: Prisma.DbNull, insightAt: null },
      })
    }

    // --- replays ---------------------------------------------------------
    await replayCardProgress(tx, userId, plan.replayCardIds)
    // Reads SURVIVING AnswerKlpResult rows, so it MUST run after the deletes.
    // It also deletes any KlpState with no evidence left, which is what stops a
    // stale posterior sitting above MIN_OBSERVATIONS forever.
    await rebuildKlpStates(tx, userId, plan.replayKlpIds)
  })
}

/**
 * A full account wipe is a truncate, not a plan: loading every row in order to
 * decide to delete every row would be absurd, so `planErasure` returns the
 * empty plan for this scope by design.
 *
 * A `Record` keyed on the model union rather than `tx[model]`: Prisma's
 * delegates are generic over `SelectSubset` and do not unify structurally, so
 * indexing the client needs a cast through `unknown` that discards all
 * checking. Keyed this way, adding a model to `ERASABLE_MEMORY_MODELS` is a
 * type error until a deleter exists for it — which is the property we want.
 */
async function eraseAccount(tx: Tx, userId: string): Promise<void> {
  const deleters: Record<ErasableMemoryModel, () => Promise<unknown>> = {
    quizAttempt: () => tx.quizAttempt.deleteMany({ where: { userId } }),
    quizAnswer: () => tx.quizAnswer.deleteMany({ where: { userId } }),
    confidenceEvent: () => tx.confidenceEvent.deleteMany({ where: { userId } }),
    cardProgress: () => tx.cardProgress.deleteMany({ where: { userId } }),
    studyEvent: () => tx.studyEvent.deleteMany({ where: { userId } }),
    klpState: () => tx.klpState.deleteMany({ where: { userId } }),
    studySession: () => tx.studySession.deleteMany({ where: { userId } }),
  }

  // Order is load-bearing at the top (QuizAttempt cascades to QuizAnswer,
  // which cascades to AnswerKlpResult), so iterate the const, not the Record.
  for (const model of ERASABLE_MEMORY_MODELS) {
    await deleters[model]()
  }
}

/** Replays CardProgress for each card from the events that survive. */
async function replayCardProgress(tx: Tx, userId: string, cardIds: string[]): Promise<void> {
  for (const cardId of cardIds) {
    const remaining = await tx.studyEvent.findMany({
      where: { userId, cardId },
      select: { correct: true, score: true, createdAt: true },
    })
    const recomputed = recomputeCardProgress(remaining)

    if (recomputed === null) {
      // No evidence left: the card reverts to never-studied.
      await tx.cardProgress.deleteMany({ where: { userId, cardId } })
      continue
    }

    // `starred` is deliberately absent from `update`: it is a user's explicit
    // flag, not a derived number, so a replay must not clobber it. It only
    // appears in `create`, where there is no prior star to preserve.
    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: {
        confidence: recomputed.confidence,
        mastery: recomputed.mastery,
        reps: recomputed.reps,
        dueAt: recomputed.dueAt,
        lastSeenAt: recomputed.lastSeenAt,
      },
      create: {
        userId,
        cardId,
        confidence: recomputed.confidence,
        mastery: recomputed.mastery,
        reps: recomputed.reps,
        dueAt: recomputed.dueAt,
        lastSeenAt: recomputed.lastSeenAt,
        starred: false,
      },
    })
  }
}

/** The queries one scope resolves to, plus whatever the root read established. */
interface ScopeQueries {
  /** Null when the scope provably reaches no graded answer at all. */
  answerWhere: Prisma.QuizAnswerWhereInput | null
  eventWhere: Prisma.StudyEventWhereInput
  /** An attempt the scope targets outright even if no answer points at it. */
  targetedAttemptId?: string
}

/**
 * Reads exactly the rows the scope reaches, INSIDE the transaction and BEFORE
 * any delete — once the rows are gone there is no way to learn which cards and
 * KLPs they fed.
 */
async function loadSnapshot(
  tx: Tx,
  userId: string,
  scope: PlannedScope,
): Promise<ErasureSnapshot> {
  const { answerWhere, eventWhere, targetedAttemptId } = await scopeToQueries(tx, userId, scope)

  const answerRows =
    answerWhere === null
      ? []
      : await tx.quizAnswer.findMany({
          where: answerWhere,
          select: {
            id: true,
            attemptId: true,
            cardId: true,
            score: true,
            klpResults: { select: { klpId: true } },
          },
        })

  const eventRows = await tx.studyEvent.findMany({
    where: eventWhere,
    select: { id: true, cardId: true, quizAnswerId: true, source: true, sessionId: true },
  })

  // Every attempt touched, with its FULL answer list — the planner needs that
  // to tell a partial deletion from a total one. `targetedAttemptId` is folded
  // in so an abandoned zero-answer attempt is still enumerated: without it the
  // planner's I-3 branch deletes the attempt while its session survives as an
  // empty husk.
  const attemptIds = [
    ...new Set([
      ...answerRows.map((a) => a.attemptId),
      ...(targetedAttemptId ? [targetedAttemptId] : []),
    ]),
  ]
  const attemptWhere: Prisma.QuizAttemptWhereInput =
    scope.kind === 'set'
      ? // Every attempt on the set, not only those an answer points at.
        { userId, OR: [{ setId: scope.setId }, { id: { in: attemptIds } }] }
      : { userId, id: { in: attemptIds } }

  const attemptRows =
    scope.kind !== 'set' && attemptIds.length === 0
      ? []
      : await tx.quizAttempt.findMany({
          where: attemptWhere,
          select: { id: true, sessionId: true, answers: { select: { id: true, score: true } } },
        })

  // For the `set` scope this MUST reach sessions by setId, not through
  // attempts: matching and review sessions have no QuizAttempt at all, and
  // deriving them from attempts is exactly the "empty husk" bug this feature
  // exists to fix. Narrower scopes only need the sessions behind the attempts
  // they touch, because that is the only place the planner reads `itemCount`.
  const sessionIds = attemptRows
    .map((a) => a.sessionId)
    .filter((id): id is string => id !== null)
  const sessionRows =
    scope.kind === 'set'
      ? await tx.studySession.findMany({
          where: { userId, setId: scope.setId },
          select: { id: true, itemCount: true },
        })
      : sessionIds.length === 0
        ? []
        : await tx.studySession.findMany({
            where: { userId, id: { in: sessionIds } },
            select: { id: true, itemCount: true },
          })

  return {
    answers: answerRows.map((a) => ({
      id: a.id,
      attemptId: a.attemptId,
      cardId: a.cardId,
      score: a.score,
      klpIds: a.klpResults.map((r) => r.klpId),
    })),
    events: eventRows.map((e) => ({
      id: e.id,
      cardId: e.cardId,
      quizAnswerId: e.quizAnswerId,
      source: e.source,
      sessionId: e.sessionId,
    })),
    attempts: attemptRows.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      answers: t.answers.map((a) => ({ id: a.id, score: a.score })),
    })),
    sessions: sessionRows.map((s) => ({ id: s.id, itemCount: s.itemCount })),
    // The planner cross-checks this against the scope and throws on a
    // mismatch, catching a loader that built the snapshot for the wrong set.
    ...(scope.kind === 'set' ? { narrowedSetId: scope.setId } : {}),
  }
}

/**
 * Resolves a scope to its queries, performing the ownership check on the root
 * row as a side effect. Each root row is read exactly once, and everything the
 * check learns (the answer's attempt, the attempt's session) is reused rather
 * than re-fetched.
 */
async function scopeToQueries(
  tx: Tx,
  userId: string,
  scope: PlannedScope,
): Promise<ScopeQueries> {
  switch (scope.kind) {
    case 'answer': {
      const answer = await tx.quizAnswer.findUnique({
        where: { id: scope.answerId },
        select: { userId: true, attemptId: true },
      })
      if (!answer || answer.userId !== userId) throw new Error('Not found')
      // Widened to the WHOLE attempt: the planner still deletes only this
      // answer, but it needs the attempt's surviving answers to recompute the
      // stored score. Scoping to the one answer would leave that score wrong.
      return {
        answerWhere: { userId, attemptId: answer.attemptId },
        eventWhere: { userId, quizAnswerId: scope.answerId },
      }
    }

    case 'event': {
      const event = await tx.studyEvent.findUnique({
        where: { id: scope.eventId },
        select: { userId: true, quizAnswer: { select: { attemptId: true } } },
      })
      if (!event || event.userId !== userId) throw new Error('Not found')
      return {
        // MANDATORY widening (I-4): planErasure THROWS when a quiz-sourced
        // event routes to an answer absent from the snapshot, because the
        // delete set and the replay set would then come from different
        // sources and the KLP posterior would survive its own evidence. That
        // throw is the only thing enforcing this coupling.
        answerWhere: event.quizAnswer
          ? { userId, attemptId: event.quizAnswer.attemptId }
          : null,
        eventWhere: { userId, id: scope.eventId },
      }
    }

    case 'attempt': {
      const attempt = await tx.quizAttempt.findUnique({
        where: { id: scope.attemptId },
        select: { userId: true, sessionId: true },
      })
      if (!attempt || attempt.userId !== userId) throw new Error('Not found')
      return {
        answerWhere: { userId, attemptId: scope.attemptId },
        // Reached by session as well as by answer (M-1): a quiz-sourced
        // StudyEvent with a NULL quizAnswerId — pre-Stage-6 rows, which Task
        // 3's backfill structurally cannot link — is invisible to the answer
        // join. `QuizAttempt.sessionId` is @unique, so a session has at most
        // one attempt and its events cannot span another one.
        eventWhere:
          attempt.sessionId === null
            ? { userId, quizAnswer: { attemptId: scope.attemptId } }
            : {
                userId,
                OR: [
                  { quizAnswer: { attemptId: scope.attemptId } },
                  { sessionId: attempt.sessionId },
                ],
              },
        targetedAttemptId: scope.attemptId,
      }
    }

    case 'card':
      // userId ONLY — no set-ownership requirement. See the module doc.
      return {
        answerWhere: { userId, cardId: scope.cardId },
        eventWhere: { userId, cardId: scope.cardId },
      }

    case 'set':
      return {
        answerWhere: { userId, card: { setId: scope.setId } },
        eventWhere: { userId, card: { setId: scope.setId } },
      }
  }
}
