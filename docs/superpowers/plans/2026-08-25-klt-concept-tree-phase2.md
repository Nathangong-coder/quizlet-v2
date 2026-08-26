# KLT Concept Tree — Phase 2 (editor & seeding) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give the concept tree a human owner — a gated screen to view, re-parent, rename, merge and delete nodes, plus both seeding paths (author your own skeleton, or ask the AI for one and review it).

**Architecture:** A `KLT_EDITORS` allowlist gates one route and every server action behind it. All four mutations reuse the pure tree math from Phase 1 (`computeSubtreeUpdates`, `wouldCycle`, `parseKltName`) rather than reimplementing it. Seeding is a two-step propose-then-apply flow: the AI returns a skeleton of top rungs only, nothing is written until the user accepts.

**Tech Stack:** Next.js App Router, TypeScript, Prisma + Postgres (Neon), Vercel AI SDK v7, Zod, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-klt-concept-tree-design.md` — build its §5 (seeding) and §9 (editor) only. §6 refinement and §10.2 semantic audits are Phase 3 and MUST NOT appear here.

## Global Constraints

- **Every operation is `KLT_EDITORS`-gated SERVER-SIDE**, not merely hidden in the UI. A non-editor gets the same "not found" shape as any other failed owner check — never a "forbidden" that confirms the route exists.
- **The tree is GLOBAL.** A re-parent moves every account's mastery. That is why the allowlist exists.
- **Never delete or supersede a `CardKlp` row. Never touch `KlpState` or `AnswerKlpResult`.** `AnswerKlpResult.klp` is `onDelete: Cascade`; deleting a `CardKlp` destroys a learner's answer history irrecoverably.
- **Delete is refused while a node has children.** Orphaning a subtree is the silent failure this editor exists to fix — and `Klt.parent` is `onDelete: Restrict`, so the database refuses it too.
- **Re-parent recomputes `depth` and `ancestorIds` for the moved node AND its whole subtree, in ONE transaction**, and refuses cycles. Use `computeSubtreeUpdates` from `@/lib/klt/tree` — it already does the arithmetic, the cycle check and the `MAX_TREE_DEPTH` refusal.
- **Nothing the AI proposes is auto-applied.** A skeleton is the structure every later placement inherits, so an unreviewed one is expensive and silent.
- **Seeding returns TOP RUNGS ONLY (2–3), never leaves.**
- Concept names go through `parseKltName` (≤4 words, ≤40 chars, dropped never truncated). `normalizedName` is globally unique.
- **Verify with the FULL SUITE:** `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` and `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`. Baseline: **160 files / 1888 passing**, tsc clean, lint **175**.
- `'use server'` files may export only async functions. Constants live in `src/lib/`.
- Component tests need `// @vitest-environment jsdom` as the literal first line and their own `afterEach(cleanup)`.
- **Mutation testing is a PROCESS, not an artifact.** Never commit a test that rebuilds a local copy of the unit under test. Every guard needs a test that FAILS when the guard is removed — verify it, and report the observation.

---

## File Structure

**Create:**
- `src/lib/klt/editors.ts` — pure allowlist parsing
- `src/actions/klt-tree.ts` — the four gated mutations
- `src/lib/ai/prompts/suggest-skeleton.ts` — the seeding prompt
- `src/actions/klt-seed.ts` — propose + apply
- `src/app/concepts/page.tsx` — the gated route
- `src/components/klt/ConceptTree.tsx` — the editor UI
- Tests mirroring each.

**Modify:**
- `src/lib/ai/schemas.ts` — `KltSkeletonSchema`
- `src/lib/ai/prompts/registry.ts` — register the prompt
- `.env.example` — document `KLT_EDITORS`

---

## Task 1: The editor allowlist

**Files:** Create `src/lib/klt/editors.ts`, `tests/klt/editors.test.ts`. Modify `.env.example`.

