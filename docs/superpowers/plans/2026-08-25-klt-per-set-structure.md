# KLT Per-Set Structure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move concept STRUCTURE from one global tree to a per-set hierarchy over a shared vocabulary, so any set owner can edit their own tree — with an admin view spanning all sets, and reusable presets.

**Architecture:** `Klt` becomes a pure globally-unique concept registry. A new `SetKltNode` holds `parentKltId`/`depth`/`ancestorIds` per (set, concept). Placement, rollup, seeding, health checks and invariants all become set-scoped. Two editors read and write the same table and differ only in scope and gate.

**Tech Stack:** Next.js App Router, TypeScript, Prisma + Postgres (Neon), Vercel AI SDK v7, Zod, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-klt-per-set-structure-design.md`. It supersedes parts of `2026-08-25-klt-concept-tree-design.md`; where they disagree, THIS spec wins.

## Global Constraints

- **Never delete or supersede a `CardKlp`. Never touch `KlpState` or `AnswerKlpResult`.** `AnswerKlpResult.klp` is `onDelete: Cascade` — deleting a `CardKlp` destroys a learner's answer history irrecoverably. This has held for two phases and holds here.
- **Every write affects exactly ONE set's structure**, admin included. The admin view differs in what it can reach, never in what an edit does.
- **`Klt` is the comparable unit.** Its `normalizedName` stays globally unique — that is what a future leaderboard aggregates on. Never key comparison on a path.
- **`SetKltNode.parentKltId` holds a `Klt` id, not a `SetKltNode` id**, and carries NO foreign key: an FK would point at `Klt` and wrongly permit a parent with no node in this set. The invariant checker enforces it instead.
- Depth cap 8 (`MAX_TREE_DEPTH`), refused whole, never truncated. `ancestorIds` root-first, EXCLUDING self, **within the set**.
- Concept names go through `parseKltName` (≤4 words, ≤40 chars, dropped never truncated).
- Nothing the AI proposes is auto-applied.
- **Verify with the FULL SUITE:** `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` and `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`. Baseline: **165 files / 1950 passing**, tsc clean, lint **175**.
- `prisma migrate dev` needs a TTY and is unusable — use `migrate diff` → write SQL → `migrate deploy`.
- `'use server'` files export only async functions. Component tests need `// @vitest-environment jsdom` as the literal first line and their own `afterEach(cleanup)`. A client component importing a `'use server'` module breaks jsdom tests unless the action module is mocked.
- **Mutation testing is a PROCESS, not an artifact.** Every guard needs a test that FAILS when the guard is removed — verify and report. Never commit a test that rebuilds a local copy of the unit under test.

---

## Task 1: Schema and set-scoped invariants

**Files:** Modify `prisma/schema.prisma`, `src/lib/klt/invariants.ts`, `tests/klt/invariants.test.ts`, `tests/schema/klt-schema.test.ts`. Create the migration.

**Produces:** `SetKltNode`, `KltPreset`; `SetNodeRow` (exported from `src/lib/klt/tree.ts`); `checkTreeInvariants(rows: SetNodeRow[])` over ONE set's nodes, keyed by `kltId`, with a new `'parent_not_in_set'` kind and violations carrying `kltId` + `nodeId`. `Klt` keeps its structure columns until Task 6.

- [ ] **Step 1: Schema — EXPAND ONLY.** Add `SetKltNode` and `KltPreset` exactly as §3 and §3b of the spec define them, and add `nodes SetKltNode[]` to `Klt`. **KEEP `Klt.parentKltId`, `Klt.depth`, `Klt.ancestorIds` and the `KltTree` self-relation for now**, with a doc comment marking them deprecated and naming Task 6 as where they are dropped. Thirteen source files still read them; removing them here leaves `tsc` and the suite red until Task 4, which would make every intermediate task unverifiable. Task 6 contracts.
- [ ] **Step 2: Migration** (additive only) via `migrate diff` → `prisma/migrations/20260826000000_klt_per_set/migration.sql` → `migrate deploy`. It must contain no `DROP COLUMN`. Append by hand:
  ```sql
  CREATE INDEX "SetKltNode_ancestorIds_idx" ON "SetKltNode" USING GIN ("ancestorIds");
  ```
  Then re-run the diff and confirm it is empty apart from that hand-added index.
