# Stage 8 Spec 1 — KLPs & Question Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every card 1-5 versioned Key Learning Points, and generate multiple-choice distractors and true/false statements by corrupting a *named* KLP so a wrong answer records what the learner actually got wrong.

**Architecture:** A new `CardKlp` table holds versioned, testable propositions per card, extracted by one batched AI call fired post-response via `after()` and self-healing through `Card.klpStatus`. A new `QuizQuestion` row freezes each asked MC/TF question with its KLP provenance — which is also what makes true/false answerable server-side, fixing a mode that currently always answers "true". Task 1 first repairs `updateSet`, which today deletes and recreates every card on save and cascades away the set's entire learning history.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (Postgres/Neon), Vercel AI SDK v7, Zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-01-klp-question-generation-design.md`
**Frozen reference:** `docs/ai/error-taxonomy.md`

## Global Constraints

- Test runner is **Vitest**: `npm test` (single run), `npm run test:watch`. Config: `vitest.config.ts`, `environment: 'node'`, alias `@` → `./src`.
- Tests live in `tests/<area>/<name>.test.ts`, mirroring `src/`.
- Server actions are tested by mocking `@/auth`, `@/lib/db`, and `next/cache` with `vi.hoisted()` + `vi.mock()`. Canonical pattern: `tests/actions/ai-credentials.test.ts`.
- **Pure logic goes in `src/lib/`, never in an action.** Standing repo convention.
- **The model must never see a raw cuid.** Prompts reference cards and KLPs by batch index; the action maps indices back to ids. Precedent: `src/lib/memory/profile.ts` header.
- Every `generateJson` call passes a Zod `schema`. Validate before persisting.
- Prompts live under `src/lib/ai/prompts/` shaped `{ id, version, schema, build }` and are registered in `src/lib/ai/prompts/registry.ts`.
- `AI_TASKS` are exactly `'grade' | 'plan' | 'distractors' | 'autocomplete'` (`src/lib/ai/model-routing.ts`). KLP extraction routes via **`'autocomplete'`**. Do not invent a new task.
- **`generateObject` does not exist in AI SDK v7.** Structured output is `generateText({ model, output: Output.object({ schema }) })` — already wrapped by `generateJson`.
- Commit after every task. Never commit `.env`.

---

## File Structure

**Created:**
- `src/lib/cards/reconcile.ts` — pure card-identity reconciliation (Task 1)
- `src/lib/cards/klp-hash.ts` — stable `sourceHash` over a card's content (Task 3)
- `src/lib/ai/prompts/extract-klps.ts` — KLP extraction prompt (Task 4)
- `src/actions/klp.ts` — extraction + `ensureKlpsReady` (Task 5)
- `src/lib/quiz/options.ts` — v1/v2 option-cache union parse + provenance lookup (Task 7)
- `src/lib/quiz/coin-flip.ts` — injectable-RNG TF variant choice (Task 10)
- `src/lib/ai/prompts/true-false.ts` — TF corrupted-statement prompt (Task 10)
- `src/components/sets/KlpEditor.tsx` — view/edit KLPs in the set builder (Task 13)
- `tests/cards/reconcile.test.ts`, `tests/cards/klp-hash.test.ts`, `tests/quiz/options.test.ts`, `tests/quiz/coin-flip.test.ts`, `tests/actions/klp.test.ts`

**Modified:**
- `prisma/schema.prisma` — `CardKlp`, `QuizQuestion`, `Card` KLP columns (Task 2)
- `src/actions/sets.ts` — reconcile in `updateSet`, `after()` extraction (Tasks 1, 6)
- `src/components/sets/SetForm.tsx`, `src/app/sets/[id]/edit/page.tsx` — round-trip card ids (Task 1)
- `src/lib/ai/schemas.ts` — KLP + v2 option schemas (Tasks 4, 8)
- `src/lib/ai/prompts/multiple-choice.ts` — v2, KLP-driven (Task 8)
- `src/lib/ai/prompts/registry.ts` — register both new prompts (Tasks 4, 10)
- `src/actions/quiz.ts` — v2 cache + `QuizQuestion` writes; TF grading fix (Tasks 9, 10, 11)
- `src/components/quiz/TrueFalseQuiz.tsx` — render server-supplied statement (Task 12)
- `tests/ai/prompts.test.ts` — extend for both new prompts

**Deviation from the spec:** §4 lists a pure `selectKlpsForQuestion(klps, n, rng)`
for weight-biased KLP targeting. It is **not** built. Every live KLP is sent to
the model, which names the one it corrupts per distractor (`klpRef`) — so
nothing selects a subset in code, and a weighted picker would be dead. If a
later spec needs to cap KLPs per prompt for token reasons, add it then.

---

### Task 1: Stop destroying card identity on every set edit

**Files:**
- Create: `src/lib/cards/reconcile.ts`
- Test: `tests/cards/reconcile.test.ts`
- Modify: `src/actions/sets.ts` (`CardInputSchema` ~line 13, `updateSet` ~line 222)
- Modify: `src/components/sets/SetForm.tsx`, `src/app/sets/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: nothing
- Produces: `reconcileCards<T extends { id?: string }>(existingIds: string[], input: T[]): { toUpdate: { id: string; card: T }[]; toCreate: T[]; toDeleteIds: string[] }`

**Why this is Task 1:** `updateSet` runs `prisma.card.deleteMany({ where: { setId: id } })` and recreates every card. `CardProgress`, `StudyEvent`, `ConfidenceEvent`, `QuizAnswer`, and `QuizOptionCache` all cascade on `cardId`, so fixing a typo in one card erases the whole set's learning history. Every later task in this plan assumes a stable `cardId`.

- [ ] **Step 1: Write the failing test**

Create `tests/cards/reconcile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { reconcileCards } from '@/lib/cards/reconcile'

const card = (id: string | undefined, term: string) => ({ id, term })

