# Unified Memory Write Path Extension: Starring, Self-Ratings, Dual Confidence (Design)

**Status:** Approved design, pre-implementation.
**Date:** 2026-07-26
**Slots:** Extends Stage 6 (Persistent Memory) further, following directly on
`docs/superpowers/plans/2026-07-25-memory-history-and-selective-reset.md`.

## Problem

The final whole-branch review of the memory-history-and-selective-reset plan surfaced three
Important findings, all rooted in the same gap: **two user actions bypass the unified
`StudyEvent` write path entirely.**

1. `starCard` (`src/actions/confidence.ts:8-23`) writes `CardProgress.starred` directly via
   `prisma.cardProgress.upsert` — no `StudyEvent` row, ever.
2. `updateConfidence` (`src/actions/confidence.ts:42-57`) writes `CardProgress.confidence`
   directly, overwriting whatever the computer-driven confidence was — also no `StudyEvent` row.

Consequences, verified during review:
- **Star loss on last-event delete:** because `starred` lives only on the `CardProgress` row and
  that row gets deleted whenever `recomputeCardProgress` (Task 1 of the prior plan) returns `null`
  (zero remaining `StudyEvent` rows), starring a card, studying it once, then deleting that one
  history entry silently un-stars it — with no warning.
- **Manual confidence silently discarded:** a user's manual 1-10 self-rating is stored in the same
  `confidence` column `recordStudyEvent` writes to. Deleting a history entry recomputes and
  overwrites that column, discarding the manual rating and any trace it ever happened.
- **A separate, unrelated finding** from the same review: `listMemoryFilterOptions`
  (`src/actions/memory.ts:94-104`) lists only sets the user *authored* in the Set filter dropdown.
  A user who studies someone else's set generates real `StudyEvent` history that shows up in the
  activity feed (joined through the card) but can never be reached via "Forget this set" or
  "Forget this card," because that set never appears in the dropdown. This is a discoverability
  gap, not a safety one — every delete/forget action already scopes by the caller's own `userId`.

## Decisions (locked with user)

1. **Star/unstar joins the unified write path** as logged `StudyEvent` rows (`source: 'star'` /
   `'unstar'`), so it appears in history, survives deletion of unrelated events correctly (starred
   state is derived by replaying star events, not stored as a bare column), and is itself
   individually forgettable like everything else.
2. **No scoring impact from starring.** Star/unstar events never affect confidence, mastery,
   `reps`, or `dueAt`. Starring is a bookmark, not a performance signal.
3. **Dual confidence model.** The computer-driven `confidence` (the existing column, driven by
   `recordStudyEvent`) and the user's manual self-rating become two distinct, separately-tracked
   values. A self-rating **nudges** computer confidence ~30% of the way toward the rating (clamped
   1-10) rather than overwriting it. Both the self-rating event and the resulting nudged confidence
   are recorded in history.
4. **Self-ratings are excluded from mastery and scheduling.** The recency-weighted `mastery` score
   (fed to the AI learner profile) and spaced-repetition `reps`/`dueAt` stay driven purely by actual
   quiz/review/matching outcomes — a confident-but-wrong self-assessment can never inflate what the
   AI or the scheduler thinks a user has mastered.
5. **Self-ratings and star/unstar toggles show up as normal, individually-deletable rows** in the
   `/profile/memory` activity feed, consistent with "any user input becomes part of history."
6. **The non-owned-set filter gap is fixed in this same plan** — `listMemoryFilterOptions` lists
   sets/cards the user has *studied* (has `StudyEvent` rows for), not sets they authored.

## Architecture

Purely additive to the existing write path; no change to the meaning of `recordStudyEvent` for
outcome-based modes (review/quiz-mc/quiz-sa/quiz-tf/matching/lesson).

- **Schema (`prisma/schema.prisma`):** one migration — add `CardProgress.selfRating Int?`
  (nullable: most cards will never have a manual rating). `StudyEvent.source` gains `'star'`,
  `'unstar'`, `'self-rating'` as new documented string values; no column/migration change needed
  there (`source` is already an unconstrained `String`).
- **Outcome-vs-memory-only split (`src/lib/memory/scoring.ts`):** export
  `MEMORY_ONLY_SOURCES = ['star', 'unstar', 'self-rating']` and a helper
  `isOutcomeSource(source: string): boolean` (true for the six existing `StudySource` values,
  false for the three new ones). Every place that builds the input array to `masteryScore` —
  `record.ts`'s live path and `recompute.ts`'s replay — filters to outcome sources first.
- **New pure function (`scoring.ts`):**
  `blendSelfRating(computerConfidence: number, selfRating: number, weight = 0.3): number` —
  `clamp(round(computerConfidence + (selfRating - computerConfidence) * weight), 1, 10)`.
- **New write functions (`src/lib/memory/record.ts`, alongside `recordStudyEvent`):**
  - `recordStarToggle({userId, cardId, starred}): Promise<void>` — one transaction: read current
    confidence (for `confidenceAfter`, unchanged), upsert `CardProgress.starred`, insert a
    `StudyEvent` row (`source: starred ? 'star' : 'unstar'`, `correct: null`, `score: null`,
    `confidenceAfter`: the *unchanged* current confidence). Does not touch `reps`, `dueAt`,
    `lastSeenAt`, or `mastery`.
  - `recordSelfRating({userId, cardId, rating}): Promise<{confidence: number}>` — one transaction:
    read current confidence, compute `blendSelfRating(current, rating)`, upsert
    `CardProgress.confidence` (the nudged value) and `CardProgress.selfRating` (the raw rating),
    insert a `StudyEvent` row (`source: 'self-rating'`, `correct: null`,
    `score: rating * 10` — reusing the existing 0-100 scale convention, `confidenceAfter`: the
    nudged value). Does not touch `reps`, `dueAt`, `lastSeenAt`, or `mastery`.
