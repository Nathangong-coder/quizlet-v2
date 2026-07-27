# Unified Memory Write Path Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route `starCard` and `updateConfidence` (currently direct `CardProgress` writes) through the unified `StudyEvent` write path, add a dual confidence model (computer-driven `confidence` nudged, not overwritten, by a manual `selfRating`), and fix the non-owned-set history discoverability gap — closing out the three Important findings from the memory-history-and-selective-reset final review.

**Architecture:** Additive to the existing Stage 6 write path. Two new "memory-only" `StudyEvent` sources (`star`/`unstar`/`self-rating`) that never influence mastery, `reps`, or `dueAt`. `recomputeCardProgress` becomes source-aware so it can correctly replay all three event kinds after a deletion. No change to how outcome-based modes (review/quiz-mc/quiz-sa/quiz-tf/matching/lesson) compute confidence or scheduling.

**Tech Stack:** Next.js Server Actions, Prisma/Postgres, Vitest.

## Global Constraints

- One schema migration only: `CardProgress.selfRating Int?` (nullable). No other schema changes.
- `StudyEvent.source` gains `'star'`, `'unstar'`, `'self-rating'` as new documented string values — no column change (`source` is already an unconstrained `String`).
- Star/unstar/self-rating events never affect `mastery`, `reps`, or `dueAt`. Every place that builds the input to `masteryScore` (both `record.ts`'s live path and `recompute.ts`'s replay) must filter to outcome sources only, via the new `isOutcomeSource`/`MEMORY_ONLY_SOURCES` export from `scoring.ts`.
- A self-rating nudges `CardProgress.confidence` via the pure `blendSelfRating(computerConfidence, selfRating, weight=0.3)` — it never overwrites confidence outright.
- No automated tests for DB-touching action functions or UI (consistent with this repo's existing convention — no DB-mocking precedent anywhere). New pure logic (`blendSelfRating`, `isOutcomeSource`, the rewritten `recomputeCardProgress`) gets full Vitest coverage mirroring `tests/memory/scoring.test.ts` / `tests/memory/recompute.test.ts`'s existing style.
- Destructive/manual actions (`starCard`, `updateConfidence`) keep their existing call signatures — this plan only changes what happens *inside* them, not how components call them.

---

### Task 1: Schema migration — `CardProgress.selfRating`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260726120000_add_self_rating_to_card_progress/migration.sql`

**Interfaces:**
- Produces: `CardProgress.selfRating: number | null` on the Prisma Client, consumed by Task 4 (`recordSelfRating`), Task 3 (`recomputeCardProgress`'s output), and Task 6 (`deleteStudyEvent`'s upsert).

- [ ] **Step 1: Edit the schema**

In `prisma/schema.prisma`, modify the `CardProgress` model:

```prisma
model CardProgress {
  id         String    @id @default(cuid())
  userId     String
  cardId     String
  confidence Int       @default(5)
  starred    Boolean   @default(false)
  // Stage 6 (Persistent Memory): recency-weighted mastery (0-100), spaced-
  // repetition scheduling state. dueAt/reps/lastSeenAt are computed and
  // written by src/lib/memory/record.ts on every recordStudyEvent call, via
  // the pure nextDueAt (src/lib/memory/schedule.ts). `reps` is the current
  // consecutive-correct streak (resets to 0 on a wrong/poor outcome), which
  // nextDueAt uses to grow (or reset) the interval feeding `dueAt`. Stays
  // nullable because rows written before Task 4 (or never reviewed) may
  // still have `dueAt: null` — treated as "due now" by getDueCards.
  mastery    Int?
  dueAt      DateTime?
  lastSeenAt DateTime?
  reps       Int       @default(0)
  // The user's latest manual 1-10 self-rating, written by
  // src/lib/memory/record.ts's recordSelfRating. Tracked separately from
  // `confidence`: a self-rating nudges (never overwrites) `confidence` via
  // the pure `blendSelfRating` (scoring.ts), and is excluded from mastery
  // and spaced-repetition scheduling.
  selfRating Int?
  updatedAt  DateTime  @updatedAt
  createdAt  DateTime  @default(now())
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  card       Card      @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([userId, cardId])
  @@index([userId])
}
```

Also update the `StudyEvent` model's doc comment (directly above `model StudyEvent {`) to:

```prisma
/// Unified study-memory event log. The single write path (recordStudyEvent,
/// recordStarToggle, recordSelfRating — all in src/lib/memory/record.ts) is
/// the only writer — every study mode (review, quiz MC/SA/TF, matching,
/// lesson) plus starring/unstarring and manual self-ratings log here on
/// every interaction. `source` values `star`/`unstar`/`self-rating` are
/// excluded from mastery and spaced-repetition scheduling — see
/// scoring.ts's `isOutcomeSource`.
model StudyEvent {
```

And update the `source` field's inline comment:

```prisma
  source          String   // "review" | "quiz-mc" | "quiz-sa" | "quiz-tf" | "matching" | "lesson" | "star" | "unstar" | "self-rating"
```

- [ ] **Step 2: Generate and apply the migration**

Run: `npx prisma migrate dev --name add_self_rating_to_card_progress`

Expected: Prisma generates a new migration folder under `prisma/migrations/` containing an `ALTER TABLE "CardProgress" ADD COLUMN "selfRating" INTEGER;` statement, applies it to the dev database, and regenerates the Prisma Client.

**If this fails because no database connection is available in this environment:** create the migration by hand instead, matching the existing pattern exactly. Create `prisma/migrations/20260726120000_add_self_rating_to_card_progress/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "CardProgress" ADD COLUMN     "selfRating" INTEGER;
```

Then run `npx prisma generate` (this only regenerates the TypeScript Client from `schema.prisma` — it does not require a database connection) so the Client types include `selfRating` for the rest of this plan's tasks to type-check against. Note in your report which path you took, since the hand-written migration still needs to be applied against the real dev/prod database before this feature can actually be used end-to-end.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors (the Prisma Client should now expose `CardProgress.selfRating`). Pre-existing unrelated errors in `tests/quiz/setup.test.ts` are not yours.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add CardProgress.selfRating column"
```

---

### Task 2: Pure scoring additions — `blendSelfRating`, `isOutcomeSource`

**Files:**
- Modify: `src/lib/memory/scoring.ts`
- Modify: `tests/memory/scoring.test.ts`

**Interfaces:**
- Consumes: existing `clamp`, `CONFIDENCE_MIN`, `CONFIDENCE_MAX` (private to `scoring.ts` already).
- Produces: `MEMORY_ONLY_SOURCES: readonly ['star', 'unstar', 'self-rating']`, `isOutcomeSource(source: string): boolean`, `blendSelfRating(computerConfidence: number, selfRating: number, weight?: number): number` — all consumed by Task 3 (`recompute.ts`) and Task 4 (`record.ts`).

- [ ] **Step 1: Write the failing tests**

In `tests/memory/scoring.test.ts`, change the top import line from:

```ts
import { nextConfidence, masteryScore } from '@/lib/memory/scoring'
```

to:

```ts
import { nextConfidence, masteryScore, isOutcomeSource, blendSelfRating } from '@/lib/memory/scoring'
```

Then append these two new `describe` blocks at the end of the file (after the closing `})` of the existing `describe('masteryScore', ...)` block):

```ts
describe('isOutcomeSource', () => {
  it('is true for every graded-outcome source', () => {
    expect(isOutcomeSource('review')).toBe(true)
    expect(isOutcomeSource('quiz-mc')).toBe(true)
    expect(isOutcomeSource('quiz-sa')).toBe(true)
    expect(isOutcomeSource('quiz-tf')).toBe(true)
    expect(isOutcomeSource('matching')).toBe(true)
    expect(isOutcomeSource('lesson')).toBe(true)
  })

  it('is false for the memory-only sources (star, unstar, self-rating)', () => {
    expect(isOutcomeSource('star')).toBe(false)
    expect(isOutcomeSource('unstar')).toBe(false)
    expect(isOutcomeSource('self-rating')).toBe(false)
  })
})