describe('reconcileCards', () => {
  it('updates cards whose id already belongs to the set', () => {
    const plan = reconcileCards(['a', 'b'], [card('a', 'WACC'), card('b', 'CAPM')])
    expect(plan.toUpdate).toEqual([
      { id: 'a', card: card('a', 'WACC') },
      { id: 'b', card: card('b', 'CAPM') },
    ])
    expect(plan.toCreate).toEqual([])
    expect(plan.toDeleteIds).toEqual([])
  })

  it('creates cards that arrive with no id', () => {
    const plan = reconcileCards(['a'], [card('a', 'WACC'), card(undefined, 'Beta')])
    expect(plan.toCreate).toEqual([card(undefined, 'Beta')])
    expect(plan.toUpdate).toHaveLength(1)
  })

  it('deletes cards the payload no longer mentions', () => {
    const plan = reconcileCards(['a', 'b', 'c'], [card('a', 'WACC')])
    expect(plan.toDeleteIds).toEqual(['b', 'c'])
  })

  it('does NOT adopt a card id belonging to another set', () => {
    // A foreign id must never be honoured: honouring it would let a caller
    // graft another user's card into their own set. It is created fresh
    // instead, which is both safe and forgiving of a stale editor tab.
    const plan = reconcileCards(['a'], [card('someone-elses-card', 'WACC')])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toCreate).toEqual([card('someone-elses-card', 'WACC')])
    expect(plan.toDeleteIds).toEqual(['a'])
  })

  it('ignores a duplicated id rather than updating the same row twice', () => {
    const plan = reconcileCards(['a'], [card('a', 'first'), card('a', 'second')])
    expect(plan.toUpdate).toEqual([{ id: 'a', card: card('a', 'first') }])
    expect(plan.toCreate).toEqual([card('a', 'second')])
  })

  it('treats an empty existing set as all-creates', () => {
    const plan = reconcileCards([], [card(undefined, 'Beta')])
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toDeleteIds).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cards/reconcile.test.ts`
Expected: FAIL — cannot resolve `@/lib/cards/reconcile`.

- [ ] **Step 3: Implement the pure reconciler**

Create `src/lib/cards/reconcile.ts`:

```ts
/**
 * Decides, for one set save, which cards are updates, which are new, and which
 * were removed.
 *
 * Before this existed, `updateSet` deleted every card and recreated it, which
 * cascaded away CardProgress, StudyEvent, ConfidenceEvent, QuizAnswer and
 * QuizOptionCache — the set's entire learning history — on any edit.
 *
 * An id the set does not already own is never adopted: honouring it would let
 * a caller graft another user's card into their own set. Such a card is
 * created fresh, which is also what a stale editor tab needs.
 */
export interface CardReconcilePlan<T> {
  toUpdate: { id: string; card: T }[]
  toCreate: T[]
  toDeleteIds: string[]
}

export function reconcileCards<T extends { id?: string }>(
  existingIds: string[],
  input: T[],
): CardReconcilePlan<T> {
  const owned = new Set(existingIds)
  const claimed = new Set<string>()

  const toUpdate: { id: string; card: T }[] = []
  const toCreate: T[] = []

  for (const card of input) {
    const id = card.id
    if (id && owned.has(id) && !claimed.has(id)) {
      claimed.add(id)
      toUpdate.push({ id, card })
    } else {
      toCreate.push(card)
    }
  }

  return {
    toUpdate,
    toCreate,
    toDeleteIds: existingIds.filter((id) => !claimed.has(id)),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cards/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: Accept an optional card id in the action schema**

In `src/actions/sets.ts`, change `CardInputSchema` (line 13):

```ts
const CardInputSchema = z.object({
  // Present when the editor is round-tripping an existing card. Absent for
  // newly added cards. Ownership is re-checked server-side in updateSet.
  id: z.string().optional(),
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  termBlocks: z.array(z.any()).optional(),
  definitionBlocks: z.array(z.any()).optional(),
  categoryNames: z.array(z.string().min(1).max(60)).optional(),
  position: z.number().int().min(0),
})
```

- [ ] **Step 6: Add a `buildCardUpdate` helper beside `buildCardCreate`**

In `src/actions/sets.ts`, after `buildCardCreate` (line 67), add:

```ts
/**
 * Update payload for an existing card. Content blocks and category
 * assignments are replaced wholesale (they have no independent identity worth
 * preserving), but the CARD ROW SURVIVES — which is the entire point: its id
 * is what CardProgress, StudyEvent and QuizAnswer hang off.
 */
function buildCardUpdate(
  card: z.infer<typeof CardInputSchema>,
  categoryIdByNormalized: Record<string, string>,
) {
  const categoryIds = Array.from(
    new Set(
      (card.categoryNames ?? [])
        .map((n) => categoryIdByNormalized[normalizeCategoryName(n)])
        .filter((id): id is string => Boolean(id)),
    ),
  )
  return {
    term: card.term,
    definition: card.definition,
    position: card.position,
    contentBlocks: { deleteMany: {}, create: buildContentBlockCreate(card) },
    categoryAssignments: {
      deleteMany: {},
      create: categoryIds.map((categoryId) => ({ categoryId })),
    },
  }
}
```

- [ ] **Step 7: Replace the delete-and-recreate block in `updateSet`**

In `src/actions/sets.ts`, add the import at the top:

```ts
import { reconcileCards } from '@/lib/cards/reconcile'
```

Replace the second `$transaction` in `updateSet` (lines 222-231) with:

```ts
    // Cards are reconciled by identity, never replaced. Deleting and
    // recreating them cascades away CardProgress, StudyEvent,
    // ConfidenceEvent, QuizAnswer and QuizOptionCache — i.e. the set's whole
    // learning history — which is exactly what used to happen on every save.
    // Named `existingCards`, not `existing` — `updateSet` already has a local
    // `existing` holding the Set row (line 196).
    const existingCards = await prisma.card.findMany({
      where: { setId: id },
      select: { id: true },
    })
    const plan = reconcileCards(
      existingCards.map((c) => c.id),
      validated.cards,
    )

    await prisma.$transaction([
      ...(plan.toDeleteIds.length > 0
        ? [prisma.card.deleteMany({ where: { setId: id, id: { in: plan.toDeleteIds } } })]
        : []),
      ...plan.toUpdate.map(({ id: cardId, card }) =>
        prisma.card.update({ where: { id: cardId }, data: buildCardUpdate(card, map) }),
      ),
      ...plan.toCreate.map((card) =>
        prisma.card.create({ data: { setId: id, ...buildCardCreate(card, map) } }),
      ),
      prisma.set.update({
        where: { id },
        data: { title: validated.title, description: validated.description },
      }),
    ])
```

Note: `existing` shadows nothing — the set lookup earlier in `updateSet` is also named `existing` (line 196). **Rename the card query to `existingCards`** and use that below.

- [ ] **Step 8: Round-trip card ids through the editor**

In `src/app/sets/[id]/edit/page.tsx`, add `id` to the mapped cards (line 50):

```tsx
        initialCards={set.cards.map((c) => ({
          id: c.id,
          term: c.term,
          definition: c.definition,
          position: c.position,
          contentBlocks: c.contentBlocks,
          categoryNames: c.categoryAssignments.map((a) => a.category.name),
        }))}
```

In `src/components/sets/SetForm.tsx`:

Add `id` to `InitialCard` (line 29):

```ts
interface InitialCard {
  id?: string
  term: string
  definition: string
  position: number
  contentBlocks?: InitialContentBlock[]
  categoryNames?: string[]
}
```

Carry it through `cardToEditorBlocks` (line 72):

```ts
  return {
    id: card.id,
    term: forSide('term', card.term),
    definition: forSide('definition', card.definition),
    categoryNames: card.categoryNames ?? [],
    position: card.position,
  }
```

Give newly added cards an explicit `undefined` id in `addCard` (line 110) so the array element type stays uniform:

```ts
    setCards([...cards, {
      id: undefined as string | undefined,
      term: [{ type: 'text', text: '', position: 0 }],
      definition: [{ type: 'text', text: '', position: 0 }],
      categoryNames: [],
      position: cards.length
    }])
```

And send it in `handleSubmit` (line 211):

```ts
        const cardsForApi = cards.map(c => ({
          id: c.id,
          term: contentBlocksToPlainText(c.term),
          definition: contentBlocksToPlainText(c.definition),
          termBlocks: c.term,
          definitionBlocks: c.definition,
          categoryNames: c.categoryNames,
          position: c.position
        }))
```

- [ ] **Step 9: Verify the whole suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Manually verify history survives an edit**

Start the app, open a set you have review history on, note a card's confidence,
edit an unrelated card's text, save, and confirm the confidence is unchanged.
Before this task that value reset to the 5 default.

- [ ] **Step 11: Commit**

```bash
git add src/lib/cards/reconcile.ts tests/cards/reconcile.test.ts src/actions/sets.ts src/components/sets/SetForm.tsx "src/app/sets/[id]/edit/page.tsx"
git commit -m "fix(sets): reconcile cards by identity so editing a set no longer erases its history"
```

---

### Task 2: Schema — `CardKlp`, `QuizQuestion`, and `Card` KLP columns

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_card_klps/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: Prisma models `CardKlp`, `QuizQuestion`; `Card.klpStatus`, `Card.klpVersion`, `Card.klpSourceHash`, `Card.klpError`

- [ ] **Step 1: Add the `CardKlp` model**

Add to `prisma/schema.prisma` after the `Card` model (line 68):

```prisma
/// Stage 8: the testable propositions a card teaches. Distractor generation,
/// error targeting, and the KLP mastery graph all key off these.
///
/// VERSIONED, never overwritten. Editing a card's text extracts version n+1
/// and stamps version n with `supersededAt`. Historical error tags keep
/// pointing at the version that was actually asked, so a July session summary
/// renders July's KLPs. Live reads filter `supersededAt: null`.
model CardKlp {
  id            String    @id @default(cuid())
  cardId        String
  version       Int
  index         Int
  text          String    @db.Text
  weight        Int       // 1-5 centrality -> significance.relevance
  kind          String    // definition|mechanism|causal|condition|quantitative|contrast|example
  sourceHash    String
  promptVersion Int
  source        String    @default("ai") // ai | user
  supersededAt  DateTime?
  createdAt     DateTime  @default(now())
  card          Card      @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([cardId, version, index])
  @@index([cardId, supersededAt])
}
```

- [ ] **Step 2: Add the `QuizQuestion` model**

Add after `QuizAnswer` (line 366):

```prisma
/// Stage 8: one asked question, frozen at the moment it was asked.
///
/// Exists for two reasons. (1) True/false is otherwise unanswerable
/// server-side: the client used to render the definition and the action
/// hardcoded `correctAnswer: 'true'`, so there was nowhere to record "this
/// statement is the corrupted variant". (2) It anchors MC distractor
/// provenance, which is what lets a wrong pick diagnose itself with no
/// grading call.
model QuizQuestion {
  id           String      @id @default(cuid())
  attemptId    String
  cardId       String
  mode         String      // multiple-choice | true-false
  statement    String?     @db.Text // TF: the (possibly corrupted) statement shown
  isTrue       Boolean?    // TF answer key. NEVER serialized to the client
  options      Json?       // MC: [{text, correct, sourceKlpId?, corruption?}]
  targetKlpIds Json
  klpVersion   Int
  createdAt    DateTime    @default(now())
  attempt      QuizAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  card         Card        @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([attemptId, cardId, mode])
  @@index([attemptId])
}
```

- [ ] **Step 3: Add the columns and relation fields**

In `model Card`, add before `@@index([setId])`:

```prisma
  klpStatus           String                   @default("pending") // pending|ready|failed|skipped
  klpVersion          Int                      @default(0)
  klpSourceHash       String?
  klpError            String?                  @db.Text
  klps                CardKlp[]
  quizQuestions       QuizQuestion[]
```

In `model QuizAttempt`, add to the relation list:

```prisma
  questions       QuizQuestion[]
```

- [ ] **Step 4: Generate and apply the migration**

Run: `npx prisma migrate dev --name card_klps`
Expected: migration applies cleanly and `prisma generate` runs.

Note: existing cards default to `klpStatus = 'pending'` and `klpVersion = 0`, which is correct — Task 5's `ensureKlpsReady` extracts them on first use.

- [ ] **Step 5: Confirm the suite still passes**

Run: `npm test && npx tsc --noEmit`
Expected: PASS (no test touches these columns yet).

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add versioned CardKlp, QuizQuestion, and Card KLP status columns"
```

---

### Task 3: `klpSourceHash`

**Files:**
- Create: `src/lib/cards/klp-hash.ts`
- Test: `tests/cards/klp-hash.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `HashableBlock = { side: string; type: string; text?: string | null; assetId?: string | null; position: number }`; `klpSourceHash(input: { term: string; definition: string; blocks?: HashableBlock[] }): string`

**Why:** this hash is the sole trigger for re-extraction. It must change when meaning changes and must NOT change on a re-save that altered nothing, or every save burns a batch of AI calls and supersedes a perfectly good KLP version.

- [ ] **Step 1: Write the failing test**

Create `tests/cards/klp-hash.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { klpSourceHash } from '@/lib/cards/klp-hash'

const base = { term: 'WACC', definition: 'Weighted average cost of capital.' }

describe('klpSourceHash', () => {
  it('is stable across calls with identical input', () => {
    expect(klpSourceHash(base)).toBe(klpSourceHash(base))
  })

  it('returns a hex sha256 digest', () => {
    expect(klpSourceHash(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when the term or definition changes', () => {
    expect(klpSourceHash({ ...base, term: 'CAPM' })).not.toBe(klpSourceHash(base))
    expect(klpSourceHash({ ...base, definition: 'Something else.' })).not.toBe(
      klpSourceHash(base),
    )
  })

  it('does not confuse a term/definition boundary shift', () => {
    // Naive concatenation would hash "AB" + "C" the same as "A" + "BC".
    expect(klpSourceHash({ term: 'AB', definition: 'C' })).not.toBe(
      klpSourceHash({ term: 'A', definition: 'BC' }),
    )
  })

  it('ignores block ordering, hashing by side and position instead', () => {
    // The editor may serialize blocks in any order; only their content and
    // their position within a side is meaning-bearing.
    const blocks = [
      { side: 'term', type: 'text', text: 'a', position: 0 },
      { side: 'definition', type: 'image', assetId: 'asset-1', position: 0 },
    ]
    expect(klpSourceHash({ ...base, blocks })).toBe(
      klpSourceHash({ ...base, blocks: [...blocks].reverse() }),
    )
  })

  it('changes when a block is added, removed, or repointed', () => {
    const withBlock = {
      ...base,
      blocks: [{ side: 'definition', type: 'image', assetId: 'asset-1', position: 0 }],
    }
    expect(klpSourceHash(withBlock)).not.toBe(klpSourceHash(base))
    expect(
      klpSourceHash({
        ...base,
        blocks: [{ side: 'definition', type: 'image', assetId: 'asset-2', position: 0 }],
      }),
    ).not.toBe(klpSourceHash(withBlock))
  })

  it('treats an absent blocks array and an empty one identically', () => {
    expect(klpSourceHash({ ...base, blocks: [] })).toBe(klpSourceHash(base))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cards/klp-hash.test.ts`
Expected: FAIL — cannot resolve `@/lib/cards/klp-hash`.

- [ ] **Step 3: Implement**

Create `src/lib/cards/klp-hash.ts`:

```ts
import { createHash } from 'node:crypto'

/**
 * The parts of a content block that change a card's meaning. `id` and any
 * client-side React key are deliberately excluded — they churn on every render
 * and would make the hash change when nothing did.
 */
export interface HashableBlock {
  side: string
  type: string
  text?: string | null
  assetId?: string | null
  position: number
}

/**
 * Stable fingerprint of everything a card teaches.
 *
 * This is the ONLY trigger for KLP re-extraction, which makes both failure
 * directions expensive: a hash that changes spuriously burns a batch of AI
 * calls and supersedes good KLPs on every save, and one that misses a real
 * edit leaves the card being tested against stale propositions forever.
 *
 * Fields are length-prefixed rather than concatenated so a boundary shift
 * (term "AB" + definition "C" vs "A" + "BC") cannot collide.
 */
export function klpSourceHash(input: {
  term: string
  definition: string
  blocks?: HashableBlock[]
}): string {
  const parts: string[] = [field(input.term), field(input.definition)]

  const blocks = [...(input.blocks ?? [])].sort(
    (a, b) => a.side.localeCompare(b.side) || a.position - b.position,
  )
  for (const b of blocks) {
    parts.push(field(b.side), field(b.type), field(b.text ?? ''), field(b.assetId ?? ''))
  }

  return createHash('sha256').update(parts.join('')).digest('hex')
}

function field(value: string): string {
  return `${value.length}:${value}`
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/cards/klp-hash.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cards/klp-hash.ts tests/cards/klp-hash.test.ts
git commit -m "feat(cards): add stable klpSourceHash over term, definition, and content blocks"
```

---

### Task 4: KLP extraction schema and prompt

**Files:**
- Modify: `src/lib/ai/schemas.ts`
- Create: `src/lib/ai/prompts/extract-klps.ts`
- Modify: `src/lib/ai/prompts/registry.ts`
- Test: `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `KLP_KINDS`, `KlpExtractionSchema`, `type KlpExtraction`; `EXTRACT_KLPS_PROMPT` (`{ id: 'extract-klps', version: 1, schema, build }`); `ExtractKlpsBuildInput = { setTitle: string; cards: { ref: number; term: string; definition: string }[] }`

- [ ] **Step 1: Add the schemas**

Append to `src/lib/ai/schemas.ts`:

```ts
/**
 * KLP kinds. `kind` is what makes "memorizes terms, fails on why" a groupBy
 * rather than an AI judgment — see docs/ai/error-taxonomy.md §6.
 */
export const KLP_KINDS = [
  'definition',
  'mechanism',
  'causal',
  'condition',
  'quantitative',
  'contrast',
  'example',
] as const;

export const MAX_KLPS_PER_CARD = 5;

export const KlpExtractionSchema = z.object({
  cards: z.array(
    z.object({
      // Index into the batch the prompt was built from. Cards are addressed by
      // position, never by cuid — the model must never see raw ids.
      ref: z.number().int().min(0),
      cardType: z.enum(['atomic', 'compound']),
      klps: z
        .array(
          z.object({
            text: z.string().min(1),
            weight: z.number().int().min(1).max(5),
            kind: z.enum(KLP_KINDS),
          }),
        )
        .min(1)
        .max(MAX_KLPS_PER_CARD),
    }),
  ),
});

export type KlpExtraction = z.infer<typeof KlpExtractionSchema>;
```

- [ ] **Step 2: Write the failing prompt test**

Append to `tests/ai/prompts.test.ts`:

```ts
import { EXTRACT_KLPS_PROMPT } from '@/lib/ai/prompts/extract-klps'

describe('EXTRACT_KLPS_PROMPT', () => {
  const input = {
    setTitle: 'M&A Basics',
    cards: [
      { ref: 0, term: 'WACC', definition: 'Weighted average cost of capital.' },
      { ref: 1, term: 'EBITDA', definition: 'Earnings before interest, taxes, D&A.' },
    ],
  }

  it('addresses cards by ref, never by id', () => {
    const prompt = EXTRACT_KLPS_PROMPT.build(input)
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('[1]')
    expect(prompt).toContain('WACC')
  })

  it('demands propositions rather than topics', () => {
    // The single highest-leverage instruction in the prompt: topic-shaped KLPs
    // produce useless distractors and unmatchable error targets.
    expect(EXTRACT_KLPS_PROMPT.build(input).toLowerCase()).toContain('proposition')
  })

  it('states the atomic-card rule so short cards are not padded to 3 KLPs', () => {
    expect(EXTRACT_KLPS_PROMPT.build(input)).toContain('atomic')
  })

  it('lists every allowed kind', () => {
    const prompt = EXTRACT_KLPS_PROMPT.build(input)
    for (const kind of KLP_KINDS) expect(prompt).toContain(kind)
  })

  it('is registered with a stable id and version', () => {
    expect(EXTRACT_KLPS_PROMPT.id).toBe('extract-klps')
    expect(EXTRACT_KLPS_PROMPT.version).toBe(1)
    expect(PROMPT_REGISTRY['extract-klps']).toBe(EXTRACT_KLPS_PROMPT)
  })
})
```

Add `KLP_KINDS` to the existing `@/lib/ai/schemas` import at the top of the file.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/ai/prompts.test.ts -t EXTRACT_KLPS_PROMPT`
Expected: FAIL — cannot resolve `@/lib/ai/prompts/extract-klps`.

- [ ] **Step 4: Implement the prompt**

Create `src/lib/ai/prompts/extract-klps.ts`:

```ts
import { KlpExtractionSchema, KLP_KINDS, MAX_KLPS_PER_CARD } from '@/lib/ai/schemas';

export interface ExtractKlpsBuildInput {
  setTitle: string;
  /** `ref` is the card's index in this batch. Never pass a cuid. */
  cards: { ref: number; term: string; definition: string }[];
}

/**
 * Decomposes cards into Key Learning Points. Routed via task 'autocomplete'
 * (cheap tier) in generateJson — this is structured decomposition, not
 * judgment. Batched by the caller at KLP_BATCH_SIZE cards per call.
 */
export const EXTRACT_KLPS_PROMPT = {
  id: 'extract-klps',
  version: 1,
  schema: KlpExtractionSchema,

  build(input: ExtractKlpsBuildInput): string {
    const cards = input.cards
      .map((c) => `[${c.ref}] Term: ${c.term}\n    Definition: ${c.definition}`)
      .join('\n\n');

    return `You are a finance interview coach breaking flashcards into the specific things a candidate must be able to say to have actually answered them.

Study set: ${input.setTitle}

Cards:
${cards}

For each card, output its Key Learning Points (KLPs).

A KLP is a PROPOSITION that can be judged true or false about a candidate's answer — not a topic or a heading.
  GOOD: "WACC weights each capital source by market value, not book value"
  BAD:  "weighting"
  GOOD: "Depreciation is added back because it is a non-cash charge"
  BAD:  "non-cash charges"

How many:
- Give 1 to ${MAX_KLPS_PER_CARD} KLPs per card. Use as few as the card actually contains.
- Mark a card "atomic" when it is a bare vocabulary definition with a single thing to know (e.g. an acronym expansion). Atomic cards get exactly 1 KLP. Do NOT invent extra points to reach a quota — a padded KLP corrupts every question generated from it.
- Mark a card "compound" when it genuinely teaches several separable points.

weight (1-5): how central this point is to answering the card. Judge the KLPs of one card against each other — the point a candidate absolutely must hit is a 5; useful colour is a 1 or 2.

kind: one of ${KLP_KINDS.join(', ')}.
- definition: what something is
- mechanism: how it works
- causal: why, or what drives what
- condition: when it applies, or its constraints
- quantitative: a number, formula, or magnitude
- contrast: how it differs from an adjacent concept
- example: a concrete instance

Reference each card by the [ref] number shown above. Return one entry per card, in the same order.

Output JSON:
{ "cards": [ { "ref": number, "cardType": "atomic" | "compound", "klps": [ { "text": string, "weight": number, "kind": string } ] } ] }`;
  },
};
```

- [ ] **Step 5: Register the prompt**

In `src/lib/ai/prompts/registry.ts`, add the export alongside the others:

```ts
export { EXTRACT_KLPS_PROMPT } from './extract-klps';
export type { ExtractKlpsBuildInput } from './extract-klps';
```

the import:

```ts
import { EXTRACT_KLPS_PROMPT } from './extract-klps';
```

and the registry entry:

```ts
  [EXTRACT_KLPS_PROMPT.id]: EXTRACT_KLPS_PROMPT,
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/ai/prompts.test.ts`
Expected: PASS, including the pre-existing registry-completeness assertions.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/extract-klps.ts src/lib/ai/prompts/registry.ts tests/ai/prompts.test.ts
git commit -m "feat(ai): add KLP extraction schema and prompt"
```

---

### Task 5: KLP extraction action

**Files:**
- Create: `src/actions/klp.ts`
- Test: `tests/actions/klp.test.ts`

**Interfaces:**
- Consumes: `EXTRACT_KLPS_PROMPT` (Task 4), `klpSourceHash` (Task 3), `generateJson`
- Produces: `KLP_BATCH_SIZE = 10`; `extractKlpsForCards(userId: string, cardIds: string[]): Promise<void>`; `ensureKlpsReady(userId: string, cardId: string): Promise<{ id: string; text: string; weight: number; kind: string; index: number }[]>`

**Status transitions:** `pending` → `ready` on success, `failed` on error, `skipped` when the user has no usable credential (`no_credentials` / `credentials_unavailable`). `skipped` is distinct from `failed` so the set builder does not show a retry button to someone who simply has no API key.

- [ ] **Step 1: Write the failing test**

Create `tests/actions/klp.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  aggregate: vi.fn(),
  updateMany: vi.fn(),
  update: vi.fn(),
  createMany: vi.fn(),
  klpUpdateMany: vi.fn(),
  klpFindMany: vi.fn(),
  generateJson: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    card: { findMany: h.findMany, update: h.update, updateMany: h.updateMany },
    cardKlp: {
      aggregate: h.aggregate,
      createMany: h.createMany,
      updateMany: h.klpUpdateMany,
      findMany: h.klpFindMany,
    },
    $transaction: (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]),
  },
}))

