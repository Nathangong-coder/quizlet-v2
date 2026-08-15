import type { PrismaClient } from '@prisma/client'

/** One `CardProgress` row, narrowed to what a set summary reads. */
export interface SetProgressRow {
  setId: string
  confidence: number
  dueAt: Date | null
  updatedAt: Date
}

export interface SetStudySummary {
  studiedCards: number
  /**
   * Mean confidence over STUDIED cards, or null when none are.
   *
   * NEVER 0 for an unstudied set. Zero would read as "you know none of this"
   * on a set nobody has opened — the same null-is-not-zero rule the learner
   * dashboard follows, and the reason `LearnerTopicProfile.knowledge` is
   * nullable too.
   */
  averageConfidence: number | null
  /**
   * Cards due for review now.
   *
   * A NULL `dueAt` counts as DUE, matching `getDueCards`
   * (`src/lib/memory/schedule.ts:185`: `OR: [{ dueAt: null }, { dueAt: { lte: now } }]`)
   * and the `CardProgress.dueAt` schema comment. Null means never scheduled —
   * a starred-but-unstudied card, or a row written before the scheduler
   * existed — which is a reason to review it, not to hide it. Treating null as
   * "not due" here would make the sets list report fewer due cards than Review
   * mode then offers, and a learner cannot tell which surface is lying.
   */
  dueCount: number
  lastStudiedAt: Date | null
}

export const EMPTY_SET_SUMMARY: SetStudySummary = {
  studiedCards: 0,
  averageConfidence: null,
  dueCount: 0,
  lastStudiedAt: null,
}

/**
 * Group progress rows into a per-set summary.
 *
 * Pure, so the null-average rule and the due boundary are tested without a
 * database — the two places this can quietly go wrong.
 */
export function shapeSetSummaries(
  rows: SetProgressRow[],
  now: Date,
): Record<string, SetStudySummary> {
  const acc: Record<string, { total: number; count: number; due: number; last: Date | null }> = {}

  for (const row of rows) {
    const bucket = (acc[row.setId] ??= { total: 0, count: 0, due: 0, last: null })
    bucket.total += row.confidence
    bucket.count += 1
    // Null is DUE (never scheduled), and `<=` not `<` — a card due exactly now
    // is due. Both halves mirror `getDueCards`; diverging on either makes this
    // list disagree with what Review mode actually offers.
    if (row.dueAt === null || row.dueAt.getTime() <= now.getTime()) bucket.due += 1
    if (bucket.last === null || row.updatedAt > bucket.last) bucket.last = row.updatedAt
  }

  const out: Record<string, SetStudySummary> = {}
  for (const [setId, b] of Object.entries(acc)) {
    out[setId] = {
      studiedCards: b.count,
      // No `count === 0 ? null` guard: a bucket only exists because a row
      // created it, so the count is never zero here. An earlier draft had that
      // ternary and mutation testing showed it could be changed to `? 0`
      // without any test noticing — because the branch is unreachable.
      //
      // The nullable average comes from ABSENCE instead: a set with no progress
      // rows gets no entry in this map at all, and callers render nothing
      // rather than a zero. `EMPTY_SET_SUMMARY` carries the null for the
      // explicit case.
      averageConfidence: b.total / b.count,
      dueCount: b.due,
      lastStudiedAt: b.last,
    }
  }
  return out
}

/**
 * Progress rows for the given sets, owner-scoped.
 *
 * `CardProgress` has no `setId` of its own — it reaches one through its card —
 * so the grouping key is lifted here rather than in the pure shaper, which
 * should not know about Prisma's nesting.
 */
export async function loadSetStudySummaries(
  prisma: PrismaClient,
  userId: string,
  setIds: string[],
  now: Date = new Date(),
): Promise<Record<string, SetStudySummary>> {
  if (setIds.length === 0) return {}

  const rows = await prisma.cardProgress.findMany({
    where: { userId, card: { setId: { in: setIds } } },
    select: {
      confidence: true,
      dueAt: true,
      updatedAt: true,
      card: { select: { setId: true } },
    },
  })

  return shapeSetSummaries(
    rows.map((r) => ({
      setId: r.card.setId,
      confidence: r.confidence,
      dueAt: r.dueAt,
      updatedAt: r.updatedAt,
    })),
    now,
  )
}
