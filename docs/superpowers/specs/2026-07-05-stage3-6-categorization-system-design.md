# Stage 3.6 — Categorization System (Design)

**Status:** Approved design, pre-implementation.
**Date:** 2026-07-05
**Slots:** New Stage 3.6, after Stage 3.5, **before** Stage 6 (Persistent Memory).

## Problem

The user wants a categorization system: label any flashcard with one or more custom
categories, see those categories on the flashcards, and filter tests **and games** to
specific categories.

CLAUDE.md and `docs/superpowers/plans/2026-06-30-stage3-5-study-experience-redesign.md`
claim "custom categories per card" shipped in Stage 3.5. **This is not true.** The feature
is half-wired: a solid data model plus a dead quiz filter, with the entire authoring,
display, and games-filtering layers missing.

### What actually exists today (verified in code)

| Layer | State | Evidence |
| --- | --- | --- |
| Prisma models `CardCategory` (set-scoped, `name` + `normalizedName`, unique per set) and `CardCategoryAssignment` (card↔category m2m) | **Built + migrated** | `prisma/schema.prisma:65-87`, migration `20260630025912_...` |
| Pure helpers `normalizeCategoryName`, `parseCategoryInput` + tests | **Built** | `src/lib/cards/categories.ts`, `tests/cards/categories.test.ts` |
| Quiz filter `filterQuizCards` honoring `categoryIds`; `QuizSetupSchema.categoryIds` + tests | **Built** | `src/lib/quiz/setup.ts:19-38`, `tests/quiz/setup.test.ts` |
| Quiz setup UI renders category checkboxes from `availableCategories` | **Built** | `src/components/quiz/QuizSetupScreen.tsx:101-115` |
| Quiz page loads `set.categories`, passes through wrapper → setup; `quiz.ts` reads assignments, filters, persists `categoryIds` on the attempt | **Built (wired end-to-end)** | `src/app/sets/[id]/quiz/page.tsx:18,41`, `QuizClientWrapper.tsx:16`, `src/actions/quiz.ts:124,139,174` |

### What is broken / missing (the actual work)

1. **No authoring path.** `CategoryPicker.tsx` exists but is an **orphan** — never imported.
   It also ignores its own `availableCategories` prop (no autocomplete).
2. **Nothing persists categories.** `src/actions/sets.ts` create/update has **zero** category
   handling. `SetForm.tsx` hardcodes `categories = []` with a literal stub comment
   ("In a real app, we'd fetch categories for the set here"). The `categories` prop threaded
   through `CardRow` → `RichCardSideEditor` only feeds the AI autocomplete button as context —
   it is **not** a card-tagging mechanism.
3. **The quiz filter is data-starved.** Because nothing ever creates a category,
   `availableCategories` is always empty in practice. The filter is functional but has no data.
4. **Categories are displayed nowhere** — not on flashcards (requirement), not in the card list.
5. **Games have no filter.** The matching game (`/sets/[id]/match`) and Review mode
   (`/sets/[id]/review`) load `set.cards` and launch immediately; neither is category-aware.

**Conclusion:** this is a "complete and correctly wire the categorization system end-to-end"
task, not a greenfield build and not a done feature.

## Decisions (locked with user)

1. **Staging:** New **Stage 3.6**. Leave the June-30 Stage 3.5 plan/history untouched; correct
   the false "categories done" claim in CLAUDE.md. Lands before Stage 6.
2. **Filter scope:** **all four** — Quiz, Matching game, Review mode, Flashcard carousel.
3. **Authoring UX:** **inline chips + set-level manage panel** (per-card tag picker with
   autocomplete, plus a panel to rename/merge/recolor/delete).
4. **Chip color:** **user picks color** — add a `color` field to `CardCategory`; choose from a
   curated swatch palette (not a raw hex input). New categories auto-assign the next unused swatch.

## Architecture

Extend, don't replace. The data model is sound; the work is actions + UI + wiring.

- **Filtering delivery:** query-param-driven for the server-rendered activities (match, review):
  the page reads `?cat=<id,id|uncategorized>` from `searchParams` and filters the card set before
  launching. **No params = all cards**, so today's behavior is preserved. The flashcard carousel
  filters client-side (it already holds all cards in memory). The quiz keeps its existing
  in-component setup filter.
- **Filter semantics:** **OR** across selected categories (a card matches if it has **any**
  selected category). Add an **"Uncategorized"** pseudo-bucket for cards with no assignments.
- **Category scope:** set-scoped (unchanged). Categories are created implicitly by typing a new
  name in the picker, or explicitly in the manage panel.
- **Mutations:** Next.js server actions, Zod-validated, owner-checked.

### Components / units (each with one clear purpose)

**Data model**
- `CardCategory.color String?` — new nullable column. Stores the **hex string** of a swatch
  from `CATEGORY_PALETTE` (nullable so existing rows are valid; UI treats null as "unassigned"
  and shows a neutral chip until recolored).