vi.mock('@/lib/ai/generate', () => ({
  generateJson: h.generateJson,
  AiGenerationError: class extends Error {
    constructor(public detail: { kind: string }) {
      super('ai failed')
    }
  },
}))

import { extractKlpsForCards, KLP_BATCH_SIZE } from '@/actions/klp'

const card = (id: string) => ({
  id,
  term: `term-${id}`,
  definition: `def-${id}`,
  setId: 'set-1',
  contentBlocks: [],
  set: { title: 'M&A Basics' },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.aggregate.mockResolvedValue({ _max: { version: 0 } })
  h.createMany.mockResolvedValue({})
  h.klpUpdateMany.mockResolvedValue({})
  h.update.mockResolvedValue({})
  h.updateMany.mockResolvedValue({})
})

describe('extractKlpsForCards', () => {
  it('batches cards so a 100-card import is not 100 calls', async () => {
    h.findMany.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => card(`c${i}`)),
    )
    h.generateJson.mockImplementation(async ({ prompt }: { prompt: string }) => ({
      cards: [...prompt.matchAll(/\[(\d+)\]/g)].map((m) => ({
        ref: Number(m[1]),
        cardType: 'compound' as const,
        klps: [{ text: 'a point', weight: 3, kind: 'definition' as const }],
      })),
    }))

    await extractKlpsForCards('u1', Array.from({ length: 25 }, (_, i) => `c${i}`))

    expect(KLP_BATCH_SIZE).toBe(10)
    expect(h.generateJson).toHaveBeenCalledTimes(3) // 10 + 10 + 5
  })

  it('writes a new version and supersedes the previous one', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.aggregate.mockResolvedValue({ _max: { version: 2 } })
    h.generateJson.mockResolvedValue({
      cards: [
        {
          ref: 0,
          cardType: 'compound',
          klps: [{ text: 'a point', weight: 4, kind: 'causal' }],
        },
      ],
    })

    await extractKlpsForCards('u1', ['c1'])

    expect(h.klpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { cardId: 'c1', supersededAt: null },
        data: { supersededAt: expect.any(Date) },
      }),
    )
    expect(h.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ cardId: 'c1', version: 3, index: 0, weight: 4, kind: 'causal' }),
        ],
      }),
    )
  })

  it('marks the card ready with the hash that produced its KLPs', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockResolvedValue({
      cards: [{ ref: 0, cardType: 'atomic', klps: [{ text: 'x', weight: 5, kind: 'definition' }] }],
    })

    await extractKlpsForCards('u1', ['c1'])

    expect(h.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c1' },
        data: expect.objectContaining({
          klpStatus: 'ready',
          klpVersion: 1,
          klpSourceHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          klpError: null,
        }),
      }),
    )
  })

  it('marks the batch failed without throwing, so a save is never blocked', async () => {
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockRejectedValue(new Error('provider exploded'))

    await expect(extractKlpsForCards('u1', ['c1'])).resolves.toBeUndefined()

    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: ['c1'] } },
        data: expect.objectContaining({ klpStatus: 'failed' }),
      }),
    )
  })

  it('skips rather than fails when the user has no usable credential', async () => {
    // 'skipped' must not surface a retry button — there is nothing to retry
    // until the user adds a key.
    const { AiGenerationError } = await import('@/lib/ai/generate')
    h.findMany.mockResolvedValue([card('c1')])
    h.generateJson.mockRejectedValue(new (AiGenerationError as any)({ kind: 'no_credentials' }))

    await extractKlpsForCards('u1', ['c1'])

    expect(h.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ klpStatus: 'skipped' }),
      }),
    )
  })

  it('does nothing when given no card ids', async () => {
    await extractKlpsForCards('u1', [])
    expect(h.generateJson).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/actions/klp.test.ts`
Expected: FAIL — cannot resolve `@/actions/klp`.

- [ ] **Step 3: Implement**

Create `src/actions/klp.ts`:

```ts
'use server';

import { prisma } from '@/lib/db';
import { generateJson, AiGenerationError } from '@/lib/ai/generate';
import { EXTRACT_KLPS_PROMPT } from '@/lib/ai/prompts/extract-klps';
import { KlpExtractionSchema } from '@/lib/ai/schemas';
import { klpSourceHash } from '@/lib/cards/klp-hash';

/**
 * Cards per extraction call. The pipe/semicolon importer creates 100+ cards in
 * one save; one call per card would exhaust the user's key pool and surface as
 * `quota_exhausted` across their whole account.
 */
export const KLP_BATCH_SIZE = 10;

/** Failure kinds that mean "no key", not "extraction is broken". */
const NO_KEY_KINDS = new Set(['no_credentials', 'credentials_unavailable']);

export interface ReadyKlp {
  id: string;
  index: number;
  text: string;
  weight: number;
  kind: string;
}

/**
 * Extracts KLPs for the given cards, in batches.
 *
 * NEVER THROWS. It runs inside `after()` on the set-save path, where an
 * exception would surface as an unhandled rejection long after the user's
 * response went out. Every failure is recorded on the card instead.
 */
export async function extractKlpsForCards(userId: string, cardIds: string[]): Promise<void> {
  if (cardIds.length === 0) return;

  const cards = await prisma.card.findMany({
    where: { id: { in: cardIds } },
    include: { contentBlocks: true, set: { select: { title: true } } },
  });

  for (let i = 0; i < cards.length; i += KLP_BATCH_SIZE) {
    const batch = cards.slice(i, i + KLP_BATCH_SIZE);
    try {
      await extractOneBatch(userId, batch);
    } catch (err) {
      const kind = err instanceof AiGenerationError ? err.detail.kind : null;
      await prisma.card.updateMany({
        where: { id: { in: batch.map((c) => c.id) } },
        data: {
          klpStatus: kind && NO_KEY_KINDS.has(kind) ? 'skipped' : 'failed',
          klpError: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error',
        },
      });
    }
  }
}

type BatchCard = Awaited<ReturnType<typeof prisma.card.findMany>>[number] & {
  contentBlocks: { side: string; type: string; text: string | null; assetId: string | null; position: number }[];
  set: { title: string };
};

async function extractOneBatch(userId: string, batch: BatchCard[]): Promise<void> {
  const prompt = EXTRACT_KLPS_PROMPT.build({
    setTitle: batch[0].set.title,
    cards: batch.map((c, ref) => ({ ref, term: c.term, definition: c.definition })),
  });

  const result = await generateJson({
    userId,
    task: 'autocomplete',
    prompt,
    schema: KlpExtractionSchema,
  });

  for (const entry of result.cards) {
    const card = batch[entry.ref];
    // A hallucinated ref must not write another card's KLPs onto this one.
    if (!card) continue;

    const hash = klpSourceHash({
      term: card.term,
      definition: card.definition,
      blocks: card.contentBlocks,
    });

    const { _max } = await prisma.cardKlp.aggregate({
      where: { cardId: card.id },
      _max: { version: true },
    });
    const version = (_max.version ?? 0) + 1;

    await prisma.$transaction([
      prisma.cardKlp.updateMany({
        where: { cardId: card.id, supersededAt: null },
        data: { supersededAt: new Date() },
      }),
      prisma.cardKlp.createMany({
        data: entry.klps.map((k, index) => ({
          cardId: card.id,
          version,
          index,
          text: k.text,
          weight: k.weight,
          kind: k.kind,
          sourceHash: hash,
          promptVersion: EXTRACT_KLPS_PROMPT.version,
          source: 'ai',
        })),
      }),
      prisma.card.update({
        where: { id: card.id },
        data: {
          klpStatus: 'ready',
          klpVersion: version,
          klpSourceHash: hash,
          klpError: null,
        },
      }),
    ]);
  }
}

/**
 * The live KLPs for one card, extracting inline if they are missing.
 *
 * This is the self-healing layer: `after()` extraction is fire-and-forget, so
 * a quiz can reach a card whose extraction is still pending or failed. Blocks
 * that one question rather than the whole quiz, and returns [] if extraction
 * is impossible so callers fall back to the legacy no-KLP path.
 */
export async function ensureKlpsReady(userId: string, cardId: string): Promise<ReadyKlp[]> {
  const live = () =>
    prisma.cardKlp.findMany({
      where: { cardId, supersededAt: null },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, text: true, weight: true, kind: true },
    });

  const existing = await live();
  if (existing.length > 0) return existing;

  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { klpStatus: true },
  });
  // 'skipped' means the user has no key. Retrying per question would fire one
  // doomed call per card in the quiz.
  if (card?.klpStatus === 'skipped') return [];

  await extractKlpsForCards(userId, [cardId]);
  return live();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/actions/klp.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/actions/klp.ts tests/actions/klp.test.ts
