# KLT Topic Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global Key Learning Topic (KLT) layer above KLPs plus a short per-KLP `label`, filled by an async AI pass, and surface "what you're getting wrong" as a new panel on `/profile/learner`.

**Architecture:** Three grains — `Klt` (broad, globally unique concept) → `CardKlp.label` (3–6 words) → `CardKlp.text` (the untouched proposition). One `after()`-triggered batched AI pass writes both `label` and 1–3 ranked `KlpTopic` links per KLP, mirroring the existing KLP extraction pipeline. Topic mastery gains a second, KLT-derived axis alongside categories; nothing existing is removed.

**Tech Stack:** Next.js App Router, TypeScript, Prisma + Postgres (Neon adapter), Vercel AI SDK v7 via `generateJson`, Zod, Vitest, React Testing Library.

**Spec:** `docs/superpowers/specs/2026-08-24-klt-topic-layer-design.md`

## Global Constraints

- **Never supersede or delete a `CardKlp` row from the KLT pass.** `AnswerKlpResult.klp` is `onDelete: Cascade` and `KlpState` keys on `klpId`. Spec §6.
- **`CardKlp.label` is the ONLY column a writer other than `writeKlpVersion` may touch.** Spec §6.1.
- **1–3 KLTs per KLP** (`MAX_KLTS_PER_KLP = 3`), ranked from 1. All ranks feed mastery by default.
- **KLT names:** normalized lowercase, ≤ 4 words, ≤ 40 chars. Invalid names are **dropped, never repaired**. A KLP with zero valid topics is still `ready` with a label.
- **`Klt.normalizedName` is globally unique** — one node for all users. Commit via `upsert`, never `create`.
- **No new `AI_TASKS` member.** Route to `'autocomplete'`.
- **No embeddings.**
- **The pipeline must never throw** — it runs inside `after()`. Record failures on the card.
- **Model sees batch indices (`ref`), never cuids.** Unknown refs are skipped, not fatal.
- **Verify with the cursor-agents excludes, always:**
  ```bash
  npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
  npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
  ```
- **Baselines to compare against** (branch `spec3b-tunable-scoring`, after item 8): 140 test files / 1655 passing; `tsc` clean; `next build` clean; `npm run lint` **175 problems**. Do not fix unrelated lint.
- **`'use server'` files may export only async functions.** Constants go in `src/lib/`, never in `src/actions/*.ts`. Guarded by `tests/actions/use-server-exports.test.ts`.
- **`prisma migrate dev` needs a TTY and is unusable here.** Use the `migrate diff` → write SQL → `migrate deploy` route (Task 1).
- **`tsx` scripts must live in `scripts/` and need a `main()` wrapper** — no top-level await.
- **Component tests** need `// @vitest-environment jsdom` as the literal first line and their own `afterEach(cleanup)`.

---

## File Structure

**Create:**
- `src/lib/cards/klt-batch.ts` — `KLT_BATCH_SIZE`
- `src/lib/klt/normalize.ts` — name normalization + validity rules
- `src/lib/klt/candidates.ts` — pure candidate-vocabulary assembly
- `src/lib/klt/resolve.ts` — pure model-output → write-plan
- `src/lib/ai/prompts/summarize-klts.ts` — the versioned prompt
- `src/actions/klt.ts` — the pipeline + retry action
- `src/lib/metrics/missed.ts` — pure shaping for the new panel
- `src/components/learner/MissedWork.tsx` — the panel
- `scripts/backfill-klts.ts` — one-time backfill
- Tests mirroring each of the above.

**Modify:**
- `prisma/schema.prisma`
- `src/lib/ai/schemas.ts` — `KltSummarySchema`, `MAX_KLTS_PER_KLP`
- `src/lib/ai/prompts/registry.ts`
- `src/actions/klp.ts` — reset `kltStatus` in `writeKlpVersion`; narrow its doc comment
- `src/lib/tuning/schema.ts` — `masteryTopicRanks` knob
- `src/lib/memory/topic-profile.ts` — KLT-derived topic rows
- `src/lib/metrics/coverage.ts` — `pendingKltSummarization`
- `src/actions/learner-dashboard.ts` — expose missed work + KLT topics
- `src/app/profile/learner/page.tsx` — mount the panel
- `src/components/sets/KlpEditor.tsx` — KLT retry affordance

---

## Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_klt_topic_layer/migration.sql`
- Test: `tests/schema/klt-schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma models `Klt { id, name, normalizedName, createdAt, links }` and `KlpTopic { id, klpId, kltId, rank, klp, klt }`; new columns `CardKlp.label String?`, `Card.kltStatus String @default("pending")`, `Card.kltError String?`.

- [ ] **Step 1: Add the models and columns to the schema**

In `prisma/schema.prisma`, add `label String?` and `topics KlpTopic[]` to `model CardKlp`; add `kltStatus String @default("pending")` and `kltError String?` to `model Card`; then append:

```prisma
/// Stage 8 item 9: a general concept a KLP is about.
///
/// GLOBAL, not per-user and not per-set — `normalizedName` is unique across
/// the whole install so "WACC" is one node for every learner. That is the
/// precondition for cross-user comparison, and it is a deliberate difference
/// from `CardCategory`, which is `@@unique([setId, normalizedName])`.
///
/// Never garbage-collected. A Klt with zero live links is simply not
/// displayed; deleting it would churn ids that history points at.
model Klt {
  id             String     @id @default(cuid())
  name           String
  normalizedName String     @unique
  createdAt      DateTime   @default(now())
  links          KlpTopic[]
}

/// KLP -> KLT, ranked 1..3 (1 = primary).
///
/// Rows for SUPERSEDED KLPs are kept. `shapeTopicProfile` separates live KLPs
/// (which drive knowledge) from attributable ones (live + superseded, which
/// attribute historical error tags) — deleting old links would empty
/// readiness's numerator on a card edit while its answers stayed in the
/// denominator.
model KlpTopic {
  id    String  @id @default(cuid())
  klpId String
  kltId String
  rank  Int
  klp   CardKlp @relation(fields: [klpId], references: [id], onDelete: Cascade)
  klt   Klt     @relation(fields: [kltId], references: [id], onDelete: Cascade)

  @@unique([klpId, kltId])
  @@index([kltId])
  @@index([klpId, rank])
}
```

- [ ] **Step 2: Generate the migration SQL** (`migrate dev` needs a TTY — do not use it)

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Copy the output into `prisma/migrations/20260824000000_klt_topic_layer/migration.sql`.

- [ ] **Step 3: Apply and verify zero drift**

```bash
npx prisma migrate deploy
npx prisma generate
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected: the final diff prints `-- This is an empty migration.` Anything else means residual drift — fix the SQL, do not proceed.

- [ ] **Step 4: Write the schema guard test**

Create `tests/schema/klt-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const schema = readFileSync(join(process.cwd(), 'prisma/schema.prisma'), 'utf8')

describe('KLT schema', () => {
  it('makes Klt.normalizedName globally unique', () => {
    const model = schema.split('model Klt {')[1].split('}')[0]
    expect(model).toMatch(/normalizedName\s+String\s+@unique/)
  })

  it('does not scope Klt to a set or a user', () => {
    const model = schema.split('model Klt {')[1].split('}')[0]
    expect(model).not.toMatch(/setId/)
    expect(model).not.toMatch(/userId/)
  })

  it('keeps CardKlp.label nullable so an unsummarized KLP still renders', () => {
    const model = schema.split('model CardKlp {')[1].split('\n}')[0]
    expect(model).toMatch(/label\s+String\?/)
  })

  it('uniquely constrains a KLP/KLT pair so a rerun cannot duplicate links', () => {
    const model = schema.split('model KlpTopic {')[1].split('\n}')[0]
    expect(model).toMatch(/@@unique\(\[klpId, kltId\]\)/)
  })
})
```

- [ ] **Step 5: Run the test**

```bash
npx vitest run tests/schema/klt-schema.test.ts --exclude "**/cursor-agents/**"
```
Expected: 4 passing.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations tests/schema/klt-schema.test.ts
git commit -m "feat(klt): add Klt, KlpTopic, CardKlp.label and Card.kltStatus"
```

---

## Task 2: KLT name normalization

**Files:**
- Create: `src/lib/klt/normalize.ts`
- Test: `tests/klt/normalize.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MAX_KLT_WORDS = 4`, `MAX_KLT_CHARS = 40`
  - `normalizeKltName(raw: string): string`
  - `parseKltName(raw: string): { name: string; normalizedName: string } | null` — null when invalid.

- [ ] **Step 1: Write the failing test**

Create `tests/klt/normalize.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { normalizeKltName, parseKltName, MAX_KLT_WORDS, MAX_KLT_CHARS } from '@/lib/klt/normalize'

describe('normalizeKltName', () => {
  it('lowercases, trims and collapses internal whitespace', () => {
    expect(normalizeKltName('  Weighted   Average  Cost ')).toBe('weighted average cost')
  })

  it('strips surrounding punctuation and trailing periods', () => {
    expect(normalizeKltName('"WACC."')).toBe('wacc')
  })

  it('is idempotent — normalizing twice equals normalizing once', () => {
    const once = normalizeKltName('  Tax   Shield. ')
    expect(normalizeKltName(once)).toBe(once)
  })

  it('collapses the same concept written three ways to one key', () => {
    expect(normalizeKltName('WACC')).toBe(normalizeKltName('wacc'))
    expect(normalizeKltName('Tax Shield')).toBe(normalizeKltName('  tax  shield  '))
  })
})

