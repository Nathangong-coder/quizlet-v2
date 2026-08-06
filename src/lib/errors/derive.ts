import type { StudySource } from '@/lib/memory/scoring'
import type { Dimension } from '@/lib/errors/taxonomy'
import { computeSignificance } from '@/lib/errors/significance'
import { resolveSeverity, type BandTable } from '@/lib/errors/bands'

/** Per the frozen taxonomy reference §3. */
export const REPEAT_BONUS = 1
export const REPEAT_WINDOW_ATTEMPTS = 3

/** An AnswerErrorTag row as read, plus the attempt it belongs to. */
export interface StoredTag {
  attemptId: string
  dimension: Dimension
  type: string
  klpId: string | null
  relevance: number
  starred: boolean
  /** Null on rows written before Spec 3. */
  magnitude: number | null
  storedSeverity: number
  storedSignificance: number
  mode: StudySource
  createdAt: Date
}

/** An AnswerErrorTag row as Prisma returns it, with its answer joined. */
export interface RawTagRow {
  dimension: string
  type: string
  klpId: string | null
  relevance: number
  starred: boolean
  magnitude: number | null
  mode: string | null
  severity: number
  significance: number
  createdAt: Date
  quizAnswer: { attemptId: string }
}

/**
 * Map DB rows to the pure shape. Lives here, not in the read shell, so the
 * legacy-mode fallback is a tested decision rather than an untested one.
 *
 * A legacy row stores no mode. `quiz-sa` is the safe stand-in because it is
 * the only mode with no true/false dock — so a legacy tag is never docked on
 * a guess. Its severity comes from `storedSeverity` regardless, since a
 * legacy row also has no magnitude.
 */
export function toStoredTags(rows: RawTagRow[]): StoredTag[] {
  return rows.map((r) => ({
    attemptId: r.quizAnswer.attemptId,
    dimension: r.dimension as StoredTag['dimension'],
    type: r.type,
    klpId: r.klpId,
    relevance: r.relevance,
    starred: r.starred,
    magnitude: r.magnitude,
    mode: (r.mode ?? 'quiz-sa') as StoredTag['mode'],
    storedSeverity: r.severity,
    storedSignificance: r.significance,
    createdAt: r.createdAt,
  }))
}

export interface DerivedTag extends StoredTag {
  severity: number
  repeatBonus: number
  significance: number
  /** True when the row predates `magnitude` and its severity could not be rederived. */
  isLegacy: boolean
}

/**
 * Recompute severity and significance from stored inputs, then apply
 * `repeatBonus` — which cannot be frozen at write time because it depends on
 * whether the same (type, target) recurs in LATER attempts.
 *
 * Tags are processed in chronological order so each one sees only what came
 * before it. Callers may pass an unsorted array.
 */
export function deriveTagScores(tags: StoredTag[], bands?: BandTable): DerivedTag[] {
  const chronological = [...tags].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  // Attempt order, oldest first, so "within the last N attempts" is countable.
  const attemptOrder: string[] = []
  for (const t of chronological) {
    if (!attemptOrder.includes(t.attemptId)) attemptOrder.push(t.attemptId)
  }
  const attemptIndex = new Map(attemptOrder.map((id, i) => [id, i]))

  const seen: { key: string; attemptIdx: number }[] = []
  const out: DerivedTag[] = []

  for (const t of chronological) {
    const isLegacy = t.magnitude === null
    const severity = isLegacy
      ? t.storedSeverity
      : resolveSeverity({ type: t.type, magnitude: t.magnitude as number, mode: t.mode, bands })

    const key = `${t.type}::${t.klpId ?? 'whole'}`
    const here = attemptIndex.get(t.attemptId) ?? 0
    const repeated = seen.some(
      (s) => s.key === key && here - s.attemptIdx <= REPEAT_WINDOW_ATTEMPTS && here !== s.attemptIdx,
    )
    const repeatBonus = repeated ? REPEAT_BONUS : 0
    seen.push({ key, attemptIdx: here })

    const base = computeSignificance({
      relevance: t.relevance,
      severity,
      dimension: t.dimension,
      starred: t.starred,
    })

    out.push({
      ...t,
      severity,
      repeatBonus,
      significance: Math.min(10, base.significance + repeatBonus),
      isLegacy,
    })
  }

  return out
}