git commit -m "feat(klp): add batched KLP extraction with versioning and self-healing reads"
```

---

### Task 6: Fire extraction from set saves

**Files:**
- Modify: `src/actions/sets.ts` (`createSet` ~line 175, `updateSet` end)

**Interfaces:**
- Consumes: `extractKlpsForCards` (Task 5), `klpSourceHash` (Task 3)
- Produces: no new exports — behaviour only

- [ ] **Step 1: Add the imports**

In `src/actions/sets.ts`:

```ts
import { after } from 'next/server'
import { extractKlpsForCards } from '@/actions/klp'
import { klpSourceHash } from '@/lib/cards/klp-hash'
```

- [ ] **Step 2: Fire extraction after set creation**

In `createSet`, after `backfillAssetLinks(...)` (line 175) and before `revalidatePath`:

```ts
    // Post-response so the user is never blocked on extraction. Every failure
    // is recorded on the card by extractKlpsForCards, which never throws.
    const created = await prisma.card.findMany({
      where: { setId: set.id },
      select: { id: true },
    })
    after(() => extractKlpsForCards(session.user.id, created.map((c) => c.id)))
```

- [ ] **Step 3: Fire extraction only for changed cards on update**

In `updateSet`, after `backfillAssetLinks(...)` and before `revalidatePath`:

```ts
    // Only cards whose meaning actually changed get re-extracted. Re-running
    // the whole set on every save would burn a batch of AI calls and supersede
    // perfectly good KLPs each time a title is corrected.
    const saved = await prisma.card.findMany({
      where: { setId: id },
      include: { contentBlocks: true },
    })
    const stale = saved
      .filter(
        (c) =>
          c.klpSourceHash !==
          klpSourceHash({ term: c.term, definition: c.definition, blocks: c.contentBlocks }),
      )
      .map((c) => c.id)

    after(() => extractKlpsForCards(session.user.id, stale))
```

- [ ] **Step 4: Verify the suite and typecheck**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manually verify end to end**

Create a set with three cards while signed in with a working AI credential.
Wait a few seconds, then check the database:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT c."term", c."klpStatus", c."klpVersion", COUNT(k."id") AS klps
FROM "Card" c LEFT JOIN "CardKlp" k ON k."cardId" = c."id" AND k."supersededAt" IS NULL
GROUP BY c."id" ORDER BY c."position";
SQL
```

