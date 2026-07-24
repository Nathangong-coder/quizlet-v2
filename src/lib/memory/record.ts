import { prisma } from '@/lib/db'
import { nextConfidence, masteryScore } from './scoring'
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
   * Spaced-repetition due date. Always `null` today — Task 4 (this same
   * plan) introduces `nextDueAt` and wires it in below. See the extension
   * point in the transaction.
   */
  dueAt: Date | null
}

/**
 * The single write path for study memory. Every mode — Review, Quiz
 * (MC/SA/TF), Matching, and (later) Lessons — must call this instead of
 * writing to `CardProgress`/event tables directly.
 *
 * Atomically:
 *  1. Reads the card's current confidence (defaulting to 5, same as the
 *     legacy `recordReview`).
 *  2. Computes the new confidence via the pure `nextConfidence`.
 *  3. Computes a recency-weighted `mastery` via the pure `masteryScore`,
 *     folding in this interaction alongside recent StudyEvent history.
 *  4. Upserts `CardProgress` (confidence, mastery, reps, lastSeenAt).
 *  5. Inserts the new `StudyEvent` row.
 *
 * `dueAt` is a trivial no-op placeholder until Task 4 lands `nextDueAt` —
 * see the extension point marked below.
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
      select: { confidence: true },
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

    // --- Task 4 extension point -------------------------------------------
    // Replace with: const dueAt = nextDueAt({ confidence, mastery, reps, ... })
    // For now, dueAt is left untouched and reps/lastSeenAt get a trivial bump.
    const dueAt: Date | null = null
    const lastSeenAt = new Date()
    // ------------------------------------------------------------------------

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: {
        confidence,
        mastery,
        lastSeenAt,
        reps: { increment: 1 },
      },
      create: {
        userId,
        cardId,
        confidence,
        mastery,
        starred: false,
        lastSeenAt,
        reps: 1,
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