describe('parseKltName', () => {
  it('keeps the display form while normalizing the key', () => {
    expect(parseKltName('Terminal Value')).toEqual({
      name: 'Terminal Value',
      normalizedName: 'terminal value',
    })
  })

  it('rejects an empty or whitespace-only name', () => {
    expect(parseKltName('')).toBeNull()
    expect(parseKltName('   ')).toBeNull()
  })

  it(`rejects more than ${MAX_KLT_WORDS} words — a topic, not a sentence`, () => {
    expect(parseKltName('the weighted average cost of capital')).toBeNull()
    expect(parseKltName('weighted average cost capital')).not.toBeNull()
  })

  it(`rejects names longer than ${MAX_KLT_CHARS} characters`, () => {
    expect(parseKltName('a'.repeat(MAX_KLT_CHARS + 1))).toBeNull()
    expect(parseKltName('a'.repeat(MAX_KLT_CHARS))).not.toBeNull()
  })

  it('measures the length cap against the NORMALIZED form, not the raw input', () => {
    // Padding must not push a valid name over the cap.
    const padded = `   ${'a'.repeat(MAX_KLT_CHARS)}   `
    expect(parseKltName(padded)).not.toBeNull()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/normalize.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — `Cannot find module '@/lib/klt/normalize'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/klt/normalize.ts`:

```ts
/**
 * A KLT is a CONCEPT NAME, not a proposition — "WACC", not "WACC weights each
 * capital source by market value". These caps are what keep it that way: the
 * model is asked for a short topic, and anything longer is dropped rather than
 * trimmed, because a truncated concept name is a different concept.
 *
 * The caps are also the containment for spec §9.2 — the global vocabulary is
 * fed into other users' summarization prompts, and a four-word cap forces
 * names toward general concepts and away from anything set-specific.
 */
export const MAX_KLT_WORDS = 4
export const MAX_KLT_CHARS = 40

/**
 * The dedup key. `Klt.normalizedName` is globally unique, so this function
 * alone decides whether two accounts' topics are the same node — golden-vector
 * tested for that reason. Changing it strands every existing row.
 */
export function normalizeKltName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Validate and split a model-supplied topic into display + key forms.
 *
 * Returns null for anything invalid. Callers DROP a null; they never repair
 * it. Fabricating or truncating a topic to fill a slot is the KLT analogue of
 * Spec 2a's rule that degradation never invents a tag — a bad topic is
 * indistinguishable downstream from a good one.
 */
export function parseKltName(raw: string): { name: string; normalizedName: string } | null {
  const normalizedName = normalizeKltName(raw)
  if (normalizedName.length === 0) return null
  if (normalizedName.length > MAX_KLT_CHARS) return null
  if (normalizedName.split(' ').length > MAX_KLT_WORDS) return null
  return { name: raw.trim().replace(/\s+/g, ' '), normalizedName }
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/klt/normalize.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/klt/normalize.ts tests/klt/normalize.test.ts
git commit -m "feat(klt): name normalization and validity rules"
```

---

## Task 3: Candidate vocabulary assembly

**Files:**
- Create: `src/lib/klt/candidates.ts`
- Test: `tests/klt/candidates.test.ts`

**Interfaces:**
- Consumes: `normalizeKltName` from Task 2.
- Produces:
  - `KLT_CANDIDATE_CAP = 150`
  - `interface KltCandidateInput { setLocal: string[]; existing: { name: string; normalizedName: string; linkCount: number }[]; klpTexts: string[] }`
  - `assembleCandidates(input: KltCandidateInput): string[]` — display names, deduped, priority-ordered, capped.

- [ ] **Step 1: Write the failing test**

Create `tests/klt/candidates.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { assembleCandidates, KLT_CANDIDATE_CAP } from '@/lib/klt/candidates'

const existing = [
  { name: 'WACC', normalizedName: 'wacc', linkCount: 50 },
  { name: 'Terminal Value', normalizedName: 'terminal value', linkCount: 3 },
  { name: 'Bankruptcy', normalizedName: 'bankruptcy', linkCount: 1 },
  { name: 'Photosynthesis', normalizedName: 'photosynthesis', linkCount: 99 },
]

describe('assembleCandidates', () => {
  it('puts set-local topics first — a set is usually one subject', () => {
    const out = assembleCandidates({
      setLocal: ['bankruptcy'],
      existing,
      klpTexts: [],
    })
    expect(out[0]).toBe('Bankruptcy')
  })

  it('includes topics whose name overlaps the batch text', () => {
    const out = assembleCandidates({
      setLocal: [],
      existing,
      klpTexts: ['Discount the cash flows using WACC and a terminal value.'],
    })
    expect(out).toContain('WACC')
    expect(out).toContain('Terminal Value')
  })

  it('fills remaining slots with the globally most-linked topics', () => {
    const out = assembleCandidates({ setLocal: [], existing, klpTexts: [] })
    expect(out[0]).toBe('Photosynthesis') // linkCount 99
    expect(out[1]).toBe('WACC') // linkCount 50
  })

  it('never repeats a topic that qualified twice', () => {
    const out = assembleCandidates({
      setLocal: ['wacc'],
      existing,
      klpTexts: ['WACC matters'],
    })
    expect(out.filter((n) => n === 'WACC')).toHaveLength(1)
  })

  it('ignores short words so "the" does not match everything', () => {
    const out = assembleCandidates({
      setLocal: [],
      existing: [{ name: 'The', normalizedName: 'the', linkCount: 0 }],
      klpTexts: ['The cash flow is the thing'],
    })
    // Only reachable via the global-popularity tail, not via overlap.
    expect(out).toEqual(['The'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: KLT_CANDIDATE_CAP + 50 }, (_, i) => ({
      name: `topic ${i}`,
      normalizedName: `topic ${i}`,
      linkCount: 1,
    }))
    const out = assembleCandidates({ setLocal: [], existing: many, klpTexts: [] })
    expect(out).toHaveLength(KLT_CANDIDATE_CAP)
  })

  it('never lets globally-popular topics crowd out set-local ones at the cap', () => {
    const many = Array.from({ length: KLT_CANDIDATE_CAP + 50 }, (_, i) => ({
      name: `topic ${i}`,
      normalizedName: `topic ${i}`,
      linkCount: 100,
    }))
    const out = assembleCandidates({
      setLocal: ['mine'],
      existing: [...many, { name: 'Mine', normalizedName: 'mine', linkCount: 0 }],
      klpTexts: [],
    })
    expect(out).toHaveLength(KLT_CANDIDATE_CAP)
    expect(out[0]).toBe('Mine')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/candidates.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/klt/candidates.ts`:

```ts
import { normalizeKltName } from '@/lib/klt/normalize'

/**
 * How many existing topic names the summarization prompt is shown.
 *
 * The vocabulary is GLOBAL, so it grows without bound across every account and
 * cannot all be sent. This is the retrieval budget.
 */
export const KLT_CANDIDATE_CAP = 150

/** Words shorter than this are too common to be evidence of overlap. */
const MIN_OVERLAP_WORD = 4

export interface KltCandidateInput {
  /** normalizedNames already linked to live KLPs in the same set. */
  setLocal: string[]
  existing: { name: string; normalizedName: string; linkCount: number }[]
  /** The batch's KLP texts, for token-overlap retrieval. */
  klpTexts: string[]
}

/**
 * Build the candidate vocabulary shown to the summarizer, in priority order:
 *
 *   1. set-local — a set is usually one subject, so its own topics are the
 *      strongest prior available;
 *   2. token overlap with the batch text — plain string matching, NO
 *      embeddings (spec §4.3); it will not connect "gearing" to "leverage",
 *      which is accepted for v1;
 *   3. globally most-linked, to fill what is left.
 *
 * Truncation happens LAST and in this order, so a popular unrelated topic can
 * never displace a set-local one.
 */
export function assembleCandidates(input: KltCandidateInput): string[] {
  const byNormalized = new Map(input.existing.map((e) => [e.normalizedName, e]))
  const setLocal = new Set(input.setLocal)

  const tokens = new Set<string>()
  for (const text of input.klpTexts) {
    for (const word of normalizeKltName(text).split(' ')) {
      if (word.length >= MIN_OVERLAP_WORD) tokens.add(word)
    }
  }

  const overlaps = (normalizedName: string): boolean =>
    normalizedName
      .split(' ')
      .some((w) => w.length >= MIN_OVERLAP_WORD && tokens.has(w))

  const tiers: string[][] = [[], [], []]
  for (const entry of input.existing) {
    const tier = setLocal.has(entry.normalizedName) ? 0 : overlaps(entry.normalizedName) ? 1 : 2
    tiers[tier].push(entry.normalizedName)
  }

  // Tier 2 is the popularity tail; the other two keep their natural order.
  tiers[2].sort(
    (a, b) => (byNormalized.get(b)?.linkCount ?? 0) - (byNormalized.get(a)?.linkCount ?? 0),
  )

  const seen = new Set<string>()
  const out: string[] = []
  for (const tier of tiers) {
    for (const normalizedName of tier) {
      if (out.length >= KLT_CANDIDATE_CAP) return out
      if (seen.has(normalizedName)) continue
      seen.add(normalizedName)
      const entry = byNormalized.get(normalizedName)
      if (entry) out.push(entry.name)
    }
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/klt/candidates.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/klt/candidates.ts tests/klt/candidates.test.ts
git commit -m "feat(klt): candidate vocabulary assembly with no embeddings"
```

---

## Task 4: The summarization schema and prompt

**Files:**
- Modify: `src/lib/ai/schemas.ts`
- Create: `src/lib/ai/prompts/summarize-klts.ts`
- Modify: `src/lib/ai/prompts/registry.ts`
- Create: `src/lib/cards/klt-batch.ts`
- Test: `tests/klt/prompt.test.ts`

**Interfaces:**
- Consumes: `KLT_CANDIDATE_CAP` (Task 3).
- Produces:
  - `MAX_KLTS_PER_KLP = 3`, `KltSummarySchema`, `type KltSummary` in `src/lib/ai/schemas.ts`
  - `KLT_BATCH_SIZE = 10` in `src/lib/cards/klt-batch.ts`
  - `SUMMARIZE_KLTS_PROMPT = { id: 'summarize-klts', version: 1, schema, build(input) }`
  - `interface SummarizeKltsBuildInput { setTitle: string; klps: { ref: number; text: string; kind: string }[]; candidates: string[] }`

- [ ] **Step 1: Add the schema**

Append to `src/lib/ai/schemas.ts`:

```ts
/**
 * How many topics one KLP may carry. The cap is the containment for spec §9.1:
 * every rank feeds mastery, so an uncapped list would let one failed answer
 * mark an unbounded number of topics weak.
 */
export const MAX_KLTS_PER_KLP = 3;

export const KltSummarySchema = z.object({
  klps: z.array(
    z.object({
      // Index into the batch, never a cuid — the model must never see raw ids.
      ref: z.number().int().min(0),
      /** 3-6 word rendering of the proposition, e.g. "Debt impact on WACC". */
      label: z.string().min(1),
      /**
       * Topic names, most central first. May be EMPTY: a KLP with no good
       * topic is better untopiced than fitted to a wrong one, and it still
       * gets its label.
       */
      topics: z.array(z.string().min(1)).max(MAX_KLTS_PER_KLP),
    }),
  ),
});

export type KltSummary = z.infer<typeof KltSummarySchema>;
```

- [ ] **Step 2: Add the batch size constant**

Create `src/lib/cards/klt-batch.ts`:

```ts
/**
 * Cards per summarization call. Lives here, not in `src/actions/klt.ts`: a
 * `'use server'` module may export only async functions, and exporting a plain
 * constant from one 500s the whole route while `tsc` and vitest stay silent.
 * Mirrors `src/lib/cards/klp-batch.ts`.
 */
export const KLT_BATCH_SIZE = 10
```

- [ ] **Step 3: Write the prompt module**

Create `src/lib/ai/prompts/summarize-klts.ts`:

```ts
import { KltSummarySchema, MAX_KLTS_PER_KLP } from '@/lib/ai/schemas';

export interface SummarizeKltsBuildInput {
  setTitle: string;
  /** `ref` is the KLP's index in this batch. Never pass a cuid. */
  klps: { ref: number; text: string; kind: string }[];
  /** Existing topic names to reuse, in priority order. May be empty. */
  candidates: string[];
}

/**
 * Summarizes KLPs into a short label plus 1-3 general topics (KLTs).
 *
 * Routed via task 'autocomplete' (cheap tier), like KLP extraction — this is
 * structured summarization, not judgment.
 *
 * BOTH grains come from one call because they are the same act of reading the
 * proposition; splitting them doubles cost for no gain.
 */
export const SUMMARIZE_KLTS_PROMPT = {
  id: 'summarize-klts',
  version: 1,
  schema: KltSummarySchema,

  build(input: SummarizeKltsBuildInput): string {
    const klps = input.klps
      .map((k) => `[${k.ref}] (${k.kind}) ${k.text}`)
      .join('\n');

    const vocabulary =
      input.candidates.length > 0
        ? `Existing topics — REUSE one of these whenever it fits:\n${input.candidates.map((c) => `- ${c}`).join('\n')}`
        : 'There are no existing topics yet. Mint new ones.';

    return `You are organising a study library. Each line below is a Key Learning Point (KLP): one specific claim a learner must be able to state.

Study set: ${input.setTitle}

KLPs:
${klps}

For each KLP, produce two things.

1. "label" — a SHORT headline for the point, 3 to 6 words, so it can be read at a glance in a list.
   GOOD: "Debt impact on WACC"
   GOOD: "Add back non-cash charges"
   BAD:  "WACC" (that is a topic, not this specific point)
   BAD:  "Debt is cheaper than equity because interest is tax-deductible" (that is the full proposition again)

2. "topics" — 1 to ${MAX_KLTS_PER_KLP} general subject areas this point belongs to, most central first.
   A topic is a CONCEPT NAME a textbook chapter might carry: "WACC", "bankruptcy", "terminal value", "working capital".
   - At most 4 words. Never a sentence, never a proper noun, never anything specific to one company or one set.
   - Give FEWER topics rather than padding. An empty list is acceptable and is better than a wrong topic.
   - The same concept must always get the same name, so reuse the vocabulary below rather than inventing a synonym.

${vocabulary}

Reference each KLP by its [ref] number. Return one entry per KLP, in the same order.

Output JSON:
{ "klps": [ { "ref": number, "label": string, "topics": string[] } ] }`;
  },
};
```

- [ ] **Step 4: Register it**

In `src/lib/ai/prompts/registry.ts`, add alongside the other exports:

```ts
export { SUMMARIZE_KLTS_PROMPT } from './summarize-klts';
export type { SummarizeKltsBuildInput } from './summarize-klts';
```

add to the import block:

```ts
import { SUMMARIZE_KLTS_PROMPT } from './summarize-klts';
```

and add to `PROMPT_REGISTRY`:

```ts
  [SUMMARIZE_KLTS_PROMPT.id]: SUMMARIZE_KLTS_PROMPT,
```

- [ ] **Step 5: Write the test**

Create `tests/klt/prompt.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { SUMMARIZE_KLTS_PROMPT } from '@/lib/ai/prompts/summarize-klts'
import { PROMPT_REGISTRY } from '@/lib/ai/prompts/registry'
import { KltSummarySchema, MAX_KLTS_PER_KLP } from '@/lib/ai/schemas'

const input = {
  setTitle: 'Valuation',
  klps: [
    { ref: 0, text: 'WACC weights each capital source by market value.', kind: 'mechanism' },
    { ref: 1, text: 'Interest is tax-deductible, lowering the after-tax cost of debt.', kind: 'causal' },
  ],
  candidates: ['WACC', 'Tax Shield'],
}

describe('SUMMARIZE_KLTS_PROMPT', () => {
  it('is in the registry under its id', () => {
    expect(PROMPT_REGISTRY['summarize-klts']).toBe(SUMMARIZE_KLTS_PROMPT)
  })

  it('addresses KLPs by ref and never leaks an id', () => {
    const out = SUMMARIZE_KLTS_PROMPT.build(input)
    expect(out).toContain('[0]')
    expect(out).toContain('[1]')
    expect(out).not.toMatch(/c[a-z0-9]{24}/)
  })

  it('shows the candidate vocabulary and asks for reuse', () => {
    const out = SUMMARIZE_KLTS_PROMPT.build(input)
    expect(out).toContain('- WACC')
    expect(out).toContain('- Tax Shield')
    expect(out).toMatch(/REUSE/)
  })

  it('says so explicitly when there is no vocabulary yet', () => {
    const out = SUMMARIZE_KLTS_PROMPT.build({ ...input, candidates: [] })
    expect(out).toContain('no existing topics yet')
  })

  it('states the topic cap it will be validated against', () => {
    expect(SUMMARIZE_KLTS_PROMPT.build(input)).toContain(`1 to ${MAX_KLTS_PER_KLP}`)
  })

  it('accepts a well-formed reply and an empty topic list', () => {
    const parsed = KltSummarySchema.safeParse({
      klps: [
        { ref: 0, label: 'Market value weighting', topics: ['WACC'] },
        { ref: 1, label: 'Tax shield on debt', topics: [] },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects more topics than the cap', () => {
    const parsed = KltSummarySchema.safeParse({
      klps: [{ ref: 0, label: 'x', topics: ['a', 'b', 'c', 'd'] }],
    })
    expect(parsed.success).toBe(false)
  })
})
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/klt/prompt.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/summarize-klts.ts src/lib/ai/prompts/registry.ts src/lib/cards/klt-batch.ts tests/klt/prompt.test.ts
git commit -m "feat(klt): summarize-klts prompt and structured output schema"
```

---

## Task 5: Resolve model output into a write plan

**Files:**
- Create: `src/lib/klt/resolve.ts`
- Test: `tests/klt/resolve.test.ts`

**Interfaces:**
- Consumes: `parseKltName` (Task 2), `MAX_KLTS_PER_KLP` (Task 4).
- Produces:
  - `interface KltWrite { klpId: string; label: string; topics: { name: string; normalizedName: string; rank: number }[] }`
  - `resolveKltWrites(entries: KltSummary['klps'], klpIds: string[]): KltWrite[]`

This is where every "the model returned junk" rule lives, kept pure so it is testable without a database or an AI call.

- [ ] **Step 1: Write the failing test**

Create `tests/klt/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveKltWrites } from '@/lib/klt/resolve'

const ids = ['klp-a', 'klp-b']

describe('resolveKltWrites', () => {
  it('maps refs to klp ids by position', () => {
    const out = resolveKltWrites(
      [{ ref: 1, label: 'Second point', topics: ['WACC'] }],
      ids,
    )
    expect(out).toEqual([
      {
        klpId: 'klp-b',
        label: 'Second point',
        topics: [{ name: 'WACC', normalizedName: 'wacc', rank: 1 }],
      },
    ])
  })

  it('DROPS a hallucinated ref rather than writing it onto another KLP', () => {
    const out = resolveKltWrites(
      [
        { ref: 7, label: 'Nowhere', topics: ['WACC'] },
        { ref: 0, label: 'Real', topics: [] },
      ],
      ids,
    )
    expect(out.map((w) => w.klpId)).toEqual(['klp-a'])
  })

  it('ranks topics by the order the model gave them', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', topics: ['WACC', 'Tax Shield', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics.map((t) => t.rank)).toEqual([1, 2, 3])
  })

  it('drops an invalid topic and RE-RANKS so ranks stay contiguous from 1', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', topics: ['the weighted average cost of capital', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics).toEqual([
      { name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 1 },
    ])
  })

  it('dedupes topics that normalize to the same key, keeping the best rank', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'x', topics: ['WACC', 'wacc', 'Bankruptcy'] }],
      ids,
    )
    expect(out[0].topics).toEqual([
      { name: 'WACC', normalizedName: 'wacc', rank: 1 },
      { name: 'Bankruptcy', normalizedName: 'bankruptcy', rank: 2 },
    ])
  })

  it('keeps a KLP whose topics were ALL invalid — the label still lands', () => {
    const out = resolveKltWrites(
      [{ ref: 0, label: 'Still useful', topics: ['a sentence that is far too long to be a topic'] }],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'Still useful', topics: [] }])
  })

  it('drops an entry whose label is blank — a blank row would render as empty', () => {
    const out = resolveKltWrites([{ ref: 0, label: '   ', topics: ['WACC'] }], ids)
    expect(out).toEqual([])
  })

  it('keeps only the first entry when the model repeats a ref', () => {
    const out = resolveKltWrites(
      [
        { ref: 0, label: 'First', topics: [] },
        { ref: 0, label: 'Second', topics: [] },
      ],
      ids,
    )
    expect(out).toEqual([{ klpId: 'klp-a', label: 'First', topics: [] }])
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run tests/klt/resolve.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/klt/resolve.ts`:

```ts
import { parseKltName } from '@/lib/klt/normalize'
import type { KltSummary } from '@/lib/ai/schemas'

export interface KltWrite {
  klpId: string
  label: string
  topics: { name: string; normalizedName: string; rank: number }[]
}

/**
 * Turn one summarization reply into the exact rows to write.
 *
 * Every "the model returned junk" rule lives here, and nowhere else, so it can
 * be tested without a database or an AI call. The rules:
 *
 * - A ref outside the batch is DROPPED. Writing it onto whatever KLP happens
 *   to sit at that position would attach one point's topics to another's.
 * - A repeated ref keeps only the first entry.
 * - An invalid topic name is DROPPED and the survivors RE-RANKED, so ranks are
 *   always contiguous from 1. A gap would make rank mean two different things
 *   depending on what the model happened to return.
 * - A KLP whose topics were all invalid still gets its label. The label is
 *   independently useful, and half a result beats none.
 * - A blank label drops the whole entry: it would render as an empty row.
 */
export function resolveKltWrites(
  entries: KltSummary['klps'],
  klpIds: string[],
): KltWrite[] {
  const out: KltWrite[] = []
  const usedRefs = new Set<number>()

  for (const entry of entries) {
    const klpId = klpIds[entry.ref]
    if (klpId === undefined) continue
    if (usedRefs.has(entry.ref)) continue
    usedRefs.add(entry.ref)

    const label = entry.label.trim().replace(/\s+/g, ' ')
    if (label.length === 0) continue

    const seen = new Set<string>()
    const topics: KltWrite['topics'] = []
    for (const raw of entry.topics) {
      const parsed = parseKltName(raw)
      if (parsed === null) continue
      if (seen.has(parsed.normalizedName)) continue
      seen.add(parsed.normalizedName)
      topics.push({ ...parsed, rank: topics.length + 1 })
    }

    out.push({ klpId, label, topics })
  }

  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/klt/resolve.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/klt/resolve.ts tests/klt/resolve.test.ts
git commit -m "feat(klt): pure resolver from model output to write plan"
```

---

## Task 6: The pipeline action

**Files:**
- Create: `src/actions/klt.ts`
- Modify: `src/actions/klp.ts` (narrow the append-only doc comment; reset `kltStatus` in `writeKlpVersion`)
- Test: `tests/actions/klt.test.ts`

**Interfaces:**
- Consumes: `assembleCandidates`, `resolveKltWrites`, `SUMMARIZE_KLTS_PROMPT`, `KLT_BATCH_SIZE`, `KltSummarySchema`.
- Produces:
  - `summarizeKltsForCards(userId: string, cardIds: string[], isOwner?: boolean): Promise<void>` — never throws
  - `retryKltSummarization(cardId: string): Promise<ActionResult<null>>`

- [ ] **Step 1: Write the failing tests**

Create `tests/actions/klt.test.ts`. Mock `@/lib/db`, `@/lib/ai/generate` and `@/auth` in the style of `tests/actions/klp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const generateJson = vi.fn()
const prisma = {
  card: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  cardKlp: { findMany: vi.fn(), update: vi.fn() },
  klt: { findMany: vi.fn(), upsert: vi.fn() },
  klpTopic: { deleteMany: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
}

vi.mock('@/lib/db', () => ({ prisma }))
vi.mock('@/lib/ai/generate', () => ({
  generateJson: (...args: unknown[]) => generateJson(...args),
  AiGenerationError: class extends Error {
    detail: { attempts: unknown[] }
    constructor(detail: { attempts: unknown[] }) {
      super('ai')
      this.detail = detail
    }
  },
}))
vi.mock('@/auth', () => ({ auth: vi.fn(async () => ({ user: { id: 'u1' } })) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const CARD = {
  id: 'card-1',
  set: { title: 'Valuation', userId: 'u1', id: 'set-1' },
  klps: [{ id: 'klp-a', text: 'WACC weights by market value.', kind: 'mechanism' }],
}

beforeEach(() => {
  vi.clearAllMocks()
  prisma.card.findMany.mockResolvedValue([CARD])
  prisma.klt.findMany.mockResolvedValue([])
  prisma.klt.upsert.mockImplementation(async ({ create }: { create: { normalizedName: string } }) => ({
    id: `klt-${create.normalizedName}`,
    ...create,
  }))
  generateJson.mockResolvedValue({
    klps: [{ ref: 0, label: 'Market value weighting', topics: ['WACC'] }],
  })
})

describe('summarizeKltsForCards', () => {
  it('writes the label with an in-place update that touches nothing else', async () => {
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(prisma.cardKlp.update).toHaveBeenCalledWith({
      where: { id: 'klp-a' },
      data: { label: 'Market value weighting' },
    })
  })

  it('NEVER supersedes or deletes a CardKlp row', async () => {
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    const updates = prisma.cardKlp.update.mock.calls.map((c) => c[0].data)
    for (const data of updates) expect(Object.keys(data)).toEqual(['label'])
    expect(prisma.cardKlp.update.mock.calls.every((c) => !('supersededAt' in c[0].data))).toBe(true)
    expect((prisma.cardKlp as Record<string, unknown>).delete).toBeUndefined()
    expect((prisma.cardKlp as Record<string, unknown>).deleteMany).toBeUndefined()
  })

  it('upserts topics on normalizedName so concurrent batches converge', async () => {
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(prisma.klt.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalizedName: 'wacc' } }),
    )
  })

  it('marks the card ready', async () => {
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(prisma.card.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'card-1' },
        data: expect.objectContaining({ kltStatus: 'ready', kltError: null }),
      }),
    )
  })

  it('records skipped — not failed — when the user has no usable credential', async () => {
    const { AiGenerationError } = await import('@/lib/ai/generate')
    generateJson.mockRejectedValue(new (AiGenerationError as never)({ attempts: [] }))
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(prisma.card.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kltStatus: 'skipped' }) }),
    )
  })

  it('records failed on a real provider error', async () => {
    const { AiGenerationError } = await import('@/lib/ai/generate')
    generateJson.mockRejectedValue(new (AiGenerationError as never)({ attempts: [{}] }))
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(prisma.card.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ kltStatus: 'failed' }) }),
    )
  })

  it('NEVER throws — it runs inside after()', async () => {
    generateJson.mockRejectedValue(new Error('boom'))
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await expect(summarizeKltsForCards('u1', ['card-1'])).resolves.toBeUndefined()
  })

  it('does not stamp a status onto a stranger card when the caller is not the owner', async () => {
    generateJson.mockRejectedValue(new Error('boom'))
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'], false)

    expect(prisma.card.updateMany).not.toHaveBeenCalled()
  })

  it('returns without an AI call when the batch has no live KLPs', async () => {
    prisma.card.findMany.mockResolvedValue([{ ...CARD, klps: [] }])
    const { summarizeKltsForCards } = await import('@/actions/klt')
    await summarizeKltsForCards('u1', ['card-1'])

    expect(generateJson).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/actions/klt.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — `Cannot find module '@/actions/klt'`.

- [ ] **Step 3: Write the action**

Create `src/actions/klt.ts`:

```ts
'use server';

import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { SUMMARIZE_KLTS_PROMPT } from '@/lib/ai/prompts/summarize-klts';
import { KltSummarySchema } from '@/lib/ai/schemas';
import { KLT_BATCH_SIZE } from '@/lib/cards/klt-batch';
import { assembleCandidates } from '@/lib/klt/candidates';
import { resolveKltWrites, type KltWrite } from '@/lib/klt/resolve';
import type { CardKlpStatus, CardKlpFailureStatus } from '@/lib/cards/klp-status';
import { readableSetWhere } from '@/lib/sets/visibility';
import type { ActionResult } from '@/types/action';

/** Same rule as KLP extraction: zero attempts means no usable credential. */
function isNoUsableCredential(err: unknown): boolean {
  return err instanceof AiGenerationError && (err.detail.attempts?.length ?? 0) === 0;
}

interface BatchCard {
  id: string;
  set: { id: string; title: string };
  klps: { id: string; text: string; kind: string }[];
}

/**
 * Summarizes each card's live KLPs into a short `label` plus 1-3 topics.
 *
 * OWNER-SCOPED and NEVER THROWS, for the same reasons as
 * `extractKlpsForCards` — it runs inside `after()`, where an exception
 * surfaces as an unhandled rejection long after the response went out.
 *
 * SAFETY (spec §6): this function writes exactly three things — `CardKlp.label`
 * in place, `Klt` rows, and `KlpTopic` rows. It issues no delete and no
 * `supersededAt` write against `CardKlp`, and never touches `KlpState` or
 * `AnswerKlpResult`. Superseding to write a label would mint new `klpId`s and
 * orphan every accumulated BKT posterior — a silent, total mastery reset.
 */
export async function summarizeKltsForCards(
  userId: string,
  cardIds: string[],
  isOwner: boolean = true,
): Promise<void> {
  if (cardIds.length === 0) return;

  let cards: BatchCard[];
  try {
    cards = await prisma.card.findMany({
      where: { id: { in: cardIds }, set: readableSetWhere(userId) },
      select: {
        id: true,
        set: { select: { id: true, title: true } },
        klps: {
          where: { supersededAt: null },
          orderBy: { index: 'asc' },
          select: { id: true, text: true, kind: true },
        },
      },
    });
  } catch (err) {
    if (isOwner) await markKltFailed(cardIds, err, 'failed', userId);
    return;
  }

  const withKlps = cards.filter((c) => c.klps.length > 0);

  for (let i = 0; i < withKlps.length; i += KLT_BATCH_SIZE) {
    const batch = withKlps.slice(i, i + KLT_BATCH_SIZE);
    const succeeded: string[] = [];
    try {
      await summarizeOneBatch(userId, batch, succeeded);
    } catch (err) {
      const failedIds = batch.map((c) => c.id).filter((id) => !succeeded.includes(id));
      if (failedIds.length > 0 && isOwner) {
        await markKltFailed(failedIds, err, isNoUsableCredential(err) ? 'skipped' : 'failed');
      }
    }
  }
}

async function summarizeOneBatch(
  userId: string,
  batch: BatchCard[],
  succeeded: string[],
): Promise<void> {
  // One flat list of KLPs across the batch; `ref` indexes into it.
  const flat = batch.flatMap((card) => card.klps.map((k) => ({ ...k, cardId: card.id })));
  const klpIds = flat.map((k) => k.id);

  const setId = batch[0].set.id;
  const [setLocalRows, existing] = await Promise.all([
    prisma.klt.findMany({
      where: { links: { some: { klp: { card: { setId }, supersededAt: null } } } },
      select: { normalizedName: true },
    }),
    prisma.klt.findMany({
      select: {
        name: true,
        normalizedName: true,
        _count: { select: { links: true } },
      },
    }),
  ]);

  const candidates = assembleCandidates({
    setLocal: setLocalRows.map((r) => r.normalizedName),
    existing: existing.map((e) => ({
      name: e.name,
      normalizedName: e.normalizedName,
      linkCount: e._count.links,
    })),
    klpTexts: flat.map((k) => k.text),
  });

  const result = await generateJson({
    userId,
    task: 'autocomplete',
    prompt: SUMMARIZE_KLTS_PROMPT.build({
      setTitle: batch[0].set.title,
      klps: flat.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
      candidates,
    }),
    schema: KltSummarySchema,
  });

  const writes = resolveKltWrites(result.klps, klpIds);
  const byCard = new Map<string, KltWrite[]>();
  for (const write of writes) {
    const cardId = flat.find((k) => k.id === write.klpId)?.cardId;
    if (cardId === undefined) continue;
    const list = byCard.get(cardId);
    if (list) list.push(write);
    else byCard.set(cardId, [write]);
  }

  // Each card commits independently, so one bad card does not abandon results
  // the AI already returned — and already charged for — for the others.
  for (const card of batch) {
    try {
      await applyKltWrites(card.id, byCard.get(card.id) ?? []);
      succeeded.push(card.id);
    } catch (err) {
      await markKltFailed([card.id], err);
    }
  }
}

/**
 * Commit one card's summary.
 *
 * The `Klt` upserts run BEFORE the transaction on purpose: they are global
 * rows shared with every other user, and holding them inside a per-card
 * transaction would serialize unrelated accounts on the popular topics.
 */
async function applyKltWrites(cardId: string, writes: KltWrite[]): Promise<void> {
  const names = [...new Set(writes.flatMap((w) => w.topics.map((t) => t.normalizedName)))];
  const kltIds = new Map<string, string>();
  for (const normalizedName of names) {
    const topic = writes.flatMap((w) => w.topics).find((t) => t.normalizedName === normalizedName);
    if (!topic) continue;
    // Upsert, never create: `normalizedName` is globally unique and two
    // concurrent batches minting the same topic must converge on one row.
    const row = await prisma.klt.upsert({
      where: { normalizedName },
      create: { name: topic.name, normalizedName },
      update: {},
      select: { id: true },
    });
    kltIds.set(normalizedName, row.id);
  }

  await prisma.$transaction(async (tx) => {
    for (const write of writes) {
      // The ONLY column a writer other than `writeKlpVersion` may touch.
      await tx.cardKlp.update({
        where: { id: write.klpId },
        data: { label: write.label },
      });
      // Replace this KLP's links so a retry is idempotent rather than additive.
      await tx.klpTopic.deleteMany({ where: { klpId: write.klpId } });
      const rows = write.topics
        .map((t) => ({ klpId: write.klpId, kltId: kltIds.get(t.normalizedName), rank: t.rank }))
        .filter((r): r is { klpId: string; kltId: string; rank: number } => r.kltId !== undefined);
      if (rows.length > 0) await tx.klpTopic.createMany({ data: rows });
    }

    await tx.card.update({
      where: { id: cardId },
      data: { kltStatus: 'ready' satisfies CardKlpStatus, kltError: null },
    });
  });
}

async function markKltFailed(
  ids: string[],
  err: unknown,
  status: CardKlpFailureStatus = 'failed',
  userId?: string,
): Promise<void> {
  try {
    await prisma.card.updateMany({
      where: { id: { in: ids }, ...(userId ? { set: { userId } } : {}) },
      data: {
        kltStatus: status,
        kltError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
      },
    });
  } catch {
    // Nothing further this function can do, and it must still not throw.
  }
}

/** Owner-triggered retry from the set builder. */
export async function retryKltSummarization(cardId: string): Promise<ActionResult<null>> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { success: false, error: 'Not signed in' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId } },
    select: { id: true, set: { select: { id: true } } },
  });
  if (!card) return { success: false, error: 'Not found' };

  await summarizeKltsForCards(userId, [cardId]);
  revalidatePath(`/sets/${card.set.id}/edit`);
  return { success: true, data: null };
}
```

- [ ] **Step 4: Reset `kltStatus` when KLPs are rewritten**

In `src/actions/klp.ts`, inside `writeKlpVersion`'s `tx.card.update` data block, add `kltStatus: 'pending'` and `kltError: null` beside the existing `klpStatus` write:

```ts
      await tx.card.update({
        where: { id: cardId },
        data: {
          klpStatus: 'ready' satisfies CardKlpStatus,
          klpVersion: version,
          klpSourceHash: hash,
          klpError: null,
          // A new KLP version has new ids, so its labels and topics do not
          // exist yet. Leaving this 'ready' would serve the PREVIOUS version's
          // topics against propositions the card no longer teaches.
          kltStatus: 'pending' satisfies CardKlpStatus,
          kltError: null,
        },
      });
