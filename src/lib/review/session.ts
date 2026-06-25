export interface ReviewCard {
  id: string
  term: string
  definition: string
  confidence: number
}

export interface ReviewSession {
  queue: ReviewCard[]
  requeuedHighConf: string[]
  completed: string[]
}

export function initReviewSession(cards: ReviewCard[]): ReviewSession {
  return { queue: [...cards], requeuedHighConf: [], completed: [] }
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

  if (knew) {
    return { ...session, queue: rest, completed: [...session.completed, cardId] }
  }

  const alreadyRequeued = session.requeuedHighConf.includes(cardId)

  if (alreadyRequeued) {
    return { ...session, queue: rest, completed: [...session.completed, cardId] }
  }

  const updatedCard = { ...card, confidence: Math.max(1, card.confidence - 1) }
  const requeuedHighConf =
    card.confidence > 5
      ? [...session.requeuedHighConf, cardId]
      : session.requeuedHighConf

  return { queue: [...rest, updatedCard], requeuedHighConf, completed: session.completed }
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
