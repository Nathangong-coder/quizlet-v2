/**
 * Decides, for one set save, which cards are updates, which are new, and which
 * were removed.
 *
 * Before this existed, `updateSet` deleted every card and recreated it, which
 * cascaded away CardProgress, StudyEvent, ConfidenceEvent, QuizAnswer and
 * QuizOptionCache — the set's entire learning history — on any edit.
 *
 * An id the set does not already own is never adopted: honouring it would let
 * a caller graft another user's card into their own set. Such a card is
 * created fresh, which is also what a stale editor tab needs.
 */
export interface CardReconcilePlan<T> {
  toUpdate: { id: string; card: T }[]
  toCreate: T[]
  toDeleteIds: string[]
}

export function reconcileCards<T extends { id?: string }>(
  existingIds: string[],
  input: T[],
): CardReconcilePlan<T> {
  const owned = new Set(existingIds)
  const claimed = new Set<string>()

  const toUpdate: { id: string; card: T }[] = []
  const toCreate: T[] = []

  for (const card of input) {
    const id = card.id
    if (id && owned.has(id) && !claimed.has(id)) {
      claimed.add(id)
      toUpdate.push({ id, card })
    } else {
      toCreate.push(card)
    }
  }

  return {
    toUpdate,
    toCreate,
    toDeleteIds: existingIds.filter((id) => !claimed.has(id)),
  }
}