```

- [ ] **Step 5: Narrow the append-only doc comment** (spec §6.1)

In `src/actions/klp.ts`, replace this paragraph of `writeKlpVersion`'s doc comment:

```
 * THE ONLY MUTATION PATH FOR CardKlp. AI extraction and user edits both come
 * through here, so `CardKlp` stays append-only: historical
 * `QuizQuestion.targetKlpIds` must keep pointing at rows whose text is what
 * the question was actually built from. An in-place `update` anywhere else
 * silently rewrites history.
```

with:

```
 * THE ONLY MUTATION PATH FOR CardKlp'S PROPOSITION. AI extraction and user
 * edits both come through here, so `CardKlp` stays append-only with respect to
 * meaning: historical `QuizQuestion.targetKlpIds` must keep pointing at rows
 * whose text is what the question was actually built from. An in-place
 * `update` to `text`, `weight`, `kind`, `index`, `version`, `sourceHash`,
 * `promptVersion`, `source` or `supersededAt` anywhere else silently rewrites
 * history.
 *
 * ONE EXCEPTION, added with the KLT layer: `label` is a derived display
 * annotation carrying no semantic content, and `src/actions/klt.ts` updates it
 * in place. That cannot rewrite history — the proposition a question was built
 * from is unchanged. It is deliberately NOT routed through here, because
 * superseding a row to attach a label would mint new `klpId`s and orphan every
 * `KlpState` posterior and `AnswerKlpResult` row keyed on the old ones.