**Interfaces:**
- Produces: `parseKltEditors(raw: string | undefined): string[]`, `isKltEditor(userId: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { parseKltEditors, isKltEditor } from '@/lib/klt/editors'

const original = process.env.KLT_EDITORS
afterEach(() => { process.env.KLT_EDITORS = original })

describe('parseKltEditors', () => {
  it('splits a comma-separated list and trims each entry', () => {
    expect(parseKltEditors('a, b ,c')).toEqual(['a', 'b', 'c'])
  })

  it('returns NOBODY when unset — the safe default for a global structure', () => {
    // An unset allowlist must not mean "everyone". This gate protects a tree
    // whose every edit moves other accounts' mastery.
    expect(parseKltEditors(undefined)).toEqual([])
    expect(parseKltEditors('')).toEqual([])
  })

  it('drops empty entries from sloppy input rather than admitting an empty id', () => {
    // ',,' would otherwise yield [''] and an unauthenticated caller whose id
    // resolved to '' would match it.
    expect(parseKltEditors('a,,b,')).toEqual(['a', 'b'])
  })
})

describe('isKltEditor', () => {
  it('admits a listed id and refuses an unlisted one', () => {
    process.env.KLT_EDITORS = 'user-1,user-2'
    expect(isKltEditor('user-1')).toBe(true)
    expect(isKltEditor('user-3')).toBe(false)
  })

  it('refuses everyone when unset', () => {
    delete process.env.KLT_EDITORS
    expect(isKltEditor('user-1')).toBe(false)
  })

  it('refuses an empty id even if the list is sloppy', () => {
    process.env.KLT_EDITORS = 'a,,b'
    expect(isKltEditor('')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**
- [ ] **Step 3: Implement**

```ts
/**
 * Who may edit the GLOBAL concept tree.
 *
 * The tree is shared across every account, so one re-parent moves everyone's
 * topic mastery. That is why editing is an allowlist rather than an ordinary
 * owner check — there IS no owner. Same posture as `npm run invite`: an
 * operator capability, configured out-of-band, not a user-facing permission.
 *
 * Unset means NOBODY, never everybody. A gate that opens when its config is
 * missing is not a gate.
 */