- **`recomputeCardProgress` becomes source-aware** (`src/lib/memory/recompute.ts`, replacing the
  prior plan's outcome-only version): the replay loop now branches per event `source`:
  - Outcome sources: unchanged existing behavior (nextConfidence, reps/dueAt via nextDueAt,
    lastSeenAt).
  - `'self-rating'`: `confidence = blendSelfRating(confidence, score / 10)`; `selfRating = score /
    10`; `reps`/`dueAt`/`lastSeenAt` untouched.
  - `'star'` / `'unstar'`: `starred = (source === 'star')`; nothing else touched.
  - Mastery is computed only from outcome-source events in the remaining list.
  - Returns `null` only when **zero** events of any kind remain (true "never touched this card").
    A card with only a star event and no study events now correctly recomputes to a valid
    (non-null) state with `starred: true`, `confidence: 5` (default), rather than being deleted.
- **Wiring (`src/actions/confidence.ts`):** `starCard` calls `recordStarToggle` instead of writing
  `CardProgress` directly; `updateConfidence` calls `recordSelfRating` instead of overwriting
  `confidence` directly.
- **`listMemoryFilterOptions` (`src/actions/memory.ts`) query change:** sets list becomes "sets
  containing at least one card this user has a `StudyEvent` for" instead of "sets this user
  authored." The card list (once a set is selected) becomes "cards in this set this user has a
  `StudyEvent` for" instead of gating on `set: { userId }`. `forgetCard`/`forgetSet`/
  `getStudyEventHistory` need **no change** — they already scope every read/delete by the caller's
  own `userId` regardless of set ownership.
- **Display (`src/app/profile/memory/page.tsx`):** `SOURCE_LABELS` gains `star`/`unstar`/
  `self-rating` entries; the outcome column gets a new branch for these three sources (e.g.
  "Starred" / "Unstarred" / "Self-rated: 7/10" in place of the Correct/Wrong/score% display).
  Per-event delete already works on them for free once they're ordinary `StudyEvent` rows.

## Data flow

1. **Star toggle:** `StarButton` → `starCard(cardId, setId, starred)` → `recordStarToggle` →
   `CardProgress.starred` updated + `StudyEvent` logged. Shows up in `/profile/memory` immediately.
2. **Self-rating:** `ConfidenceRate` slider → `updateConfidence(cardId, setId, rating)` →
   `recordSelfRating` → blended `confidence` + raw `selfRating` written + `StudyEvent` logged.
3. **Delete one event (any source) in `/profile/memory`:** unchanged call path
   (`deleteStudyEvent` → `recomputeCardProgress` over the card's remaining events of *all* sources)
   — now correctly reconstructs `starred`/`selfRating`/`confidence` per the branching rules above.
4. **Forget card/set:** unchanged — already deletes every `StudyEvent` row regardless of source.
5. **Studying someone else's set:** `listMemoryFilterOptions` now surfaces that set in the
   dropdown (since the user has `StudyEvent` rows for its cards), and `forgetSet`/`forgetCard`
   already correctly scope by the caller's own `userId`, so using them only ever removes the
   caller's own memory — never the set owner's or another student's.

## Edge cases

- A card that has only ever been starred (never studied, never self-rated) → `CardProgress` exists
  with `confidence: 5` (default), `mastery: null`, `dueAt: null`, `starred: true`. Deleting that
  star event → zero events remain → `CardProgress` row deleted (fully fresh) — correct "forget"
  semantics.
- A card studied, then self-rated, then the *study* event deleted → remaining events = [self-rating]
  → recompute replays only the self-rating: confidence starts from default 5, blends toward the
  rating once, `mastery: null` (no outcome events left), `reps: 0`, `dueAt: null`. This is a
  deliberate, documented consequence of "self-ratings don't count as study" — the card reverts to
  "never scheduled" even though a rating exists, since scheduling is purely outcome-driven.
- Multiple self-ratings over time: each is its own `StudyEvent`; replay applies `blendSelfRating`
  sequentially in chronological order, same as outcome events replay `nextConfidence` sequentially.
- Star then unstar then star again: replay applies them in order; final `starred` reflects the last
  one chronologically, matching live-write behavior.
- `listMemoryFilterOptions` for a user with zero studied sets (brand new account) → empty dropdown,
  same empty-state as today.

## Testing

- `tests/memory/scoring.test.ts` (extend): `blendSelfRating` — nudges toward the rating by ~30%,
  clamps at 1 and 10, is a no-op when `selfRating === computerConfidence`. `isOutcomeSource` — true
  for all six `StudySource` values, false for the three memory-only ones.
- `tests/memory/recompute.test.ts` (extend): star-only history → non-null result with correct
  `starred`, default confidence, null mastery/dueAt. Self-rating-only history → blended confidence
  from default, null mastery/dueAt/reps. Mixed history (outcome + star + self-rating interleaved,
  shuffled input order) → matches sequential application of the three event kinds in chronological
  order; mastery computed only from the outcome-source subset.
- No automated tests for `recordStarToggle`/`recordSelfRating`/the `listMemoryFilterOptions` query
  change, consistent with this repo's existing no-DB-mocking convention — verified manually.

## Non-goals (YAGNI)

- Configurable blend weight (the 30% constant is fixed, not a per-user setting).
- Undo for a star/unstar/self-rating event beyond the existing generic per-event delete.
- Any change to how outcome-based modes (review/quiz/matching) compute confidence, mastery, or
  scheduling — this plan only adds two new, clearly-separated event kinds alongside them.
- Teacher/classroom visibility into a student's history across shared sets — noted as a future
  direction in a separate plan doc, not built here.