```

- [ ] **Step 6: Run the tests**

```bash
npx vitest run tests/actions/klt.test.ts tests/actions/klp.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS — 9 new, and `klp.test.ts` still green.

- [ ] **Step 7: Mutation-test the two safety guards**

This is required, not optional — this project has twice shipped guards that could not fail.

1. In `applyKltWrites`, temporarily change the label update to also write `supersededAt: new Date()`.
2. Run `npx vitest run tests/actions/klt.test.ts --exclude "**/cursor-agents/**"`.
3. **Confirm `NEVER supersedes or deletes a CardKlp row` FAILS.** If it passes, the guard is worthless — fix the test before continuing.
4. Revert the change and confirm green again.

- [ ] **Step 8: Commit**

```bash
git add src/actions/klt.ts src/actions/klp.ts tests/actions/klt.test.ts
git commit -m "feat(klt): summarization pipeline, label-only write surface"
```

---

## Task 7: Trigger the pass and expose a retry

**Files:**
- Modify: `src/actions/sets.ts` (schedule the pass beside KLP extraction)
- Modify: `src/components/sets/KlpEditor.tsx`
- Test: `tests/actions/klt-trigger.test.ts`

**Interfaces:**
- Consumes: `summarizeKltsForCards`, `retryKltSummarization` (Task 6).
- Produces: no new exports.

