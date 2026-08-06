/** Frozen reference docs/ai/error-taxonomy.md §5. */
export const PROMOTE_MIN_OCCURRENCES = 2
export const PROMOTE_MIN_SESSIONS = 2
export const RETIRE_AFTER_DAYS = 30
export const RETIRE_AFTER_CLEAN_ANSWERS = 3

/** One `type = 'conflation'` error tag. */
export interface ConflationTag {
  klpId: string
  secondaryKlpId: string
  sessionId: string
  quote: string | null
  createdAt: Date
}

export interface Misconception {
  klpId: string
  secondaryKlpId: string
  occurrences: number
  sessionCount: number
  lastSeenAt: Date
  /** The verbatim learner quote from the triggering tag. Never regenerated. */
  evidenceSnippet: string | null
  active: boolean
  retiredReason: 'stale' | 'cleared' | null
}

/** One per-KLP outcome, for streak counting. */
export interface KlpOutcome {
  klpId: string
  status: 'passed' | 'partial' | 'failed'
  createdAt: Date
}

/**
 * Consecutive `passed` outcomes per KLP, counted back from the most recent.
 *
 * `partial` breaks a streak: retirement means the confusion is gone, and a
 * half-right answer is not evidence of that.
 */
export function computeCleanStreaks(outcomes: KlpOutcome[]): Record<string, number> {
  const byKlp = new Map<string, KlpOutcome[]>()
  for (const o of outcomes) {
    const list = byKlp.get(o.klpId)
    if (list) list.push(o)
    else byKlp.set(o.klpId, [o])
  }

  const streaks: Record<string, number> = {}
  for (const [klpId, list] of byKlp) {
    const newestFirst = [...list].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    let streak = 0
    for (const o of newestFirst) {
      if (o.status !== 'passed') break
      streak++
    }
    streaks[klpId] = streak
  }
  return streaks
}

/**
 * Derive misconceptions from accumulated conflation tags.
 *
 * A model asked to NAME a misconception invents fresh phrasing every time and
 * the same confusion never aggregates with itself — so the entity is derived
 * here, deterministically, and only its human-readable label is ever an AI
 * call.
 *
 * `(a,b)` and `(b,a)` are deliberately distinct: describing WACC using CAPM's
 * content is a different error from the reverse.
 */
export function deriveMisconceptions(input: {
  tags: ConflationTag[]
  /** Consecutive clean answers per klpId, as of now. */
  cleanStreaks: Record<string, number>
  now: Date
}): Misconception[] {
  const groups = new Map<string, ConflationTag[]>()
  for (const t of input.tags) {
    const key = `${t.klpId}::${t.secondaryKlpId}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  const out: Misconception[] = []
  for (const tags of groups.values()) {
    const sessions = new Set(tags.map((t) => t.sessionId))
    if (tags.length < PROMOTE_MIN_OCCURRENCES) continue
    if (sessions.size < PROMOTE_MIN_SESSIONS) continue

    const chronological = [...tags].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    const latest = chronological[chronological.length - 1]

    const daysSince = (input.now.getTime() - latest.createdAt.getTime()) / 86_400_000
    const bothClean =
      (input.cleanStreaks[latest.klpId] ?? 0) >= RETIRE_AFTER_CLEAN_ANSWERS &&
      (input.cleanStreaks[latest.secondaryKlpId] ?? 0) >= RETIRE_AFTER_CLEAN_ANSWERS

    let retiredReason: Misconception['retiredReason'] = null
    if (daysSince >= RETIRE_AFTER_DAYS) retiredReason = 'stale'
    else if (bothClean) retiredReason = 'cleared'

    out.push({
      klpId: latest.klpId,
      secondaryKlpId: latest.secondaryKlpId,
      occurrences: tags.length,
      sessionCount: sessions.size,
      lastSeenAt: latest.createdAt,
      evidenceSnippet: latest.quote,
      active: retiredReason === null,
      retiredReason,
    })
  }

  return out
}
