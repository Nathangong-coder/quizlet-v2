# Scoped Memory History — Design

**Date:** 2026-07-27
**Status:** Approved
**Stage:** Extends Stage 6 (Persistent learner memory)

## Problem

Study history is already unified in the database — every mode writes one
`StudyEvent` row per answer through `recordStudyEvent`. But the surfaces on top
of it are lopsided:

- `/profile` shows **only** consolidated numbers, with no way to scope them to a
  set. Its stats also read `QuizAttempt`, so review/matching activity is invisible.
- `/profile/memory` shows **only** a flat feed with a single-select Set → Card →
  Source dropdown chain. You can narrow it, but you cannot compare, multi-select,
  or scope by category.
- Categories cannot span sets at all. `CardCategory` is set-scoped by schema
  (`@@unique([setId, normalizedName])`), so "show me everything I've ever done in
  *valuation*, across every set" is unanswerable today.

The user wants both a consolidated history **and** an individual one, toggleable
by set *or* by category, where categories are understood to exist above the level
of an individual set.

## Approach

### Cross-set categories: group by normalized name, no migration

`CardCategory` rows stay set-scoped. The history layer collapses them by
`normalizedName` into a *derived* cross-set category. "valuation" in three
different sets presents as one chip covering all three.

Chosen over a schema migration to user-scoped categories because it works on all
existing data with zero migration risk, touches no other feature's call sites
(set builder, quiz setup, review, match, flashcards all keep working unchanged),
and stays forward-compatible: if true user-scoped categories are wanted later,
this grouping becomes the migration's dedupe rule.

Known trade-off, accepted: renaming a category in one set drops it out of the
group. That matches user intent closely enough — a renamed category is a
different label.

### Scope as a single value object

```ts
type HistoryScope = {
  setIds: string[];        // OR semantics
  categoryKeys: string[];  // normalized names, OR; may include UNCATEGORIZED_ID
  cardId?: string;
  source?: string;
};
```

Empty arrays mean consolidated. Making "all" the zero value rather than a
distinct mode keeps one code path through the feed, the stats, and the filter
options — there is no separate "consolidated query" to drift out of sync.

Set and category scope combine as **AND between the two dimensions, OR within
each**: selecting sets {A, B} and categories {valuation} means "cards in A or B
that are tagged valuation." This mirrors `filterCardsByCategories`' existing OR
semantics within the category dimension.

## Components

### `src/lib/memory/scope.ts` (new, pure)

- `groupCategoriesByName(rows)` → `CrossSetCategory[]` of
  `{ key, name, color, setIds, categoryIds, cardCount }`.
  Display name is the most common raw spelling; color is the most common
  non-null color, tie-broken by `CATEGORY_PALETTE` order so it is deterministic.
- `buildStudyEventWhere(userId, scope, categoryIds)` → the Prisma `where` object.
  Pure, so every scope combination is unit-testable without a database.
- `serializeScope` / `parseScope` → URL search-param round-trip.

Reuses `normalizeCategoryName` and `UNCATEGORIZED_ID` from
`src/lib/cards/categories.ts` rather than reimplementing, so grouping stays
consistent with how categories were authored and filtered elsewhere.

### `src/actions/memory.ts` (extended)

- `getStudyEventHistory(scope)` — widened from single `setId`/`cardId` to the
  scope object. Cursor pagination unchanged.
- `listMemoryFilterOptions(scope)` — returns sets, cross-set categories with card
  counts, and cards (cards only when exactly one set is scoped, matching current
  behavior).
- `getScopedMemoryStats(scope)` — **new**. Event count, accuracy over graded
  events, average confidence, mastered-card count, and per-source breakdown.
  Computed over the whole scope, not the current page, so the tiles do not change
  as you paginate.

### UI

`/profile/memory` gains, above the existing feed:

- **`ScopeBar`** — multi-select set chips, multi-select cross-set category chips
  (colored, with an "Uncategorized" bucket), source dropdown, and the card
  dropdown when exactly one set is active. A "Clear" affordance returns to
  consolidated.
- **`ScopeStats`** — tiles that recompute for the active scope.

Scope is **URL-synced** (`?sets=a,b&cats=valuation&source=quiz-sa`). Today's page
holds filters in `useState`, which loses the view on reload and breaks the back
button; URL state fixes both and makes a scoped view shareable.

The existing feed, "Load more", per-event delete, and forget-card/forget-set
actions are preserved. Forget actions apply to the scoped selection.

## Data flow

```
ScopeBar → URL search params → parseScope → server action
  → buildStudyEventWhere (pure) → Prisma → rows
  → feed + stats
```

## Error handling

Follows the existing `ActionResult<T>` discriminated-union pattern. Every action
returns `{ success: false, error }` on failure and the page surfaces it via a
`sonner` toast — matching how `listMemoryFilterOptions` failures are already
surfaced.

## Testing

`tests/memory/scope.test.ts`, mirroring the existing `tests/` layout under
Vitest:

- grouping the same category name across multiple sets into one entry
- most-common display name and color selection, with deterministic tie-break
- the `UNCATEGORIZED_ID` bucket surviving grouping
- `buildStudyEventWhere` for each scope combination: empty, sets only,
  categories only, both, plus `cardId` and `source` narrowing
- `serializeScope`/`parseScope` round-trip, including empty scope

## Out of scope

- Migrating `CardCategory` to user-scoped (deliberately deferred; see above).
- Changing what any study mode writes. The write path is untouched.
- Charts or time-series visualisation of the scoped stats.
