/**
 * Lightweight SM-2-style spaced-repetition scheduling for the unified
 * study-memory write path (Stage 6, Task 4).
 *
 * `nextDueAt` is the pure scheduling function called from
 * `lib/memory/record.ts` on every `recordStudyEvent`. `getDueCards` is a
 * thin DB-querying shell (same shape as `buildLearnerProfile` in
 * `lib/memory/profile.ts`) used by Review-mode defaults and (later) the
 * Personalized Learning Plans "today" list — nothing calls it yet.
 *
 * This is intentionally NOT a full SM-2/FSRS implementation — see the task
 * report for the explicit formula/constants and rationale. It is simple,
 * deterministic, and fully unit-tested.
 */

// ---------------------------------------------------------------------------
// nextDueAt
// ---------------------------------------------------------------------------

/**
 * `reps` here is redefined (from the pre-Task-4 placeholder's "unconditional
 * +1 every interaction") to mean the current **consecutive-correct streak**:
 * it resets to 0 on a wrong/poor outcome and increments by 1 on a
 * correct/good one. Nothing else in the codebase reads `CardProgress.reps`
 * today (confirmed by grep before making this change), so redefining its
 * semantics here is safe. This streak is what drives interval growth below.
 */
export interface NextDueAtInput {
  /** Whether this interaction was correct (binary modes) or graded well
   *  (short-answer `overall >= 8`, same convention `record.ts` already
   *  uses to derive its own `correct` flag). */
  correct: boolean
  /** The card's confidence *after* this interaction (1-10 scale). */
  confidence: number
  /** The new consecutive-correct streak (post this interaction) — 0 when
   *  `correct` is false, otherwise the caller's previous streak + 1. */
  reps: number
  /** Injectable clock so this stays pure/testable (no `Date.now()` inside). */
  now: Date
}

/** Interval (days) a wrong/poorly-graded outcome resets the card to. */
export const RESET_INTERVAL_DAYS = 1

/** Baseline interval (days) for the first correct rep of a fresh streak. */
export const BASE_INTERVAL_DAYS = 1

/** Geometric growth rate applied per additional consecutive-correct rep. */
export const GROWTH_RATE = 2

/** Hard cap (days) so a well-known card never disappears from review forever. */
export const MAX_INTERVAL_DAYS = 60

/** Confidence-based interval multiplier range (confidence 1-10 -> this range). */
const CONFIDENCE_SCALE_MIN = 0.5
const CONFIDENCE_SCALE_MAX = 1.5

/**
 * Linearly maps confidence (1-10, clamped) to a multiplier between
 * CONFIDENCE_SCALE_MIN (at confidence=1) and CONFIDENCE_SCALE_MAX (at
 * confidence=10). A more-confident card gets a longer jump for the same
 * streak length; a shaky one gets a shorter one.
 */
