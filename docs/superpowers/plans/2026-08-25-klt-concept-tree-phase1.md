# KLT Concept Tree — Phase 1 (substrate) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the flat KLT layer into a real concept tree — depth becomes a property of the concept, key points link to their leaf only, and mastery rolls up over subtrees.

**Architecture:** `Klt` gains `parentKltId`, a denormalized `depth`, and an `ancestorIds` array so a subtree query is one indexed array containment rather than a recursive CTE. Generation splits in two: Phase A names a label and 1–2 leaf concepts (no paths), Phase B places unparented leaves by proposing a full root-to-leaf path that TypeScript reconciles against the existing tree. Display auto-selects one depth to show.

**Tech Stack:** Next.js App Router, TypeScript, Prisma + Postgres (Neon adapter), Vercel AI SDK v7, Zod, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-25-klt-concept-tree-design.md` — build Phase 1 of its §13 only.

## Global Constraints

- **Never delete or supersede a `CardKlp` row.** The write surface stays `label` (in place), `Klt`, `KlpTopic`. `KlpState` and `AnswerKlpResult` are never touched. Spec §11, and the previous spec's §6 — its guards stay green.
- **`rank` means CENTRALITY**, not breadth: 1 = the concept the point is chiefly about, 2 = a second it honestly also covers. Max 2. Breadth lives in the tree.
- **Depth cap 8.** `MAX_TREE_DEPTH = 8`. A path exceeding it is rejected whole, never truncated.
- **Never fabricate a parent.** A failed placement leaves `parentKltId: null`; the leaf still reports mastery as its own node.
- **Never pad depth.** The prompt must not ask for a rung count.
- **`onDelete: Restrict`** on the self-relation — `SetNull` would silently orphan a subtree.
- **Names still go through `parseKltName`** (≤4 words, ≤40 chars, dropped never truncated) and labels through `parseKltLabel` (≤8 words, ≤60 chars).
- **Verify with the cursor-agents excludes, always:**
  ```bash
  npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
  npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
  ```
- **Baselines to beat/hold:** 153 test files / 1795 passing; `tsc` clean; `next build` clean; `npm run lint` **175 problems**. Do not fix unrelated lint.
- **`prisma migrate dev` needs a TTY and is unusable here.** Use `migrate diff` → write SQL → `migrate deploy`.
- **`'use server'` files may export only async functions.** Constants live in `src/lib/`.
- **Scripts reaching `generateJson` need `--conditions=react-server`.**
- **Component tests** need `// @vitest-environment jsdom` as the literal first line and their own `afterEach(cleanup)`.

---

## File Structure

**Create:**
- `src/lib/klt/tree.ts` — pure tree math: depth/ancestor computation, cycle detection, path resolution, prompt rendering
- `src/lib/klt/invariants.ts` — pure structural invariant checks over row arrays
- `src/lib/ai/prompts/place-klts.ts` — Phase B prompt
- `src/lib/klt/place.ts` — placement pipeline (DB writes)
- `src/lib/metrics/klt-depth.ts` — pure `selectDisplayDepth`
- Tests mirroring each.

**Modify:**
- `prisma/schema.prisma` + a new migration
- `src/lib/ai/schemas.ts` — `KltSummarySchema` (topics → concepts), new `KltPlacementSchema`
- `src/lib/ai/prompts/summarize-klts.ts` — v4, ladder removed
- `src/lib/klt/resolve.ts` — 1–2 concepts, rank = centrality
- `src/lib/memory/topic-profile.ts` — subtree-aware `kltRowsToTopicRows`
- `src/lib/metrics/read.ts` — subtree rollup + depth selection
- `src/components/learner/TopicMastery.tsx` — breadcrumb
- `scripts/backfill-klts.ts` — placement step + tier-aware health metrics

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260825000000_klt_tree/migration.sql`
- Test: `tests/schema/klt-schema.test.ts` (extend)

**Interfaces:**
- Consumes: nothing.
- Produces: `Klt.parentKltId String?`, `Klt.depth Int @default(0)`, `Klt.ancestorIds String[]`, self-relation `KltTree` with `onDelete: Restrict`.

- [ ] **Step 1: Edit the schema**

Replace the `model Klt` block with:

```prisma
model Klt {
  id             String     @id @default(cuid())
  name           String
  normalizedName String     @unique
  parentKltId    String?
  parent         Klt?       @relation("KltTree", fields: [parentKltId], references: [id], onDelete: Restrict)
  children       Klt[]      @relation("KltTree")
  /// 0 at a subject root. Denormalized; `child.depth = parent.depth + 1` is a
  /// TESTED invariant, not an assumption — see src/lib/klt/invariants.ts.
  depth          Int        @default(0)
  /// Every ancestor id, root-first, EXCLUDING self.
  ///
  /// Denormalized so "everything under `accounting`" is one indexed array
  /// containment query rather than a recursive CTE — the rollup runs on every
  /// dashboard load. A stale array silently changes which key points roll up
  /// where, so an invariant test asserts it matches a real parent walk.
  ancestorIds    String[]
  createdAt      DateTime   @default(now())
  links          KlpTopic[]

  @@index([parentKltId])
  @@index([depth])
}
```

Update `KlpTopic.rank`'s comment to:

```prisma
  /// CENTRALITY, not breadth: 1 = the concept this point is chiefly about,
  /// 2 = a second concept it honestly also covers. Breadth comes from the tree.
  rank  Int
```

- [ ] **Step 2: Generate the migration SQL**

```bash
npx prisma format
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Write the output to `prisma/migrations/20260825000000_klt_tree/migration.sql`, then **append the GIN index by hand** — Prisma cannot express it:

```sql
CREATE INDEX "Klt_ancestorIds_idx" ON "Klt" USING GIN ("ancestorIds");
```

- [ ] **Step 3: Apply and confirm zero drift**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected: the final diff prints `-- This is an empty migration.` The hand-added GIN index does not appear in the diff because Prisma does not model it; that is expected and fine.

- [ ] **Step 4: Extend the schema guard test**

Append to `tests/schema/klt-schema.test.ts`:

```ts
describe('KLT tree schema', () => {
  it('gives Klt a self-relation with Restrict, never SetNull', () => {
    // SetNull would silently orphan an entire subtree on delete — every key
    // point beneath it vanishes from every rollup above it, with nothing raised.
    expect(model('Klt')).toMatch(/parent\s+Klt\?\s+@relation\("KltTree".*onDelete: Restrict\)/)
  })

  it('carries denormalized depth and ancestorIds', () => {
    const body = model('Klt')
    expect(body).toMatch(/depth\s+Int\s+@default\(0\)/)
    expect(body).toMatch(/ancestorIds\s+String\[\]/)
  })

  it('indexes ancestorIds with GIN in the migration', () => {
    // The rollup reads this array on every dashboard load; without the index
    // it is a sequential scan of every concept in the install.
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260825000000_klt_tree/migration.sql'),
      'utf8',
    )
    expect(sql).toMatch(/USING GIN \("ancestorIds"\)/)
  })

  it('documents rank as centrality, not breadth', () => {
    expect(model('KlpTopic')).toMatch(/CENTRALITY, not breadth/)
  })
})
```

- [ ] **Step 5: Run it**