- [ ] **Step 1: Find the existing `after()` call sites**

```bash
grep -n "extractKlpsForCards" src/actions/sets.ts
```

Every `after(() => extractKlpsForCards(...))` gains a following `summarizeKltsForCards` call, chained so summarization sees the KLPs extraction just wrote:

```ts
after(async () => {
  await extractKlpsForCards(userId, cardIds);
  await summarizeKltsForCards(userId, cardIds);
});
```

Import it at the top of `src/actions/sets.ts`:

```ts
import { summarizeKltsForCards } from '@/actions/klt';
```

- [ ] **Step 2: Write the trigger test**

Create `tests/actions/klt-trigger.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const sets = readFileSync(join(process.cwd(), 'src/actions/sets.ts'), 'utf8')
const klp = readFileSync(join(process.cwd(), 'src/actions/klp.ts'), 'utf8')

describe('KLT trigger wiring', () => {
  it('schedules summarization wherever extraction is scheduled', () => {
    const extractions = (sets.match(/extractKlpsForCards/g) ?? []).length
    const summarizations = (sets.match(/summarizeKltsForCards/g) ?? []).length
    // One import line plus one call per extraction call site.
    expect(summarizations).toBeGreaterThanOrEqual(extractions)
  })

  it('resets kltStatus whenever a new KLP version is written', () => {
    const body = klp.split('async function writeKlpVersion')[1]
    expect(body).toMatch(/kltStatus: 'pending'/)
  })

  it('keeps the narrowed append-only rule documented', () => {
    expect(klp).toContain('ONE EXCEPTION')
    expect(klp).toMatch(/label` is a derived display/)
  })
})
```

- [ ] **Step 3: Add the retry affordance**

In `src/components/sets/KlpEditor.tsx`, import the action and add a second status block. Add to the imports:

```ts
import { retryKltSummarization } from '@/actions/klt'
```

Extend the component's props and state minimally — add `kltStatus` to what `getCardKlps` returns (see Step 4), then render beneath the existing status blocks:

```tsx
          {!busy && status === 'ready' && kltStatus === 'failed' && (
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">Topic summary failed for this card.</p>
              <Button type="button" variant="outline" size="sm" onClick={retryKlt}>
                Retry topics
              </Button>
            </div>
          )}
```

with the handler:

```tsx
  async function retryKlt() {
    setBusy(true)
    const res = await retryKltSummarization(cardId)
    if (!res.success) {
      setBusy(false)
      toast.error(res.error || 'Failed to summarize topics')
      return
    }
    await load()
  }
```

- [ ] **Step 4: Return `kltStatus` and `label` from `getCardKlps`**

In `src/actions/klp.ts`, add `label: true` to the `select` in `getCardKlps`, add `kltStatus` to the card fields it reads, and widen `ReadyKlp`:

```ts
export interface ReadyKlp {
  id: string;
  index: number;
  text: string;
  weight: number;
  kind: string;
  /** Null until the KLT pass has run for this card. */
  label: string | null;
}
```

Then add `label: string | null` and `kltStatus: CardKlpStatus` to the `Klp` interface and component state in `KlpEditor.tsx`, initialising `kltStatus` from the action result.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/actions/klt-trigger.test.ts tests/actions/klp.test.ts --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: tests pass, `tsc` clean.

- [ ] **Step 6: Commit**

```bash
git add src/actions/sets.ts src/actions/klp.ts src/components/sets/KlpEditor.tsx tests/actions/klt-trigger.test.ts
git commit -m "feat(klt): trigger summarization after extraction, add retry"
```

---

## Task 8: The mastery-ranks tuning knob

**Files:**
- Modify: `src/lib/tuning/schema.ts`
- Test: `tests/tuning/mastery-ranks.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MetricThresholds.masteryTopicRanks: number`, `DEFAULT_MASTERY_TOPIC_RANKS = 3`.

- [ ] **Step 1: Write the failing test**

Create `tests/tuning/mastery-ranks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_THRESHOLDS,
  DEFAULT_MASTERY_TOPIC_RANKS,
  ThresholdOverridesSchema,
  parseThresholds,
  resolveThresholds,
} from '@/lib/tuning/schema'
import { MAX_KLTS_PER_KLP } from '@/lib/ai/schemas'

