# Memory History View & Selective Reset (Design)

**Status:** Approved design, pre-implementation.
**Date:** 2026-07-25
**Slots:** Extends Stage 6 (Persistent Memory). No new numbered stage — this fills a gap left by
the 2026-07-04 persistent-memory work rather than opening new roadmap scope.

## Problem

Stage 6 ("persistent learner memory") shipped a single write path (`recordStudyEvent`,
`src/lib/memory/record.ts`) so every study mode — Review, Quiz (MC/SA/TF), Matching — now writes
an append-only `StudyEvent` row plus updates `CardProgress` (confidence, mastery, spaced-repetition
`dueAt`/`reps`). Verified in code: `StudyEvent` (`prisma/schema.prisma:208-227`), call sites in
`src/actions/confidence.ts:32`, `src/actions/quiz.ts:266,346,453,527`, `src/actions/quiz-matching.ts:66`.

But this memory is currently **write-only from the user's perspective**. `StudyEvent` is read only
by `buildLearnerProfile` (`src/lib/memory/profile.ts`) to feed AI prompts — nothing renders it for
the user. The only user-facing memory control is an all-or-nothing **"Reset Memory"** button in the
`/profile` Danger Zone (`resetUserMemory`, `src/actions/user.ts:65`), which wipes every memory table
for the account. There is no way to see what's been recorded, or to correct/remove part of it
without nuking everything.

## Decisions (locked with user)

1. **Delete granularity:** support all three — per-event (single `StudyEvent` row), per-card
   ("forget this card"), and per-set ("forget this set").
2. **Placement:** new dedicated route `/profile/memory`, linked from `/profile` ("View full memory
   history →"). The existing full "Reset Memory" action moves here from the `/profile` Danger Zone.
3. **Recompute on single-event delete:** `CardProgress` (confidence/mastery/reps/dueAt) is
   recomputed from the card's *remaining* events, not left stale. If zero events remain, the
   `CardProgress` row is deleted entirely (fresh/unseen state) rather than kept with orphaned
   defaults.
4. **Forget-card / forget-set scope:** wipes everything for the affected card(s) — `StudyEvent`,
   legacy `ConfidenceEvent`, and the `CardProgress` row, **including the starred flag**. "Forget"
   means forget, not "forget except one field."
5. **Default view:** flat reverse-chronological feed across all sets/cards, with Set/Card/Source
   filters that narrow the same list (filtering down to one card/set is also how the
   forget-this-card/forget-this-set actions get their target — see below).

## Architecture

Additive — no changes to the existing write path (`recordStudyEvent`) or scoring functions
(`nextConfidence`, `masteryScore` in `src/lib/memory/scoring.ts`; `nextDueAt` in
`src/lib/memory/schedule.ts`). This is a new read/delete surface over the same tables, plus one new
orchestration function that replays those existing pure functions.

- **Route:** `src/app/profile/memory/page.tsx` (Server Component), reachable from a new link on
  `/profile`.
- **Actions (`src/actions/memory.ts`, new file):**
  - `getStudyEventHistory({ setId?, cardId?, source?, cursor?, limit })` — cursor-paginated
    (`createdAt` desc, `id` tiebreak; default `limit` 50), scoped to the session `userId`, joined to
    card term + set name for display.
  - `deleteStudyEvent(eventId)` — ownership-checked, deletes the row, then calls
    `recomputeCardProgress` for that card inside one `prisma.$transaction`.
  - `forgetCard(cardId)` — ownership-checked, deletes all `StudyEvent` + `ConfidenceEvent` rows and
    the `CardProgress` row for that card, in one transaction.
  - `forgetSet(setId)` — same, across every card in the set, in one transaction.
- **Pure function (`src/lib/memory/recompute.ts`, new file):**
  `recomputeCardProgress(remainingEvents: StudyEventLike[]): CardProgressState | null`.
  `mastery` is already a stateless recency-weighted read over the last-10 events
  (`masteryScore` in `scoring.ts`), so it's simply recomputed over whatever remains. `confidence`
  and `reps`/`dueAt` are stateful (each event nudges off the *prior* state), so this function
  replays the remaining events in chronological order through the existing `nextConfidence` and
  `nextDueAt` functions starting from defaults (confidence 5, reps 0), producing the same result as
  if those events had been the only ones ever applied. Returns `null` when the remaining-events list
  is empty, signaling the caller to delete the `CardProgress` row instead of upserting it.
- **`/profile` changes:** remove the Danger Zone's "Reset Memory" block; add a "View full memory
  history →" link to `/profile/memory`. `resetUserMemory` (`src/actions/user.ts:65`) itself is
  unchanged, just relocated in the UI.

### Components / units

- `recomputeCardProgress` — pure, DB-free, unit-testable in isolation (mirrors how `scoring.ts` and
  `schedule.ts` are already tested).
- `src/actions/memory.ts` — thin DB/orchestration shell calling the pure function, matching the
  existing `record.ts` split between orchestration and pure scoring.
- `MemoryHistoryPage` (server component) + `MemoryFilterBar` (client component, URL-search-param
  driven) + `MemoryEventRow` (per-row delete action) + `ForgetCardButton` / `ForgetSetButton`
  (confirm-gated, shown only when the Card/Set filter narrows to exactly one).

## Data flow

1. User opens `/profile/memory` → server component calls `getStudyEventHistory` with filters read
   from `searchParams` → renders the flat feed + "Load more" (cursor-based).
2. User narrows the Set filter to one set → `ForgetSetButton` appears. Narrows Card filter to one
   card (within a set) → `ForgetCardButton` appears instead/also.
3. **Delete one event:** confirm dialog → `deleteStudyEvent(eventId)` → transaction deletes the row,
   fetches the card's remaining `StudyEvent` rows, calls `recomputeCardProgress`, upserts (or
   deletes) `CardProgress` → `revalidatePath('/profile/memory')` and `/profile`.