function confidenceScale(confidence: number): number {
  const clamped = Math.min(10, Math.max(1, confidence))
  const t = (clamped - 1) / 9
  return CONFIDENCE_SCALE_MIN + t * (CONFIDENCE_SCALE_MAX - CONFIDENCE_SCALE_MIN)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

/**
 * Computes the next due date for a card, pure (no `Date.now()` inside — the
 * caller passes `now`).
 *
 * - **Wrong/poor outcome** -> reset to `RESET_INTERVAL_DAYS` (due again
 *   ~tomorrow), regardless of confidence/streak. The caller is expected to
 *   have also reset `reps` to 0 for this same interaction (see
 *   `NextDueAtInput.reps` doc above) so the growth curve restarts from
 *   scratch next time the card is answered correctly.
 * - **Correct/good outcome** -> geometric growth from the streak:
 *   `days = BASE_INTERVAL_DAYS * GROWTH_RATE ** (reps - 1) * confidenceScale`,
 *   capped at `MAX_INTERVAL_DAYS`. With GROWTH_RATE=2 and confidence in the
 *   middle of its range, a streak grows roughly 1 -> 2 -> 4 -> 8 -> 16 -> 32
 *   -> 60(capped) days; a low-confidence streak grows slower, a
 *   high-confidence one faster, within the same shape.
 * - The resulting day count is rounded to the nearest whole day and floored
 *   at 1, so `dueAt` is always strictly in the future relative to `now`.
 */
export function nextDueAt(input: NextDueAtInput): Date {
  const { correct, confidence, reps, now } = input

  if (!correct) {
    return addDays(now, RESET_INTERVAL_DAYS)
  }

  const streak = Math.max(1, reps)
  const rawDays =
    BASE_INTERVAL_DAYS * GROWTH_RATE ** (streak - 1) * confidenceScale(confidence)
  const days = Math.max(1, Math.min(MAX_INTERVAL_DAYS, Math.round(rawDays)))

  return addDays(now, days)
}

// ---------------------------------------------------------------------------
// getDueCards
// ---------------------------------------------------------------------------

/** Minimal shape of a due-candidate row (CardProgress joined to Card text). */
export interface DueCardRow {
  cardId: string
  term: string
  definition: string
  dueAt: Date | null
  confidence: number
}

/**
 * Pure ordering/selection logic over already-fetched rows, extracted so it's
 * unit-testable without a database (same "thin DB shell + pure shaper"
 * pattern as `shapeLearnerProfile`/`buildLearnerProfile`).
 *
 * A row counts as due if `dueAt` is `null` (never scheduled — e.g. never
 * reviewed, or reviewed before Task 4 shipped) or `dueAt <= now`. Never-
 * scheduled cards sort first (most in need of a first review), then by
 * oldest `dueAt` first (most overdue first). Capped at `limit`.
 */
export function selectDueCards(rows: DueCardRow[], now: Date, limit: number): DueCardRow[] {
  const due = rows.filter((r) => r.dueAt === null || r.dueAt.getTime() <= now.getTime())

  due.sort((a, b) => {
    if (a.dueAt === null && b.dueAt === null) return 0
    if (a.dueAt === null) return -1
    if (b.dueAt === null) return 1
    return a.dueAt.getTime() - b.dueAt.getTime()
  })

  return due.slice(0, Math.max(0, limit))
}

/**
 * Defensive bound on how many CardProgress rows `getDueCards` fetches from
 * the DB before applying `selectDueCards`'s ordering/limit — deep enough to
 * cover an active user's/set's full due queue, shallow enough to keep the
 * query bounded regardless of total lifetime card count.
 */
export const DUE_CARDS_FETCH_CAP = 500

// ---------------------------------------------------------------------------
// Thin DB-querying shell. Deliberately untested here (no DB-mocking
// precedent exists in this suite, per Task 3's `buildLearnerProfile`) — all
// real logic lives in `selectDueCards` above, which is fully covered by
// tests/memory/schedule.test.ts.
//
// `prisma` is imported dynamically for the same reason `profile.ts` does:
// `lib/db.ts` throws at import time if `DATABASE_URL` isn't set, and vitest
// doesn't load `.env`, so a top-level import would break this file's pure
// tests too.
// ---------------------------------------------------------------------------

/**
 * Cards due for review for a user (optionally scoped to one set): never
 * reviewed yet, or with `dueAt <= now`. Ordered never-reviewed/oldest-due
 * first, capped at `limit`. Used for Review-mode defaults and (later) the
 * Personalized Learning Plans "today" list.
 *
 * Returns `term`/`definition` text alongside `cardId` (not a bare ID) since
 * callers need something directly usable.
 */
export async function getDueCards(
  userId: string,
  setId?: string,
  limit = 20,
  now: Date = new Date(),
): Promise<DueCardRow[]> {
  const { prisma } = await import('@/lib/db')
  const cardFilter = setId ? { card: { setId } } : {}

  const rows = await prisma.cardProgress.findMany({
    where: {
      userId,
      ...cardFilter,
      OR: [{ dueAt: null }, { dueAt: { lte: now } }],
    },
    // Mirror `selectDueCards`'s own ordering (never-scheduled first, then
    // oldest-due first) here too: with `take: DUE_CARDS_FETCH_CAP` bounding
    // the fetch, an unordered query could truncate to an arbitrary subset
    // before `selectDueCards` ever sees the true most-overdue rows. Ordering
    // at the DB level ensures the rows kept by the cap are exactly the ones
    // `selectDueCards` would have picked first anyway.
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'first' } }],
    take: DUE_CARDS_FETCH_CAP,
    select: {
      cardId: true,
      dueAt: true,
      confidence: true,
      card: { select: { term: true, definition: true } },
    },
  })

  const dueRows: DueCardRow[] = rows.map((r) => ({
    cardId: r.cardId,
    term: r.card.term,
    definition: r.card.definition,
    dueAt: r.dueAt,
    confidence: r.confidence,
  }))

  return selectDueCards(dueRows, now, limit)
}