- [ ] **Step 3: Invariants.** `checkTreeInvariants` now validates ONE SET's nodes — the caller scopes the rows; the function never sees a `setId` and cannot verify what it is not given. Export a new row type from `src/lib/klt/tree.ts` beside `TreeNodeRow`:
  ```ts
  export interface SetNodeRow {
    id: string          // the SetKltNode row
    kltId: string       // the concept — what parentKltId and ancestorIds hold
    parentKltId: string | null
    depth: number
    ancestorIds: string[]
  }
  ```
  **The lookup map keys on `kltId`, not `id`** — that is the whole semantic change, and every existing check must be re-read against it. `InvariantViolation` carries BOTH `kltId` (the concept, for the operator) and `nodeId` (the row, for the fix).
  Add a sixth kind:
  ```ts
  | 'parent_not_in_set'
  ```
  raised when a node's OWN `parentKltId` has no node among the rows. This replaces the foreign key the schema deliberately cannot declare, so it is the guard that matters most in this task. `orphan` **narrows** to mean the chain breaks FURTHER UP — the direct parent is present but one of ITS ancestors is not. The two are then independently reachable, which is what makes both mutation-testable.
  Task 1's only live caller (`src/lib/klt/health.ts`, and the backfill through it) still passes `Klt` rows: adapt at the call site with `{ ...row, kltId: row.id }`, which is exactly true while structure still lives on `Klt`. Task 2 makes the row shape real and the adapter disappears.
- [ ] **Step 4: Tests.** Update the existing invariant fixtures to the new row shape. Add a `parent_not_in_set` test. Mutation-verify all six kinds: remove each check, watch its named test go red, restore, report.
- [ ] **Step 5: Schema guard tests.** Assert `SetKltNode` has `@@unique([setId, kltId])`, that `set` cascades, that `parentKltId` declares NO relation/FK (the invariant checker is its only enforcement — if a future edit adds the FK, that guard silently becomes decoration), that `KltPreset.name` is unique, and that the migration contains the GIN index and no `DROP COLUMN`. The assertion that `Klt` no longer declares `parentKltId` belongs to Task 6, not here.
- [ ] **Step 6: Commit** — `feat(klt): per-set structure table and set-scoped invariants`

---

## Task 2: Tree math and placement become set-scoped

**Files:** Modify `src/lib/klt/tree.ts`, `src/lib/klt/place.ts` and their tests.

**Produces:** `TreeNodeRow` gains `kltId` (the concept) distinct from `id` (the node row); `placeUnparentedConcepts(userId, setId, generate?)`.

- [ ] **Step 1** Read `src/lib/klt/tree.ts` and `place.ts` in full first. The pure functions (`renderTreeForPrompt`, `wouldCycle`, `computeSubtreeUpdates`, `resolvePlacementPath`) are correct and heavily tested — **adapt their row shape, do not rewrite their logic.** Every rejection rule they encode still applies.
- [ ] **Step 2** `TreeNodeRow` becomes `{ id, kltId, name, normalizedName, parentKltId, depth, ancestorIds }`. Parent lookups now resolve by `kltId`, not by node id — that is the one semantic change, and it is where an error will hide. `wouldCycle` walks `parentKltId → the node whose kltId matches`.
- [ ] **Step 3** `placeUnparentedConcepts` takes a `setId` and operates entirely within it: unplaced means "this set has a `KlpTopic` link to this concept but no `SetKltNode` for it". A concept placed in set B is NOT placed in set A. The prompt sees only this set's tree.
- [ ] **Step 4** Update `src/actions/sets.ts` — the `after()` chain already calls `placeUnparentedConcepts`; it now passes the set id.
- [ ] **Step 5** Tests: adapt existing ones to the new shape; ADD one asserting a concept placed in set B is still unplaced in set A, and one asserting placement in set A never writes a `SetKltNode` for set B. Mutation-verify the set scoping specifically.
- [ ] **Step 6: Commit** — `feat(klt): set-scoped tree math and placement`

---

## Task 3: Rollup and health checks become set-scoped

**Files:** Modify `src/lib/metrics/klt-rollup.ts`, `src/lib/metrics/read.ts`, `src/lib/memory/topic-profile.ts`, `src/lib/klt/health.ts` and their tests.