Expected: `klpStatus = 'ready'`, `klpVersion = 1`, and 1-5 KLPs per card.
Then edit one card's definition, save, and confirm only that card moves to
version 2 while the others stay at version 1.

- [ ] **Step 6: Commit**

```bash
git add src/actions/sets.ts
git commit -m "feat(sets): extract KLPs post-response on save, only for changed cards"
```

---

### Task 7: Option-cache parsing and distractor provenance

**Files:**
- Create: `src/lib/quiz/options.ts`
- Test: `tests/quiz/options.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `CORRUPTIONS`, `type Corruption`; `OptionCacheV2Schema`; `type ParsedOptions = { version: 1 | 2; correctAnswer: string; options: ParsedOption[] }`; `type ParsedOption = { text: string; correct: boolean; sourceKlpId?: string; corruption?: Corruption }`; `parseOptionCache(json: unknown): ParsedOptions | null`; `resolveDistractorProvenance(parsed: ParsedOptions, pickedText: string): { sourceKlpId: string; corruption: Corruption } | null`

**Why a union:** `QuizOptionCache` holds v1 blobs (`{options: string[], correctAnswer: string}`) for every card already quizzed. Those must keep working as provenance-less rather than being wiped.

- [ ] **Step 1: Write the failing test**

Create `tests/quiz/options.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { parseOptionCache, resolveDistractorProvenance } from '@/lib/quiz/options'

const v1 = { options: ['a', 'b', 'c', 'd'], correctAnswer: 'a' }

const v2 = {
  v: 2,
  correctAnswer: 'Market value weights',
  options: [
    { text: 'Market value weights', correct: true },
    { text: 'Book value weights', correct: false, sourceKlpId: 'klp-1', corruption: 'inversion' },
    { text: 'Equal weights', correct: false, sourceKlpId: 'klp-2', corruption: 'misapplication' },
    { text: 'Revenue weights', correct: false, sourceKlpId: 'klp-2', corruption: 'factual_error' },
  ],
}

describe('parseOptionCache', () => {
  it('reads a v2 blob with provenance intact', () => {
    const parsed = parseOptionCache(v2)!
    expect(parsed.version).toBe(2)
    expect(parsed.options[1].sourceKlpId).toBe('klp-1')
  })

  it('reads a legacy v1 blob as provenance-less', () => {
    // Every card already quizzed has one of these cached. Wiping them would
    // re-bill the user for generation they already paid for.
    const parsed = parseOptionCache(v1)!
    expect(parsed.version).toBe(1)
    expect(parsed.correctAnswer).toBe('a')
    expect(parsed.options).toHaveLength(4)
    expect(parsed.options[0].correct).toBe(true)
    expect(parsed.options[1].correct).toBe(false)
    expect(parsed.options.every((o) => o.sourceKlpId === undefined)).toBe(true)
  })

  it('returns null for a blob matching neither shape', () => {
    expect(parseOptionCache({ nonsense: true })).toBeNull()
    expect(parseOptionCache(null)).toBeNull()
  })

  it('rejects a v2 blob carrying an unknown corruption', () => {
    expect(
      parseOptionCache({
        ...v2,
        options: [{ text: 'x', correct: false, sourceKlpId: 'k', corruption: 'vibes' }],
      }),
    ).toBeNull()
  })
})