describe('masteryTopicRanks', () => {
  it('defaults to counting every rank', () => {
    expect(DEFAULT_THRESHOLDS.masteryTopicRanks).toBe(DEFAULT_MASTERY_TOPIC_RANKS)
    expect(DEFAULT_MASTERY_TOPIC_RANKS).toBe(MAX_KLTS_PER_KLP)
  })

  it('accepts narrowing to the primary topic only', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 1 }).success).toBe(true)
  })

  it('rejects 0 — no rank counting means no topic could ever report knowledge', () => {
    expect(ThresholdOverridesSchema.safeParse({ masteryTopicRanks: 0 }).success).toBe(false)
  })

  it(`rejects more than ${MAX_KLTS_PER_KLP} — no KLP can carry that many`, () => {
    expect(
      ThresholdOverridesSchema.safeParse({ masteryTopicRanks: MAX_KLTS_PER_KLP + 1 }).success,
    ).toBe(false)
  })

  it('survives a round trip through the stored blob', () => {
    expect(resolveThresholds(parseThresholds({ masteryTopicRanks: 1 })).masteryTopicRanks).toBe(1)
  })

  it('falls back to the default when the stored blob is corrupt', () => {
    expect(resolveThresholds(parseThresholds('nonsense')).masteryTopicRanks).toBe(
      DEFAULT_MASTERY_TOPIC_RANKS,
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/tuning/mastery-ranks.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — `DEFAULT_MASTERY_TOPIC_RANKS` is not exported.

- [ ] **Step 3: Implement**

In `src/lib/tuning/schema.ts`, import the cap and add the knob:

```ts
import { MAX_KLTS_PER_KLP } from '@/lib/ai/schemas'

/**
 * How many of a KLP's ranked topics feed TOPIC MASTERY.
 *
 * 3 (all of them) is the shipped default, chosen by the user: a broad topic
 * accumulates evidence faster, which matters on a thin corpus. The cost is
 * smearing — one failed answer can mark up to three topics weak (spec §9.1).
 * Exposed as a knob rather than a constant so that trade-off is retunable
 * without a migration.
 */
export const DEFAULT_MASTERY_TOPIC_RANKS = MAX_KLTS_PER_KLP
```

Add to the `MetricThresholds` interface:

```ts
  /** How many of a KLP's ranked KLTs count toward topic mastery. */
  masteryTopicRanks: number
```

Add to `DEFAULT_THRESHOLDS`:

```ts
  masteryTopicRanks: DEFAULT_MASTERY_TOPIC_RANKS,
```

Add to `ThresholdOverridesSchema` (before `.strict()`):

```ts
    masteryTopicRanks: z.number().int().min(1).max(MAX_KLTS_PER_KLP).optional(),
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/tuning/ --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: new tests pass, existing tuning tests still pass, `tsc` clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tuning/schema.ts tests/tuning/mastery-ranks.test.ts
git commit -m "feat(klt): masteryTopicRanks tuning knob, defaulting to all ranks"
```

---

## Task 9: KLT-derived topic rows

**Files:**
- Modify: `src/lib/memory/topic-profile.ts`
- Test: `tests/memory/klt-topic-rows.test.ts`

**Interfaces:**
- Consumes: `TopicRow`, `shapeTopicProfile` (existing); `MetricThresholds.masteryTopicRanks` (Task 8).
- Produces: `interface RawKltRow { normalizedName: string; name: string; links: { rank: number; klp: { id: string; supersededAt: Date | null; cardId: string } }[] }` and `kltRowsToTopicRows(rows: RawKltRow[], maxRank: number): TopicRow[]`.

Reuses `shapeTopicProfile` unchanged — a KLT topic and a category topic are the same shape, so knowledge, readiness and verbosity all come for free.

- [ ] **Step 1: Write the failing test**

Create `tests/memory/klt-topic-rows.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { kltRowsToTopicRows } from '@/lib/memory/topic-profile'

const link = (klpId: string, rank: number, supersededAt: Date | null = null) => ({
  rank,
  klp: { id: klpId, supersededAt, cardId: `card-${klpId}` },
})

describe('kltRowsToTopicRows', () => {
  it('splits live from superseded KLPs, as category rows do', () => {
    const [row] = kltRowsToTopicRows(
      [
        {
          normalizedName: 'wacc',
          name: 'WACC',
          links: [link('a', 1), link('b', 1, new Date())],
        },
      ],
      3,
    )
    expect(row.klpIds).toEqual(['a'])
    expect(row.supersededKlpIds).toEqual(['b'])
  })

  it('includes every rank at the default maxRank', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 3)] }],
      3,
    )
    expect(row.klpIds.sort()).toEqual(['a', 'b'])
  })

  it('drops ranks above maxRank when the knob is narrowed', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1), link('b', 2)] }],
      1,
    )
    expect(row.klpIds).toEqual(['a'])
  })

  it('carries cardIds so whole-answer tags can still be attributed', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1)] }],
      3,
    )
    expect(row.cardIds).toEqual(['card-a'])
  })

  it('never emits a topic with no live KLPs at all', () => {
    const rows = kltRowsToTopicRows(
      [{ normalizedName: 'dead', name: 'Dead', links: [link('a', 1, new Date())] }],
      3,
    )
    expect(rows).toEqual([])
  })

  it('has no color — KLTs are AI-derived and carry no user-chosen colour', () => {
    const [row] = kltRowsToTopicRows(
      [{ normalizedName: 'wacc', name: 'WACC', links: [link('a', 1)] }],
      3,
    )
    expect(row.color).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/memory/klt-topic-rows.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — `kltRowsToTopicRows` is not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/memory/topic-profile.ts`:

```ts
/** A `Klt` row as Prisma returns it, with its links and their KLPs joined. */
export interface RawKltRow {
  normalizedName: string
  name: string
  links: { rank: number; klp: { id: string; supersededAt: Date | null; cardId: string } }[]
}

/**
 * Flatten KLT rows into the SAME `TopicRow` shape category rows produce, so
 * `shapeTopicProfile` computes knowledge, readiness and verbosity for both
 * axes with one implementation. A KLT topic and a category topic differ in
 * where they came from, not in how they are scored.
 *
 * `maxRank` is `MetricThresholds.masteryTopicRanks`. Links above it are
 * excluded from MASTERY; callers wanting the full associative graph (browse,
 * "related topics") query `KlpTopic` directly rather than going through here.
 *
 * The live/superseded split is load-bearing and mirrors `toTopicRows`: live
 * KLPs drive knowledge, superseded ones still attribute historical error tags.
 */
export function kltRowsToTopicRows(rows: RawKltRow[], maxRank: number): TopicRow[] {
  const out: TopicRow[] = []
  for (const row of rows) {
    const inRank = row.links.filter((l) => l.rank <= maxRank)
    const klpIds = [...new Set(inRank.filter((l) => l.klp.supersededAt === null).map((l) => l.klp.id))]
    if (klpIds.length === 0) continue
    out.push({
      normalizedName: row.normalizedName,
      displayName: row.name,
      // KLTs are AI-derived; only user-authored categories carry a colour.
      color: null,
      klpIds,
      supersededKlpIds: [
        ...new Set(inRank.filter((l) => l.klp.supersededAt !== null).map((l) => l.klp.id)),
      ],
      cardIds: [...new Set(inRank.map((l) => l.klp.cardId))],
    })
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/memory/ --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: new tests pass, existing memory tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/topic-profile.ts tests/memory/klt-topic-rows.test.ts
git commit -m "feat(klt): derive TopicRows from KLT links, reusing shapeTopicProfile"
```

---

## Task 10: Shape the missed-work panel data

**Files:**
- Create: `src/lib/metrics/missed.ts`
- Test: `tests/metrics/missed.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `interface MissedAnswer { klpId: string; mode: string; status: string; createdAt: Date; errorTypes: string[] }`
  - `interface MissedKlp { klpId: string; label: string | null; text: string; term: string; misses: MissedAnswer[]; pKnown: number | null; observations: number }`
  - `interface MissedTopic { key: string; name: string; knowledge: number | null; klps: MissedKlp[]; missCount: number }`
  - `shapeMissedWork(input: ShapeMissedWorkInput): MissedTopic[]`

- [ ] **Step 1: Write the failing test**

Create `tests/metrics/missed.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { shapeMissedWork, UNTOPICED_KEY } from '@/lib/metrics/missed'

const base = {
  klps: [
    { klpId: 'k1', label: 'Debt impact on WACC', text: 'Long proposition one.', term: 'WACC', topicKeys: ['wacc'] },
    { klpId: 'k2', label: null, text: 'Long proposition two.', term: 'Leases', topicKeys: [] },
  ],
  topicNames: { wacc: 'WACC' },
  knowledge: {
    k1: { pKnown: 0.2, observations: 5 },
    k2: { pKnown: 0.4, observations: 1 },
  },
  results: [
    { klpId: 'k1', status: 'failed', mode: 'quiz-sa', createdAt: new Date('2026-08-20'), errorTypes: ['negated'] },
    { klpId: 'k1', status: 'partial', mode: 'quiz-mc', createdAt: new Date('2026-08-22'), errorTypes: [] },
    { klpId: 'k2', status: 'failed', mode: 'quiz-tf', createdAt: new Date('2026-08-21'), errorTypes: [] },
  ],
  floor: 3,
}

describe('shapeMissedWork', () => {
  it('groups missed KLPs under their topic', () => {
    const out = shapeMissedWork(base)
    const wacc = out.find((t) => t.key === 'wacc')
    expect(wacc?.name).toBe('WACC')
    expect(wacc?.klps.map((k) => k.klpId)).toEqual(['k1'])
  })

  it('puts a KLP with no topic under Uncategorized rather than dropping it', () => {
    const out = shapeMissedWork(base)
    const none = out.find((t) => t.key === UNTOPICED_KEY)
    expect(none?.klps.map((k) => k.klpId)).toEqual(['k2'])
  })

  it('counts partial as a miss — half-right is still not right', () => {
    const out = shapeMissedWork(base)
    expect(out.find((t) => t.key === 'wacc')?.klps[0].misses).toHaveLength(2)
  })

  it('ignores passed results entirely', () => {
    const out = shapeMissedWork({
      ...base,
      results: [{ klpId: 'k1', status: 'passed', mode: 'quiz-sa', createdAt: new Date(), errorTypes: [] }],
    })
    expect(out).toEqual([])
  })

  it('orders misses newest first', () => {
    const out = shapeMissedWork(base)
    const misses = out.find((t) => t.key === 'wacc')!.klps[0].misses
    expect(misses[0].createdAt.getTime()).toBeGreaterThan(misses[1].createdAt.getTime())
  })

  it('reports knowledge as null below the floor — never as a zero', () => {
    const out = shapeMissedWork(base)
    expect(out.find((t) => t.key === UNTOPICED_KEY)?.knowledge).toBeNull()
    expect(out.find((t) => t.key === 'wacc')?.knowledge).toBeCloseTo(0.2)
  })

  it('orders topics by miss count, most missed first', () => {
    const out = shapeMissedWork({
      ...base,
      results: [
        ...base.results,
        { klpId: 'k2', status: 'failed', mode: 'quiz-tf', createdAt: new Date('2026-08-23'), errorTypes: [] },
        { klpId: 'k2', status: 'failed', mode: 'quiz-tf', createdAt: new Date('2026-08-24'), errorTypes: [] },
      ],
    })
    expect(out[0].key).toBe(UNTOPICED_KEY)
  })

  it('lets one KLP appear under every topic it carries', () => {
    const out = shapeMissedWork({
      ...base,
      klps: [{ ...base.klps[0], topicKeys: ['wacc', 'bankruptcy'] }],
      topicNames: { wacc: 'WACC', bankruptcy: 'Bankruptcy' },
      results: base.results.filter((r) => r.klpId === 'k1'),
    })
    expect(out.map((t) => t.key).sort()).toEqual(['bankruptcy', 'wacc'])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/metrics/missed.test.ts --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/metrics/missed.ts`:

```ts
/**
 * Shapes the "What you're getting wrong" panel (spec §8).
 *
 * Leads with AGGREGATE weakness and carries the EPISODIC misses that produced
 * it, because either alone is unusable: an aggregate nobody can check is not
 * trustworthy, and a feed of individual misses cannot tell an unlucky answer
 * from a real gap.
 *
 * Pure. The AI never sees this and never computes any of it.
 */

/** Bucket for KLPs the summarizer gave no topic. */
export const UNTOPICED_KEY = '__untopiced__'

export interface MissedAnswer {
  klpId: string
  mode: string
  status: string
  createdAt: Date
  errorTypes: string[]
}

export interface MissedKlp {
  klpId: string
  /** Null until the KLT pass has run; callers fall back to `text`. */
  label: string | null
  text: string
  term: string
  misses: MissedAnswer[]
  pKnown: number | null
  observations: number
}

export interface MissedTopic {
  key: string
  name: string
  knowledge: number | null
  klps: MissedKlp[]
  missCount: number
}

export interface ShapeMissedWorkInput {
  klps: { klpId: string; label: string | null; text: string; term: string; topicKeys: string[] }[]
  topicNames: Record<string, string>
  knowledge: Record<string, { pKnown: number; observations: number }>
  results: MissedAnswer[]
  /** The learner's own observation floor, never a constant. */
  floor: number
}

/** `partial` counts as a miss: half-right is still not right. */
const MISS_STATUSES = new Set(['failed', 'partial'])

export function shapeMissedWork(input: ShapeMissedWorkInput): MissedTopic[] {
  const missesByKlp = new Map<string, MissedAnswer[]>()
  for (const r of input.results) {
    if (!MISS_STATUSES.has(r.status)) continue
    const list = missesByKlp.get(r.klpId)
    if (list) list.push(r)
    else missesByKlp.set(r.klpId, [r])
  }

  const byTopic = new Map<string, MissedKlp[]>()
  for (const klp of input.klps) {
    const misses = missesByKlp.get(klp.klpId)
    if (!misses || misses.length === 0) continue

    const k = input.knowledge[klp.klpId]
    const shaped: MissedKlp = {
      klpId: klp.klpId,
      label: klp.label,
      text: klp.text,
      term: klp.term,
      misses: [...misses].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      // Below the floor, pKnown is mostly the BKT prior. Reporting it would
      // state a confidence the evidence does not support — the floor's whole
      // purpose. Null renders its own state; it is NEVER shown as a zero.
      pKnown: k && k.observations >= input.floor ? k.pKnown : null,
      observations: k?.observations ?? 0,
    }

    // A KLP carries up to three topics and appears under each — one point can
    // honestly belong to several subjects.
    const keys = klp.topicKeys.length > 0 ? klp.topicKeys : [UNTOPICED_KEY]
    for (const key of keys) {
      const list = byTopic.get(key)
      if (list) list.push(shaped)
      else byTopic.set(key, [shaped])
    }
  }

  const out: MissedTopic[] = []
  for (const [key, klps] of byTopic) {
    const scored = klps.filter((k) => k.pKnown !== null)
    out.push({
      key,
      name: key === UNTOPICED_KEY ? 'Uncategorized' : (input.topicNames[key] ?? key),
      knowledge:
        scored.length === 0
          ? null
          : scored.reduce((sum, k) => sum + (k.pKnown ?? 0), 0) / scored.length,
      klps: klps.sort((a, b) => b.misses.length - a.misses.length),
      missCount: klps.reduce((sum, k) => sum + k.misses.length, 0),
    })
  }

  return out.sort((a, b) => b.missCount - a.missCount)
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/metrics/missed.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/missed.ts tests/metrics/missed.test.ts
git commit -m "feat(klt): pure shaping for the missed-work panel"
```

---

## Task 11: Wire the dashboard read

**Files:**
- Modify: `src/actions/learner-dashboard.ts`
- Modify: `src/lib/metrics/coverage.ts`
- Test: `tests/actions/learner-dashboard-missed.test.ts`

**Interfaces:**
- Consumes: `shapeMissedWork` (Task 10), `kltRowsToTopicRows` (Task 9), `masteryTopicRanks` (Task 8).
- Produces: `LearnerDashboard.missed: MissedTopic[]`, `LearnerDashboard.kltTopics: LearnerTopicProfile[]`, `DashboardCoverage.pendingKltSummarization: number`.

- [ ] **Step 1: Add the coverage counter**

In `src/lib/metrics/coverage.ts`, add to `DashboardCoverage`:

```ts
  /**
   * Cards with live KLPs whose TOPIC summarization has not finished. A fifth
   * cause of a thin panel, and like `pendingExtraction` it means WAIT rather
   * than act.
   */
  pendingKltSummarization: number
```

and add the matching owner-scoped count to `loadCoverage`'s `Promise.all`:

```ts
    prisma.card.count({
      where: { ...owned, ...liveKlps, kltStatus: { in: ['pending', 'failed'] } },
    }),
```

- [ ] **Step 2: Extend the dashboard result**

In `src/actions/learner-dashboard.ts`, add to `LearnerDashboard`:

```ts
  /** Spec §8: what the learner got wrong, grouped by topic. */
  missed: MissedTopic[]
  /** The AI-derived topic axis, shown BESIDE the category axis. */
  kltTopics: LearnerTopicProfile[]
```

Load the KLT rows scoped to the user's readable cards, run them through `kltRowsToTopicRows(rows, thresholds.masteryTopicRanks)` then `shapeTopicProfile`, and build `missed` from the same `AnswerKlpResult` rows the dashboard already reads. Follow the existing scope handling exactly — every query filters by `userId`.

- [ ] **Step 3: Write the test**

Create `tests/actions/learner-dashboard-missed.test.ts`, mocking `@/lib/db` and `@/auth` in the style of `tests/actions/learner-dashboard.test.ts`. Assert:

```ts
  it('returns missed topics alongside the existing metrics', async () => {
    const res = await getLearnerDashboard(null)
    expect(res.success).toBe(true)
    if (res.success) {
      expect(Array.isArray(res.data.missed)).toBe(true)
      expect(Array.isArray(res.data.kltTopics)).toBe(true)
      // The category axis is UNTOUCHED — spec decision 3.
      expect(res.data.metrics.topics).toBeDefined()
    }
  })

  it('scopes every KLT read to the signed-in user', async () => {
    await getLearnerDashboard(null)
    for (const call of prisma.klt.findMany.mock.calls) {
      expect(JSON.stringify(call[0])).toContain('u1')
    }
  })

  it('counts cards awaiting topic summarization separately from extraction', async () => {
    const res = await getLearnerDashboard(null)
    if (res.success) {
      expect(res.data.coverage).toHaveProperty('pendingKltSummarization')
      expect(res.data.coverage).toHaveProperty('pendingExtraction')
    }
  })
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run tests/actions/ tests/metrics/coverage.test.ts --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: pass; `scripts/tuning-check.ts` also consumes `DashboardCoverage`, so fix it if `tsc` flags it.

- [ ] **Step 5: Commit**

```bash
git add src/actions/learner-dashboard.ts src/lib/metrics/coverage.ts tests/actions/learner-dashboard-missed.test.ts
git commit -m "feat(klt): expose missed work and the KLT topic axis on the dashboard"
```

---

## Task 12: The panel

**Files:**
- Create: `src/components/learner/MissedWork.tsx`
- Modify: `src/app/profile/learner/page.tsx`
- Test: `tests/components/missed-work.test.tsx`

**Interfaces:**
- Consumes: `MissedTopic` (Task 10).
- Produces: `export default function MissedWork({ topics, floor }: { topics: MissedTopic[]; floor: number })`.

- [ ] **Step 1: Write the failing test**

Create `tests/components/missed-work.test.tsx` — note the environment pragma **must** be the literal first line, and RTL cleanup is not automatic here:

```tsx
// @vitest-environment jsdom
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import MissedWork from '@/components/learner/MissedWork'
import type { MissedTopic } from '@/lib/metrics/missed'

afterEach(cleanup)

const topics: MissedTopic[] = [
  {
    key: 'wacc',
    name: 'WACC',
    knowledge: 0.2,
    missCount: 2,
    klps: [
      {
        klpId: 'k1',
        label: 'Debt impact on WACC',
        text: 'Lease debt is added back when moving from Equity Value to Enterprise Value.',
        term: 'WACC',
        pKnown: 0.2,
        observations: 5,
        misses: [
          { klpId: 'k1', status: 'failed', mode: 'quiz-sa', createdAt: new Date('2026-08-22'), errorTypes: ['negated'] },
        ],
      },
    ],
  },
]

describe('MissedWork', () => {
  it('leads with the short label, not the full proposition', () => {
    render(<MissedWork topics={topics} floor={3} />)
    expect(screen.getByText('Debt impact on WACC')).toBeTruthy()
    expect(screen.queryByText(/Lease debt is added back/)).toBeNull()
  })

  it('falls back to the proposition when there is no label yet', () => {
    const noLabel = [{ ...topics[0], klps: [{ ...topics[0].klps[0], label: null }] }]
    render(<MissedWork topics={noLabel} floor={3} />)
    expect(screen.getByText(/Lease debt is added back/)).toBeTruthy()
  })

  it('reveals the full proposition and the misses on expand', () => {
    render(<MissedWork topics={topics} floor={3} />)
    fireEvent.click(screen.getByRole('button', { name: /Debt impact on WACC/i }))
    expect(screen.getByText(/Lease debt is added back/)).toBeTruthy()
  })

  it('renders an unmeasured topic as its own state, never as 0%', () => {
    render(<MissedWork topics={[{ ...topics[0], knowledge: null }]} floor={3} />)
    expect(screen.getByText(/not measured/i)).toBeTruthy()
    expect(screen.queryByText('0%')).toBeNull()
  })

  it('says nothing is wrong rather than rendering an empty box', () => {
    render(<MissedWork topics={[]} floor={3} />)
    expect(screen.getByText(/nothing.*wrong/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run tests/components/missed-work.test.tsx --exclude "**/cursor-agents/**"
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the panel**

Create `src/components/learner/MissedWork.tsx`, following `TopicMastery.tsx`'s conventions (`Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent`, `text-muted-foreground`, `tabular-nums`). Requirements:

- One collapsible row per topic, ordered as received (`shapeMissedWork` already sorted them).
- Each KLP row shows `label ?? text`, its miss count, and — only when `pKnown !== null` — the percentage.
- A `null` knowledge value renders the literal words "not measured", never `0%`.
- Expanding a KLP reveals the full `text`, the card `term`, and each miss (mode, date, error types).
- Empty `topics` renders a sentence saying nothing has been missed, not a bare heading.
- The expand control is a real `<button>` so the test can find it by role and so it is keyboard-reachable.

- [ ] **Step 4: Mount it on the page**

In `src/app/profile/learner/page.tsx`, import the panel and render it **above** `TopicMastery`, passing `data.value.missed` and `data.value.thresholds.minObservations`. Do not modify `TopicMastery`, `StudyNext` or `RetentionPanel`.

- [ ] **Step 5: Run the tests**

```bash
npx vitest run tests/components/ --exclude "**/cursor-agents/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
```
Expected: new tests pass, existing component tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/components/learner/MissedWork.tsx src/app/profile/learner/page.tsx tests/components/missed-work.test.tsx
git commit -m "feat(klt): What you're getting wrong panel on /profile/learner"
```

---

## Task 13: Backfill script

**Files:**
- Create: `scripts/backfill-klts.ts`
- Modify: `package.json` (add the `backfill:klts` script)
- Test: `tests/klt/backfill-idempotent.test.ts`

**Interfaces:**
- Consumes: `summarizeKltsForCards` (Task 6).
- Produces: `npm run backfill:klts`.

- [ ] **Step 1: Write the script**

Create `scripts/backfill-klts.ts` — it must live in `scripts/` for module resolution and needs a `main()` wrapper because top-level await breaks under the CJS output:

```ts
import { prisma } from '../src/lib/db'
import { summarizeKltsForCards } from '../src/actions/klt'
import { KLT_BATCH_SIZE } from '../src/lib/cards/klt-batch'

/**
 * One-time backfill for cards whose KLPs predate the KLT layer.
 *
 * Idempotent and resumable: it selects only cards that are NOT already
 * `kltStatus: 'ready'`, so a re-run after an interruption picks up where it
 * stopped, and `applyKltWrites` replaces a KLP's links rather than adding to
 * them. Safe to run repeatedly.
 */
async function main() {
  const owners = await prisma.user.findMany({ select: { id: true } })
  let done = 0

  for (const owner of owners) {
    const cards = await prisma.card.findMany({
      where: {
        set: { userId: owner.id },
        klps: { some: { supersededAt: null } },
        kltStatus: { not: 'ready' },
      },
      select: { id: true },
    })

    for (let i = 0; i < cards.length; i += KLT_BATCH_SIZE) {
      const batch = cards.slice(i, i + KLT_BATCH_SIZE).map((c) => c.id)
      await summarizeKltsForCards(owner.id, batch)
      done += batch.length
      console.log(`[backfill:klts] ${owner.id}: ${done} cards processed`)
    }
  }

  const topics = await prisma.klt.count()
  const links = await prisma.klpTopic.count()
  console.log(`[backfill:klts] done — ${done} cards, ${topics} topics, ${links} links`)
}

main()
  .catch((err) => {
    console.error('[backfill:klts] failed', err)
    process.exitCode = 1
  })
  .finally(() => process.exit(0))
```

- [ ] **Step 2: Register the npm script**

In `package.json`, beside the other backfills:

```json
    "backfill:klts": "tsx --env-file=.env scripts/backfill-klts.ts",
```

- [ ] **Step 3: Write the idempotency test**

Create `tests/klt/backfill-idempotent.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const script = readFileSync(join(process.cwd(), 'scripts/backfill-klts.ts'), 'utf8')

describe('backfill-klts', () => {
  it('skips cards already summarized, so a re-run resumes rather than redoes', () => {
    expect(script).toMatch(/kltStatus:\s*\{\s*not:\s*'ready'\s*\}/)
  })

  it('only touches cards that actually have live KLPs', () => {
    expect(script).toMatch(/supersededAt:\s*null/)
  })

  it('scopes every card read to one owner', () => {
    expect(script).toMatch(/set:\s*\{\s*userId:\s*owner\.id\s*\}/)
  })

  it('wraps its body in main() — top-level await breaks under CJS output', () => {
    expect(script).toMatch(/async function main\(\)/)
    expect(script).not.toMatch(/^await /m)
  })
})
```

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/klt/backfill-idempotent.test.ts --exclude "**/cursor-agents/**"
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/backfill-klts.ts package.json tests/klt/backfill-idempotent.test.ts
git commit -m "feat(klt): idempotent backfill script for pre-KLT cards"
```

---

## Task 14: Full verification and live gate

**Files:** none — this task only verifies.

- [ ] **Step 1: Full suite, typecheck, build, lint**

```bash
npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
npm run build
npm run lint 2>&1 | tail -5
```

Expected: **1655 + new tests passing, zero failures**; `tsc` clean; build clean; lint at **175 problems or fewer**. A rise means this work introduced it — fix it, do not rebaseline.

- [ ] **Step 2: Re-verify zero schema drift**

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```
Expected: `-- This is an empty migration.`

- [ ] **Step 3: Run the backfill against the dev database**

```bash
npm run backfill:klts
```

Expected: it processes ~69 cards and reports a non-zero topic and link count. **Predict the numbers before reading the output** — a topic count near 69 means the reconciler is minting one topic per card and not converging, which is the §9.4 failure mode showing up immediately.

- [ ] **Step 4: Inspect the resulting vocabulary by hand**

Write a temporary script in `scripts/` that prints every `Klt` with its link count, run it, then delete it. Check for the fragmentation this design exists to prevent: near-duplicates ("WACC" and "cost of capital"), sentence-shaped names that slipped the cap, and topics that are obviously format labels rather than concepts. Record what you find — this is the only quality signal the vocabulary has.

- [ ] **Step 5: Live gate against the real app**

Trap 6 is closed — run this yourself, do not hand it to the human:

```bash
NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
npm run seed:dev-user
```

Sign in at `/login` as `dev_user`, then verify:

1. `/profile/learner` renders the new panel above Topic mastery, and the three existing panels are unchanged.
2. Rows read as short labels, not 16-word propositions.
3. Expanding a row reveals the full proposition and the recent misses.
4. A topic below the observation floor says "not measured" and never `0%`.
5. Editing a card in the set builder flips its topics to pending and they repopulate.
6. **The mastery guard, end to end:** note a KLP's `pKnown` and `observations`, run `npm run backfill:klts` again, and confirm both are unchanged. This is §6's claim tested against the real database rather than a mock.

Stop the dev server with `taskkill /PID <pid> /F` (Windows — `pkill` does not work).

- [ ] **Step 6: Update the queue and commit**

Mark item 9 built in `docs/superpowers/BUILD-QUEUE.md`, record the new baselines, and note what Step 4 found about vocabulary quality.

```bash
git add docs/superpowers/BUILD-QUEUE.md
git commit -m "docs: item 9 built — KLT topic layer, new baselines"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
| --- | --- |
| §3 schema | 1 |
| §4.1 trigger, batching, `isOwner`, never-throws | 6, 7 |
| §4.2 one call, both grains, refs not cuids | 4, 5 |
| §4.3 candidate assembly, no embeddings | 3 |
| §4.4 mint constraints, upsert dedup, no fabrication | 2, 5, 6 |
| §4.5 failure statuses, retry, backfill | 6, 7, 13 |
| §5 versioning, superseded links kept | 6 (Step 4), 9 |
| §6 mastery safety + §6.1 invariant narrowing | 6 (Steps 3, 5, 7) |
| §7 testing incl. mutation-tested guards | every task; 6 Step 7; 14 Step 5.6 |
| §8 the panel, `diagnoseEmptyState` reuse, null-never-zero | 10, 11, 12 |
| §9.1 mitigation (the knob) | 8 |
| Decision 3 (categories untouched) | 11 Step 3, 12 Step 4 |

**Placeholder scan:** no TBDs; every code step carries real code; the two `// ... existing fields unchanged ...` markers are Prisma elisions with the surrounding edit described in prose.

**Type consistency:** `KltWrite` (Task 5) is consumed by name in Task 6. `TopicRow` (existing) is produced by `kltRowsToTopicRows` (Task 9) and consumed by `shapeTopicProfile` unchanged. `MissedTopic` (Task 10) flows to Task 11's `LearnerDashboard` and Task 12's props. `MAX_KLTS_PER_KLP` (Task 4) bounds both `KltSummarySchema` and `masteryTopicRanks` (Task 8). `CardKlpStatus` is reused for `kltStatus` rather than a parallel vocabulary.

**Known plan-level risk:** Task 11 is the least specified, because `learner-dashboard.ts`'s existing scope handling must be followed rather than replaced and its exact query shape is best read at implementation time. If it grows past ~80 lines of new code, split the KLT read into `src/lib/metrics/klt-read.ts` rather than letting the action sprawl.
