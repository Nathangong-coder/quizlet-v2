/**
 * Group progress: what members see about each other on a group's sets.
 *
 * PURE. Everything a member sees is computed here from rows the loader has
 * already filtered to (member of THIS group) × (card of THIS group's readable
 * sets). Nothing is stored, so leaving a group ends the sharing at once and
 * there is nothing to erase — that is the privacy contract, and this module
 * is where it is kept.
 *
 * "Mastered" is a confidence threshold, not KLP mastery: confidence exists on
 * every card in every mode, KLP state only where key points were authored,
 * and a leaderboard that counts one member's authored set and not another's
 * legacy set is comparing different things.
 */

/** Confidence at or above which a card counts as mastered for group views. */
export const MASTERED_CONFIDENCE = 7

export interface GroupMemberRef {
  userId: string
  handle: string | null
}

export interface MemberProgressRow {
  userId: string
  cardId: string
  confidence: number
  updatedAt: Date
}

export interface MemberSessionRow {
  userId: string
  setId: string
  durationMs: number | null
  startedAt: Date
}

export interface MemberSetStanding {
  userId: string
  handle: string | null
  /** Cards with a progress row. */
  studied: number
  /** Cards at or above MASTERED_CONFIDENCE. */
  mastered: number
  /** Cards in the set with no progress row. */
  unstudied: number
  /** Mean confidence over studied cards; null when none — never 0. */
  averageConfidence: number | null
  lastStudiedAt: Date | null
  timeMs: number
  /** 1-based; ties share a rank. */
  rank: number
}

export interface CardCoverage {
  cardId: string
  /** Members who have mastered this card, sorted by handle for a stable read. */
  masteredBy: GroupMemberRef[]
  /** Members with a row below the threshold. */
  learningBy: GroupMemberRef[]
}

export interface SetLeaderboard {
  setId: string
  cardCount: number
  standings: MemberSetStanding[]
  cards: CardCoverage[]
}

function byHandle(a: GroupMemberRef, b: GroupMemberRef): number {
  return (a.handle ?? '').localeCompare(b.handle ?? '') || a.userId.localeCompare(b.userId)
}

/**
 * Ranked by mastered, then by studied, then by mean confidence; a member with
 * no rows at all sits last with zeros and a null average. Ties share a rank
 * (1, 1, 3), so two people who have done identical work are not ordered by
 * who signed up first.
 */
export function shapeSetLeaderboard(input: {
  setId: string
  cardIds: readonly string[]
  members: readonly GroupMemberRef[]
  progress: readonly MemberProgressRow[]
  sessions: readonly MemberSessionRow[]
}): SetLeaderboard {
  const cardSet = new Set(input.cardIds)
  const memberIds = new Set(input.members.map((m) => m.userId))

  const per = new Map<string, { studied: number; mastered: number; total: number; last: Date | null; timeMs: number }>()
  for (const m of input.members) per.set(m.userId, { studied: 0, mastered: 0, total: 0, last: null, timeMs: 0 })

  const coverage = new Map<string, { mastered: GroupMemberRef[]; learning: GroupMemberRef[] }>()
  for (const id of input.cardIds) coverage.set(id, { mastered: [], learning: [] })
  const memberRef = new Map(input.members.map((m) => [m.userId, m]))

  for (const row of input.progress) {
    // Defensive: the loader filters both, but a row for a non-member or a
    // card outside the set must never leak into a member's numbers.
    if (!memberIds.has(row.userId) || !cardSet.has(row.cardId)) continue
    const acc = per.get(row.userId)!
    acc.studied += 1
    acc.total += row.confidence
    if (row.confidence >= MASTERED_CONFIDENCE) acc.mastered += 1
    if (!acc.last || row.updatedAt > acc.last) acc.last = row.updatedAt
    const cov = coverage.get(row.cardId)!
    ;(row.confidence >= MASTERED_CONFIDENCE ? cov.mastered : cov.learning).push(memberRef.get(row.userId)!)
  }

  for (const s of input.sessions) {
    if (s.setId !== input.setId || !memberIds.has(s.userId)) continue
    const acc = per.get(s.userId)!
    acc.timeMs += s.durationMs ?? 0
    if (!acc.last || s.startedAt > acc.last) acc.last = s.startedAt
  }

  const standings: MemberSetStanding[] = input.members.map((m) => {
    const acc = per.get(m.userId)!
    return {
      userId: m.userId,
      handle: m.handle,
      studied: acc.studied,
      mastered: acc.mastered,
      unstudied: input.cardIds.length - acc.studied,
      averageConfidence: acc.studied === 0 ? null : Math.round((acc.total / acc.studied) * 10) / 10,
      lastStudiedAt: acc.last,
      timeMs: acc.timeMs,
      rank: 0,
    }
  })

  standings.sort(
    (a, b) =>
      b.mastered - a.mastered ||
      b.studied - a.studied ||
      (b.averageConfidence ?? -1) - (a.averageConfidence ?? -1) ||
      byHandle(a, b),
  )
  let rank = 0
  for (let i = 0; i < standings.length; i++) {
    const prev = standings[i - 1]
    const cur = standings[i]
    const tied =
      prev &&
      prev.mastered === cur.mastered &&
      prev.studied === cur.studied &&
      prev.averageConfidence === cur.averageConfidence
    if (!tied) rank = i + 1
    cur.rank = rank
  }

  const cards: CardCoverage[] = input.cardIds.map((cardId) => {
    const cov = coverage.get(cardId)!
    return { cardId, masteredBy: [...cov.mastered].sort(byHandle), learningBy: [...cov.learning].sort(byHandle) }
  })

  return { setId: input.setId, cardCount: input.cardIds.length, standings, cards }
}

/** "3h 20m" / "45m" / "—" for the leaderboard's time column. */
export function formatStudyTime(ms: number): string {
  if (ms <= 0) return '—'
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return '<1m'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
