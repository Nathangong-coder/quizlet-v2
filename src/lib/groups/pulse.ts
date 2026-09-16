import type { SetLeaderboard } from './progress'

/**
 * The group's pulse — pure shaping over the per-set leaderboards the loader
 * already builds. Nothing here reads the database.
 */

export interface PulseSet {
  setId: string
  title: string
  readable: boolean
}

export interface PulseOverview {
  leaderboard: SetLeaderboard
  cards: { id: string; term: string }[]
}

export interface NextCard {
  cardId: string
  setId: string
  term: string
  setTitle: string
  masteredCount: number
  learningCount: number
  memberCount: number
}

/**
 * The cards the fewest members have mastered, across every readable set —
 * where the group studies next. Ties break toward cards MORE people are
 * already learning (a card with momentum beats one nobody has opened).
 */
export function studyNext(sets: readonly PulseSet[], overview: Record<string, PulseOverview>, memberCount: number, limit: number): NextCard[] {
  const out: NextCard[] = []
  for (const s of sets) {
    const o = overview[s.setId]
    if (!s.readable || !o) continue
    const termBy = new Map(o.cards.map((c) => [c.id, c.term]))
    for (const c of o.leaderboard.cards) {
      out.push({
        cardId: c.cardId,
        setId: s.setId,
        term: termBy.get(c.cardId) ?? '',
        setTitle: s.title,
        masteredCount: c.masteredBy.length,
        learningCount: c.learningBy.length,
        memberCount,
      })
    }
  }
  out.sort((a, b) => a.masteredCount - b.masteredCount || b.learningCount - a.learningCount || a.term.localeCompare(b.term))
  return out.slice(0, limit)
}

/** Per member, mastered / learning summed over every readable set. */
export function memberTotals(memberIds: readonly string[], overview: Record<string, PulseOverview>): Map<string, { mastered: number; learning: number }> {
  const totals = new Map<string, { mastered: number; learning: number }>()
  for (const id of memberIds) totals.set(id, { mastered: 0, learning: 0 })
  for (const o of Object.values(overview)) {
    for (const st of o.leaderboard.standings) {
      const t = totals.get(st.userId)
      if (t) {
        t.mastered += st.mastered
        t.learning += st.studied - st.mastered
      }
    }
  }
  return totals
}

/** How many cards, across every readable set, nobody has mastered. */
export function countNobody(overview: Record<string, PulseOverview>): number {
  let n = 0
  for (const o of Object.values(overview)) for (const c of o.leaderboard.cards) if (c.masteredBy.length === 0) n += 1
  return n
}