```bash
npx vitest run tests/schema/klt-schema.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (10 tests — 6 existing plus 4 new).

- [ ] **Step 6: Commit**

```bash
git add prisma tests/schema/klt-schema.test.ts
git commit -m "feat(klt): make Klt a tree — parentKltId, depth, ancestorIds"
```

---

## Task 2: Pure tree math

**Files:**
- Create: `src/lib/klt/tree.ts`
- Test: `tests/klt/tree.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_TREE_DEPTH = 8`
  - `interface TreeNodeRow { id: string; name: string; normalizedName: string; parentKltId: string | null; depth: number; ancestorIds: string[] }`
  - `renderTreeForPrompt(rows: TreeNodeRow[]): string`
  - `wouldCycle(nodeId: string, newParentId: string, byId: Map<string, TreeNodeRow>): boolean`
  - `computeSubtreeUpdates(nodeId: string, newParentId: string | null, rows: TreeNodeRow[]): { id: string; depth: number; ancestorIds: string[] }[]`

- [ ] **Step 1: Write the failing test**

Create `tests/klt/tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  renderTreeForPrompt,
  wouldCycle,
  computeSubtreeUpdates,
  MAX_TREE_DEPTH,
  type TreeNodeRow,
} from '@/lib/klt/tree'

const node = (
  id: string,
  name: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
): TreeNodeRow => ({ id, name, normalizedName: name, parentKltId, depth, ancestorIds })

//  finance
//  └── accounting
//      └── statements
//          └── cash flow
const TREE: TreeNodeRow[] = [
  node('f', 'finance', null, 0, []),
  node('a', 'accounting', 'f', 1, ['f']),
  node('s', 'statements', 'a', 2, ['f', 'a']),
  node('c', 'cash flow', 's', 3, ['f', 'a', 's']),
]
const byId = new Map(TREE.map((n) => [n.id, n]))

describe('renderTreeForPrompt', () => {
  it('renders one indented line per node, parents before children', () => {
    expect(renderTreeForPrompt(TREE)).toBe(
      ['finance', '  accounting', '    statements', '      cash flow'].join('\n'),
    )
  })

  it('renders an empty tree as an empty string', () => {
    expect(renderTreeForPrompt([])).toBe('')
  })

  it('renders multiple roots', () => {
    const out = renderTreeForPrompt([...TREE, node('b', 'biology', null, 0, [])])
    expect(out).toContain('finance')
    expect(out).toContain('biology')
  })
})

describe('wouldCycle', () => {
  it('detects placing a node under its own descendant', () => {
    // Moving `accounting` under `cash flow` would make accounting its own ancestor.
    expect(wouldCycle('a', 'c', byId)).toBe(true)
  })

  it('detects placing a node under itself', () => {
    expect(wouldCycle('a', 'a', byId)).toBe(true)
  })

  it('allows a legitimate move', () => {
    expect(wouldCycle('c', 'a', byId)).toBe(false)
  })
})