describe('resolveDistractorProvenance', () => {
  it('returns the corruption and source KLP of the picked distractor', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'Book value weights')).toEqual({
      sourceKlpId: 'klp-1',
      corruption: 'inversion',
    })
  })

  it('returns null for the correct answer', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'Market value weights')).toBeNull()
  })

  it('matches on trimmed, case-insensitive text', () => {
    // The client echoes back the rendered string; whitespace and casing must
    // not decide whether an answer is diagnosable.
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, '  book VALUE weights ')).toEqual({
      sourceKlpId: 'klp-1',
      corruption: 'inversion',
    })
  })

  it('returns null on a v1 blob rather than inventing provenance', () => {
    const parsed = parseOptionCache(v1)!
    expect(resolveDistractorProvenance(parsed, 'b')).toBeNull()
  })

  it('returns null when the picked text matches no option', () => {
    const parsed = parseOptionCache(v2)!
    expect(resolveDistractorProvenance(parsed, 'something else entirely')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/quiz/options.test.ts`
Expected: FAIL — cannot resolve `@/lib/quiz/options`.

- [ ] **Step 3: Implement**

Create `src/lib/quiz/options.ts`:

```ts
import { z } from 'zod';

/**
 * The accuracy-vocabulary corruptions a distractor may be built from. Must
 * stay in sync with docs/ai/error-taxonomy.md §2.1 — Spec 2 reads a picked
 * distractor's `corruption` directly as the error type, with no AI call.
 */
export const CORRUPTIONS = [
  'inversion',
  'conflation',
  'misapplication',
  'overgeneralization',
  'factual_error',
] as const;

export type Corruption = (typeof CORRUPTIONS)[number];

const OptionV2Schema = z.object({
  text: z.string().min(1),
  correct: z.boolean(),
  sourceKlpId: z.string().optional(),
  corruption: z.enum(CORRUPTIONS).optional(),
});

export const OptionCacheV2Schema = z.object({
  v: z.literal(2),
  correctAnswer: z.string().min(1),
  options: z.array(OptionV2Schema),
});

const OptionCacheV1Schema = z.object({
  options: z.array(z.string().min(1)),
  correctAnswer: z.string().min(1),
});

export interface ParsedOption {
  text: string;
  correct: boolean;
  sourceKlpId?: string;
  corruption?: Corruption;
}

export interface ParsedOptions {
  version: 1 | 2;
  correctAnswer: string;
  options: ParsedOption[];
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

/**
 * Reads either cache generation. v1 blobs predate KLP provenance and are
 * returned provenance-less rather than discarded — every card already quizzed
 * has one, and wiping them would re-bill the user for generation they already
 * paid for.
 */
export function parseOptionCache(json: unknown): ParsedOptions | null {
  const v2 = OptionCacheV2Schema.safeParse(json);
  if (v2.success) {
    return { version: 2, correctAnswer: v2.data.correctAnswer, options: v2.data.options };
  }

  const v1 = OptionCacheV1Schema.safeParse(json);
  if (v1.success) {
    const correct = normalize(v1.data.correctAnswer);
    return {
      version: 1,
      correctAnswer: v1.data.correctAnswer,
      options: v1.data.options.map((text) => ({ text, correct: normalize(text) === correct })),
    };
  }

  return null;
}

/**
 * What a wrong pick reveals: which KLP the chosen distractor was built from,
 * and how it was corrupted. This is what lets multiple choice diagnose itself
 * with no grading call (docs/ai/error-taxonomy.md §4).
 *
 * Returns null for the correct answer, for v1 blobs, and for any option
 * lacking provenance — never a fabricated default, which would pollute the
 * aggregate profile with errors the learner never made.
 */
export function resolveDistractorProvenance(
  parsed: ParsedOptions,
  pickedText: string,
): { sourceKlpId: string; corruption: Corruption } | null {
  const picked = parsed.options.find((o) => normalize(o.text) === normalize(pickedText));
  if (!picked || picked.correct) return null;
  if (!picked.sourceKlpId || !picked.corruption) return null;
  return { sourceKlpId: picked.sourceKlpId, corruption: picked.corruption };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/quiz/options.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/quiz/options.ts tests/quiz/options.test.ts
git commit -m "feat(quiz): parse v1/v2 option caches and resolve distractor provenance"
```

---

### Task 8: KLP-driven multiple-choice prompt (v2)

**Files:**
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/multiple-choice.ts`
- Test: `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: `CORRUPTIONS` (Task 7), `ReadyKlp` (Task 5)
- Produces: `MultipleChoiceKlpSchema`; `MULTIPLE_CHOICE_PROMPT.version === 2`; `MultipleChoiceBuildInput` gains `klps?: { ref: number; text: string; kind: string }[]`

**Behaviour:** with KLPs, each distractor names the KLP ref it corrupts and the corruption used. Without KLPs, `build` emits the existing v1 prompt unchanged so a keyless or unextracted card still gets a working quiz.

- [ ] **Step 1: Add the schema**

Append to `src/lib/ai/schemas.ts`:

```ts
/**
 * KLP-aware MC generation. Distractors reference the KLP they corrupt by its
 * `ref` (index in the prompt), never by cuid; the action maps refs back to ids.
 */
export const MultipleChoiceKlpSchema = z.object({
  correctAnswer: z.string().min(1),
  distractors: z
    .array(
      z.object({
        text: z.string().min(1),
        klpRef: z.number().int().min(0),
        corruption: z.enum([
          'inversion',
          'conflation',
          'misapplication',
          'overgeneralization',
          'factual_error',
        ]),
      }),
    )
    .length(3),
});

export type MultipleChoiceKlp = z.infer<typeof MultipleChoiceKlpSchema>;
```

- [ ] **Step 2: Write the failing test**

Append to `tests/ai/prompts.test.ts`:

```ts
describe('MULTIPLE_CHOICE_PROMPT v2 (KLP-driven)', () => {
  const card = makeCard()
  const klps = [
    { ref: 0, text: 'EBITDA excludes interest expense', kind: 'definition' },
    { ref: 1, text: 'D&A is added back because it is non-cash', kind: 'causal' },
  ]

  it('is version 2', () => {
    expect(MULTIPLE_CHOICE_PROMPT.version).toBe(2)
  })

  it('lists each KLP by ref and asks for one corruption per distractor', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [], klps })
    expect(prompt).toContain('[0]')
    expect(prompt).toContain('EBITDA excludes interest expense')
    expect(prompt).toContain('klpRef')
    expect(prompt).toContain('inversion')
  })

  it('falls back to the legacy prompt when the card has no KLPs', () => {
    // A user with no AI key, or a card whose extraction failed, must still get
    // a working quiz.
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [] })
    expect(prompt).toContain('plausible but incorrect distractors')
    expect(prompt).not.toContain('klpRef')
  })

  it('never leaks a cuid into the prompt', () => {
    const prompt = MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: [], klps })
    expect(prompt).not.toContain(card.id)
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/ai/prompts.test.ts -t "KLP-driven"`
Expected: FAIL — version is 1 and `klps` is not an accepted input.

- [ ] **Step 4: Implement**

In `src/lib/ai/prompts/multiple-choice.ts`, add the import:

```ts
import { MultipleChoiceKlpSchema } from '@/lib/ai/schemas';
import { CORRUPTIONS } from '@/lib/quiz/options';
```

Extend the input interface:

```ts
export interface PromptKlp {
  /** Index in this prompt. Never a cuid. */
  ref: number;
  text: string;
  kind: string;
}

export interface MultipleChoiceBuildInput {
  card: Card;
  siblingCards: Card[];
  /** Optional rendered LearnerProfile block (see lib/ai/context.ts). */
  profileBlock?: string;
  /** Live KLPs. Absent or empty falls back to the legacy sibling-seeded prompt. */
  klps?: PromptKlp[];
}
```

Set `version: 2`. Leave `schema` as `MultipleChoiceOptionsSchema` — it is the
fallback path's contract, and Task 9 imports `MultipleChoiceKlpSchema` directly
for the KLP path. Do **not** add a second `klpSchema` field to the prompt
object; nothing reads it. Make `build` branch:

```ts
  build(input: MultipleChoiceBuildInput): string {
    if (!input.klps || input.klps.length === 0) return legacyBuild(input);

    const klpList = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');

    return `You are a finance interview expert writing a multiple-choice question.

Term: ${input.card.term}
Correct Definition: ${input.card.definition}

Key Learning Points this card teaches:
${klpList}

Other related definitions, for flavour only:
- ${siblingDefinitions(input.card, input.siblingCards)}
${distractorMemoryHint(input.profileBlock)}
Write exactly 3 distractors. Each one must:
1. Corrupt EXACTLY ONE of the Key Learning Points above, named by its klpRef.
2. Use exactly one corruption from: ${CORRUPTIONS.join(', ')}.
   - inversion: reverse the direction, sign, or causality
   - conflation: describe it using an adjacent concept's content
   - misapplication: keep the concept but apply it in the wrong context
   - overgeneralization: state a conditional claim as universal
   - factual_error: change a specific number, formula term, or fact
3. Be wrong ONLY in the way named. A distractor that is wrong for several
   reasons at once cannot tell us what the candidate misunderstood.
4. Be similar enough to the correct definition that someone who half-knows the
   point would pick it.

Do not restate the correct definition as a distractor.

Output JSON:
{ "correctAnswer": string, "distractors": [ { "text": string, "klpRef": number, "corruption": string } ] }`;
  },
```

Move the current body into a module-private `legacyBuild(input)` returning the existing v1 string verbatim.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ai/prompts.test.ts`
Expected: PASS, including the pre-existing v1 assertions via the fallback path.

- [ ] **Step 6: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/multiple-choice.ts tests/ai/prompts.test.ts
git commit -m "feat(ai): generate MC distractors by corrupting a named KLP"
```

---

### Task 9: Persist v2 options and a `QuizQuestion` row

**Files:**
- Modify: `src/actions/quiz.ts` (`generateQuizOptions`, ~lines 30-122)

**Interfaces:**
- Consumes: `ensureKlpsReady` (Task 5), `parseOptionCache` (Task 7), `MULTIPLE_CHOICE_PROMPT` v2 (Task 8)
- Produces: `generateQuizOptions` gains an optional `attemptId` parameter and writes a `QuizQuestion` row when one is supplied

- [ ] **Step 1: Generate v2 options when KLPs exist**

In `src/actions/quiz.ts`, add imports:

```ts
import { ensureKlpsReady } from '@/actions/klp';
import { parseOptionCache, type ParsedOptions } from '@/lib/quiz/options';
import { MultipleChoiceKlpSchema } from '@/lib/ai/schemas';
```

Replace the cache read (lines 46-63) so it goes through the union parser:

```ts
      const cached = await prisma.quizOptionCache.findUnique({
        where: { cardId_model: { cardId, model } },
      });

      const parsedCache = cached ? parseOptionCache(cached.options) : null;
      if (parsedCache) {
        await recordQuizQuestion(attemptId, cardId, parsedCache);
        return {
          success: true,
          data: {
            cardId,
            options: parsedCache.options.map((o) => o.text),
            correctAnswer: parsedCache.correctAnswer,
            cacheHit: true,
            model,
          },
        };
      }
```

Replace the generation block (lines 76-101) with the KLP-aware path:

```ts
    const klps = await ensureKlpsReady(session.user.id, cardId);

    let optionsJson: unknown;

    if (klps.length > 0) {
      const generated = await generateJson({
        userId: session.user.id,
        task: 'distractors',
        prompt: MULTIPLE_CHOICE_PROMPT.build({
          card,
          siblingCards: set.cards,
          profileBlock,
          klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
        }),
        schema: MultipleChoiceKlpSchema,
      });

      optionsJson = {
        v: 2,
        correctAnswer: generated.correctAnswer,
        options: shuffle([
          { text: generated.correctAnswer, correct: true },
          ...generated.distractors.map((d) => ({
            text: d.text,
            correct: false,
            // Map ref -> real id here. The model never saw the cuid.
            sourceKlpId: klps[d.klpRef]?.id,
            corruption: d.corruption,
          })),
        ]),
      };
    } else {
      // No KLPs (no credential, or extraction failed): legacy prompt, legacy
      // v1 shape. The quiz still works; it just isn't diagnosable.
      const legacy = await generateJson({
        userId: session.user.id,
        task: 'distractors',
        prompt: MULTIPLE_CHOICE_PROMPT.build({ card, siblingCards: set.cards, profileBlock }),
        schema: MultipleChoiceOptionsSchema,
      });
      optionsJson = legacy;
    }
```

Then keep the existing `if (!model) throw` guard and `upsert`, using `optionsJson`.
Finally, before returning, parse and record:

```ts
    const parsed = parseOptionCache(optionsJson)!;
    await recordQuizQuestion(attemptId, cardId, parsed);

    return {
      success: true,
      data: {
        cardId,
        options: parsed.options.map((o) => o.text),
        correctAnswer: parsed.correctAnswer,
        cacheHit: false,
        model,
      },
    };
```

- [ ] **Step 2: Add the `QuizQuestion` writer and the shuffle helper**

Add near the top of `src/actions/quiz.ts`:

```ts
/**
 * Fisher-Yates. The correct answer must not sit in a predictable slot — the
 * previous prompt asked the model to place it randomly, which it does not
 * reliably do.
 */
function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Freezes the question as asked, with its KLP provenance. Spec 2 reads this to
 * diagnose a wrong pick with no grading call. Upsert because a user may
 * navigate back to a question before submitting.
 */
async function recordQuizQuestion(
  attemptId: string | undefined,
  cardId: string,
  parsed: ParsedOptions,
): Promise<void> {
  if (!attemptId) return;
  const targetKlpIds = Array.from(
    new Set(parsed.options.map((o) => o.sourceKlpId).filter((id): id is string => Boolean(id))),
  );
  const data = {
    options: parsed.options as unknown as object,
    targetKlpIds,
    klpVersion: 0,
  };
  await prisma.quizQuestion.upsert({
    where: { attemptId_cardId_mode: { attemptId, cardId, mode: 'multiple-choice' } },
    create: { attemptId, cardId, mode: 'multiple-choice', ...data },
    update: data,
  });
}
```

Note: `klpVersion` is read from the card in Step 3.

- [ ] **Step 3: Pin the KLP version on the question**

In `recordQuizQuestion`, replace `klpVersion: 0` by reading the card:

```ts
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    select: { klpVersion: true },
  });
  const data = {
    options: parsed.options as unknown as object,
    targetKlpIds,
    // Pinned: a question already asked keeps the version it was asked under,
    // even if the card is edited mid-attempt.
    klpVersion: card?.klpVersion ?? 0,
  };
