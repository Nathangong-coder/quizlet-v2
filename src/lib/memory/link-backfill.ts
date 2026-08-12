import { toQuizMode } from '@/lib/quiz/mode'

/**
 * One-time matcher for StudyEvent rows written before `quizAnswerId` existed.
 *
 * Deliberately conservative. A wrong link means a later erasure deletes the
 * wrong memory row — silently, and with no way to notice. An unlinked legacy
 * row is merely incomplete. So an ambiguous group links NOTHING.
 */
export interface LegacyEvent {
  id: string
  cardId: string
  sessionId: string | null
  source: string
  createdAt: Date
}

export interface LegacyAnswer {
  id: string
  cardId: string
  sessionId: string | null
  mode: string
  createdAt: Date
}

/** Two candidates within this many ms of each other are indistinguishable. */
const AMBIGUITY_WINDOW_MS = 1000

export function pairStudyEventsToAnswers(
  events: LegacyEvent[],
  answers: LegacyAnswer[],
): { eventId: string; quizAnswerId: string }[] {
  const claimed = new Set<string>()
  const pairs: { eventId: string; quizAnswerId: string }[] = []

  for (const event of events) {
    // `review` and `lesson` have no quiz mode at all. `toQuizMode` returns null
    // for those, and null must match nothing rather than fall through to every
    // mode (see src/lib/quiz/mode.ts).
    const mode = toQuizMode(event.source)
    if (mode === null || event.sessionId === null) continue

    const candidates = answers.filter(
      (a) =>
        !claimed.has(a.id) &&
        a.cardId === event.cardId &&
        a.sessionId === event.sessionId &&
        a.mode === mode,
    )
    if (candidates.length === 0) continue

    const byDistance = [...candidates].sort(
      (a, b) =>
        Math.abs(a.createdAt.getTime() - event.createdAt.getTime()) -
        Math.abs(b.createdAt.getTime() - event.createdAt.getTime()),
    )

    if (byDistance.length > 1) {
      const first = Math.abs(byDistance[0].createdAt.getTime() - event.createdAt.getTime())
      const second = Math.abs(byDistance[1].createdAt.getTime() - event.createdAt.getTime())
      if (Math.abs(second - first) < AMBIGUITY_WINDOW_MS) continue
    }

    claimed.add(byDistance[0].id)
    pairs.push({ eventId: event.id, quizAnswerId: byDistance[0].id })
  }

  return pairs
}