describe('computeSubtreeUpdates', () => {
  it('recomputes depth and ancestors for the moved node AND its subtree', () => {
    // Move `statements` from under `accounting` to directly under `finance`.
    const updates = computeSubtreeUpdates('s', 'f', TREE)
    expect(updates).toEqual([
      { id: 's', depth: 1, ancestorIds: ['f'] },
      { id: 'c', depth: 2, ancestorIds: ['f', 's'] },
    ])
  })

  it('handles promotion to a root', () => {
    const updates = computeSubtreeUpdates('s', null, TREE)
    expect(updates).toEqual([
      { id: 's', depth: 0, ancestorIds: [] },
      { id: 'c', depth: 1, ancestorIds: ['s'] },
    ])
  })

  it('returns an empty list when nothing actually changes', () => {
    expect(computeSubtreeUpdates('c', 's', TREE)).toEqual([])
  })

  it(`refuses a move that would push the subtree past depth ${MAX_TREE_DEPTH}`, () => {
    // A chain already at the cap cannot be pushed deeper.
    const deep: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      deep.push(node(`n${i}`, `n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    expect(() => computeSubtreeUpdates('n1', `n${MAX_TREE_DEPTH}`, deep)).toThrow(/depth/i)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/tree.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — `Cannot find package '@/lib/klt/tree'`.

- [ ] **Step 3: Implement**

Create `src/lib/klt/tree.ts`:

```ts
/**
 * Pure tree math. No Prisma types, no IO — every rule here is testable against
 * plain arrays, which matters because a mistake in depth or ancestor
 * computation silently moves which key points roll up where.
 */

/**
 * Deepest allowed chain. A path longer than this is rejected WHOLE, never
 * truncated: a truncated path attaches a concept under the wrong parent, which
 * is worse than leaving it unplaced.
 */
export const MAX_TREE_DEPTH = 8

export interface TreeNodeRow {
  id: string
  name: string
  normalizedName: string
  parentKltId: string | null
  depth: number
  ancestorIds: string[]
}

/**
 * The whole tree as indented names, parents before children.
 *
 * This is what Phase B sees. Names only — one short line per node — which is
 * why the entire tree fits in a prompt where a per-card candidate list would
 * not.
 */
export function renderTreeForPrompt(rows: TreeNodeRow[]): string {
  const childrenOf = new Map<string | null, TreeNodeRow[]>()
  for (const r of rows) {
    const list = childrenOf.get(r.parentKltId)
    if (list) list.push(r)
    else childrenOf.set(r.parentKltId, [r])
  }

  const lines: string[] = []
  const walk = (parentId: string | null, indent: number) => {
    const kids = [...(childrenOf.get(parentId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const k of kids) {
      lines.push(`${'  '.repeat(indent)}${k.name}`)
      walk(k.id, indent + 1)
    }
  }
  walk(null, 0)
  return lines.join('\n')
}

/**
 * Would attaching `nodeId` under `newParentId` make it its own ancestor?
 *
 * Walks UP from the proposed parent. A cycle makes the rollup query
 * non-terminating and mastery meaningless, so this is checked before every
 * write rather than cleaned up after.
 */
export function wouldCycle(
  nodeId: string,
  newParentId: string,
  byId: Map<string, TreeNodeRow>,
): boolean {
  let cursor: string | null = newParentId
  const seen = new Set<string>()
  while (cursor !== null) {
    if (cursor === nodeId) return true
    // Defensive: a pre-existing cycle must not hang this walk.
    if (seen.has(cursor)) return true
    seen.add(cursor)
    cursor = byId.get(cursor)?.parentKltId ?? null
  }
  return false
}

/**
 * New depth/ancestors for a moved node and everything beneath it.
 *
 * Returns ONLY rows whose values actually change, so a no-op move writes
 * nothing. Throws when the move would push any descendant past the cap —
 * refusing is correct, because the alternative is a tree whose depth means
 * nothing.
 */
export function computeSubtreeUpdates(
  nodeId: string,
  newParentId: string | null,
  rows: TreeNodeRow[],
): { id: string; depth: number; ancestorIds: string[] }[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const node = byId.get(nodeId)
  if (!node) throw new Error(`unknown node ${nodeId}`)
  if (newParentId !== null && wouldCycle(nodeId, newParentId, byId)) {
    throw new Error(`moving ${nodeId} under ${newParentId} would create a cycle`)
  }

  const parent = newParentId === null ? null : byId.get(newParentId)
  if (newParentId !== null && !parent) throw new Error(`unknown parent ${newParentId}`)

  const baseDepth = parent ? parent.depth + 1 : 0
  const baseAncestors = parent ? [...parent.ancestorIds, parent.id] : []

  const childrenOf = new Map<string, TreeNodeRow[]>()
  for (const r of rows) {
    if (r.parentKltId === null) continue
    const list = childrenOf.get(r.parentKltId)
    if (list) list.push(r)
    else childrenOf.set(r.parentKltId, [r])
  }

  const out: { id: string; depth: number; ancestorIds: string[] }[] = []
  const walk = (id: string, depth: number, ancestorIds: string[]) => {
    if (depth >= MAX_TREE_DEPTH) {
      throw new Error(`move would exceed max depth ${MAX_TREE_DEPTH} at ${id}`)
    }
    const current = byId.get(id)
    const changed =
      current === undefined ||
      current.depth !== depth ||
      current.ancestorIds.join(',') !== ancestorIds.join(',')
    if (changed) out.push({ id, depth, ancestorIds })
    for (const child of childrenOf.get(id) ?? []) {
      walk(child.id, depth + 1, [...ancestorIds, id])
    }
  }
  walk(nodeId, baseDepth, baseAncestors)
  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/klt/tree.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/klt/tree.ts tests/klt/tree.test.ts
git commit -m "feat(klt): pure tree math — render, cycle check, subtree recompute"
```

---

## Task 3: Structural invariants

**Files:**
- Create: `src/lib/klt/invariants.ts`
- Test: `tests/klt/invariants.test.ts`

**Interfaces:**
- Consumes: `TreeNodeRow`, `MAX_TREE_DEPTH` (Task 2).
- Produces:
  - `type ViolationKind = 'depth_mismatch' | 'cycle' | 'orphan' | 'stale_ancestors' | 'too_deep'`
  - `interface InvariantViolation { kind: ViolationKind; kltId: string; detail: string }`
  - `checkTreeInvariants(rows: TreeNodeRow[]): InvariantViolation[]`

- [ ] **Step 1: Write the failing test**

Create `tests/klt/invariants.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { checkTreeInvariants } from '@/lib/klt/invariants'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

const node = (
  id: string,
  parentKltId: string | null,
  depth: number,
  ancestorIds: string[],
): TreeNodeRow => ({ id, name: id, normalizedName: id, parentKltId, depth, ancestorIds })

const HEALTHY: TreeNodeRow[] = [
  node('f', null, 0, []),
  node('a', 'f', 1, ['f']),
  node('s', 'a', 2, ['f', 'a']),
]

describe('checkTreeInvariants', () => {
  it('passes a healthy tree', () => {
    expect(checkTreeInvariants(HEALTHY)).toEqual([])
  })

  it('catches a depth that does not follow its parent', () => {
    const rows = [...HEALTHY.slice(0, 2), node('s', 'a', 5, ['f', 'a'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('depth_mismatch')
  })

  it('catches an ancestorIds array that does not match a real parent walk', () => {
    // The rollup reads the ARRAY, not the pointers — a stale array silently
    // moves mastery with nothing to notice it.
    const rows = [...HEALTHY.slice(0, 2), node('s', 'a', 2, ['f'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('stale_ancestors')
  })

  it('catches an orphan whose parent does not exist', () => {
    const rows = [node('f', null, 0, []), node('x', 'ghost', 1, ['ghost'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('orphan')
  })

  it('catches a cycle', () => {
    const rows = [node('a', 'b', 1, ['b']), node('b', 'a', 1, ['a'])]
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('cycle')
  })

  it('catches a chain past the depth cap', () => {
    const rows: TreeNodeRow[] = []
    for (let i = 0; i <= MAX_TREE_DEPTH; i++) {
      rows.push(node(`n${i}`, i === 0 ? null : `n${i - 1}`, i,
        Array.from({ length: i }, (_, j) => `n${j}`)))
    }
    expect(checkTreeInvariants(rows).map((v) => v.kind)).toContain('too_deep')
  })

  it('reports every violation, not just the first', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 9, ['f']), node('x', 'ghost', 1, [])]
    expect(checkTreeInvariants(rows).length).toBeGreaterThan(1)
  })

  it('names the offending node on every violation', () => {
    const rows = [node('f', null, 0, []), node('a', 'f', 5, ['f'])]
    expect(checkTreeInvariants(rows)[0].kltId).toBe('a')
  })

  it('terminates on a cycle rather than hanging', () => {
    const rows = [node('a', 'b', 1, ['b']), node('b', 'a', 1, ['a'])]
    expect(() => checkTreeInvariants(rows)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/invariants.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/klt/invariants.ts`:

```ts
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

export type ViolationKind =
  | 'depth_mismatch'
  | 'cycle'
  | 'orphan'
  | 'stale_ancestors'
  | 'too_deep'

export interface InvariantViolation {
  kind: ViolationKind
  kltId: string
  detail: string
}

/**
 * Every structural rule the tree must satisfy, checked in one pass.
 *
 * These are the guard, NOT the review: a perfectly-shaped tree of nonsense
 * passes all of them. Semantic correctness is Phase 3's AI audit. What these
 * catch is the class of bug that is invisible in the UI and moves real numbers
 * — a stale `ancestorIds` array, an orphaned subtree, a depth that drifted.
 *
 * Returns EVERY violation rather than throwing on the first, so one run tells
 * an operator the full extent of the damage.
 */
export function checkTreeInvariants(rows: TreeNodeRow[]): InvariantViolation[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out: InvariantViolation[] = []

  for (const row of rows) {
    // Walk up, collecting the true ancestor chain and detecting cycles.
    const walked: string[] = []
    const seen = new Set<string>([row.id])
    let cursor = row.parentKltId
    let cyclic = false
    let orphaned = false

    while (cursor !== null) {
      if (seen.has(cursor)) {
        cyclic = true
        break
      }
      const parent = byId.get(cursor)
      if (!parent) {
        orphaned = true
        break
      }
      seen.add(cursor)
      walked.unshift(cursor)
      cursor = parent.parentKltId
    }

    if (cyclic) {
      out.push({ kind: 'cycle', kltId: row.id, detail: 'ancestor chain revisits a node' })
      continue // Every other check below reads the chain, which is meaningless here.
    }
    if (orphaned) {
      out.push({
        kind: 'orphan',
        kltId: row.id,
        detail: `parent ${row.parentKltId} does not exist`,
      })
      continue
    }

    if (row.depth !== walked.length) {
      out.push({
        kind: 'depth_mismatch',
        kltId: row.id,
        detail: `depth ${row.depth} but ${walked.length} ancestors`,
      })
    }
    if (row.ancestorIds.join(',') !== walked.join(',')) {
      out.push({
        kind: 'stale_ancestors',
        kltId: row.id,
        detail: `ancestorIds [${row.ancestorIds}] but walk gives [${walked}]`,
      })
    }
    if (walked.length >= MAX_TREE_DEPTH) {
      out.push({
        kind: 'too_deep',
        kltId: row.id,
        detail: `${walked.length} ancestors exceeds cap ${MAX_TREE_DEPTH}`,
      })
    }
  }

  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/klt/invariants.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/klt/invariants.ts tests/klt/invariants.test.ts
git commit -m "feat(klt): structural tree invariants"
```

---

## Task 4: Phase A — prompt v4, leaves not ladders

**Files:**
- Modify: `src/lib/ai/schemas.ts`
- Modify: `src/lib/ai/prompts/summarize-klts.ts`
- Modify: `src/lib/klt/resolve.ts`
- Test: `tests/klt/prompt.test.ts`, `tests/klt/resolve.test.ts` (both updated)

**Interfaces:**
- Consumes: `parseKltName`, `parseKltLabel`.
- Produces: `MAX_CONCEPTS_PER_KLP = 2`; `KltSummarySchema` with `concepts` replacing `topics`; `resolveKltWrites` unchanged in signature, `topics` now capped at 2 and ranked by centrality.

- [ ] **Step 1: Change the schema**

In `src/lib/ai/schemas.ts`, replace `MAX_KLTS_PER_KLP` and the topics field:

```ts
/**
 * How many LEAF concepts one key point may carry.
 *
 * Two, not three: breadth now comes from the tree, so these are peers ("the
 * concept this is chiefly about" plus at most one it honestly also covers),
 * not rungs. A third peer is almost always the model padding.
 */
export const MAX_CONCEPTS_PER_KLP = 2;

export const KltSummarySchema = z.object({
  klps: z.array(
    z.object({
      ref: z.number().int().min(0),
      label: z.string().min(1),
      /** Leaf concepts, most central first. May be empty. */
      concepts: z.array(z.string().min(1)).max(MAX_CONCEPTS_PER_KLP),
    }),
  ),
});
```

Keep `MAX_KLTS_PER_KLP` exported as an alias for one release so `masteryTopicRanks`' bound keeps compiling:

```ts
/** @deprecated Use MAX_CONCEPTS_PER_KLP. Kept so the tuning bound keeps working. */
export const MAX_KLTS_PER_KLP = MAX_CONCEPTS_PER_KLP;
```

- [ ] **Step 2: Rewrite the topics section of the prompt**

In `src/lib/ai/prompts/summarize-klts.ts`, set `version: 4` and replace the entire `2. "topics"` block with:

```ts
`2. "concepts" — 1 to ${MAX_CONCEPTS_PER_KLP} SPECIFIC concepts this point is about, most central first.
   Take the first one from the key words of the KLP itself. Do NOT give broader categories:
   the app already knows that a quick ratio is a liquidity ratio and that liquidity sits under
   accounting. Your job is only the precise concept, not where it belongs.

   Worked examples:
     KLP: "The quick ratio excludes inventory from current assets."       -> ["quick ratio"]
     KLP: "Minority interest is added back when calculating Enterprise Value."
                                                                          -> ["minority interest"]
     KLP: "Chlorophyll absorbs light most strongly in blue and red wavelengths."
                                                                          -> ["chlorophyll"]

   Rules:
   - A concept must be something a DIFFERENT card could also be about.
     "quick ratio" passes. "quick ratio excludes inventory" is this key point restated, and fails.
   - At most ${MAX_KLT_WORDS} words. Never a sentence, never a proper noun, never anything
     specific to one company, person or study set.
   - REUSE an existing concept from the list below whenever one fits, exactly as written.
   - One concept is normal. Give a second ONLY when the point genuinely covers two ideas.
`
```

- [ ] **Step 3: Update the resolver**

In `src/lib/klt/resolve.ts`, change the loop source from `entry.topics` to `entry.concepts` and update the doc comment's rank paragraph to:

```ts
 * - Rank is CENTRALITY: 1 is the concept the point is chiefly about. Invalid
 *   names are dropped and survivors re-ranked so ranks stay contiguous from 1.
```

- [ ] **Step 4: Update the tests**

In `tests/klt/resolve.test.ts`, replace every `topics:` key in an input object with `concepts:` (the output field stays `topics`). In `tests/klt/prompt.test.ts`, update the version assertion to `4`, replace the ladder assertions with:

```ts
  it('asks for specific concepts and explicitly NOT for broader categories', () => {
    // The tree supplies breadth. Asking for it here reintroduces the depth
    // inconsistency the tree exists to remove.
    const out = SUMMARIZE_KLTS_PROMPT.build(input)
    expect(out).toMatch(/Do NOT give broader categories/)
    expect(out).toMatch(/not where it belongs/)
  })

  it('states the reusability rule that guards against leaf proliferation', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toMatch(/a DIFFERENT card could also be about/)
  })
```

and delete the `bans the umbrella words` and `carries worked examples from more than one subject` tests — the ladder they guarded no longer exists. Keep the multi-subject examples in the prompt itself.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/klt --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: PASS, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/summarize-klts.ts src/lib/klt/resolve.ts tests/klt
git commit -m "feat(klt): prompt v4 — leaf concepts only, breadth comes from the tree"
```

---

## Task 5: Phase B — the placement prompt

**Files:**
- Create: `src/lib/ai/prompts/place-klts.ts`
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/registry.ts`
- Test: `tests/klt/place-prompt.test.ts`

**Interfaces:**
- Consumes: `renderTreeForPrompt`, `MAX_TREE_DEPTH` (Task 2).
- Produces:
  - `KltPlacementSchema` — `{ placements: { concept: string; path: string[] }[] }`
  - `PLACE_KLTS_PROMPT = { id: 'place-klts', version: 1, schema, build(input) }`
  - `interface PlaceKltsBuildInput { tree: string; concepts: string[] }`

- [ ] **Step 1: Add the schema**

Append to `src/lib/ai/schemas.ts`:

```ts
export const KltPlacementSchema = z.object({
  placements: z.array(
    z.object({
      /** The concept being placed, echoed back exactly as given. */
      concept: z.string().min(1),
      /** Root-first path INCLUDING the concept itself as the last element. */
      path: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export type KltPlacement = z.infer<typeof KltPlacementSchema>;
```

- [ ] **Step 2: Write the prompt**

Create `src/lib/ai/prompts/place-klts.ts`:

```ts
import { KltPlacementSchema } from '@/lib/ai/schemas';
import { MAX_TREE_DEPTH } from '@/lib/klt/tree';

export interface PlaceKltsBuildInput {
  /** The whole current tree, indented. Empty string when nothing exists yet. */
  tree: string;
  /** Concepts with no parent yet. */
  concepts: string[];
}

/**
 * Places unparented concepts into the tree.
 *
 * Separate from summarization because naming a concept and knowing where it
 * belongs are different tasks with different failure modes. Naming is anchored
 * by the KLP's own words and is reliable; placement is the compounding error
 * and wants the WHOLE tree in view rather than one batch of cards.
 *
 * Deliberately does NOT ask for a target depth. Demanding rungs produces
 * filler that becomes permanent structure — spec §12.1. Shallow output is
 * expected and is corrected later by refinement, not by prompting harder.
 */
export const PLACE_KLTS_PROMPT = {
  id: 'place-klts',
  version: 1,
  schema: KltPlacementSchema,

  build(input: PlaceKltsBuildInput): string {
    const tree =
      input.tree.length > 0
        ? `Existing concept tree — REUSE these nodes wherever they fit:\n${input.tree}`
        : 'The tree is empty. You are creating its first branches.';

    return `You are organising study concepts into a hierarchy.

${tree}

Place each of these concepts into the tree:
${input.concepts.map((c) => `- ${c}`).join('\n')}

For each one, return the full path from a top-level SUBJECT down to the concept itself.

Example shape:
  concept: "quick ratio"
  path: ["finance", "accounting", "financial statements", "liquidity ratios", "quick ratio"]

Rules:
- The FIRST element must be a broad subject — "finance", "biology", "modern history".
- The LAST element must be the concept exactly as given to you. Do not rename it.
- REUSE an existing node, spelled exactly as it appears above, at every level where one fits.
  Only invent a level that genuinely does not exist yet.
- Do NOT invent levels to make the path longer. A short accurate path is better than a padded one.
- At most ${MAX_TREE_DEPTH} elements including the concept.
- Every level must be a genuine generalisation of the one after it. Reading the path backwards
  must make sense: a quick ratio IS A liquidity ratio, which IS PART OF financial statements.

Output JSON:
{ "placements": [ { "concept": string, "path": string[] } ] }`;
  },
};
```

- [ ] **Step 3: Register it**

In `src/lib/ai/prompts/registry.ts` add the export, the import, and the `PROMPT_REGISTRY` entry, following the existing pattern exactly:

```ts
export { PLACE_KLTS_PROMPT } from './place-klts';
export type { PlaceKltsBuildInput } from './place-klts';
```
```ts
import { PLACE_KLTS_PROMPT } from './place-klts';
```
```ts
  [PLACE_KLTS_PROMPT.id]: PLACE_KLTS_PROMPT,
```

- [ ] **Step 4: Write the test**

Create `tests/klt/place-prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { PLACE_KLTS_PROMPT } from '@/lib/ai/prompts/place-klts'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { KltPlacementSchema } from '@/lib/ai/schemas'
import { MAX_TREE_DEPTH } from '@/lib/klt/tree'

const input = { tree: 'finance\n  accounting', concepts: ['quick ratio', 'minority interest'] }

describe('PLACE_KLTS_PROMPT', () => {
  it('is in the registry', () => {
    expect(PROMPT_REGISTRY['place-klts']).toBe(PLACE_KLTS_PROMPT)
  })

  it('shows the whole tree and asks for reuse', () => {
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toContain('finance\n  accounting')
    expect(out).toMatch(/REUSE an existing node/)
  })

  it('says so when the tree is empty', () => {
    expect(PLACE_KLTS_PROMPT.build({ ...input, tree: '' })).toMatch(/tree is empty/)
  })

  it('lists every concept to place', () => {
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toContain('- quick ratio')
    expect(out).toContain('- minority interest')
  })

  it('states the depth cap it will be validated against', () => {
    expect(PLACE_KLTS_PROMPT.build(input)).toContain(`At most ${MAX_TREE_DEPTH} elements`)
  })

  it('forbids padding rather than requesting a depth', () => {
    // Demanding rungs produces filler that becomes permanent structure.
    const out = PLACE_KLTS_PROMPT.build(input)
    expect(out).toMatch(/Do NOT invent levels/)
    expect(out).not.toMatch(/at least \d+ levels/i)
  })

  it('states the IS-A test that makes a path checkable', () => {
    expect(PLACE_KLTS_PROMPT.build(input)).toMatch(/Reading the path backwards/)
  })

  it('accepts a well-formed reply', () => {
    expect(
      KltPlacementSchema.safeParse({
        placements: [{ concept: 'quick ratio', path: ['finance', 'quick ratio'] }],
      }).success,
    ).toBe(true)
  })

  it('rejects an empty path', () => {
    expect(
      KltPlacementSchema.safeParse({ placements: [{ concept: 'x', path: [] }] }).success,
    ).toBe(false)
  })
})
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/klt --exclude "**/cursor-agents/**"
```
Expected: PASS (9 new).

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/prompts/place-klts.ts src/lib/ai/prompts/registry.ts src/lib/ai/schemas.ts tests/klt/place-prompt.test.ts
git commit -m "feat(klt): placement prompt for Phase B"
```

---

## Task 6: Placement pipeline

**Files:**
- Create: `src/lib/klt/place.ts`
- Test: `tests/klt/place.test.ts`

**Interfaces:**
- Consumes: `renderTreeForPrompt`, `wouldCycle`, `MAX_TREE_DEPTH`, `TreeNodeRow` (Task 2); `parseKltName`; `PLACE_KLTS_PROMPT`, `KltPlacementSchema` (Task 5).
- Produces:
  - `resolvePlacementPath(path: string[], byNormalized: Map<string, TreeNodeRow>): { matched: TreeNodeRow[]; toCreate: { name: string; normalizedName: string }[] } | null` — pure
  - `placeUnparentedConcepts(userId: string, generate?: KltPlacer): Promise<void>` — never throws
  - `type KltPlacer = (input: { userId: string; prompt: string }) => Promise<KltPlacement>`

- [ ] **Step 1: Write the failing test for the pure resolver**

Create `tests/klt/place.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolvePlacementPath } from '@/lib/klt/place'
import { MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree'

const node = (id: string, name: string, parentKltId: string | null, depth: number): TreeNodeRow => ({
  id, name, normalizedName: name, parentKltId, depth,
  ancestorIds: parentKltId ? [parentKltId] : [],
})

const byNormalized = new Map<string, TreeNodeRow>([
  ['finance', node('f', 'finance', null, 0)],
  ['accounting', node('a', 'accounting', 'f', 1)],
])

describe('resolvePlacementPath', () => {
  it('matches existing nodes and creates only what is missing', () => {
    const out = resolvePlacementPath(['finance', 'accounting', 'liquidity', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.id)).toEqual(['f', 'a'])
    expect(out?.toCreate.map((c) => c.normalizedName)).toEqual(['liquidity', 'quick ratio'])
  })

  it('creates the whole chain against an empty tree', () => {
    const out = resolvePlacementPath(['finance', 'quick ratio'], new Map())
    expect(out?.matched).toEqual([])
    expect(out?.toCreate).toHaveLength(2)
  })

  it('normalizes names so casing cannot fork a node', () => {
    const out = resolvePlacementPath(['Finance', 'Accounting', 'quick ratio'], byNormalized)
    expect(out?.matched.map((m) => m.id)).toEqual(['f', 'a'])
  })

  it('REJECTS a path once a match follows a creation — the tree would fork', () => {
    // finance > (new) liquidity > accounting: 'accounting' already lives
    // elsewhere, so honouring this would move it and everything beneath it.
    expect(resolvePlacementPath(['finance', 'liquidity', 'accounting'], byNormalized)).toBeNull()
  })

  it('rejects a path past the depth cap whole, never truncated', () => {
    const path = Array.from({ length: MAX_TREE_DEPTH + 1 }, (_, i) => `n${i}`)
    expect(resolvePlacementPath(path, new Map())).toBeNull()
  })

  it('rejects a path containing an invalid concept name', () => {
    expect(
      resolvePlacementPath(['finance', 'a name that is far too long to be a valid concept here'], byNormalized),
    ).toBeNull()
  })

  it('rejects an empty path', () => {
    expect(resolvePlacementPath([], byNormalized)).toBeNull()
  })

  it('rejects a path that repeats a name', () => {
    expect(resolvePlacementPath(['finance', 'finance'], byNormalized)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/place.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure resolver and the pipeline**

Create `src/lib/klt/place.ts`:

```ts
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { PLACE_KLTS_PROMPT } from '@/lib/ai/prompts/place-klts';
import { KltPlacementSchema, type KltPlacement } from '@/lib/ai/schemas';
import { parseKltName } from '@/lib/klt/normalize';
import { renderTreeForPrompt, MAX_TREE_DEPTH, type TreeNodeRow } from '@/lib/klt/tree';

export type KltPlacer = (input: { userId: string; prompt: string }) => Promise<KltPlacement>;

export const defaultKltPlacer: KltPlacer = ({ userId, prompt }) =>
  generateJson({ userId, task: 'autocomplete', prompt, schema: KltPlacementSchema });

export interface ResolvedPlacement {
  /** Existing nodes matched, root-first. */
  matched: TreeNodeRow[];
  /** Names to create, in order, each a child of the previous. */
  toCreate: { name: string; normalizedName: string }[];
}

/**
 * Split a proposed path into "already exists" and "must be created".
 *
 * PURE. Every rejection rule lives here so all of them are testable without a
 * database or an AI call:
 *
 * - A match appearing AFTER a creation is refused outright. It would mean
 *   re-parenting an existing node — moving it and its whole subtree, and every
 *   key point's mastery with it — as a side effect of placing an unrelated
 *   concept. Refusing leaves the concept unplaced, which is recoverable.
 * - A path past the cap is refused WHOLE. Truncating attaches the concept
 *   under the wrong parent, which is worse than leaving it unplaced.
 * - A repeated name is refused: it is a cycle expressed as a path.
 * - Any segment failing `parseKltName` refuses the path, rather than dropping
 *   the segment — dropping a middle rung silently changes what the path means.
 */
export function resolvePlacementPath(
  path: string[],
  byNormalized: Map<string, TreeNodeRow>,
): ResolvedPlacement | null {
  if (path.length === 0 || path.length > MAX_TREE_DEPTH) return null;

  const parsed = path.map((p) => parseKltName(p));
  if (parsed.some((p) => p === null)) return null;
  const names = parsed as { name: string; normalizedName: string }[];

  if (new Set(names.map((n) => n.normalizedName)).size !== names.length) return null;

  const matched: TreeNodeRow[] = [];
  const toCreate: { name: string; normalizedName: string }[] = [];
  for (const n of names) {
    const existing = byNormalized.get(n.normalizedName);
    if (existing) {
      if (toCreate.length > 0) return null; // match after a creation — see doc.
      matched.push(existing);
    } else {
      toCreate.push(n);
    }
  }
  return { matched, toCreate };
}

/**
 * Place every concept that has no parent yet.
 *
 * NEVER THROWS — it runs from `after()` and from a script. A failure leaves
 * concepts unparented, which is the honest resting state: they still hold
 * their key points and still report mastery as their own node, they simply do
 * not roll up. Fabricating a parent would be indistinguishable from a correct
 * one and would move real numbers.
 */
export async function placeUnparentedConcepts(
  userId: string,
  generate: KltPlacer = defaultKltPlacer,
): Promise<void> {
  let all: TreeNodeRow[];
  try {
    all = await prisma.klt.findMany({
      select: {
        id: true, name: true, normalizedName: true,
        parentKltId: true, depth: true, ancestorIds: true,
      },
    });
  } catch {
    return;
  }

  // A root is a node with children and no parent; an unplaced concept is a
  // node with neither. Distinguishing them matters — re-placing a root would
  // try to hang a whole subject under something else.
  const hasChildren = new Set(all.map((n) => n.parentKltId).filter((id): id is string => id !== null));
  const unplaced = all.filter((n) => n.parentKltId === null && !hasChildren.has(n.id));
  if (unplaced.length === 0) return;

  let result: KltPlacement;
  try {
    result = await generate({
      userId,
      prompt: PLACE_KLTS_PROMPT.build({
        tree: renderTreeForPrompt(all.filter((n) => !unplaced.includes(n))),
        concepts: unplaced.map((n) => n.name),
      }),
    });
  } catch (err) {
    if (!(err instanceof AiGenerationError)) throw err;
    return; // Unplaced is a valid state; leave them and let a retry try again.
  }

  const byNormalized = new Map(all.map((n) => [n.normalizedName, n]));
  const unplacedByNormalized = new Map(unplaced.map((n) => [n.normalizedName, n]));

  for (const placement of result.placements) {
    const target = parseKltName(placement.concept);
    if (!target) continue;
    const node = unplacedByNormalized.get(target.normalizedName);
    if (!node) continue; // Hallucinated concept, or one already placed this run.

    // The path must END at the concept being placed; anything else means the
    // model drifted and the path describes a different node.
    const last = parseKltName(placement.path[placement.path.length - 1] ?? '');
    if (!last || last.normalizedName !== target.normalizedName) continue;

    const resolved = resolvePlacementPath(placement.path, byNormalized);
    if (!resolved) continue;

    try {
      await applyPlacement(node, resolved, byNormalized);
    } catch {
      // One bad placement must not abandon the rest of the batch.
    }
  }
}

/**
 * Create the missing chain and attach the concept, in one transaction.
 *
 * `byNormalized` is updated in place so later placements in the same run reuse
 * nodes this one created — without it, two concepts sharing a new ancestor
 * would each mint their own copy and the tree would fork on its first run.
 */
async function applyPlacement(
  node: TreeNodeRow,
  resolved: ResolvedPlacement,
  byNormalized: Map<string, TreeNodeRow>,
): Promise<void> {
  const parentChain = resolved.toCreate.slice(0, -1); // last entry IS the node
  let parent = resolved.matched[resolved.matched.length - 1] ?? null;

  await prisma.$transaction(async (tx) => {
    for (const spec of parentChain) {
      const created = await tx.klt.upsert({
        where: { normalizedName: spec.normalizedName },
        create: {
          name: spec.name,
          normalizedName: spec.normalizedName,
          parentKltId: parent?.id ?? null,
          depth: parent ? parent.depth + 1 : 0,
          ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
        },
        update: {},
        select: {
          id: true, name: true, normalizedName: true,
          parentKltId: true, depth: true, ancestorIds: true,
        },
      });
      byNormalized.set(created.normalizedName, created);
      parent = created;
    }

    await tx.klt.update({
      where: { id: node.id },
      data: {
        parentKltId: parent?.id ?? null,
        depth: parent ? parent.depth + 1 : 0,
        ancestorIds: parent ? [...parent.ancestorIds, parent.id] : [],
      },
    });
  });

  if (parent) {
    byNormalized.set(node.normalizedName, {
      ...node,
      parentKltId: parent.id,
      depth: parent.depth + 1,
      ancestorIds: [...parent.ancestorIds, parent.id],
    });
  }
}
```

- [ ] **Step 4: Run the pure tests**

```bash
npx vitest run tests/klt/place.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (8 tests).

- [ ] **Step 5: Add pipeline tests with a mocked prisma**

Append to `tests/klt/place.test.ts` a second `describe` using the `vi.hoisted` + `vi.mock('@/lib/db')` pattern from `tests/actions/klt.test.ts`. Assert:

```ts
  it('never throws when generation fails', async () => { /* generate rejects */ })
  it('leaves concepts unparented rather than fabricating a parent', async () => { /* no klt.update call */ })
  it('skips a placement whose path does not end at the concept', async () => { /* no update */ })
  it('does not try to re-place a node that already has children', async () => { /* root excluded */ })
  it('reuses a node created earlier in the same run', async () => { /* one upsert for a shared ancestor */ })
```

- [ ] **Step 6: Run and commit**

```bash
npx vitest run tests/klt --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
git add src/lib/klt/place.ts tests/klt/place.test.ts
git commit -m "feat(klt): placement pipeline with path reconciliation"
```

---

## Task 7: Subtree rollup

**Files:**
- Modify: `src/lib/memory/topic-profile.ts`
- Modify: `src/lib/metrics/read.ts`
- Test: `tests/memory/klt-topic-rows.test.ts`

**Interfaces:**
- Consumes: `TreeNodeRow`.
- Produces: `kltRowsToTopicRows(rows: RawKltRow[], maxRank: number)` — unchanged signature; `RawKltRow` gains `depth: number` and its `links` now include descendants' links.

- [ ] **Step 1: Write the failing test**

Append to `tests/memory/klt-topic-rows.test.ts`:

```ts
describe('kltRowsToTopicRows — subtree rollup', () => {
  it('counts a descendant’s key points toward an ancestor', () => {
    // `accounting` holds no links directly; every key point sits on leaves
    // beneath it. Without rollup it reports nothing at all.
    const [row] = kltRowsToTopicRows(
      [{
        normalizedName: 'accounting', name: 'accounting', depth: 1,
        links: [link('a', 1), link('b', 1)],
      }],
      3,
    )
    expect([...row.klpIds].sort()).toEqual(['a', 'b'])
  })

  it('carries depth through so the display can group by level', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'accounting', name: 'accounting', depth: 1, links: [link('a', 1)] }],
      3,
    )
    expect(row.depth).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — `RawKltRow` has no `depth`, `TopicRow` has no `depth`.

- [ ] **Step 3: Implement**

In `src/lib/memory/topic-profile.ts`, add `depth: number` to `RawKltRow` and to `TopicRow`, and pass it through in `kltRowsToTopicRows`. Add to the doc comment:

```ts
 * `links` now arrives ALREADY INCLUDING descendants' links — the rollup is done
 * in the query (`ancestorIds has <id>`), not here, so this function stays a
 * pure shaper. A node's own links alone would report nothing for every interior
 * node, since key points only ever attach to leaves.
```

In `src/lib/metrics/read.ts`, change `loadKltRows` so each node's `links` filter becomes "links on this node **or any descendant**":

```ts
  return prisma.klt.findMany({
    where: { OR: [{ links: { some: { klp: { card } } } }, { /* interior nodes */ children: { some: {} } }] },
    select: {
      normalizedName: true,
      name: true,
      depth: true,
      // Rollup: every link whose Klt is this node OR has this node as an ancestor.
      links: { where: { klp: { card } }, select: { rank: true, klp: { select: { id: true, supersededAt: true, cardId: true } } } },
    },
  })
```

then, after fetching, fold each node's descendants' links into it using `ancestorIds` — a second pass in TypeScript over the same rows, so there is one query, not one per node.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/memory tests/metrics --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/topic-profile.ts src/lib/metrics/read.ts tests/memory/klt-topic-rows.test.ts
git commit -m "feat(klt): roll mastery up over subtrees"
```

---

## Task 8: Auto-selected display depth

**Files:**
- Create: `src/lib/metrics/klt-depth.ts`
- Modify: `src/lib/metrics/read.ts`, `src/components/learner/TopicMastery.tsx`
- Test: `tests/metrics/klt-depth.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MIN_TOPICS_AT_DEPTH = 3`; `selectDisplayDepth(measuredByDepth: Map<number, number>, populatedDepths: number[]): number | null`

- [ ] **Step 1: Write the failing test**

Create `tests/metrics/klt-depth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectDisplayDepth, MIN_TOPICS_AT_DEPTH } from '@/lib/metrics/klt-depth'

describe('selectDisplayDepth', () => {
  it('picks the DEEPEST level with enough measured topics', () => {
    const m = new Map([[0, 1], [1, 5], [2, 4], [3, 1]])
    expect(selectDisplayDepth(m, [0, 1, 2, 3])).toBe(2)
  })

  it(`requires at least ${MIN_TOPICS_AT_DEPTH} measured topics at a level`, () => {
    const m = new Map([[0, 5], [1, MIN_TOPICS_AT_DEPTH - 1]])
    expect(selectDisplayDepth(m, [0, 1])).toBe(0)
  })

  it('falls back to the shallowest POPULATED level when nothing is measured', () => {
    // A thin corpus must still show something, and the broadest level is the
    // one most likely to have any evidence at all.
    expect(selectDisplayDepth(new Map(), [2, 3])).toBe(2)
  })

  it('returns null when there is no tree at all', () => {
    expect(selectDisplayDepth(new Map(), [])).toBeNull()
  })

  it('ignores a measured level that is not populated', () => {
    expect(selectDisplayDepth(new Map([[7, 9]]), [0, 1])).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/metrics/klt-depth.ts`:

```ts
/**
 * How many topics at a level must clear the learner's observation floor before
 * that level is worth showing. Below this, the view is mostly "not measured",
 * which is the complaint that opened queue item 9.
 */
export const MIN_TOPICS_AT_DEPTH = 3

/**
 * Which level of the tree to display.
 *
 * DEEPEST wins: a specific topic is more actionable than a broad one, so we go
 * as fine-grained as the evidence supports and no further. A thin corpus lands
 * on broad topics; the view sharpens by itself as answers accumulate, with no
 * setting for the learner to notice and retune.
 *
 * Pure, so every combination is testable without a database.
 */
export function selectDisplayDepth(
  measuredByDepth: Map<number, number>,
  populatedDepths: number[],
): number | null {
  if (populatedDepths.length === 0) return null

  const populated = [...new Set(populatedDepths)].sort((a, b) => a - b)
  const qualifying = populated.filter(
    (d) => (measuredByDepth.get(d) ?? 0) >= MIN_TOPICS_AT_DEPTH,
  )
  if (qualifying.length > 0) return qualifying[qualifying.length - 1]

  // Nothing measured anywhere — show the broadest level that exists rather
  // than nothing. It is the most likely to accumulate evidence first.
  return populated[0]
}
```

- [ ] **Step 4: Wire it in**

In `src/lib/metrics/read.ts`, after `kltTopics` is shaped, compute the depth and filter:

```ts
  const measuredByDepth = new Map<number, number>()
  const populatedDepths: number[] = []
  for (const t of kltTopicsAll) {
    populatedDepths.push(t.depth)
    if (t.knowledge !== null) {
      measuredByDepth.set(t.depth, (measuredByDepth.get(t.depth) ?? 0) + 1)
    }
  }
  const displayDepth = selectDisplayDepth(measuredByDepth, populatedDepths)
  const kltTopics = displayDepth === null
    ? []
    : kltTopicsAll.filter((t) => t.depth === displayDepth)
```

Add `displayDepth: number | null` and `kltBreadcrumbs: Record<string, string[]>` to `LearnerMetrics`, the latter mapping topic key → ancestor display names.

In `TopicMastery.tsx`, render the breadcrumb under each topic name when one is supplied:

```tsx
        {breadcrumb && breadcrumb.length > 0 && (
          <p className="text-xs text-muted-foreground truncate">{breadcrumb.join(' › ')}</p>
        )}
```

- [ ] **Step 5: Run everything and commit**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
git add src/lib/metrics/klt-depth.ts src/lib/metrics/read.ts src/components/learner/TopicMastery.tsx tests/metrics/klt-depth.test.ts
git commit -m "feat(klt): auto-select display depth, breadcrumb ancestors"
```

---

## Task 9: Health metrics and the backfill

**Files:**
- Modify: `scripts/backfill-klts.ts`
- Test: `tests/klt/backfill-idempotent.test.ts`

**Interfaces:**
- Consumes: `placeUnparentedConcepts` (Task 6), `checkTreeInvariants` (Task 3).
- Produces: `npm run backfill:klts` runs Phase A then Phase B, then reports health.

- [ ] **Step 1: Add the placement step**

After the per-owner summarization loop, before the reporting:

```ts
  // Phase B. Runs ONCE for the whole install, not per owner: the tree is
  // global, and placing one owner's concepts at a time would show the model a
  // partial tree and invite it to mint duplicates of nodes another owner's run
  // is about to create.
  console.log('[backfill:klts] placing unparented concepts…')
  await placeUnparentedConcepts(owners[0]?.id ?? '', direct ? directPlacer() : undefined)
```

with `directPlacer()` mirroring `directGenerator()` but using `KltPlacementSchema`.

- [ ] **Step 2: Replace the tier metrics with tree metrics**

`reportFragmentation` and `reportConcentration` were written for a flat 3-rank scheme. Replace with:

```ts
/** Direct children above which a node has absorbed distinctions it should delegate. */
const MAX_BRANCHING = 7

async function reportTreeHealth() {
  const rows = await prisma.klt.findMany({
    select: { id: true, name: true, normalizedName: true, parentKltId: true, depth: true, ancestorIds: true },
  })

  const violations = checkTreeInvariants(rows)
  if (violations.length > 0) {
    console.error(`[backfill:klts] STRUCTURAL VIOLATIONS: ${violations.length}`)
    for (const v of violations.slice(0, 10)) console.error(`  ${v.kind} ${v.kltId}: ${v.detail}`)
  }

  const byDepth = new Map<number, number>()
  for (const r of rows) byDepth.set(r.depth, (byDepth.get(r.depth) ?? 0) + 1)
  console.log('[backfill:klts] nodes by depth: ' +
    [...byDepth.entries()].sort((a, b) => a[0] - b[0]).map(([d, n]) => `${d}:${n}`).join(' '))

  const unplaced = rows.filter((r) => r.parentKltId === null &&
    !rows.some((o) => o.parentKltId === r.id))
  if (unplaced.length > 0) {
    console.warn(`[backfill:klts] ${unplaced.length} concept(s) still unparented — they report ` +
      `mastery as their own node but do not roll up: ${unplaced.slice(0, 8).map((u) => u.name).join(', ')}`)
  }

  const childCount = new Map<string, number>()
  for (const r of rows) {
    if (r.parentKltId) childCount.set(r.parentKltId, (childCount.get(r.parentKltId) ?? 0) + 1)
  }
  const overloaded = [...childCount.entries()]
    .filter(([, n]) => n > MAX_BRANCHING)
    .map(([id, n]) => `${rows.find((r) => r.id === id)?.name} (${n})`)
  if (overloaded.length > 0) {
    console.warn(`[backfill:klts] ${overloaded.length} node(s) exceed ${MAX_BRANCHING} direct ` +
      `children — a rung is probably missing beneath them: ${overloaded.join(', ')}`)
  }

  const linked = await prisma.klpTopic.groupBy({ by: ['kltId'], _count: true })
  const singletons = linked.filter((l) => l._count === 1).length
  if (linked.length > 0) {
    console.log(`[backfill:klts] concepts with exactly one key point: ${singletons}/${linked.length}`)
    if (singletons > linked.length * 0.5) {
      console.warn('[backfill:klts] WARNING: over half of concepts cover a single key point. ' +
        'Leaves are being minted per card instead of reused — nothing will aggregate.')
    }
  }
}
```

- [ ] **Step 3: Update the script tests**

In `tests/klt/backfill-idempotent.test.ts`, replace the concentration/fragmentation assertions with:

```ts
  it('runs placement after summarization', () => {
    expect(script).toMatch(/placeUnparentedConcepts/)
    expect(script.indexOf('summarizeKltsForCards')).toBeLessThan(
      script.indexOf('placeUnparentedConcepts'),
    )
  })

  it('checks structural invariants and reports violations loudly', () => {
    expect(script).toMatch(/checkTreeInvariants/)
    expect(script).toMatch(/STRUCTURAL VIOLATIONS/)
  })

  it('warns on overloaded nodes — the signal a rung is missing', () => {
    expect(script).toMatch(/MAX_BRANCHING/)
  })

  it('warns on leaf proliferation', () => {
    expect(script).toMatch(/single key point/)
  })
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run tests/klt --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
git add scripts/backfill-klts.ts tests/klt/backfill-idempotent.test.ts
git commit -m "feat(klt): tree health metrics — invariants, branching, singletons"
```

---

## Task 10: Regenerate and verify

**Files:** none — this task verifies.

- [ ] **Step 1: Full gates**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npm run build
npm run lint 2>&1 | tail -3
```
Expected: all green; lint at **175 or fewer**. A rise means this work introduced it.

- [ ] **Step 2: Wipe the derived tree (spec §11)**

```bash
npx tsx --conditions=react-server --env-file=.env -e "
import('./src/lib/db').then(async ({ prisma }) => {
  await prisma.klpTopic.deleteMany({})
  await prisma.klt.deleteMany({})
  await prisma.card.updateMany({ data: { kltStatus: 'pending' } })
  console.log('wiped')
  process.exit(0)
})"
```

`CardKlp.label` is deliberately kept — unaffected by the tree, and regenerating it is waste.

- [ ] **Step 3: Regenerate**

```bash
npm run backfill:klts -- --direct --force
```

**Predict before reading the output.** Expect: 153/153 labelled; nodes concentrated at depths 0–3; **several overloaded-node warnings** — that is Phase 1 working as designed, not failing. Depth collapse (§12.1) is the known state Phase 3 fixes.

- [ ] **Step 4: Confirm the invariants hold against real data**

The backfill prints violations. Expected: **zero**. Any violation is a bug in Task 6's writer, not in the data — fix before proceeding.

- [ ] **Step 5: Live gate**

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
```

Sign in at `/login` as `dev_user` (password in `.env`, note `--env-file` strips the surrounding quotes). Check on `/profile/learner`:

1. Topic mastery renders at one auto-selected depth, not every node at once.
2. Breadcrumbs show ancestor paths.
3. The missed-work panel still works and rows still lead with short labels.
4. **The mastery guard:** note a KLP's `pKnown` and `observations`, re-run the backfill, confirm both unchanged.

Stop the server with `taskkill /PID <pid> /F`.

- [ ] **Step 6: Update the queue and commit**

Record in `docs/superpowers/BUILD-QUEUE.md`: Phase 1 built, new baselines, the observed depth distribution, and how many overloaded nodes Phase 3 will have to fix.

---

## Self-Review

**Spec coverage (Phase 1 scope only):**

| Spec section | Task |
| --- | --- |
| §3 schema, `Restrict`, GIN | 1 |
| §4.1 Phase A, leaf rule | 4 |
| §4.2 Phase B, path reconciliation, cycle/depth refusal | 5, 6 |
| §4.3 unparented is the pending state | 6 |
| §7 subtree rollup, `masteryTopicRanks` unchanged | 7 |
| §8 auto-depth + breadcrumb (zoom is Phase 2) | 8 |
| §10.1 structural invariants | 3, 9 |
| §11 migration by wipe-and-regenerate | 10 |
| §12.5 leaf proliferation metric | 9 |
| §12.7 tier-aware → tree-aware health checks | 9 |
| §5 seeding, §6 refinement, §9 editor, §10.2 audits | **Phases 2–3, not here** |

**Placeholder scan:** no TBDs. Task 6 Step 5 and Task 7 Step 3 describe test assertions and a query shape in prose rather than full code — both are cases where the surrounding code must be read at implementation time (the existing mock harness, the existing scope handling). Every other step carries real code.

**Type consistency:** `TreeNodeRow` (Task 2) is consumed by name in Tasks 3, 6, 9. `ResolvedPlacement` (Task 6) is produced and consumed only there. `RawKltRow` gains `depth` in Task 7 and is read by Task 8. `MAX_TREE_DEPTH` (Task 2) bounds Tasks 3, 5, 6. `MAX_CONCEPTS_PER_KLP` (Task 4) replaces `MAX_KLTS_PER_KLP`, which stays as a deprecated alias so `masteryTopicRanks`' Zod bound keeps compiling.

**Known plan-level risk:** Task 7 is the least specified — `read.ts` already carries the whole scope-resolution story and the descendant-folding pass has to respect it. If the change exceeds ~60 lines, extract the rollup into `src/lib/metrics/klt-rollup.ts` rather than letting `read.ts` sprawl further.
