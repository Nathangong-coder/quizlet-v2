import { prisma } from '@/lib/db'
import { nextConfidence, masteryScore } from './scoring'
import { nextDueAt } from './schedule'
import type { MasteryEvent, StudyOutcome, StudySource } from './scoring'

export interface RecordStudyEventInput {
  userId: string
  cardId: string
  source: StudySource
  outcome: StudyOutcome
  /** Optional per-interaction metadata, persisted onto the StudyEvent row. */
  meta?: {
    latencyMs?: number
  }
}

export interface RecordStudyEventResult {
  confidence: number
  mastery: number | null
  /**
   * Spaced-repetition due date, computed by the pure `nextDueAt`
   * (lib/memory/schedule.ts) from the new confidence and the card's
   * consecutive-correct streak (`reps`).
   */
  dueAt: Date
}

/**
 * The single write path for study memory. Every mode — Review, Quiz
 * (MC/SA/TF), Matching, and (later) Lessons — must call this instead of
 * writing to `CardProgress`/event tables directly.
 *
 * Atomically:
 *  1. Reads the card's current confidence and reps (defaulting to 5/0, same
 *     as the legacy `recordReview`).
 *  2. Computes the new confidence via the pure `nextConfidence`.
 *  3. Computes a recency-weighted `mastery` via the pure `masteryScore`,
 *     folding in this interaction alongside recent StudyEvent history.
 *  4. Computes the new consecutive-correct streak (`reps`) and the next
 *     `dueAt` via the pure `nextDueAt` (lib/memory/schedule.ts).
 *  5. Upserts `CardProgress` (confidence, mastery, reps, dueAt, lastSeenAt).
 *  6. Inserts the new `StudyEvent` row.
 */
export async function recordStudyEvent(
  input: RecordStudyEventInput
): Promise<RecordStudyEventResult> {
  const { userId, cardId, source, outcome, meta } = input

  // Derive the fields StudyEvent/CardProgress actually store from the
  // outcome shape, using the same conventions already established in
  // src/actions/quiz.ts (`grade.overall * 10` for score, `>= 8` for correct).
  const correct = 'correct' in outcome ? outcome.correct : outcome.overall >= 8
  const score = 'overall' in outcome ? Math.round(outcome.overall * 10) : null

  return prisma.$transaction(async (tx) => {
    const current = await tx.cardProgress.findUnique({
      where: { userId_cardId: { userId, cardId } },
      select: { confidence: true, reps: true },
    })

    const oldConfidence = current?.confidence ?? 5
    const confidence = nextConfidence(oldConfidence, outcome)

    // Recent history for this card, used to compute mastery alongside the
    // interaction being recorded right now.
    const recentEvents = await tx.studyEvent.findMany({
      where: { userId, cardId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { correct: true, score: true, createdAt: true },
    })

    const thisEvent: MasteryEvent = { correct, score, createdAt: new Date() }
    const mastery = masteryScore([thisEvent, ...recentEvents])

    // --- Spaced-repetition scheduling (Task 4) ------------------------------
    // `reps` is redefined here (from the pre-Task-4 placeholder's
    // unconditional +1) to mean the current consecutive-correct streak: it
    // resets to 0 on a wrong/poorly-graded outcome and grows by 1 on a
    // correct/good one. This streak, together with the new confidence, is
    // what `nextDueAt` uses to grow (or reset) the review interval. Compute
    // it once here (rather than via Prisma's `{ increment: 1 }`) so the same
    // literal number can be passed to both `nextDueAt` and the `reps:` field
    // below — `increment` doesn't hand back the resulting value pre-write.
    const oldReps = current?.reps ?? 0
    const reps = correct ? oldReps + 1 : 0
    const lastSeenAt = new Date()
    const dueAt = nextDueAt({ correct, confidence, reps, now: lastSeenAt })
    // ------------------------------------------------------------------------

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: {
        confidence,
        mastery,
        lastSeenAt,
        reps,
        dueAt,
      },
      create: {
        userId,
        cardId,
        confidence,
        mastery,
        starred: false,
        lastSeenAt,
        reps,
        dueAt,
      },
    })

    await tx.studyEvent.create({
      data: {
        userId,
        cardId,
        source,
        correct,
        score,
        confidenceAfter: confidence,
        latencyMs: meta?.latencyMs,
      },
    })

    return { confidence, mastery, dueAt }
  })
}