**Pure helpers (`src/lib/cards/categories.ts` — extend)**
- Keep `normalizeCategoryName`, `parseCategoryInput`.
- Add `pickDefaultColor(existingColors: string[]): string` — deterministic next-unused swatch.
- Add `CATEGORY_PALETTE` constant (~10 curated swatches).

**Filter helpers**
- Add one shared pure predicate `filterCardsByCategories(cards, categoryIds, includeUncategorized)`
  so quiz, match, review, and carousel share the same tested logic (OR semantics + "Uncategorized"
  bucket live here). `filterQuizCards` **delegates** to it for the category portion, keeping its
  existing starred/failed logic.

**Server actions (`src/actions/categories.ts` — new)**
- `listCategories(setId)` → `{ id, name, color, count }[]` (usage counts).
- `createCategory(setId, name)` → normalize, dedupe on `normalizedName`, assign default color.
- `renameCategory(id, name)` → **rename-to-existing normalized name = merge** (reassign the
  losing category's cards, delete it), gated by a confirm in the UI.
- `recolorCategory(id, color)`.
- `deleteCategory(id)` → cascade removes assignments; UI confirm shows affected-card count.
- `setCardCategories(cardId, categoryIds[])` → replace a card's assignments.
- All owner-checked (category's set → set.userId === session user).

**Persistence wiring (`src/actions/sets.ts` — modify)**
- On set create/update, persist per-card category assignments and create any new inline
  categories. This is the fix for "nothing persists categories."

**Authoring UI**
- `CategoryPicker.tsx` — rebuild into a real tag input: chips (with color dot), text field with
  **autocomplete against the set's existing categories**, create-on-Enter for new names,
  remove-chip. Actually consume `availableCategories`.
- `CardRow.tsx` — mount the picker per card; load the card's current assignments.
- `SetForm.tsx` — replace the `categories = []` stub with real loaded data; add a **"Manage
  categories"** panel (list + counts, rename/merge, recolor via swatch grid, delete with confirm).

**Display UI**
- Colored category chips on the flashcard (carousel) and in each `TermsList` row.
  Card-level (schema is per-card, not per-side).

**Filtering UI**
- `CategoryFilterBar.tsx` — shared control listing the set's categories (+ "Uncategorized").
  URL-driven variant for match/review (updates `?cat=`); state-driven variant for the carousel.
- Quiz: wire the existing `QuizSetupScreen` filter (works once data exists); add the
  "Uncategorized" option; confirm `filterQuizCards` covers it.

**Data loading (page-level)**
- `sets/[id]/page.tsx`, `sets/[id]/edit`, `match/page.tsx`, `review/page.tsx` must include
  `categories` and per-card `categoryAssignments`.

## Data flow

1. **Author:** user types a category on a card → `setCardCategories` (creating the `CardCategory`
   if new) → assignments persisted. Manage panel edits go through rename/recolor/delete actions.
2. **Display:** set detail loads assignments → chips render on carousel + card rows.
3. **Filter (quiz):** setup screen selects categories → `QuizSetup.categoryIds` → `filterQuizCards`
   → `quiz.ts` builds questions from the filtered set, persists `categoryIds` on the attempt.
4. **Filter (match/review):** `CategoryFilterBar` writes `?cat=` → server page filters cards via the
   shared predicate → launches game/session on the subset.
5. **Filter (carousel):** chips update client state → carousel shows the filtered subset.

## Edge cases

- Empty filter result → friendly "no cards match these categories" + clear-filter affordance
  (all activities). Matching game additionally re-checks its "≥2 cards" guard against the
  **filtered** set.
- Deleting an in-use category → confirm dialog with affected-card count; cascade removes assignments.
- Rename collision → merge into the existing category (confirm), then delete the emptied one.
- Normalization/dedup → typing "Accounting" then "accounting " maps to one category.
- Cards with zero categories → excluded from category filters unless "Uncategorized" is selected.
- No-filter default preserved everywhere (no `?cat=` = all cards; empty `categoryIds` = all cards).
- Category name length/empty validation via Zod.

## Testing

- **Pure lib:** extend `tests/cards/categories.test.ts` (`pickDefaultColor`, palette cycling) and
  `tests/quiz/setup.test.ts` / new filter test (OR semantics, uncategorized bucket, empty result).
- **Actions:** create/rename-merge/recolor/delete/setCardCategories, including owner checks and
  dedup/merge behavior.
- **Components:** picker autocomplete + create-on-Enter; `CategoryFilterBar` URL/state updates.

## Docs / staging changes

- New plan: `docs/superpowers/plans/2026-07-05-stage3-6-categorization-system.md`.
- CLAUDE.md: add a **Stage 3.6** section; **correct** the Stage 3.5 line that claims categories
  are done (note authoring/display/games-filtering were unbuilt and are delivered in 3.6).

## Non-goals (YAGNI)

- Cross-set / global (account-level) categories.
- AI auto-categorization of cards.
- Category-based analytics / mastery-by-category.
- Feeding categories into Stage 6 learner-profile prompts (future).
- Server-side PDF; nested/hierarchical categories; per-side (term vs definition) categories.