describe('blendSelfRating', () => {
  it('nudges confidence toward the self-rating by the default weight (30%)', () => {
    // 5 + (9 - 5) * 0.3 = 6.2 -> rounds to 6, not a full jump to 9.
    expect(blendSelfRating(5, 9)).toBe(6)
  })

  it('nudges downward when the self-rating is lower than the computer confidence', () => {
    // 8 + (2 - 8) * 0.3 = 6.2 -> rounds to 6.
    expect(blendSelfRating(8, 2)).toBe(6)
  })

  it('is a no-op when the self-rating equals the current confidence', () => {
    expect(blendSelfRating(7, 7)).toBe(7)
  })

  it('clamps at the maximum (10)', () => {
    expect(blendSelfRating(10, 10)).toBe(10)
  })

  it('clamps at the minimum (1)', () => {
    expect(blendSelfRating(1, 1)).toBe(1)
  })

  it('respects a custom weight when provided', () => {
    // Full trust: weight 1 snaps directly to the rating.
    expect(blendSelfRating(5, 9, 1)).toBe(9)
    // No trust: weight 0 leaves confidence unchanged.
    expect(blendSelfRating(5, 9, 0)).toBe(5)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/scoring.test.ts`
Expected: FAIL — `isOutcomeSource`/`blendSelfRating` are not exported yet.

- [ ] **Step 3: Implement the additions**

Append to the end of `src/lib/memory/scoring.ts` (after the closing `}` of `masteryScore`):

```ts

/**
 * Sources logged to StudyEvent that are NOT graded study outcomes — they
 * never influence mastery, reps, or dueAt. Starring is a bookmark, not a
 * performance signal; a self-rating is the user's own assessment, not a
 * measured outcome.
 */
export const MEMORY_ONLY_SOURCES = ['star', 'unstar', 'self-rating'] as const

/**
 * True for the six graded-outcome sources (review/quiz-mc/quiz-sa/quiz-tf/
 * matching/lesson); false for star/unstar/self-rating. Used to filter the
 * mastery/scheduling input so a bookmark toggle or a self-assessment can
 * never be mistaken for a performance signal — see MEMORY_ONLY_SOURCES.
 */
export function isOutcomeSource(source: string): boolean {
  return !(MEMORY_ONLY_SOURCES as readonly string[]).includes(source)
}

/** How much a manual self-rating nudges the computer-driven confidence. */
const SELF_RATING_BLEND_WEIGHT = 0.3

/**
 * Nudges the computer-driven confidence toward a user's manual self-rating
 * rather than overwriting it outright, so repeated quiz/review performance
 * still dominates over time. `weight` is fixed at 0.3 by default (not a
 * per-user setting).
 */
export function blendSelfRating(
  computerConfidence: number,
  selfRating: number,
  weight: number = SELF_RATING_BLEND_WEIGHT,
): number {
  const nudged = computerConfidence + (selfRating - computerConfidence) * weight
  return clamp(Math.round(nudged), CONFIDENCE_MIN, CONFIDENCE_MAX)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/scoring.test.ts`
Expected: PASS (all tests, including the new ones).

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/scoring.ts tests/memory/scoring.test.ts
git commit -m "feat: add blendSelfRating and isOutcomeSource to scoring.ts"
```

---

### Task 3: `recomputeCardProgress` becomes source-aware

**Files:**
- Modify: `src/lib/memory/recompute.ts`
- Modify: `tests/memory/recompute.test.ts`

**Interfaces:**
- Consumes: `isOutcomeSource`, `blendSelfRating` (Task 2, `@/lib/memory/scoring`).
- Produces: `RecomputeEvent` now requires `source: string`. `RecomputedCardProgress` gains `starred: boolean`, `selfRating: number | null`, and `dueAt`/`lastSeenAt` become `Date | null` (previously non-null `Date`). Consumed by Task 6 (`src/actions/memory.ts`'s `deleteStudyEvent`).

- [ ] **Step 1: Rewrite the test file**

Replace the entire contents of `tests/memory/recompute.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { recomputeCardProgress } from '@/lib/memory/recompute'
import { masteryScore, blendSelfRating } from '@/lib/memory/scoring'
import type { RecomputeEvent } from '@/lib/memory/recompute'

const t1 = new Date('2026-07-20T00:00:00.000Z')
const t2 = new Date('2026-07-22T00:00:00.000Z')
const t3 = new Date('2026-07-24T00:00:00.000Z')

describe('recomputeCardProgress', () => {
  it('returns null when no events remain (card should revert to unseen)', () => {
    expect(recomputeCardProgress([])).toBeNull()
  })

  it('replays a single correct binary event from the default baseline (confidence 5, reps 0)', () => {
    const events: RecomputeEvent[] = [
      { source: 'review', correct: true, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(6) // 5 + 1 (correct binary delta)
    expect(result!.reps).toBe(1)
    expect(result!.lastSeenAt!.getTime()).toBe(t1.getTime())
    expect(result!.mastery).toBe(masteryScore(events))
    expect(result!.starred).toBe(false)
    expect(result!.selfRating).toBeNull()
  })

  it('replays a single incorrect binary event', () => {
    const events: RecomputeEvent[] = [
      { source: 'review', correct: false, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(4) // 5 - 1
    expect(result!.reps).toBe(0)
  })

  it('reconstructs the graded (short-answer) outcome from score, not just the correct flag', () => {
    // score=40 -> overall=4.0 -> gradedDelta(<=4) = -2, so confidence should be
    // 5 - 2 = 3. record.ts also stores correct=false for this row (overall < 8).
    // If recompute wrongly replayed this as a plain {correct:false} binary
    // event, confidence would come out as 4 instead of 3 - this discriminates.
    const events: RecomputeEvent[] = [
      { source: 'quiz-sa', correct: false, score: 40, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result!.confidence).toBe(3)
    expect(result!.reps).toBe(0) // reps/dueAt use the stored `correct` flag directly
  })

  it('replays multiple outcome events in chronological order regardless of input array order', () => {
    // Chronological: correct(t1) -> wrong(t2) -> correct(t3)
    // t1: confidence 5->6, reps 0->1
    // t2: confidence 6->5, reps ->0
    // t3: confidence 5->6, reps 0->1
    const chronological: RecomputeEvent[] = [
      { source: 'review', correct: true, score: null, createdAt: t1 },
      { source: 'quiz-mc', correct: false, score: null, createdAt: t2 },
      { source: 'matching', correct: true, score: null, createdAt: t3 },
    ]
    const shuffled = [chronological[2], chronological[0], chronological[1]]

    const expected = recomputeCardProgress(chronological)
    const actual = recomputeCardProgress(shuffled)

    expect(actual!.confidence).toBe(6)
    expect(actual!.reps).toBe(1)
    expect(actual!.lastSeenAt!.getTime()).toBe(t3.getTime())
    expect(actual).toEqual(expected)
  })

  it('mastery matches calling masteryScore directly over the same remaining outcome events', () => {
    const events: RecomputeEvent[] = [
      { source: 'review', correct: true, score: null, createdAt: t1 },
      { source: 'quiz-tf', correct: false, score: null, createdAt: t2 },
    ]
    const result = recomputeCardProgress(events)
    expect(result!.mastery).toBe(masteryScore(events))
  })

  it('a star-only history (never studied) produces default confidence, null scheduling, and starred=true', () => {
    const events: RecomputeEvent[] = [
      { source: 'star', correct: null, score: null, createdAt: t1 },
    ]
    const result = recomputeCardProgress(events)

    expect(result).not.toBeNull()
    expect(result!.starred).toBe(true)
    expect(result!.confidence).toBe(5) // default, no outcome events to move it
    expect(result!.mastery).toBeNull()
    expect(result!.reps).toBe(0)
    expect(result!.dueAt).toBeNull()
    expect(result!.lastSeenAt).toBeNull()
  })

  it('the most recent star/unstar event wins', () => {
    const starredLast: RecomputeEvent[] = [
      { source: 'star', correct: null, score: null, createdAt: t1 },
      { source: 'unstar', correct: null, score: null, createdAt: t2 },
      { source: 'star', correct: null, score: null, createdAt: t3 },
    ]
    expect(recomputeCardProgress(starredLast)!.starred).toBe(true)

    const unstarredLast: RecomputeEvent[] = [
      { source: 'star', correct: null, score: null, createdAt: t1 },
      { source: 'star', correct: null, score: null, createdAt: t2 },
      { source: 'unstar', correct: null, score: null, createdAt: t3 },
    ]
    expect(recomputeCardProgress(unstarredLast)!.starred).toBe(false)
  })

  it('a self-rating-only history nudges confidence via blendSelfRating and is excluded from mastery/scheduling', () => {
    const events: RecomputeEvent[] = [
      { source: 'self-rating', correct: null, score: 90, createdAt: t1 }, // rating 9
    ]
    const result = recomputeCardProgress(events)

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(blendSelfRating(5, 9))
    expect(result!.selfRating).toBe(9)
    expect(result!.mastery).toBeNull() // no outcome events
    expect(result!.reps).toBe(0)
    expect(result!.dueAt).toBeNull()
    expect(result!.lastSeenAt).toBeNull()
  })

  it('mixes outcome, star, and self-rating events correctly, independent of input order', () => {
    // Chronological: correct review (t1) -> star (t2) -> self-rating of 3 (t3)
    const chronological: RecomputeEvent[] = [
      { source: 'review', correct: true, score: null, createdAt: t1 }, // confidence 5->6, reps 0->1
      { source: 'star', correct: null, score: null, createdAt: t2 }, // starred=true, confidence untouched
      { source: 'self-rating', correct: null, score: 30, createdAt: t3 }, // rating 3, blends confidence
    ]
    const shuffled = [chronological[2], chronological[0], chronological[1]]

    const expected = recomputeCardProgress(chronological)
    const actual = recomputeCardProgress(shuffled)

    expect(actual).toEqual(expected)
    expect(actual!.starred).toBe(true)
    expect(actual!.selfRating).toBe(3)
    expect(actual!.confidence).toBe(blendSelfRating(6, 3))
    expect(actual!.reps).toBe(1) // untouched by star/self-rating
    expect(actual!.mastery).toBe(masteryScore([chronological[0]])) // only the outcome event counts
    expect(actual!.lastSeenAt!.getTime()).toBe(t1.getTime()) // only outcome events touch lastSeenAt
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/memory/recompute.test.ts`
Expected: FAIL — type errors (`RecomputeEvent` doesn't have `source` yet) and/or missing `starred`/`selfRating` on the result.

- [ ] **Step 3: Rewrite the implementation**

Replace the entire contents of `src/lib/memory/recompute.ts` with:

```ts
/**
 * Pure replay logic for recomputing a card's CardProgress after one or more
 * of its StudyEvent rows have been deleted (src/actions/memory.ts's
 * `deleteStudyEvent`). Reuses the exact same pure functions the live write
 * path already trusts — `nextConfidence`/`masteryScore`/`blendSelfRating`
 * (scoring.ts) and `nextDueAt` (schedule.ts) — so a recompute produces the
 * same state as if the remaining events had been the only ones ever
 * applied, incrementally, in order. Source-aware: outcome events (review/
 * quiz-*/matching/lesson) drive confidence/reps/dueAt/lastSeenAt/mastery;
 * `self-rating` events only nudge confidence and set `selfRating`;
 * `star`/`unstar` events only set `starred` — see scoring.ts's
 * isOutcomeSource for which is which.
 */
import { nextConfidence, masteryScore, isOutcomeSource, blendSelfRating } from './scoring'
import type { StudyOutcome, MasteryEvent } from './scoring'
import { nextDueAt } from './schedule'

const DEFAULT_CONFIDENCE = 5

/** The minimal StudyEvent shape this replay needs. */
export interface RecomputeEvent {
  source: string
  correct: boolean | null
  score: number | null
  createdAt: Date
}

export interface RecomputedCardProgress {
  confidence: number
  mastery: number | null
  reps: number
  /** Null when no outcome event has ever been replayed (e.g. a card that's
   *  only ever been starred or self-rated, never actually studied). */
  dueAt: Date | null
  /** Null for the same reason as `dueAt`. */
  lastSeenAt: Date | null
  starred: boolean
  selfRating: number | null
}

/**
 * `score` is on the 0-100 scale record.ts writes (`Math.round(overall * 10)`
 * for graded short-answer outcomes); `nextConfidence` expects `overall` back
 * on the original 1-10 rubric scale, so this divides by 10 to invert that.
 */
function toOutcome(event: RecomputeEvent): StudyOutcome {
  if (event.score !== null) return { overall: event.score / 10 }
  return { correct: !!event.correct }
}

/**
 * Replays `remainingEvents` (any order) in chronological order from the same
 * defaults `recordStudyEvent` uses for a fresh card (confidence 5, reps 0,
 * unstarred, no self-rating), returning the resulting CardProgress state.
 * Returns `null` when the list is empty, signaling the caller to delete the
 * CardProgress row entirely rather than upsert a stale one (the card
 * reverts to "never touched").
 */
export function recomputeCardProgress(
  remainingEvents: RecomputeEvent[],
): RecomputedCardProgress | null {
  if (remainingEvents.length === 0) return null

  const chronological = [...remainingEvents].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let confidence = DEFAULT_CONFIDENCE
  let reps = 0
  let dueAt: Date | null = null
  let lastSeenAt: Date | null = null
  let starred = false
  let selfRating: number | null = null

  for (const event of chronological) {
    if (event.source === 'star' || event.source === 'unstar') {
      starred = event.source === 'star'
      continue
    }

    if (event.source === 'self-rating') {
      const rating = (event.score ?? 0) / 10
      confidence = blendSelfRating(confidence, rating)
      selfRating = rating
      continue
    }

    // Outcome event (review/quiz-mc/quiz-sa/quiz-tf/matching/lesson).
    confidence = nextConfidence(confidence, toOutcome(event))
    const correct = !!event.correct
    reps = correct ? reps + 1 : 0
    lastSeenAt = event.createdAt
    dueAt = nextDueAt({ correct, confidence, reps, now: lastSeenAt })
  }

  const masteryEvents: MasteryEvent[] = remainingEvents
    .filter((e) => isOutcomeSource(e.source))
    .map((e) => ({ correct: e.correct, score: e.score, createdAt: e.createdAt }))

  return {
    confidence,
    mastery: masteryScore(masteryEvents),
    reps,
    dueAt,
    lastSeenAt,
    starred,
    selfRating,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/memory/recompute.test.ts`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/recompute.ts tests/memory/recompute.test.ts
git commit -m "feat: make recomputeCardProgress source-aware (star/self-rating replay)"
```

---

### Task 4: `record.ts` — mastery-window fix + new write functions

**Files:**
- Modify: `src/lib/memory/record.ts`

**Interfaces:**
- Consumes: `MEMORY_ONLY_SOURCES`, `blendSelfRating` (Task 2, `./scoring`).
- Produces: `recordStarToggle({userId, cardId, starred}): Promise<void>`, `recordSelfRating({userId, cardId, rating}): Promise<{confidence: number}>` — both consumed by Task 5 (`src/actions/confidence.ts`).

- [ ] **Step 1: Fix the import line**

At the top of `src/lib/memory/record.ts`, change:

```ts
import { nextConfidence, masteryScore } from './scoring'
```

to:

```ts
import { nextConfidence, masteryScore, blendSelfRating, MEMORY_ONLY_SOURCES } from './scoring'
```

- [ ] **Step 2: Fix the mastery-window query to exclude memory-only sources**

In `recordStudyEvent`, change:

```ts
    // Recent history for this card, used to compute mastery alongside the
    // interaction being recorded right now.
    const recentEvents = await tx.studyEvent.findMany({
      where: { userId, cardId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { correct: true, score: true, createdAt: true },
    })
```

to:

```ts
    // Recent history for this card, used to compute mastery alongside the
    // interaction being recorded right now. Excludes star/unstar/self-rating
    // rows — they carry no performance signal and would otherwise crowd out
    // real outcome events from this most-recent-10 slice (scoring.ts's
    // isOutcomeSource / MEMORY_ONLY_SOURCES).
    const recentEvents = await tx.studyEvent.findMany({
      where: { userId, cardId, source: { notIn: [...MEMORY_ONLY_SOURCES] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { correct: true, score: true, createdAt: true },
    })
```

- [ ] **Step 3: Add the two new write functions**

Append to the end of `src/lib/memory/record.ts` (after the closing `}` of `recordStudyEvent`):

```ts

export interface RecordStarToggleInput {
  userId: string
  cardId: string
  starred: boolean
}

/**
 * Logs a star/unstar toggle to StudyEvent and updates CardProgress.starred.
 * Never touches confidence, mastery, reps, or dueAt — starring is a
 * bookmark, not a performance signal (scoring.ts's isOutcomeSource).
 */
export async function recordStarToggle(input: RecordStarToggleInput): Promise<void> {
  const { userId, cardId, starred } = input

  await prisma.$transaction(async (tx) => {
    const current = await tx.cardProgress.findUnique({
      where: { userId_cardId: { userId, cardId } },
      select: { confidence: true },
    })
    const confidence = current?.confidence ?? 5

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { starred },
      create: { userId, cardId, starred, confidence },
    })

    await tx.studyEvent.create({
      data: {
        userId,
        cardId,
        source: starred ? 'star' : 'unstar',
        correct: null,
        score: null,
        confidenceAfter: confidence,
      },
    })
  })
}

export interface RecordSelfRatingInput {
  userId: string
  cardId: string
  rating: number
}

export interface RecordSelfRatingResult {
  confidence: number
}

/**
 * Logs a manual self-rating to StudyEvent and nudges (never overwrites)
 * CardProgress.confidence toward it via the pure `blendSelfRating`. Also
 * records the raw rating in CardProgress.selfRating. Never touches mastery,
 * reps, or dueAt (self-ratings are excluded from scheduling/mastery — see
 * scoring.ts's isOutcomeSource).
 */
export async function recordSelfRating(
  input: RecordSelfRatingInput,
): Promise<RecordSelfRatingResult> {
  const { userId, cardId, rating } = input

  return prisma.$transaction(async (tx) => {
    const current = await tx.cardProgress.findUnique({
      where: { userId_cardId: { userId, cardId } },
      select: { confidence: true },
    })
    const oldConfidence = current?.confidence ?? 5
    const confidence = blendSelfRating(oldConfidence, rating)

    await tx.cardProgress.upsert({
      where: { userId_cardId: { userId, cardId } },
      update: { confidence, selfRating: rating },
      create: { userId, cardId, confidence, selfRating: rating, starred: false },
    })

    await tx.studyEvent.create({
      data: {
        userId,
        cardId,
        source: 'self-rating',
        correct: null,
        score: rating * 10,
        confidenceAfter: confidence,
      },
    })

    return { confidence }
  })
}
```

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/memory` (re-runs all memory-suite tests, none of which should be affected by this file — confirms nothing broke)
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/record.ts
git commit -m "feat: add recordStarToggle/recordSelfRating, exclude them from mastery window"
```

---

### Task 5: Wire `starCard`/`updateConfidence` through the write path

**Files:**
- Modify: `src/actions/confidence.ts`

**Interfaces:**
- Consumes: `recordStarToggle`, `recordSelfRating` (Task 4, `@/lib/memory/record`).
- Produces: no change to `starCard`/`updateConfidence`'s exported signatures — only their internals change. Consumed by existing components `src/components/sets/StarButton.tsx` and `src/components/sets/ConfidenceRate.tsx` (unchanged).

- [ ] **Step 1: Rewrite the file**

Replace the entire contents of `src/actions/confidence.ts` with:

```ts
'use server'

import { auth } from '@/auth'
import { revalidatePath } from 'next/cache'
import { recordStudyEvent, recordStarToggle, recordSelfRating } from '@/lib/memory/record'

export async function starCard(
  cardId: string,
  setId: string,
  starred: boolean
): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await recordStarToggle({ userId: session.user.id, cardId, starred })

  revalidatePath(`/sets/${setId}`)
}

export async function recordReview(
  cardId: string,
  knew: boolean
): Promise<{ newConfidence: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Not authenticated')

  const result = await recordStudyEvent({
    userId: session.user.id,
    cardId,
    source: 'review',
    outcome: { correct: knew },
  })

  return { newConfidence: result.confidence }
}

export async function updateConfidence(
  cardId: string,
  setId: string,
  confidence: number
): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await recordSelfRating({ userId: session.user.id, cardId, rating: confidence })

  revalidatePath(`/sets/${setId}`)
}
```

Note: the direct `import { prisma } from '@/lib/db'` from the old version is intentionally dropped — neither `starCard` nor `updateConfidence` touches `prisma` directly anymore, and `recordReview` never did.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors, no unused-import warnings.

Run: `npm run lint` — confirm no new errors specifically attributable to this file (pre-existing unrelated lint problems elsewhere are not yours; see this repo's known baseline).

- [ ] **Step 3: Commit**

```bash
git add src/actions/confidence.ts
git commit -m "refactor: route starCard/updateConfidence through the unified write path"
```

---

### Task 6: `src/actions/memory.ts` — recompute wiring + non-owned-set fix

**Files:**
- Modify: `src/actions/memory.ts`

**Interfaces:**
- Consumes: `RecomputeEvent` (Task 3's new shape, `@/lib/memory/recompute`).
- Produces: no change to `deleteStudyEvent`/`forgetCard`/`forgetSet`/`getStudyEventHistory`/`listMemoryFilterOptions`'s exported signatures — only their internals change. Consumed by the existing `src/app/profile/memory/page.tsx` (unchanged by this task; Task 7 touches its display only).

- [ ] **Step 1: Fix `deleteStudyEvent`'s recompute call**

In `src/actions/memory.ts`, inside `deleteStudyEvent`, change:

```ts
      const remaining = await tx.studyEvent.findMany({
        where: { userId, cardId: event.cardId },
        select: { correct: true, score: true, createdAt: true },
      });

      const recomputed = recomputeCardProgress(remaining);

      if (recomputed === null) {
        await tx.cardProgress.deleteMany({ where: { userId, cardId: event.cardId } });
      } else {
        await tx.cardProgress.upsert({
          where: { userId_cardId: { userId, cardId: event.cardId } },
          update: {
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
          },
          create: {
            userId,
            cardId: event.cardId,
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: false,
          },
        });
      }
```

to:

```ts
      const remaining = await tx.studyEvent.findMany({
        where: { userId, cardId: event.cardId },
        select: { source: true, correct: true, score: true, createdAt: true },
      });

      const recomputed = recomputeCardProgress(remaining);

      if (recomputed === null) {
        await tx.cardProgress.deleteMany({ where: { userId, cardId: event.cardId } });
      } else {
        await tx.cardProgress.upsert({
          where: { userId_cardId: { userId, cardId: event.cardId } },
          update: {
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: recomputed.starred,
            selfRating: recomputed.selfRating,
          },
          create: {
            userId,
            cardId: event.cardId,
            confidence: recomputed.confidence,
            mastery: recomputed.mastery,
            reps: recomputed.reps,
            dueAt: recomputed.dueAt,
            lastSeenAt: recomputed.lastSeenAt,
            starred: recomputed.starred,
            selfRating: recomputed.selfRating,
          },
        });
      }
```

- [ ] **Step 2: Fix `listMemoryFilterOptions`'s non-owned-set gap**

In `src/actions/memory.ts`, inside `listMemoryFilterOptions`, change:

```ts
    const [sets, cards] = await Promise.all([
      prisma.set.findMany({
        where: { userId },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
      setId
        ? prisma.card.findMany({
            where: { setId, set: { userId } },
            select: { id: true, term: true },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),
    ]);
```

to:

```ts
    // Sets/cards the user has *studied* (has StudyEvent rows for), not
    // necessarily authored — a user who studies someone else's set still
    // has real history for it and must be able to find and forget it. Every
    // delete below is already scoped by the caller's own `userId`, so this
    // only widens what's *discoverable* in the dropdowns, not what's
    // deletable.
    const [sets, cards] = await Promise.all([
      prisma.set.findMany({
        where: { cards: { some: { studyEvents: { some: { userId } } } } },
        select: { id: true, title: true },
        orderBy: { title: 'asc' },
      }),
      setId
        ? prisma.card.findMany({
            where: { setId, studyEvents: { some: { userId } } },
            select: { id: true, term: true },
            orderBy: { position: 'asc' },
          })
        : Promise.resolve([]),
    ]);
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/actions/memory.ts
git commit -m "fix: recompute starred/selfRating on delete; list studied (not just owned) sets/cards"
```

---

### Task 7: Display the new event types in `/profile/memory`

**Files:**
- Modify: `src/app/profile/memory/page.tsx`

- [ ] **Step 1: Extend `SOURCE_LABELS`**

Change:

```ts
const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
};
```

to:

```ts
const SOURCE_LABELS: Record<string, string> = {
  review: 'Review',
  'quiz-mc': 'Quiz (Multiple Choice)',
  'quiz-sa': 'Quiz (Short Answer)',
  'quiz-tf': 'Quiz (True/False)',
  matching: 'Matching Game',
  lesson: 'Lesson',
  star: 'Starred',
  unstar: 'Unstarred',
  'self-rating': 'Self-Rating',
};
```

- [ ] **Step 2: Add a display branch for the new sources' outcome column**

Change:

```tsx
                  <Badge variant="outline">{SOURCE_LABELS[event.source] ?? event.source}</Badge>
                  <span className="text-sm w-16 text-right">
                    {event.score !== null ? `${event.score}%` : event.correct ? 'Correct' : 'Wrong'}
                  </span>
```

to:

```tsx
                  <Badge variant="outline">{SOURCE_LABELS[event.source] ?? event.source}</Badge>
                  <span className="text-sm w-28 text-right">
                    {event.source === 'star'
                      ? 'Starred'
                      : event.source === 'unstar'
                        ? 'Unstarred'
                        : event.source === 'self-rating'
                          ? `Self-rated: ${event.score !== null ? event.score / 10 : '?'}/10`
                          : event.score !== null
                            ? `${event.score}%`
                            : event.correct
                              ? 'Correct'
                              : 'Wrong'}
                  </span>
```

(The column widened from `w-16` to `w-28` so "Self-rated: 7/10" doesn't wrap awkwardly.)

- [ ] **Step 3: Update the page subtitle copy**

Change:

```tsx
        <p className="text-muted-foreground mt-2">Every review and quiz answer that shaped your confidence scores.</p>
```

to:

```tsx
        <p className="text-muted-foreground mt-2">Every review, quiz answer, star, and self-rating that shaped your confidence scores.</p>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/profile/memory/page.tsx
git commit -m "feat: display star/unstar/self-rating events in the memory history feed"
```

---

### Task 8: Manual end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the automated suite**

Run: `npm run test`
Expected: all suites pass, including the extended `tests/memory/scoring.test.ts` and rewritten `tests/memory/recompute.test.ts`.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: no new errors attributable to this plan's files (this repo has pre-existing unrelated lint problems — see the memory-history-and-selective-reset plan's Task 6 notes; don't chase those here).

- [ ] **Step 3: Manual browser walkthrough**

Run: `npm run dev`, then in the browser:

1. Star a card on a set's detail page. Visit `/profile/memory` and confirm a "Starred" row appears for that card.
2. Manually self-rate that same card (the confidence slider). Confirm a "Self-rated: N/10" row appears, and that the card's *displayed* confidence (wherever it's shown, e.g. the flashcard carousel) nudged toward the rating rather than snapping to it exactly.
3. Study that card once via Review mode. Confirm a normal outcome row appears, and delete just that outcome row from `/profile/memory` — confirm the card's star and self-rating are *not* lost (this is the bug this plan set out to fix).
4. Delete every remaining event for that card one by one (including the star/self-rating rows) — confirm that once all events are gone, the card fully reverts to fresh/unstarred.
5. Study a set you don't own (if one is available, e.g. a second test account's set) and confirm it now appears in the `/profile/memory` Set filter dropdown, and that "Forget this set" works and only removes your own history.
6. Confirm `Reset Memory` (Danger Zone) still fully wipes everything, same as before.

- [ ] **Step 4: Fix any issues found, then commit if changes were needed**

If Step 3 surfaces a bug, fix it in the relevant task's file, re-run `npm run test` and `npm run lint`, and commit with a `fix:` message describing what broke.
