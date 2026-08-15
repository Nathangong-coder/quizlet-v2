# Profile & sets UI overhaul — Implementation Plan

**Goal:** Make the profile area navigable and non-duplicative now that it has three pages, and make the sets surfaces show the study state the app already tracks.

**Why now:** Spec 3C added `/profile/learner` as a third sibling under `/profile` with no navigation between the three, and gave the app a real learner model that the old `/profile` aggregates now duplicate badly. The sets surfaces never caught up with two shipped features — set visibility (queue item 1) and confidence/due state — so neither is visible where a learner chooses what to study.

**Not a restyle.** Every task below closes a specific, checkable gap found by reading the current pages. Colour, spacing and typography are untouched except where hierarchy is the defect.

---

## Findings this plan closes

**Profile area**
1. **Three sibling pages, no navigation.** `/profile` carries two text links; `/profile/memory` and `/profile/learner` each have only "Back to profile". Moving between the two leaves means going up and back down.
2. **Three overlapping names, no hierarchy.** `/profile` is titled *"Your Learning Memory"*, `/profile/memory` is *"Memory History"*, `/profile/learner` is *"Learner Profile"*. The parent is named after one of its children.
3. **`/profile` duplicates `/profile/learner`, worse.** "Avg Performance" and "Performance by Mode" are flat averages over quiz attempts; the learner page reports knowledge, articulation and retention from the same evidence. Two pages answering "how am I doing?" differently is how a learner stops trusting both.
4. **A full-page spinner blocks the whole route** (`min-h-screen`, centred) — nothing renders, including the header and links, until `getUserStats` resolves.
5. **A stats failure is a dead end**: "Failed to load your profile." with no retry and no navigation.

**Sets list (`/sets`)**
6. **Visibility is invisible.** Item 1 shipped private-by-default with a link-shareable toggle, and the list never shows which is which. The one place a learner would check is the only place it is not shown.
7. **No study signal.** Every card shows title, description, card count, creation date. The app knows confidence, due counts and last-studied per set and shows none of it, so the list cannot answer "what should I open?".
8. **A `<Button>` nested inside a `<Link>`** (`SetCard.tsx:45`) — invalid HTML, and a real focus-order problem for keyboard users.

**Set detail (`/sets/[id]`)**
9. **Seven dead imports** — `Button`, `Card`, `CardContent`, `Badge`, `Separator`, `StarButton`, `ConfidenceRate`. Confirmed against lint; they are 7 of the 52 warnings in the baseline.

---

## Global constraints

- Suite: `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"`; type check `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`. Baselines after Spec 3C: **1286 tests / 105 files**, `tsc` clean, lint **185**.
- Lint must **drop** by the 7 dead imports Task 4 removes and gain nothing. Target **178**.
- Aggregation goes in pure, tested modules — never in a component. Same rule Spec 3C followed.
- jsdom traps: `// @vitest-environment jsdom` as the literal first line, `afterEach(cleanup)`, and mock any `'use server'` module a rendered component imports.
- No schema changes. Everything here reads data that already exists.
- Commit per task.

---

### Task 1: One navigation across the profile area

**Files:** create `src/components/profile/ProfileNav.tsx`; modify `src/app/profile/page.tsx`, `src/app/profile/memory/page.tsx`, `src/app/profile/learner/page.tsx`; test `tests/components/profile-nav.test.tsx`

- [ ] One tab strip rendered on all three pages, marking the current one with `aria-current="page"`.
- [ ] Rename for a hierarchy that reads: **Overview** (`/profile`), **Learner Profile** (`/profile/learner`), **Memory History** (`/profile/memory`). The parent stops being named after its child.
- [ ] Replace the per-page "Back to profile" links — the nav subsumes them.
- [ ] Test: every destination is present on each page; exactly one is `aria-current`.

### Task 2: `/profile` stops competing with `/profile/learner`

**Files:** `src/app/profile/page.tsx`

- [ ] Keep the three counters (mastered / attempts / average) — those are activity facts, not judgements.
- [ ] Replace the "Performance by Mode" panel with a pointer into the learner page. A flat per-mode average sitting beside a BKT posterior invites the reader to reconcile two numbers that answer different questions.
- [ ] **Render the header and nav immediately**; only the stats region shows a loading state. A full-route spinner hides the navigation that is the fix for finding 1.
- [ ] Error state keeps the nav and offers a retry.

### Task 3: Per-set study summary

**Files:** create `src/lib/sets/study-summary.ts`, `tests/sets/study-summary.test.ts`; modify `src/app/sets/page.tsx`, `src/components/sets/SetCard.tsx`

- [ ] Pure `shapeSetSummary(rows, now)` → `{ studiedCards, averageConfidence, dueCount, lastStudiedAt }` per set, plus a DB shell `loadSetStudySummaries`.
- [ ] `averageConfidence` is **null** when nothing is studied, never 0 — the same rule the dashboard follows. A zero would read as "you know none of this" on a set never opened.
- [ ] `dueCount` counts `dueAt <= now`; a null `dueAt` is not due.
- [ ] `SetCard` renders a **visibility badge** (finding 6), the study signal, and **drops the nested `<Button>`** for a plain styled span (finding 8).
- [ ] Tests: nothing studied → null average and zero due; a null `dueAt` is never due; the boundary `dueAt === now` counts as due.

### Task 4: Set detail cleanup and study header

**Files:** `src/app/sets/[id]/page.tsx`

- [ ] Delete the seven dead imports (finding 9).
- [ ] Add a one-line study summary under the card count for signed-in viewers, from the same helper as Task 3 — so the list and the detail page cannot disagree.

### Final verification

- [ ] Full suite green, `tsc` clean, lint **178** (185 − 7 dead imports).
- [ ] Mutation-test each new guard: the null-average rule, the due boundary, and the `aria-current` marker.

### Human gate (trap 6 — agent sessions cannot reach signed-in pages)

1. `/profile`, `/profile/learner`, `/profile/memory` — the nav appears on all three and marks the right tab.
2. `/profile` renders its header and nav before the stats arrive.
3. `/sets` — each card shows its visibility, and a studied set shows confidence and due count; an unstudied set shows neither a 0% nor a due count.
