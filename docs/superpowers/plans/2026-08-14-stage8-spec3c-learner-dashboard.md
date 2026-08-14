# Stage 8 Spec 3C — Learner dashboard & saved study scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the learner the model Spec 3 built and Spec 3B made tunable — `/profile/learner` — give them one control over what it is allowed to recommend (the saved study scope), and close the two prompt-block defects so the dashboard and the AI are looking at the same learner.

**Architecture:** The dashboard is a **rendering layer only**. Every number comes from `getLearnerMetrics`, which Spec 3B already scopes, thresholds, and ranks; components map arrays to DOM and compute nothing. The saved study scope is a fourth sparse blob on the existing `LearnerTuning` row, resolved against what currently exists by a pure function, and it supplies the dashboard's *default* scope and the quiz-setup *prefill* — never a filter on any write path.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16 App Router, React 19, Vitest 4, Zod 4, Tailwind, shadcn/base-ui.

**Spec:** `docs/superpowers/specs/2026-08-05-spec3c-learner-dashboard-design.md` (revised 2026-08-13, §5 widened to four empty states 2026-08-14)

**Depends on:** Spec 3 (merged, PR #11), the Spec 3 hardening pass, and **Spec 3B** (`plans/2026-08-06-stage8-spec3b-tunable-scoring.md`, done and live-verified 2026-08-13 on this branch). This plan consumes 3B's `ranked`, its per-learner thresholds, and its **partial** `saveTuning`. Do not start it against pre-3B code.

---

## Baselines (branch `spec3b-tunable-scoring`, measured 2026-08-13)

- **Tests:** 100 files / **1181 passing**, excluding `cursor-agents`
- **`tsc --noEmit`:** clean, excluding `cursor-agents`
- **`npm run lint`:** **185 problems** (133 errors, 52 warnings), all pre-existing

---

## Global Constraints

- `cursor-agents/` in the project root breaks bare `vitest`/`tsc` (BUILD-QUEUE trap 2). The suite is
  `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"`; the type check is
  `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`. Every command below carries them.
- Tests import via `@/` and live under `tests/<area>/`.
- **This spec adds no aggregation.** If a component sorts, filters, sums, or thresholds, it is in the wrong place — move it into a pure module under `src/lib/` with its own test. The one thing that must never happen is the dashboard and the prompt path computing the learner differently.
- **`ranked` is rendered in the order received.** Spec 3B already applied the learner's strategy. A component that re-sorts is a defect (spec §0.1).
- **Never hardcode 3 as the evidence floor** in copy or logic. It is `MetricThresholds.minObservations`, per learner, since 3B.
- A pure module must not import `@/lib/db`; DB shells import it dynamically. A lib module must never import from `src/actions/*` (`'use server'`).
- A `'use server'` module may export **only async functions**.
- Migrations must be additive. Never `--force-reset`, never `--accept-data-loss`. `prisma migrate dev` needs a TTY and is unusable from an agent shell (trap 5) — use `migrate diff` + `migrate deploy`.
- **jsdom traps (traps 7 and 9), which this plan hits more than any before it:** every `*.test.tsx` needs `// @vitest-environment jsdom` as its **literal first line** and must call `afterEach(cleanup)` itself; and a client component that imports a `'use server'` module kills the whole test file at load unless the action module is mocked.
- **Sub-agents do not check lint unless told.** Say so per task if executed in parallel. A `Record<string, any>` added to satisfy `tsc` is three `no-explicit-any` errors.
- Commit after every task. Do not skip hooks.

---

## File Structure

**Create:**
- `src/lib/tuning/study-scope.ts` — pure. Zod schema, parse, and `resolveStudyScope` (the stale-reference rule). (Task 1)
- `src/lib/metrics/coverage.ts` — pure `diagnoseEmptyState` + the DB shell `loadCoverage`. (Task 5)
- `src/actions/learner-dashboard.ts` — `'use server'`. One read for the whole page. (Task 6)
- `src/components/settings/StudyScopePanel.tsx` (Task 3)
- `src/components/learner/EmptyDashboard.tsx` (Task 7)
- `src/components/learner/TopicMastery.tsx` (Task 8)
- `src/components/learner/StudyNext.tsx` (Task 9)
- `src/components/learner/MisconceptionList.tsx`, `RetentionPanel.tsx` (Task 10)
- `src/app/profile/learner/page.tsx` (Task 11)

**Modify:**
- `prisma/schema.prisma` — `LearnerTuning.studyScope Json?` (Task 1)
- `src/lib/tuning/schema.ts` — `TuningRow.studyScope`, `shapeTuning` (Task 1)
- `src/lib/tuning/store.ts` — `ResolvedTuning.studyScope` (Task 2)
- `src/actions/learner-tuning.ts` — partial `studyScope` save (Task 2)
- `src/app/settings/ai/page.tsx` — mount the fourth panel (Task 3)
- `src/lib/memory/scope.ts` — `hasExplicitScope` (Task 6)
- `src/lib/quiz/setup.ts` — pure `resolveScopePrefill` (Task 4)
- `src/app/sets/[id]/quiz/page.tsx`, `src/components/quiz/QuizClientWrapper.tsx`, `src/components/quiz/QuizSetupScreen.tsx` — the prefill (Task 4)
- `src/lib/ai/context.ts` — reserve a topic budget in `capBlock`; pass real topics (Task 12)
- `src/actions/training-plan.ts` — pass real topics (Task 12)
- `scripts/tuning-check.ts` — use the shared coverage helper (Task 5)

---

### Task 1: `studyScope` storage and the stale-reference rule

**Files:**
- Modify: `prisma/schema.prisma`, `src/lib/tuning/schema.ts`
- Create: `src/lib/tuning/study-scope.ts`, `tests/tuning/study-scope.test.ts`

- [ ] **Step 1: Schema + migration**

```prisma
  /// Spec 3C §6: which sets and categories the learner is working on now.
  /// { setIds: string[], categoryKeys: string[] } — the same two dimensions as
  /// HistoryScope, so the stored value converts with no translation layer.
  /// Sets by id; categories by normalizedName, because a CardCategory row is
  /// SET-SCOPED and ids would mean one set's "accounting" only.
  /// Empty arrays mean EVERYTHING, matching EMPTY_SCOPE.
  studyScope Json?
```

Then trap 5's route: `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → write to `prisma/migrations/<ts>_add_study_scope/migration.sql` → `npx prisma migrate deploy` → re-run the diff and confirm "This is an empty migration". Expected SQL: one `ALTER TABLE "LearnerTuning" ADD COLUMN "studyScope" JSONB`. Any `DROP` → STOP, return BLOCKED.

- [ ] **Step 2: `src/lib/tuning/study-scope.ts`**

```ts
export const StudyScopeSchema = z
  .object({
    setIds: z.array(z.string()).default([]),
    categoryKeys: z.array(z.string()).default([]),
  })
  .strict()

export interface StoredStudyScope { setIds: string[]; categoryKeys: string[] }

/** Corrupt blob → empty scope, never a throw. Same rule as the other three. */
export function parseStudyScope(raw: unknown): StoredStudyScope
```

Then the load-bearing function:

```ts
export interface ResolvedStudyScope {
  scope: HistoryScope
  /** Stored ids/keys that no longer exist. Rendered so the learner can clean up. */
  staleSetIds: string[]
  staleCategoryKeys: string[]
  /**
   * TRUE only when a NON-EMPTY stored scope resolved to nothing and was
   * dropped. A learner who never saved a scope has not been "widened" — firing
   * the notice for them would tell every new user their setting broke.
   */
  widened: boolean
}

export function resolveStudyScope(
  stored: StoredStudyScope,
  available: { setIds: string[]; categoryKeys: string[] },
): ResolvedStudyScope
```

Rules, and each is a test:
- nothing stored → `EMPTY_SCOPE`, `widened: false`
- all stored references survive → that scope verbatim, `widened: false`
- **some** survive → scope by the survivors, stale ones listed, `widened: false`
- **none** survive → `EMPTY_SCOPE`, `widened: true`
- one dimension dies and the other survives → scope by the survivor, `widened: false` (the scope still means something)
- `UNCATEGORIZED_ID` always survives — it is a sentinel bucket in `filterCardsByCategories`, not a row, so it is never in `available.categoryKeys` and must not be judged stale

**Why widen rather than narrow** (spec §6.4): an empty recommendation list is indistinguishable from a broken feature — the 3B gate produced that exact confusion twice — whereas a wider-than-intended list is visible, obviously wrong, and one click from fixed. Widening is recoverable and self-announcing; silence is neither.

- [ ] **Step 3: `shapeTuning` carries the fourth field**

Add `studyScope: StoredStudyScope` to `TuningRow` and parse it in `shapeTuning`, **independently** of the other three — the existing contract is that one corrupt blob must not discard a good strategy. Extend `tests/tuning/schema.test.ts` with a corrupt-`studyScope`-only case asserting bands, thresholds and strategy survive.

- [ ] **Step 4: Verify and commit** — `npx vitest run tests/tuning/`, `npx prisma generate`, type check, then commit.

---

### Task 2: Persist it through the partial save

**Files:**
- Modify: `src/lib/tuning/store.ts`, `src/actions/learner-tuning.ts`
- Test: `tests/tuning/store.test.ts`, `tests/actions/learner-tuning.test.ts`

- [ ] **Step 1: `getUserTuning` returns `studyScope`** — add it to `ResolvedTuning` and select the column. Note the asymmetry and comment it: bands and thresholds are **resolved** here (merged over defaults), `studyScope` is returned **stored**, because resolving it needs the learner's current sets and categories — a DB read this function has no business doing on every metrics call.

- [ ] **Step 2: `loadTuning` / `saveTuning`**

`loadTuning` returns the stored scope. `saveTuning` gains one more independent branch, exactly parallel to the other three:

```ts
if (input.studyScope !== undefined) {
  const parsed = StudyScopeSchema.safeParse(input.studyScope)
  if (!parsed.success) return { success: false, error: 'Invalid study scope' }
  data.studyScope = parsed.data
}
```

- [ ] **Step 3: The partial-save invariant, extended to four**

This is the assertion that protects 3B's §5 decision. Test: save a scope, then save a *strategy*, then read — the scope must survive. And the reverse. Then **mutation-test it**: make `saveTuning` write `studyScope: input.studyScope ?? {setIds:[],categoryKeys:[]}` unconditionally and confirm the test reddens. If it does not, the fixture is not discriminating (3B found three such tests) — fix the fixture, not the code.

- [ ] **Step 4: Commit.**

---

### Task 3: The study scope panel

**Files:**
- Create: `src/components/settings/StudyScopePanel.tsx`, `tests/components/study-scope-panel.test.tsx`
- Modify: `src/app/settings/ai/page.tsx`

- [ ] **Step 1: The panel**

Two independent checkbox groups, each revealing its list when ticked — the shape the user asked for:

```
[x] Only test certain sets
     [x] Accounting Interview Prep     [ ] Valuation Deck
[ ] Only test certain categories
```

Options come from `listMemoryFilterOptions()` (`src/actions/memory.ts:120`), which already returns account-wide sets and **cross-set categories grouped on `normalizedName`** — the exact key this blob stores. Do not write a second options query; the grouping is the part that would drift.

Categories render with their colour dot and card count, like `ScopeBar`'s chips. Include `UNCATEGORIZED_ID` as a selectable option.

Send **only** `{ studyScope }` — never the other three fields.

- [ ] **Step 2: The un-savable state**

Ticked-with-nothing-selected must be blocked: disable Save with "pick at least one set, or untick the box." Not cosmetic — `[]` on disk means *everything*, so saving that state would store the exact opposite of what the panel displays. There is no third value to store, which is why this is a UI block rather than a storage decision.

- [ ] **Step 3: Tests**

`// @vitest-environment jsdom` first line; `afterEach(cleanup)`; **mock `@/actions/learner-tuning` and `@/actions/memory`** or the file dies at load (trap 7). Assert: the list is hidden until the box is ticked; ticking then unticking every item disables Save; a save sends only `studyScope`.

- [ ] **Step 4: Mount and commit.** Add `<StudyScopePanel />` to `src/app/settings/ai/page.tsx` below `<TargetingStrategyPanel />`. Run lint — expect **185**.

---

### Task 4: Quiz-setup prefill

**Files:**
- Modify: `src/lib/quiz/setup.ts`, `src/app/sets/[id]/quiz/page.tsx`, `src/components/quiz/QuizClientWrapper.tsx`, `src/components/quiz/QuizSetupScreen.tsx`
- Test: `tests/quiz/setup.test.ts`

- [ ] **Step 1: The pure resolve**

`QuizSetup.categoryIds` holds **per-set ids**; the scope stores cross-set names. So this is a resolve, not a copy:

```ts
export function resolveScopePrefill(input: {
  setId: string
  scope: { setIds: string[]; categoryKeys: string[] }
  categories: { id: string; normalizedName: string }[]
}): { categoryIds: string[]; outOfScope: boolean }
```

- scope's `setIds` is non-empty and excludes `setId` → `{ categoryIds: [], outOfScope: true }`
- otherwise → the ids of this set's categories whose `normalizedName` is in `categoryKeys`
- no match → `[]`. **An empty prefill means "everything in this set"**, which is today's behaviour and the right default. Never prefill an empty-but-active filter: that selects zero cards and produces a quiz with no questions.

- [ ] **Step 2: Wire it server-side**

`src/app/sets/[id]/quiz/page.tsx` is already a server component and already loads `set.categories` in full, so `normalizedName` is in hand — **no new query and no new action.** Call `getUserTuning(session.user.id)`, run `resolveScopePrefill`, pass `initialCategoryIds` and `scopeNotice` down through `QuizClientWrapper` to `QuizSetupScreen`'s `useState` initialiser.

`outOfScope` renders one line: "This set is outside your saved study scope, so no categories were pre-selected." Silently prefilling an excluded set is confusing; silently *blocking* it would be enforcement, which spec §6.2 rejected.

- [ ] **Step 3: Test and commit.** Cover all four branches. Note `QuizClientWrapper` has pre-existing `any` props — do not widen them, and do not add new `any`.

---

### Task 5: Coverage counts and the four-cause diagnosis

**Files:**
- Create: `src/lib/metrics/coverage.ts`, `tests/metrics/coverage.test.ts`
- Modify: `scripts/tuning-check.ts`

- [ ] **Step 1: The DB shell**

```ts
export interface DashboardCoverage {
  klpStates: number
  klpStatesClearingFloor: number
  cardsWithLiveKlps: number
  categorizedCards: number
  rankableCards: number        // BOTH — the precondition nobody predicts
  rankableCardsInScope: number // the same count, narrowed by the applied scope
}

export async function loadCoverage(prisma, userId, scope, floor): Promise<DashboardCoverage>
```

**Every count is filtered by `userId`.** `scripts/tuning-check.ts` currently counts `cardKlp`/`card` globally with no owner filter — harmless with one user in the database, wrong the moment there are two, and this helper is about to be the page a user sees. Port the script onto this helper in the same task so the gate and the page can never disagree about coverage.

- [ ] **Step 2: The pure diagnosis**

```ts
export type EmptyCause =
  | { kind: 'no_history' }
  | { kind: 'below_floor'; measured: number; floor: number }
  | { kind: 'nothing_categorized'; cardsWithKlps: number }
  | { kind: 'scope_too_narrow' }
  | null  // not empty — render the dashboard

export function diagnoseEmptyState(
  coverage: DashboardCoverage,
  scoped: boolean,
): EmptyCause
```

Order matters and is itself the design: `no_history` (nothing to say) → `scope_too_narrow` (scoped, and the library *does* have rankable cards outside it) → `nothing_categorized` (library-wide) → `below_floor` (evidence exists, none has cleared). Distinguishing the middle two is the point — both are "nothing is categorized", but one is about the library and one about the slice the learner chose, and the remedies are **opposite**: categorize versus widen. A merged message sends half the learners to the wrong fix.

- [ ] **Step 3: Four fixtures, four assertions**

Differing **only** in the counts, asserting four different `kind`s. Then mutation-test the ordering: swap the `scope_too_narrow` and `nothing_categorized` branches and confirm a test reddens.

- [ ] **Step 4: Commit.**

---

### Task 6: One read for the page

**Files:**
- Create: `src/actions/learner-dashboard.ts`
- Modify: `src/lib/memory/scope.ts`
- Test: `tests/actions/learner-dashboard.test.ts`, `tests/memory/scope.test.ts`

- [ ] **Step 1: `hasExplicitScope`**

```ts
/** Scope keys `serializeScope` writes, plus the explicit "everything" marker. */
export const SCOPE_PARAM_KEYS = ['sets', 'cats', 'card', 'source'] as const
export const SCOPE_ALL_PARAM = 'scope'   // ?scope=all

export function hasExplicitScope(params: URLSearchParams): boolean
```

Lives beside `serializeScope` so the two cannot drift. It exists because `serializeScope(EMPTY_SCOPE)` is the empty string, making "the learner cleared the scope" and "the learner has not chosen one" **the same URL** — and they must behave differently: the second gets the saved default, the first must not. "Show everything" navigates to `?scope=all`.

- [ ] **Step 2: `getLearnerDashboard`**

```ts
export async function getLearnerDashboard(
  urlScope: HistoryScope | null,   // null = URL carried no scope
): Promise<ActionResult<{
  metrics: LearnerMetrics
  coverage: DashboardCoverage
  empty: EmptyCause
  appliedScope: HistoryScope
  defaultApplied: boolean          // the saved scope is in force, not a URL one
  widened: boolean                 // §6.4 fired — the notice is NOT optional
  staleSetIds: string[]
  staleCategoryKeys: string[]
  thresholds: MetricThresholds     // so copy can quote the learner's own floor
  strategy: StrategyKey            // so the ordering control can name it
}>>
```

Order: auth → `getUserTuning` → if `urlScope` is non-null use it (`defaultApplied: false`, no resolution — a URL is an instruction, not a preference) → else resolve the saved scope against `listMemoryFilterOptions`-shaped availability → `getLearnerMetrics({ userId, scope })` → `loadCoverage` → `diagnoseEmptyState`.

**A URL scope is never resolved for staleness.** A shared or bookmarked link must show what it says, including nothing.

- [ ] **Step 3: Test.** The precedent for mocking `getLearnerMetrics` is `tests/metrics/read-populations.test.ts`. Assert: URL scope beats the saved default; absent URL applies the default with `defaultApplied: true`; an all-stale saved scope sets **`widened: true`** — assert the flag, not just the widening, since a silent widening is the defect.

- [ ] **Step 4: Commit.**

---

### Task 7: The empty dashboard

**Files:**
- Create: `src/components/learner/EmptyDashboard.tsx`, `tests/components/empty-dashboard.test.tsx`

- [ ] **Step 1:** One component over `EmptyCause`, four messages, each with its own action link — study / `/settings/ai` (the floor) / the set editor (categorize) / clear the scope. `below_floor` quotes `thresholds.minObservations`, **never a literal 3**.

Include the retroactivity line on `nothing_categorized`, because it is cheap and non-obvious: adding a category to an already-studied card lights the topic up immediately — posteriors are keyed by KLP id, so the evidence is already there and no re-quizzing is needed.

- [ ] **Step 2: Tests.** Four fixtures, four distinct strings. Plus the one that matters: render with `minObservations: 1` and assert the copy says 1 and the string "3" does not appear. Mutation-test by hardcoding 3 — the test must redden.

- [ ] **Step 3: Commit.**

---

### Task 8: Topic mastery and verbosity

**Files:**
- Create: `src/components/learner/TopicMastery.tsx`, `tests/components/topic-mastery.test.tsx`

- [ ] **Step 1:** Knowledge against articulation on one grid, **never collapsed into a single "mastery %"** — the whole point of the substrate is that high-knowledge/low-articulation is a different prescription from low-on-both. Topics carry their `CATEGORY_PALETTE` colour.

A `null` metric renders its insufficient-data state, **never a 0**. Rendering null as 0% tells a learner they know nothing about a topic they have simply not been quizzed on.

- [ ] **Step 2:** Verbosity as a diverging bar from the signed index, centred at calibrated. Topics whose `too_terse` tags were excluded for low `pKnown` are labelled **knowledge gaps**, not shown as neutral — no articulation signal *because the learner does not know it* is not the same as well-calibrated.

- [ ] **Step 3: Tests** — null → insufficient-data, not "0%"; the mutation is rendering `?? 0`. Commit.

---

### Task 9: What to study next

**Files:**
- Create: `src/components/learner/StudyNext.tsx`, `tests/components/study-next.test.tsx`

- [ ] **Step 1:** Render `metrics.ranked` **in the order received**. Each row is a KLP — the proposition, its card, its topic — because "not WACC, but the exact sub-claim you get wrong" is the most actionable thing this substrate knows.

- [ ] **Step 2:** `sufficient: false` rows are visually separated and labelled unmeasured, never interleaved. On a thin corpus they are all tied at the prior, and presenting that tie as a ranking invents a recommendation the evidence does not support.

- [ ] **Step 3:** The ordering control **names** the active strategy and links to `/settings/ai`. It does not re-implement ordering.

- [ ] **Step 4: The guard that matters most in this plan.** A test that reorders the fixture and asserts the DOM order follows. Then mutation-test it with `[...ranked].sort((a,b) => b.score - a.score)` — a mutant that looks *more* correct than the original, which is exactly why it needs to redden. **Use a fixture whose ranked order is NOT already score-descending**, or the mutant survives; 3B lost this exact bet twice (a purity test with pre-sorted ids, a strategy test every strategy ranked alike).

- [ ] **Step 5: Commit.**

---

### Task 10: Misconceptions, retention and pace

**Files:**
- Create: `src/components/learner/MisconceptionList.tsx`, `RetentionPanel.tsx`, and their tests

- [ ] **Step 1:** Weak KLPs with the verbatim `quote` evidence from their tags, respecting the learner's floor.
- [ ] **Step 2:** Promoted conflation pairs with stored label and `evidence_snippet`; **retirement state visible**, so a learner can watch one decay rather than wondering why it vanished.
- [ ] **Step 3:** Bucketed recall from the forgetting curve, what is due, and pace outliers labelled "correct but not fluent" — with their mode, since each is scored against that mode's own baseline and mixing them is meaningless.
- [ ] **Step 4: Commit.**

---

### Task 11: The page

**Files:**
- Create: `src/app/profile/learner/page.tsx`
- Modify: `src/app/profile/page.tsx` (a link — otherwise the page is unreachable)

- [ ] **Step 1:** Follow `/profile/memory/page.tsx` exactly: `Suspense` wrapper, URL-synced scope via `parseScope`/`serializeScope`, `ScopeBar` fed by `listMemoryFilterOptions`, request-key tagging so a slow earlier reply cannot win. Reuse; do not invent a second scoping mechanism — the memory page already solved cross-set categories, and a second implementation would drift until the two pages disagreed about what "valuation" contains.

- [ ] **Step 2: Two notices, both required**
  - `defaultApplied` → "Showing your saved study scope" + a one-click **Show everything** (`?scope=all`). A filtered view the learner did not choose on this visit, and cannot see a reason for, is the same failure as an empty state that looks broken.
  - `widened` → "Your saved study scope no longer matches anything that exists — showing everything." Naming the stale entries. This is not optional; without it, this is just a setting that stopped working.

- [ ] **Step 3: Link it from `/profile`.** A page nothing links to does not exist — `/profile/activity/[id]` shipped that way and had to be fixed later (`b911ae4`).

- [ ] **Step 4: Commit.**

---

### Task 12: Close both prompt-block defects — together

**Files:**
- Modify: `src/lib/ai/context.ts`, `src/actions/training-plan.ts`
- Test: `tests/ai/context.test.ts`

**Fix both or neither.** Closing the first alone silently drops the topic signal the moment an active learner's card section fills `MAX_PROFILE_CHARS` — which is the case that motivated the fix.

- [ ] **Step 1: Reserve a topic budget in `capBlock`.** Today the card section is concatenated first and `capBlock` truncates the tail, so the topic section is always what dies. Build the topic section first, reserve `min(topicLen, TOPIC_SECTION_RESERVE)` characters for it, cap the **card** section to what remains at a line boundary, then concatenate.

- [ ] **Step 2: Pass real topics.** `safeProfileBlock` (`context.ts:155`) and `training-plan.ts:34` both hardcode `topics: []`. Source them from the topic profile. Keep the try/catch isolation: a profile failure must never break the AI call it exists to enrich.

- [ ] **Step 3: The test that is the whole point.** A card section that alone exceeds `MAX_PROFILE_CHARS`, and assert **a topic line survives**. Without this input the fix is untested for the only case that motivated it. Mutation: restore the old concatenation order and confirm it reddens.

- [ ] **Step 4: Commit.**

---

## Final verification

- [ ] Full suite: `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` — expect ≥ **1181** and zero failures.
- [ ] `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"` — clean.
- [ ] `npm run lint` — **185**. Not 186.
- [ ] `npm run tuning:check` — coverage counts now come from `loadCoverage` and are user-filtered.
- [ ] Grep for a hardcoded floor in new copy: `grep -rn "3 answers\|three answers" src/components/learner src/app/profile/learner` → no hits.
- [ ] **Mutation-test every guard.** For each assertion that exists to catch a specific defect, introduce that defect, confirm red, revert. `scripts/mutcheck.py` automates the loop. The five that matter most: the ranked-order guard (Task 9), the partial-save invariant (Task 2), the widened flag (Task 6), the diagnosis ordering (Task 5), and the capBlock reserve (Task 12).

## Human gate — the user runs this, not an agent

No signed-in page is reachable from an agent session (trap 6: GitHub OAuth only, no `GITHUB_ID`/`GITHUB_SECRET` in `.env`). Write these as explicit gates rather than discovering them mid-task:

1. `/settings/ai` → tick "Only test certain sets", pick one, save. Re-run `npm run tuning:check`: the stored row must still carry the 3B band override, both threshold overrides, **and** the strategy. That is the four-panel partial-save proof.
2. `/profile/learner` → the saved scope is in force and **says so**; "Show everything" widens it.
3. Delete or rename every set/category in the saved scope → reload → the page shows **everything** plus the stale notice. This is the §6.4 rule live, and it is the one no mocked test can fully stand in for.
4. Start a quiz on a set inside the scope → its categories are pre-ticked and can be un-ticked. Start one on a set outside → nothing pre-ticked, notice shown, and the quiz still runs over every card.
5. With the tuning left in its 3B test state (`minObservations: 1`), confirm the empty-state copy quotes **1**, not 3.

## Deliberately NOT in this plan

- **Trend-over-time charts** — the substrate stores current posteriors, not their history (spec §8).
- **Unscoped `repeatBonus` derivation** (3B §3.4.2) — a scoped view can read one point lower than the canonical unscoped value. Recorded, not fixed here.
- **Study scope as an enforced filter**, or scoping Review/Matching by it. §6.2 chose prefill; "stop me studying off-plan" is a different feature with a different consent story.
- **Any change to a write path.** The scope selects and orders what is *offered* and touches nothing that is recorded. A scope that filtered the memory write path would silently discard evidence the learner generated — and unlike a bad ordering, that is not recoverable by changing the setting back.
