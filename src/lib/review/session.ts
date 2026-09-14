import { ContentBlock } from '../cards/content'

export interface ReviewCard {
  id: string
  term: string
  definition: string
  confidence: number
  contentBlocks?: ContentBlock[]
}

/** What happened to one card over the session, for the summary. */
export interface ReviewOutcome {
  /** Did the first answer say "know it"? */
  firstKnew: boolean
  /** How many times the card was answered. */
  attempts: number
  startConfidence: number
  /** Confidence after the last answer, as the deck tracked it (±1 per answer, clamped). */
  endConfidence: number
}

export interface ReviewSession {
  queue: ReviewCard[]
  requeuedHighConf: string[]
  completed: string[]
  /** Per card, filled in as answers arrive. Optional so older shapes still type. */
  outcomes?: Record<string, ReviewOutcome>
}

export function initReviewSession(cards: ReviewCard[]): ReviewSession {
  return { queue: [...cards], requeuedHighConf: [], completed: [], outcomes: {} }
}

export function currentCard(session: ReviewSession): ReviewCard | null {
  return session.queue[0] ?? null
}

export function answerCard(
  session: ReviewSession,
  cardId: string,
  knew: boolean
): ReviewSession {
  const card = session.queue.find((c) => c.id === cardId)
  if (!card) return session

  const rest = session.queue.filter((c) => c.id !== cardId)
  const prev = session.outcomes?.[cardId]
  const endConfidence = knew ? Math.min(10, card.confidence + 1) : Math.max(1, card.confidence - 1)
  const outcomes: Record<string, ReviewOutcome> = {
    ...(session.outcomes ?? {}),
    [cardId]: prev
      ? { ...prev, attempts: prev.attempts + 1, endConfidence }
      : { firstKnew: knew, attempts: 1, startConfidence: card.confidence, endConfidence },
  }

  if (knew) {
    return { ...session, queue: rest, completed: [...session.completed, cardId], outcomes }
  }

  const alreadyRequeued = session.requeuedHighConf.includes(cardId)

  if (alreadyRequeued) {
    return { ...session, queue: rest, completed: [...session.completed, cardId], outcomes }
  }

  const updatedCard = { ...card, confidence: endConfidence }
  const requeuedHighConf =
    card.confidence > 5
      ? [...session.requeuedHighConf, cardId]
      : session.requeuedHighConf

  return { queue: [...rest, updatedCard], requeuedHighConf, completed: session.completed, outcomes }
}

export function isReviewComplete(session: ReviewSession): boolean {
  return session.queue.length === 0
}

export function progressStats(session: ReviewSession): {
  total: number
  completed: number
  remaining: number
} {
  const total = session.completed.length + session.queue.length
  return { total, completed: session.completed.length, remaining: session.queue.length }
}

export interface ReviewSummary {
  total: number
  /** Known on the first showing. */
  knownFirstTime: number
  /** Answered "don't know" at least once. */
  missed: number
  /** Cards whose deck-tracked confidence ended higher / lower than it began. */
  up: number
  down: number
  /** The missed cards, for "review these again". */
  missedIds: string[]
}

/** The end-of-session picture, from the outcomes the deck recorded. */
export function summarizeReview(session: ReviewSession): ReviewSummary {
  const outcomes = session.outcomes ?? {}
  const ids = Object.keys(outcomes)
  const missedIds = ids.filter((id) => !outcomes[id].firstKnew)
  return {
    total: ids.length,
    knownFirstTime: ids.filter((id) => outcomes[id].firstKnew).length,
    missed: missedIds.length,
    up: ids.filter((id) => outcomes[id].endConfidence > outcomes[id].startConfidence).length,
    down: ids.filter((id) => outcomes[id].endConfidence < outcomes[id].startConfidence).length,
    missedIds,
  }
}