4. **Forget card / forget set:** confirm dialog (shows affected event count) → `forgetCard`/
   `forgetSet` → transaction deletes rows → revalidate same paths.
5. **Full reset:** unchanged `resetUserMemory`, now invoked from this page instead of `/profile`.

## Edge cases

- Deleting the *only* event for a card ⇒ `recomputeCardProgress` returns `null` ⇒ `CardProgress` row
  deleted, card goes back to "never studied."
- Filters combine (Set + Card + Source simultaneously); Card options populate based on the selected
  Set.
- Ownership: every action re-verifies the event/card/set belongs to the session user before
  mutating — same pattern as `resetUserMemory` and the quiz submit actions.
- Legacy `ConfidenceEvent` rows (Review-only, pre-Stage-6) are included in `forgetCard`/`forgetSet`
  deletion for that card/set, same as they already are in the full `resetUserMemory` wipe, but are
  **not** shown as rows in the history feed (the feed is `StudyEvent`-only, since that's the single
  source of truth going forward) and are not affected by single-event delete.
- Empty history (new account) ⇒ empty-state message, no filters/actions shown.

## Testing

- `tests/memory/recompute.test.ts` (new, mirrors existing `tests/memory/` layout): empty remaining
  events → `null`; single remaining event → matches that event's `confidenceAfter/mastery`; a mixed
  correct/incorrect sequence → replayed result matches what `recordStudyEvent` would have produced
  applying those same events incrementally in order (cross-check against `scoring.ts`/`schedule.ts`
  directly, no mocking).
- Action-level: ownership check (user A cannot delete/forget user B's rows); `forgetCard`/`forgetSet`
  remove exactly the expected row counts; `deleteStudyEvent` triggers the correct recompute.

## Non-goals (YAGNI)

- Undo/restore for deleted events — deletion is permanent, matching the existing full-reset
  behavior.
- Editing a `StudyEvent`'s recorded outcome (correct/score) — delete-and-let-it-be-recreated by
  studying again, not in-place edits.
- Exposing `source: 'lesson'` events specially — Stage 7 (lessons) isn't built yet; the feed just
  displays whatever sources exist.
- Any change to `recordStudyEvent`, `nextConfidence`, `masteryScore`, or `nextDueAt` — this is a
  read/delete layer on top of the existing write path, not a rework of it.