```

- [ ] **Step 4: Thread `attemptId` from the caller**

Widen the `generateQuizOptions` signature (line ~28). It is optional so the
printable-quiz path, which has no attempt, keeps working:

```ts
export async function generateQuizOptions(
  cardId: string,
  attemptId?: string,
): Promise<ActionResult<{ cardId: string; options: string[]; correctAnswer: string; cacheHit: boolean; model: string }>> {
```

In `src/components/quiz/MultipleChoiceQuiz.tsx`, pass the prop the component
already holds at every `generateQuizOptions(` call site:

```tsx
        const res = await generateQuizOptions(card.id, attemptId)
```

Verify no call site was missed:

```bash
grep -rn "generateQuizOptions(" src/
```

Expected: every call inside a quiz component passes `attemptId`; only the
printable path may omit it.

- [ ] **Step 5: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

Then run a multiple-choice quiz on a set with KLPs and confirm:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT "mode", "targetKlpIds", "options" FROM "QuizQuestion" ORDER BY "createdAt" DESC LIMIT 3;
SQL
```

Expected: `options` carries `sourceKlpId` and `corruption` on each distractor.

- [ ] **Step 6: Commit**

```bash
git add src/actions/quiz.ts src/components/quiz/MultipleChoiceQuiz.tsx
git commit -m "feat(quiz): persist v2 option provenance and a frozen QuizQuestion row"
```

---

### Task 10: True/false generation with a server-side coin flip

**Files:**
- Create: `src/lib/quiz/coin-flip.ts`, `src/lib/ai/prompts/true-false.ts`
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/registry.ts`, `src/actions/quiz.ts`
- Test: `tests/quiz/coin-flip.test.ts`, `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: `ensureKlpsReady` (Task 5), `CORRUPTIONS` (Task 7)
- Produces: `pickTfVariant(rng?: () => number): 'true' | 'false'`; `TrueFalseStatementSchema`; `TRUE_FALSE_PROMPT`; `getTrueFalseQuestion(attemptId, cardId): Promise<ActionResult<{ statement: string }>>`

- [ ] **Step 1: Write the failing coin-flip test**

Create `tests/quiz/coin-flip.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickTfVariant } from '@/lib/quiz/coin-flip'

describe('pickTfVariant', () => {
  it('returns the real definition on a low roll', () => {
    expect(pickTfVariant(() => 0)).toBe('true')
    expect(pickTfVariant(() => 0.49)).toBe('true')
  })

  it('returns the corrupted statement on a high roll', () => {
    expect(pickTfVariant(() => 0.5)).toBe('false')
    expect(pickTfVariant(() => 0.99)).toBe('false')
  })

  it('is roughly balanced over many real draws', () => {
    const draws = Array.from({ length: 2000 }, () => pickTfVariant())
    const trues = draws.filter((d) => d === 'true').length
    expect(trues).toBeGreaterThan(800)
    expect(trues).toBeLessThan(1200)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/quiz/coin-flip.test.ts`
Expected: FAIL — cannot resolve `@/lib/quiz/coin-flip`.

- [ ] **Step 3: Implement the coin flip**

Create `src/lib/quiz/coin-flip.ts`:

```ts
/**
 * Chooses whether a true/false question shows the card's real definition or a
 * KLP-corrupted one.
 *
 * `rng` is injectable so generation is deterministic in tests. The flip runs
 * SERVER-SIDE only: the client must never learn which variant it received.
 */
export function pickTfVariant(rng: () => number = Math.random): 'true' | 'false' {
  return rng() < 0.5 ? 'true' : 'false';
}
```

- [ ] **Step 4: Add the statement schema**

Append to `src/lib/ai/schemas.ts`:

```ts
export const TrueFalseStatementSchema = z.object({
  statement: z.string().min(1),
  klpRef: z.number().int().min(0),
  corruption: z.enum([
    'inversion',
    'conflation',
    'misapplication',
    'overgeneralization',
    'factual_error',
  ]),
});

export type TrueFalseStatement = z.infer<typeof TrueFalseStatementSchema>;
```

- [ ] **Step 5: Write the failing prompt test**

Append to `tests/ai/prompts.test.ts`:

```ts
import { TRUE_FALSE_PROMPT } from '@/lib/ai/prompts/true-false'

describe('TRUE_FALSE_PROMPT', () => {
  const card = makeCard()
  const klps = [{ ref: 0, text: 'EBITDA excludes interest expense', kind: 'definition' }]

  it('asks for a statement that is wrong in exactly one way', () => {
    const prompt = TRUE_FALSE_PROMPT.build({ card, klps })
    expect(prompt).toContain('exactly one')
    expect(prompt).toContain('klpRef')
  })

  it('requires the statement to stay plausible', () => {
    // An obviously absurd statement tests nothing — the candidate rejects it
    // without engaging the KLP at all.
    expect(TRUE_FALSE_PROMPT.build({ card, klps }).toLowerCase()).toContain('plausible')
  })

  it('is registered', () => {
    expect(TRUE_FALSE_PROMPT.id).toBe('true-false')
    expect(PROMPT_REGISTRY['true-false']).toBe(TRUE_FALSE_PROMPT)
  })
})
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/ai/prompts.test.ts -t TRUE_FALSE_PROMPT`
Expected: FAIL — cannot resolve `@/lib/ai/prompts/true-false`.

- [ ] **Step 7: Implement the prompt and register it**

Create `src/lib/ai/prompts/true-false.ts`:

```ts
import { Card } from '@prisma/client';
import { TrueFalseStatementSchema } from '@/lib/ai/schemas';
import { CORRUPTIONS } from '@/lib/quiz/options';
import type { PromptKlp } from './multiple-choice';

export interface TrueFalseBuildInput {
  card: Card;
  klps: PromptKlp[];
}

/**
 * Builds the FALSE half of a true/false question: a statement that corrupts
 * exactly one KLP. The TRUE half needs no generation — it is the card's own
 * definition. Routed via task 'distractors'.
 */
export const TRUE_FALSE_PROMPT = {
  id: 'true-false',
  version: 1,
  schema: TrueFalseStatementSchema,

  build(input: TrueFalseBuildInput): string {
    const klpList = input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n');

    return `You are a finance interview expert writing a true/false question.

Term: ${input.card.term}
Correct Definition: ${input.card.definition}

Key Learning Points this card teaches:
${klpList}

Rewrite the definition into a statement that is FALSE.

Requirements:
1. Corrupt EXACTLY ONE Key Learning Point, named by its klpRef.
2. Use exactly one corruption from: ${CORRUPTIONS.join(', ')}.
3. Leave every other part of the definition intact and correct. A statement
   wrong in several ways cannot tell us which point the candidate missed.
4. Keep it plausible. A statement that is obviously absurd is rejected without
   the candidate ever engaging with the learning point, which tests nothing.
5. Do not signal falsity through hedging, vagueness, or unusual phrasing. It
   must read exactly like a confident, correct definition.

Output JSON:
{ "statement": string, "klpRef": number, "corruption": string }`;
  },
};
```

Register it in `src/lib/ai/prompts/registry.ts` following the Task 4 pattern
(export, type export, import, and `[TRUE_FALSE_PROMPT.id]: TRUE_FALSE_PROMPT`).

- [ ] **Step 8: Add the `getTrueFalseQuestion` action**

Append to `src/actions/quiz.ts`:

```ts
/**
 * Resolves this attempt's true/false question for a card, generating it on
 * first request and returning ONLY the statement.
 *
 * The answer key lives in QuizQuestion.isTrue and never crosses the wire.
 * Before this existed the client rendered the real definition and
 * submitTrueFalseAnswer hardcoded `correctAnswer: 'true'`, so every true/false
 * answer was correct and the mode fed free correctness into study memory.
 */
export async function getTrueFalseQuestion(
  attemptId: string,
  cardId: string,
): Promise<ActionResult<{ statement: string }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  try {
    const attempt = await prisma.quizAttempt.findFirst({
      where: { id: attemptId, userId: session.user.id },
      select: { id: true },
    });
    if (!attempt) return { success: false, error: 'Attempt not found' };

    // Already generated: return the same statement. Re-flipping on a revisit
    // would change the question under the user mid-attempt.
    const existing = await prisma.quizQuestion.findUnique({
      where: { attemptId_cardId_mode: { attemptId, cardId, mode: 'true-false' } },
    });
    if (existing?.statement) return { success: true, data: { statement: existing.statement } };

    const card = await prisma.card.findUnique({ where: { id: cardId } });
    if (!card) return { success: false, error: 'Card not found' };

    const klps = await ensureKlpsReady(session.user.id, cardId);

    let statement = card.definition;
    let isTrue = true;
    let targetKlpIds: string[] = klps.map((k) => k.id);

    if (klps.length > 0 && pickTfVariant() === 'false') {
      try {
        const generated = await generateJson({
          userId: session.user.id,
          task: 'distractors',
          prompt: TRUE_FALSE_PROMPT.build({
            card,
            klps: klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind })),
          }),
          schema: TrueFalseStatementSchema,
        });
        statement = generated.statement;
        isTrue = false;
        const target = klps[generated.klpRef]?.id;
        targetKlpIds = target ? [target] : targetKlpIds;
      } catch (err) {
        // Generation failed: fall back to the true variant rather than
        // failing the question. Still diagnosable — just not this time.
        console.error('TF statement generation failed:', err);
      }
    }

    await prisma.quizQuestion.create({
      data: {
        attemptId,
        cardId,
        mode: 'true-false',
        statement,
        isTrue,
        targetKlpIds,
        klpVersion: card.klpVersion,
      },
    });

    return { success: true, data: { statement } };
  } catch (err) {
    console.error('getTrueFalseQuestion failed:', err);
    return { success: false, error: 'Failed to load question' };
  }
}
```

Add the imports `pickTfVariant`, `TRUE_FALSE_PROMPT`, and `TrueFalseStatementSchema`.

- [ ] **Step 9: Run the tests**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/lib/quiz/coin-flip.ts src/lib/ai/prompts/true-false.ts src/lib/ai/schemas.ts src/lib/ai/prompts/registry.ts src/actions/quiz.ts tests/quiz/coin-flip.test.ts tests/ai/prompts.test.ts
git commit -m "feat(quiz): generate true/false statements by corrupting a KLP, server-side flip"
```

---

### Task 11: Grade true/false against the persisted answer key

**Files:**
- Modify: `src/actions/quiz.ts` (`submitTrueFalseAnswer`, ~lines 310-400)

**Interfaces:**
- Consumes: `QuizQuestion` (Task 2), `getTrueFalseQuestion` (Task 10)
- Produces: `submitTrueFalseAnswer` grades against `QuizQuestion.isTrue`; records `unscored` when no question row exists

**This is the bug fix.** `isCorrect` is currently `input.selectedOption === 'true'` — always correct.

- [ ] **Step 1: Grade against the stored key**

In `submitTrueFalseAnswer`, replace the correctness computation (lines 319-320):

```ts
  const question = await prisma.quizQuestion.findUnique({
    where: {
      attemptId_cardId_mode: {
        attemptId: input.attemptId,
        cardId: input.cardId,
        mode: 'true-false',
      },
    },
  });

  // No question row means this answer predates Task 10, or generation never
  // ran. There is no answer key, so the answer is recorded UNSCORED rather
  // than graded against an assumption. The old code assumed "true" and marked
  // every such answer correct, feeding free correctness into study memory.
  const isCorrect =
    question && question.isTrue !== null
      ? (input.selectedOption === 'true') === question.isTrue
      : null;
  const score = isCorrect === null ? null : isCorrect ? 100 : 0;
```

- [ ] **Step 2: Persist the unscored case honestly**

In the same function, the `quizAnswer.create` call must reflect the real key:

```ts
      data: {
        attemptId: input.attemptId,
        userId: session.user.id,
        cardId: input.cardId,
        mode: 'true-false',
        prompt: question?.statement ?? 'True/False',
        correctAnswer: question?.isTrue === false ? 'false' : 'true',
        selectedOption: input.selectedOption,
        isCorrect,
        score,
        latencyMs: normalizeLatency(input.latencyMs),
        feedback,
      },
```

- [ ] **Step 3: Skip the memory write when unscored**

Replace the `recordStudyEvent` call so an unscored answer does not move confidence:

```ts
    if (isCorrect !== null) {
      try {
        await recordStudyEvent({
          userId: session.user.id,
          cardId: input.cardId,
          source: 'quiz-tf',
          sessionId: attempt?.sessionId ?? undefined,
          outcome: { correct: isCorrect },
          meta: { latencyMs: input.latencyMs },
        });
      } catch (memErr) {
        console.error('recordStudyEvent failed for quiz-tf:', memErr);
      }
    }
```

- [ ] **Step 4: Give the feedback call the real correct answer**

The `MC_FEEDBACK_PROMPT.build` call currently passes `correct: 'true'`
unconditionally. Change it to `correct: question?.isTrue === false ? 'false' : 'true'`.

- [ ] **Step 5: Update the return type**

`submitTrueFalseAnswer` returns `{ isCorrect: boolean; score: number; feedback?: string }`.
Widen to `{ isCorrect: boolean | null; score: number | null; feedback?: string }` and
fix the call site in `TrueFalseQuiz.tsx` (Task 12 rewrites it anyway).

- [ ] **Step 6: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/actions/quiz.ts
git commit -m "fix(quiz): grade true/false against the stored answer key instead of always true"
```

---

### Task 12: True/false client reads the server-supplied statement

**Files:**
- Modify: `src/components/quiz/TrueFalseQuiz.tsx`

**Interfaces:**
- Consumes: `getTrueFalseQuestion` (Task 10)
- Produces: no new exports

- [ ] **Step 1: Fetch the statement for the visible card**

In `src/components/quiz/TrueFalseQuiz.tsx`, add state and a fetch effect
alongside the existing timer effect (line 34):

```tsx
    const [statements, setStatements] = useState<{ [cardId: string]: string }>({});
    const [loadingId, setLoadingId] = useState<string | null>(null);

    // The statement is generated server-side and may be a KLP-corrupted
    // variant, so it CANNOT be derived from the card on the client.
    useEffect(() => {
      const activeId = cards[currentIndex]?.id;
      if (!activeId || statements[activeId]) return;

      let cancelled = false;
      setLoadingId(activeId);
      getTrueFalseQuestion(attemptId, activeId).then((res) => {
        if (cancelled) return;
        setLoadingId(null);
        if (res.success && res.data) {
          setStatements((prev) => ({ ...prev, [activeId]: res.data!.statement }));
        } else {
          showError(res.error || 'Failed to load question');
        }
      });
      return () => {
        cancelled = true;
      };
    }, [cards, currentIndex, attemptId, statements, showError]);
```

Add `getTrueFalseQuestion` to the `@/actions/quiz` import.

- [ ] **Step 2: Render the statement instead of the definition**

Replace the definition block (lines ~77-81):

```tsx
            <div className="p-4 bg-muted rounded-lg space-y-2 text-left">
              <p className="font-bold text-sm text-muted-foreground uppercase tracking-wider">
                Statement
              </p>
              {loadingId === card.id ? (
                <p className="text-muted-foreground">Loading…</p>
              ) : (
                <p>{statements[card.id] ?? ''}</p>
              )}
            </div>

            <p className="text-sm text-muted-foreground text-center">
              Is this statement correct?
            </p>
```

Note this replaces `<QuizCardPrompt card={card} side="definition" />`. The
statement is generated text, not the card's stored content, so the rich-content
renderer no longer applies to this side.

- [ ] **Step 3: Block answering until the statement has loaded**

A user must not be able to answer a blank question — the timer is already
running, and the answer would be recorded against a statement they never saw.
Add above the return:

```tsx
    const statementReady = Boolean(statements[card.id]) && loadingId !== card.id;
```

and disable both buttons in the existing `['true', 'false'].map(...)` block:

```tsx
                <Button
                  key={val}
                  type="button"
                  disabled={!statementReady}
                  variant={selectedAnswers[card.id] === val ? 'default' : 'outline'}
                  onClick={() => setSelectedAnswers(prev => ({ ...prev, [card.id]: val }))}
```

- [ ] **Step 4: Verify manually**

Run the app, start a true/false quiz on a set with KLPs, and answer several
questions. Expected: some statements are subtly wrong; answering "true" to one
of those is now marked incorrect. Before this task every answer was correct.

- [ ] **Step 5: Verify the suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/quiz/TrueFalseQuiz.tsx
git commit -m "feat(quiz): render server-generated true/false statements"
```

---

### Task 13: View and edit KLPs in the set builder

**Files:**
- Create: `src/components/sets/KlpEditor.tsx`
- Modify: `src/actions/klp.ts`, `src/components/sets/CardRow.tsx`

**Interfaces:**
- Consumes: `ReadyKlp` (Task 5)
- Produces: `getCardKlps(cardId): Promise<ActionResult<{ status: string; klps: ReadyKlp[] }>>`; `saveCardKlp(klpId, patch): Promise<ActionResult<void>>`; `retryKlpExtraction(cardId): Promise<ActionResult<void>>`

**Why editing matters:** without it, one bad extraction is permanent, and every question and error tag generated from that card inherits the flaw.

- [ ] **Step 1: Add the actions**

Append to `src/actions/klp.ts`:

```ts
/**
 * KLPs for one card, for the set builder. Owner-checked: KLP text is derived
 * from card content, so it must not leak across accounts.
 */
export async function getCardKlps(
  cardId: string,
): Promise<ActionResult<{ status: string; klps: ReadyKlp[] }>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId: session.user.id } },
    select: { klpStatus: true },
  });
  if (!card) return { success: false, error: 'Card not found' };

  const klps = await prisma.cardKlp.findMany({
    where: { cardId, supersededAt: null },
    orderBy: { index: 'asc' },
    select: { id: true, index: true, text: true, weight: true, kind: true },
  });

  return { success: true, data: { status: card.klpStatus, klps } };
}

