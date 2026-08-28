# Set Views & Atlas Implementation Plan

> **EXECUTED 2026-08-28.** All 6 tasks complete; commits `b42c5dd..0b0d62a`. Baselines at completion: 195 files / 2422 tests, tsc clean, build clean, lint 175. **Live gate owed (spec §11).** Task 5 Step 3 (`diagnoseEmptyState`) and Task 6 Step 2 (re-run mutations) were MISSED on the first pass and closed in `45f290f`, which also fixed five deep links stranded by item 6f's settings split.

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the set page into Study / Knowledge / Analysis, move everything about what you
know into Knowledge with mastery-shaded concepts, and ship Analysis mostly real with one
honest in-progress block.

**Architecture:** A `(views)` route group inside `(app)/sets/[id]/` supplies the shared header
and tab strip; `edit` and `concepts` stay outside it. Both new tabs read from
`getLearnerMetrics({ scope: { setIds: [id] } })` — no new tables, no new writes.

**Tech Stack:** Next.js 16.2.9 App Router, Prisma 7.8, Tailwind v4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-28-set-views-and-atlas-design.md`

## Global Constraints

- **Baselines to hold:** 190 files / 2335 tests, `tsc` clean, `next build` clean,
  `npm run lint` **175** (do not increase).
- **`readableSetWhere` on every set read**, composed via `composeSetWhere`, never spread
  beside another `OR`.
- **`null` knowledge is never `0`.** Four modules already state this; a fifth is being added.
- **Pages must not re-center themselves** — the shell owns the measure. Narrow means
  `max-w-*` with no `mx-auto`.
- **Every guard proven red by mutation, and verify the mutation landed** — a replace that hits
  an explanatory comment looks exactly like a guard that cannot fail (2026-08-28).
- **Back up untracked files before mutating**; `git checkout --` silently fails on them.

---

### Task 1: Pure modules — tabs and mastery shading

**Files:**
- Create: `src/lib/sets/views.ts`, `src/lib/klt/mastery-shade.ts`
- Create: `tests/sets/views.test.ts`, `tests/klt/mastery-shade.test.ts`

**Produces:** `setViewTabs(setId)`, `isSetViewCurrent(pathname, href)`,
`shadeForKnowledge(knowledge: number | null): MasteryShade`, `MASTERY_SHADES`.

- [x] **Step 1: Failing tests.** Study is not current on `/knowledge` or `/analysis`; at most
      one tab current for every path; `shadeForKnowledge(null) === 'unknown'`; band boundaries
      are exclusive at the top; 0 maps to `weak`, not `unknown`.
- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement** per spec §3 and §5.3.
- [x] **Step 4: Mutate** `knowledge ?? 0` and `startsWith`; confirm both red; confirm each
      mutation actually landed before believing a green run.
- [x] **Step 5: Commit.**

---

### Task 2: Knowledge data loader

**Files:**
- Create: `src/lib/sets/knowledge.ts`, `tests/sets/knowledge.test.ts`

**Produces:** `shapeTopicMastery(topics): TopicMasteryRow[]`,
`shapeConfidenceHistogram(rows): ConfidenceHistogram`, `loadSetKnowledge(userId, setId)`.

- [x] **Step 1: Failing tests.** A null `knowledge` survives as null through
      `shapeTopicMastery`; a null `dueAt` counts as due in the histogram; an empty set yields
      zeroed counts and null averages, never `0` averages.
- [x] **Step 2: Run, verify fail.**
- [x] **Step 3: Implement.** `loadSetKnowledge` is a thin read-only shell over
      `getLearnerMetrics` with `{ setIds: [setId], categoryKeys: [], sources: [] }`, plus the
      set's categories, `CardProgress` rows and `StudySession` rows.
- [x] **Step 4: Run, verify pass.**
- [x] **Step 5: Commit.**

---

### Task 3: The route group, header and tab strip

**Files:**
- Create: `src/app/(app)/sets/[id]/(views)/layout.tsx`,
  `src/components/sets/SetViewTabs.tsx`, `src/components/sets/SetHeader.tsx`
- Move: `(app)/sets/[id]/page.tsx` → `(app)/sets/[id]/(views)/page.tsx`
- Modify: `tests/shell/route-structure.test.ts`, `tests/sets/visibility-enforcement.test.ts`

- [x] **Step 1:** Move the Study page into `(views)` with `git mv`; fall back to copy+remove
      if OneDrive refuses the rename.
- [x] **Step 2:** Lift the header out of the page and into the layout — title, description,
      fork attribution, card count, owner actions, listing-blocked notice. Drop the outline
      **Concepts** button; it is a tab now.
- [x] **Step 3:** `SetViewTabs` is the only client piece, using `isSetViewCurrent`.
- [x] **Step 4:** Update `ENFORCED_PATHS` and the route-structure lists for the new paths, and
      assert `edit` and `concepts` are NOT inside `(views)`.
- [x] **Step 5: Mutate** by moving `edit` into `(views)`; confirm red.
- [x] **Step 6:** `npx tsc --noEmit && npm run build`.
- [x] **Step 7: Commit.**

---

### Task 4: Knowledge tab

**Files:**
- Create: `src/app/(app)/sets/[id]/(views)/knowledge/page.tsx`,
  `src/components/sets/knowledge/ConceptMastery.tsx` (Map|List switch),
  `MasteryList.tsx`, `CategoryMastery.tsx`, `ConfidenceBars.tsx`, `SetHistory.tsx`
- Modify: `src/components/klt/ConceptCanvas.tsx` (accept optional `shades`)

- [x] **Step 1:** Four-metric header via `Metric`, which already renders `—` for null.
- [x] **Step 2:** `ConceptCanvas` gains an optional `shades?: Map<string, MasteryShade>`.
      Optional so `/sets/[id]/concepts` renders exactly as it does now — the editor is not
      changing.
- [x] **Step 3:** `MasteryList` takes `TopicMasteryRow[]` and imports nothing from KLT. The
      view is chosen by `?view=list`.
- [x] **Step 4:** Categories, confidence distribution, session history.
- [x] **Step 5:** Signed-out branch: unshaded map plus a sign-in prompt, never a 404.
- [x] **Step 6:** `npm run build`.
- [x] **Step 7: Commit.**

---

### Task 5: Analysis tab

**Files:**
- Create: `src/app/(app)/sets/[id]/(views)/analysis/page.tsx`,
  `src/components/sets/knowledge/InProgressBlock.tsx`

- [x] **Step 1:** Render `RetentionPanel`, misconceptions and pace outliers from the same
      scoped metrics.
- [x] **Step 2:** `InProgressBlock` states what is coming and what it needs. **No fake chart** —
      a dimmed invented chart is indistinguishable from real data at a glance.
- [x] **Step 3:** Empty states route through `diagnoseEmptyState` so four causes stay four.
- [x] **Step 4:** `npm run build`.
- [x] **Step 5: Commit.**

---

### Task 6: Verify, document, remember

- [x] **Step 1:** Full suite, `tsc`, `lint`, `build`.
- [x] **Step 2:** Re-run every mutation from Tasks 1 and 3 against the final tree.
- [x] **Step 3:** Update `docs/superpowers/BUILD-QUEUE.md` with baselines and the owed gate.
- [x] **Step 4:** Update memory: `set-views-and-atlas-owed` becomes built; record the three
      revised decisions.
- [x] **Step 5: Commit.**