- [ ] **Step 1** The rollup resolves each set's subtree independently, then UNIONS the key points by concept. Spec §6.2: the concept is the same node, the paths may differ, and that is intended. A learner scoped to three sets gets `accounting` = union of three subtrees.
- [ ] **Step 2** `loadKltRows` now reads `SetKltNode` joined to `Klt`, scoped to the sets in the learner's scope — **not the whole table.** This also removes the Phase 1 minor where the read scaled with the whole install and the GIN index went unused.
- [ ] **Step 3** `summarizeTreeHealth` takes one set's nodes and returns that set's health. The backfill reports per set.
- [ ] **Step 4** Tests: an interior node credited from descendants **within its own set**; a concept in two sets rolled up **once per set then unioned, not double-counted**; a set whose structure is empty yielding no topics rather than throwing. Mutation-verify each.
- [ ] **Step 5: Commit** — `feat(klt): per-set rollup and health`

---

## Task 4: Both editors, with a better UI

**Files:** Modify `src/actions/klt-tree.ts`, `src/components/klt/ConceptTree.tsx`, `src/app/concepts/page.tsx`. Create `src/app/sets/[id]/concepts/page.tsx`.

- [ ] **Step 1: Actions take a `setId`** and gate on EITHER set ownership OR `isKltEditor`. One private helper resolves that once; every action uses it. A caller who is neither gets the not-found shape — never "forbidden".
- [ ] **Step 1b: Add `createConcept(setId, name, parentKltId | null)`.** Today there is NO manual way to create a node — the editor can only rearrange concepts the KLP pipeline named, so an owner who knows their own subject cannot type its top rungs in. It runs `parseKltName`, upserts the `Klt` by `normalizedName` (reusing a concept that already exists globally rather than forking a near-duplicate), then creates the `SetKltNode`. It refuses: a concept that already has a node in THIS set; a `parentKltId` with no node in this set; a resulting depth past `MAX_TREE_DEPTH`. The same name in a DIFFERENT set is not a duplicate and must be allowed.
- [ ] **Step 2: Two routes.** `/sets/[id]/concepts` — owner-gated, that set only. `/concepts` — `KLT_EDITORS`-gated, lists sets and lets the admin pick one, then renders the SAME component. Both `notFound()` when the gate fails.
- [ ] **Step 3: The UI the owner asked for — "better, clearer, more comprehensive".** Beyond what exists today:
  - **Unplaced concepts surfaced FIRST**, in their own section with a count. They are what needs attention; today they are buried in a flat list.
  - **Collapsible nodes** with indent guides, so a six-level tree is navigable.
  - **A filter box** that narrows to matching concepts and keeps their ancestors visible for context.
  - **Impact preview on move**: "moves 12 concepts" before confirming, computed from `computeSubtreeUpdates`.
  - **An "add concept" control** on every row (add a child) and above the tree (add a root). This is the missing half of "the user seeds the top": manual entry and AI generation are peers, not a fallback each.
  - **An empty-structure panel offering all three seeding routes** — type your own top-level concepts, generate them with AI (`suggestSkeleton`, subject pre-filled from the SET'S TITLE so the owner rarely types it, still previewed and never auto-applied), or apply a preset (Task 5). Shown when the set has no `SetKltNode` rows at all, and again — phrased as "no structure yet" — when it has concepts but every one of them is unplaced.
  - Keep from today: link/child counts per row, Delete disabled with a visible reason, merge behind a confirm.
- [ ] **Step 4: Tests** — the owner gate admits an owner and refuses a stranger; the admin gate admits an allowlisted non-owner; unplaced concepts render in their own section; the filter keeps ancestors visible; the impact preview shows the subtree count. For `createConcept`: a root is created at depth 0 with empty `ancestorIds`; a child inherits `ancestorIds` + parent; a duplicate within the set is refused; **the SAME name in another set succeeds**; a parent with no node in this set is refused; the empty-structure panel appears only when the set has no placed nodes. Mutation-verify both gates and the same-name-other-set rule.
- [ ] **Step 5: Commit** — `feat(klt): per-set and admin concept editors`

---

## Task 5: Presets

**Files:** Create `src/actions/klt-presets.ts`, `tests/klt/presets.test.ts`. Modify the editor component.

- [ ] **Step 1** `listPresets` (any set owner), `savePreset(name, paths)` and `deletePreset(id)` (admin only), `applyPreset(presetId, setId)` (set owner or admin).
- [ ] **Step 2** `applyPreset` routes through the SAME validation as AI seeding — `resolvePlacementPath` — so a path that would re-parent an existing node is refused, not honoured. Idempotent; reports created and skipped counts, exactly as `applySkeleton` does.
- [ ] **Step 3** Paths store concept NAMES, not ids, so a preset applies to a set whose concepts do not exist yet. Validate every segment with `parseKltName` on save AND on apply — a preset saved before a rule tightened must not bypass it.
- [ ] **Step 4** UI: an "Apply a preset" control in the editor; a "Save this set's structure as a preset" control for admins.
- [ ] **Step 5** Tests: applying twice creates nothing the second time; a preset naming a concept that exists elsewhere reuses it rather than forking; a path that would re-parent an existing node is skipped and counted; a non-admin cannot save or delete. Mutation-verify the admin gate.
- [ ] **Step 6: Commit** — `feat(klt): reusable structure presets`

---

## Task 6: Rebuild and verify

- [ ] **Step 1: CONTRACT the schema.** Now that Tasks 2–5 have moved every reader onto `SetKltNode`, drop `Klt.parentKltId`, `Klt.depth`, `Klt.ancestorIds` and the `KltTree` self-relation, in a second migration `20260827000000_klt_drop_global_structure`. Add a guard test asserting no file under `src/` or `scripts/` reads `klt.parentKltId` / `klt.depth` / `klt.ancestorIds`, so a reader left behind is a build failure rather than a silent read of a column that no longer updates. `tsc` finding a straggler here is the point of the expand/contract split, not a surprise.
- [ ] **Step 1b** Full gates: suite, `tsc`, `next build`, `npm run lint` (175 baseline), zero schema drift.
- [ ] **Step 2** Capture the mastery baseline (`KlpState` rows) BEFORE any rebuild.
- [ ] **Step 3** Rebuild structure per set: `npm run backfill:klts -- --direct --force`. `Klt` rows, `KlpTopic` links and `CardKlp.label` are KEPT; only `SetKltNode` is re-derived.
- [ ] **Step 4** Verify: zero invariant violations **per set**; `KlpState` byte-identical to Step 2; every set with linked concepts has a non-empty structure.
- [ ] **Step 5** Live gate: `/sets/[id]/concepts` renders for the owner and 404s for a stranger; `/concepts` 404s with `KLT_EDITORS` unset and lists sets when set; a re-parent in set A leaves set B's structure untouched — **the load-bearing check of this whole change**; mastery unchanged after an edit.
- [ ] **Step 6** Update `docs/superpowers/BUILD-QUEUE.md` with the outcome and new baselines.

---

## Self-Review

**Amended 2026-08-26 (b) — expand/contract, controller ruling:** the original Task 1 dropped `Klt`'s structure columns immediately, which breaks 13 files that Tasks 2–4 have not yet migrated and leaves every intermediate task unverifiable against the plan's own "full suite green" constraint. Task 1 is now purely additive and Task 6 drops the columns. **Cost if wrong:** a window (T1–T5) where both structures exist and a reader could keep using the stale one — bounded by T6 Step 1's guard test and `tsc`.

**Amended 2026-08-26** (owner request, mid-execution): Task 4 gains `createConcept` and an empty-structure seeding panel. Manual creation was designed for in the concept-tree spec ("either the user can seed the top or ask AI to seed it") but never built — Phase 2 shipped only the AI route. Tasks 1–3 are unaffected.

**Spec coverage:** §3 schema → T1; §3b presets → T1 (model) + T5; Decision 3 two editors → T4; Decision 4 one-set-per-edit → T4 Step 1; Decision 5 per-set pipeline → T2, T3; Decision 6 mastery safety → T6 Step 4; Decision 8 rebuild → T6. §6.2's union semantics → T3 Step 1. Out-of-scope items (auto-apply presets, the IA split, 6c sharing) correctly absent.

**Placeholder scan:** Tasks 3–5 describe test intent rather than full bodies, because each depends on harness shapes best read at implementation time. That weak spot cost a fix round in Phase 1; implementers are told to read the neighbouring files first.

**Type consistency:** `TreeNodeRow` gains `kltId` in T2 and is consumed by T1's invariants, T3's rollup and T4's impact preview — T1 lands first, so its fixtures must already use the new shape. `resolvePlacementPath` is reused unchanged by T2 and T5.

**Biggest risk:** T2's shift from node-id to concept-id parent lookups. Every pure function keeps its logic but changes what it dereferences, and a mistake there is invisible until the rollup silently attributes to the wrong node. The set-scoping tests in T2 Step 5 are the guard.