/**
 * Corrects one KLP in place, marking it user-authored.
 *
 * Also stamps the card's current content hash so the next save does not treat
 * the card as stale and re-extract over the correction.
 */
export async function saveCardKlp(
  klpId: string,
  patch: { text: string; weight: number; kind: string },
): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const klp = await prisma.cardKlp.findFirst({
    where: { id: klpId, card: { set: { userId: session.user.id } } },
    include: { card: { include: { contentBlocks: true } } },
  });
  if (!klp) return { success: false, error: 'Not found' };

  await prisma.$transaction([
    prisma.cardKlp.update({
      where: { id: klpId },
      data: { text: patch.text, weight: patch.weight, kind: patch.kind, source: 'user' },
    }),
    prisma.card.update({
      where: { id: klp.cardId },
      data: {
        klpSourceHash: klpSourceHash({
          term: klp.card.term,
          definition: klp.card.definition,
          blocks: klp.card.contentBlocks,
        }),
        klpStatus: 'ready',
      },
    }),
  ]);

  revalidatePath(`/sets/${klp.card.setId}/edit`);
  return { success: true, data: undefined };
}

/** Re-runs extraction for one card after a failure. */
export async function retryKlpExtraction(cardId: string): Promise<ActionResult<void>> {
  const session = await auth();
  if (!session?.user?.id) return { success: false, error: 'Unauthorized' };

  const card = await prisma.card.findFirst({
    where: { id: cardId, set: { userId: session.user.id } },
    select: { id: true },
  });
  if (!card) return { success: false, error: 'Card not found' };

  await extractKlpsForCards(session.user.id, [cardId]);
  return { success: true, data: undefined };
}
```

Add the imports `auth` from `@/auth`, `revalidatePath` from `next/cache`, and
the `ActionResult` type used across `src/actions/`.

- [ ] **Step 2: Build the editor component**

Create `src/components/sets/KlpEditor.tsx`:

```tsx
'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { KLP_KINDS } from '@/lib/ai/schemas'
import { getCardKlps, saveCardKlp, retryKlpExtraction } from '@/actions/klp'
import { toast } from 'sonner'

interface Klp {
  id: string
  index: number
  text: string
  weight: number
  kind: string
}

/**
 * Per-card KLP panel in the set builder. Collapsed by default and loaded on
 * expand — a 100-card set must not fire 100 queries on page load.
 */
export function KlpEditor({ cardId }: { cardId: string }) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [klps, setKlps] = useState<Klp[]>([])
  const [busy, setBusy] = useState(false)

  async function load() {
    setBusy(true)
    const res = await getCardKlps(cardId)
    setBusy(false)
    if (!res.success || !res.data) {
      toast.error(res.error || 'Failed to load learning points')
      return
    }
    setStatus(res.data.status)
    setKlps(res.data.klps)
  }

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && status === null) void load()
  }

  function patch(id: string, changes: Partial<Klp>) {
    setKlps((prev) => prev.map((k) => (k.id === id ? { ...k, ...changes } : k)))
  }

  async function save(klp: Klp) {
    const res = await saveCardKlp(klp.id, {
      text: klp.text,
      weight: klp.weight,
      kind: klp.kind,
    })
    if (res.success) toast.success('Learning point saved')
    else toast.error(res.error || 'Failed to save')
  }

  async function retry() {
    setBusy(true)
    await retryKlpExtraction(cardId)
    await load()
  }

  return (
    <div className="mt-3 border-t pt-3">
      <button type="button" onClick={toggle} className="text-sm text-muted-foreground underline">
        {open ? 'Hide' : 'Show'} key learning points
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {busy && <p className="text-sm text-muted-foreground">Loading…</p>}

          {!busy && status === 'pending' && (
            <p className="text-sm text-muted-foreground">Analyzing this card…</p>
          )}

          {!busy && status === 'skipped' && (
            <p className="text-sm text-muted-foreground">
              Add an AI key in Settings to analyze this card.
            </p>
          )}

          {!busy && status === 'failed' && (
            <div className="space-y-2">
              <p className="text-sm text-destructive">Analysis failed for this card.</p>
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          )}

          {!busy &&
            status === 'ready' &&
            klps.map((klp) => (
              <div key={klp.id} className="flex flex-wrap items-center gap-2">
                <Input
                  value={klp.text}
                  onChange={(e) => patch(klp.id, { text: e.target.value })}
                  className="flex-1 min-w-[16rem]"
                />
                <select
                  value={klp.kind}
                  onChange={(e) => patch(klp.id, { kind: e.target.value })}
                  className="border rounded px-2 py-1 text-sm"
                >
                  {KLP_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <select
                  value={klp.weight}
                  onChange={(e) => patch(klp.id, { weight: Number(e.target.value) })}
                  className="border rounded px-2 py-1 text-sm"
                  title="How central this point is to the card"
                >
                  {[1, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={() => save(klp)}>
                  Save
                </Button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
```

Note the status branches are exhaustive by design. `skipped` deliberately has
**no Retry button** — there is nothing to retry until the user adds a key, and
offering one would just reproduce the same failure.

- [ ] **Step 3: Mount it in the card editor**

Render `<KlpEditor cardId={...} />` inside `src/components/sets/CardRow.tsx`,
only when the card has an id (a card being created for the first time has no
KLPs yet).

- [ ] **Step 4: Verify manually**

Edit a set, expand a card's KLP panel, change a KLP's text and weight, save, and
reload. Expected: the edit persists and the row is marked user-authored:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT "text", "weight", "kind", "source" FROM "CardKlp" WHERE "supersededAt" IS NULL LIMIT 5;
SQL
```

Then save the whole set without touching that card and confirm the KLP is not
re-extracted (its `source` stays `user`).

- [ ] **Step 5: Verify the suite**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sets/KlpEditor.tsx src/actions/klp.ts src/components/sets/CardRow.tsx
git commit -m "feat(sets): view, edit, and retry KLPs in the set builder"
```

---

## Done when

- Editing a set preserves card ids, and with them every card's confidence,
  mastery, scheduling state, and answer history.
- Every card carries 1-5 versioned KLPs, extracted post-response and batched.
- MC distractors record which KLP they corrupt and how.
- True/false shows a real coin-flipped statement and grades against a stored
  answer key — the always-true bug is gone.
- A user with no AI credential still gets a working quiz on every mode.