export function parseKltEditors(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function isKltEditor(userId: string): boolean {
  // An empty id must never match, however sloppy the configured list is.
  if (userId.length === 0) return false
  return parseKltEditors(process.env.KLT_EDITORS).includes(userId)
}
```

- [ ] **Step 4: Run — expect PASS (6 tests). Mutation-verify: delete the `userId.length === 0` guard and confirm the empty-id test goes red; restore.**
- [ ] **Step 5: Document the variable in `.env.example`**

```
# Who may edit the GLOBAL concept tree (comma-separated user ids). The tree is
# shared across accounts, so an edit moves everyone's topic mastery — unset
# means nobody, which is the correct default.
KLT_EDITORS=""
```

- [ ] **Step 6: Commit** — `feat(klt): KLT_EDITORS allowlist for the concept tree editor`

---

## Task 2: The four gated mutations

**Files:** Create `src/actions/klt-tree.ts`, `tests/actions/klt-tree.test.ts`.

**Interfaces:**
- Consumes: `isKltEditor` (Task 1); `computeSubtreeUpdates`, `wouldCycle`, `TreeNodeRow`, `MAX_TREE_DEPTH` from `@/lib/klt/tree`; `parseKltName` from `@/lib/klt/normalize`.
- Produces, all returning `ActionResult<null>` and all gated:
  - `listConceptTree(): Promise<ActionResult<ConceptTreeNode[]>>`
  - `reparentConcept(kltId: string, newParentId: string | null)`
  - `renameConcept(kltId: string, name: string)`
  - `mergeConcepts(sourceId: string, targetId: string)`
  - `deleteConcept(kltId: string)`
  - `interface ConceptTreeNode { id, name, normalizedName, parentKltId, depth, ancestorIds, linkCount, childCount }`

- [ ] **Step 1: Write the failing tests**

Model the harness on `tests/actions/klt.test.ts`: `vi.hoisted`, `vi.mock('@/lib/db')`, a `defaultTransactionImpl` whose `tx` delegates to the same mocks. **Omit from the mock any Prisma delegate these actions must never call — notably `cardKlp`, `klpState` and `answerKlpResult`.** If the implementation reaches for one, the test dies with "not a function" rather than passing quietly.

Cover at minimum:

```ts
  it('refuses every mutation for a non-editor, with a not-found shape', async () => {
    // Never "forbidden" — that confirms the route exists to someone who
    // should not know it does.
    process.env.KLT_EDITORS = 'someone-else'
    for (const call of [
      () => reparentConcept('a', 'b'), () => renameConcept('a', 'x'),
      () => mergeConcepts('a', 'b'), () => deleteConcept('a'),
    ]) {
      const res = await call()
      expect(res.success).toBe(false)
      expect(res.success === false && res.error).toMatch(/not found/i)
    }
  })

  it('refuses a re-parent that would create a cycle', async () => { /* move a node under its own descendant */ })
  it('recomputes depth and ancestorIds for the whole subtree in one transaction', async () => { /* assert $transaction called once, and an update per changed descendant */ })
  it('refuses deleting a node that still has children', async () => { /* childCount > 0 */ })
  it('refuses a rename whose normalized form collides with another concept', async () => { /* unique normalizedName */ })
  it('rejects a rename that fails parseKltName', async () => { /* > 4 words */ })
  it('merge re-points links and children to the target, then deletes the source', async () => { /* order matters */ })
  it('merge refuses when the target is a descendant of the source', async () => { /* cycle */ })
  it('merge skips a link that would duplicate an existing (klpId, kltId) pair', async () => { /* @@unique */ })
  it('never touches CardKlp, KlpState or AnswerKlpResult', async () => { /* those delegates are absent from the mock */ })
```

- [ ] **Step 2: Run — expect FAIL**
- [ ] **Step 3: Implement `src/actions/klt-tree.ts`**

`'use server'`. Every exported function starts with the same three lines — session, userId, `isKltEditor` — returning `{ success: false, error: 'Not found' }` otherwise. Extract that into a private helper returning the userId or null; do not repeat it five times.

Key rules, each of which has a test above:
- **Re-parent** loads all `Klt` rows, calls `computeSubtreeUpdates(kltId, newParentId, rows)` and writes the returned updates in one `$transaction`. `computeSubtreeUpdates` THROWS on a cycle or a depth-cap breach — catch it and return the message as a failed `ActionResult` rather than letting it escape.
- **Rename** validates with `parseKltName`, then refuses if another row already holds that `normalizedName`. Do not silently merge — the user can merge explicitly.
- **Merge** must refuse when `target` is a descendant of `source` (use `wouldCycle`). Then, in one transaction: re-point `KlpTopic` rows from source to target **skipping any whose `(klpId, targetId)` pair already exists** (the `@@unique([klpId, kltId])` constraint), re-point children, recompute the moved children's subtrees, and delete the source.
- **Delete** refuses when the node has children.

- [ ] **Step 4: Run — expect PASS. Mutation-verify each guard (gate, cycle refusal, delete-with-children refusal, rename collision, merge duplicate-skip): remove it, watch the named test go red, restore. Report each observation.**
- [ ] **Step 5: Commit** — `feat(klt): gated re-parent, rename, merge and delete for the concept tree`

---

## Task 3: AI seeding — propose, never apply

**Files:** Create `src/lib/ai/prompts/suggest-skeleton.ts`, `src/actions/klt-seed.ts`, `tests/klt/skeleton.test.ts`. Modify `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/registry.ts`.

**Interfaces:**
- Produces:
  - `KltSkeletonSchema` — `{ paths: string[][] }`
  - `SUGGEST_SKELETON_PROMPT = { id: 'suggest-skeleton', version: 1, schema, build(input) }`, input `{ subject: string; sampleConcepts: string[] }`
  - `suggestSkeleton(subject: string): Promise<ActionResult<{ paths: string[][] }>>` — gated, writes NOTHING
  - `applySkeleton(paths: string[][]): Promise<ActionResult<{ created: number }>>` — gated, writes

- [ ] **Step 1: Add the schema**

```ts
/** Deepest a suggested skeleton may go. Top rungs only — never leaves. */
export const MAX_SKELETON_DEPTH = 3;

export const KltSkeletonSchema = z.object({
  /** Root-first paths, each 1..MAX_SKELETON_DEPTH segments. */
  paths: z.array(z.array(z.string().min(1)).min(1).max(MAX_SKELETON_DEPTH)).min(1),
});
```

- [ ] **Step 2: Write the prompt**

It receives the subject name and a sample of leaf concepts already extracted from the learner's cards, and returns the top 2–3 rungs. Required text, each with a test:
- "Return only the TOP levels — broad areas, never specific concepts."
- name the sample concepts as evidence of what the subject covers, and say explicitly they must NOT appear in the output
- at most `MAX_SKELETON_DEPTH` segments per path
- reuse the same wording rules as `parseKltName` (≤4 words, no proper nouns)

- [ ] **Step 3: Implement the two actions**

`suggestSkeleton` is gated, calls `generateJson` with the prompt, and RETURNS the proposal. It performs **no writes at all** — that is the whole point of §5.2, and it needs a test asserting no Prisma write delegate was called.

`applySkeleton` is gated and creates the missing chain for each path. **Reuse `resolvePlacementPath` from `@/lib/klt/place`** — it already refuses a path whose match follows a creation (which would re-parent an existing node), a repeated name, an over-deep path, and an invalid segment. Create only what is missing; never re-parent an existing node.

- [ ] **Step 4: Tests**

```ts
  it('suggestSkeleton writes NOTHING — the user reviews before anything lands', async () => { /* no create/update/upsert/delete called */ })
  it('is gated: a non-editor gets a not-found shape from both actions', async () => {})
  it('rejects a skeleton path deeper than MAX_SKELETON_DEPTH', async () => {})
  it('applySkeleton creates missing nodes but never re-parents an existing one', async () => {})
  it('applySkeleton is idempotent — applying the same skeleton twice creates nothing the second time', async () => {})
  it('the prompt forbids emitting the sample concepts it was shown', async () => {})
```

- [ ] **Step 5: Run, mutation-verify the gate and the depth cap, commit** — `feat(klt): AI skeleton suggestion, reviewed before it is applied`

---

## Task 4: The editor screen

**Files:** Create `src/app/concepts/page.tsx`, `src/components/klt/ConceptTree.tsx`, `tests/components/concept-tree.test.tsx`.

- [ ] **Step 1: The route**

`src/app/concepts/page.tsx` is a server component. It resolves the session, and if `isKltEditor(userId)` is false it calls `notFound()` — a real 404, not a redirect and not a message. Otherwise it renders `<ConceptTree />`.

- [ ] **Step 2: The component**

`'use client'`. Renders the tree as an indented list, deepest-first ordering stable (sort siblings by name, as `renderTreeForPrompt` does). Each row shows the name, its link count, and its child count, plus controls:

- **Move under…** — a `<select>` of every other node plus "(make a root)". **Not drag-and-drop**, which the spec's §5.1 mentions; a select is equivalent in function, keyboard-accessible, and testable. Note the deviation in your report.
- **Rename** — inline input.
- **Merge into…** — a `<select>`, with a confirm step, since merge deletes the source.
- **Delete** — disabled with a visible reason when the node has children.

Plus a **"Suggest a starting structure"** button that calls `suggestSkeleton`, renders the proposal as an indented preview with **Apply** and **Discard**, and writes nothing until Apply.

- [ ] **Step 3: Tests** (`// @vitest-environment jsdom` first line, own `afterEach(cleanup)`, mock the action module — a `'use server'` import breaks jsdom otherwise)

```ts
  it('renders the tree indented by depth', () => {})
  it('disables Delete for a node with children, and says why', () => {})
  it('does not offer a node itself as its own new parent', () => {})
  it('shows the suggested skeleton as a preview and writes nothing until Apply', () => {})
  it('requires a confirm before merging, since merge deletes the source', () => {})
```

- [ ] **Step 4: Run, commit** — `feat(klt): concept tree editor screen`

---

## Task 5: Verification

- [ ] **Step 1: Full gates** — full suite, `tsc`, `next build`, `npm run lint`. Baseline 160 files / 1888 passing, lint 175. A lint rise means this work caused it.
- [ ] **Step 2: Zero schema drift** — `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` must print an empty migration. Phase 2 adds NO columns; if it reports drift, something was changed that should not have been.
- [ ] **Step 3: Structural invariants still hold** after any editor operation — run `checkTreeInvariants` over the real rows and expect zero violations.
- [ ] **Step 4: Live gate.** `KLT_EDITORS=<dev user id> NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`, sign in as `dev_user`, and check: `/concepts` renders the tree for an allowlisted user; **it 404s when `KLT_EDITORS` is unset** (the load-bearing check); a re-parent moves a subtree and invariants stay clean; Delete is refused on a node with children.
- [ ] **Step 5: Confirm mastery is untouched** — note a KLP's `pKnown` and `observations`, perform a re-parent, confirm both unchanged.

---

## Self-Review

**Spec coverage:** §9's four operations → Task 2; §9's server-side gating → Tasks 1, 2, 4; §5.1 user-authored seeding → Task 4's editor controls; §5.2 AI-seeded → Task 3; §5.2's "nothing auto-applied" → Task 3's propose/apply split. §6 refinement and §10.2 audits are correctly absent.

**Placeholder scan:** Task 2's and Task 4's test bodies are named with intent rather than fully written, because both depend on harness shapes best read at implementation time (the existing `vi.hoisted` mock in `tests/actions/klt.test.ts`, and the existing component fixtures). Every other step carries real code. This is the same weak spot flagged in Phase 1's plan, and it cost a fix round there — implementers should read those two files first.

**Type consistency:** `ConceptTreeNode` (Task 2) is consumed by Task 4. `parseKltEditors`/`isKltEditor` (Task 1) by Tasks 2, 3, 4. `KltSkeletonSchema`/`MAX_SKELETON_DEPTH` (Task 3) bound both the prompt and `applySkeleton`. `resolvePlacementPath` and `computeSubtreeUpdates` are reused from Phase 1 unchanged.

**Known risk:** merge is the most intricate operation — it re-points links, re-points children, recomputes subtrees and deletes, all in one transaction, with a `@@unique([klpId, kltId])` constraint waiting to be violated. If Task 2 grows unwieldy, split merge into its own task rather than rushing it.
