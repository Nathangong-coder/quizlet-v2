# Stage 3.6 — Categorization System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users label any flashcard with one or more custom, colored, set-scoped categories, see those categories on flashcards and the terms list, and filter every study activity (Quiz, Matching game, Review mode, Flashcard carousel) to specific categories.

**Architecture:** The data model already exists (`CardCategory`, `CardCategoryAssignment`); this plan completes the unbuilt authoring, display, and filtering layers and wires the existing dead quiz filter to real data. Category authoring is **all-in-memory in `SetForm` and persisted transactionally on save** through `createSet`/`updateSet` — this matches the codebase's existing "delete-and-recreate cards on every edit" pattern and avoids inconsistency between per-card assignments (deferred until save) and category CRUD. Filtering for server-rendered activities (match, review) is **query-param-driven** (`?cat=<id,id>`); the flashcard carousel filters client-side. All four activities share one pure, tested filter predicate.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (Postgres/Neon), Zod 4, Vitest 4 (node env, `@/` alias resolved), Tailwind + shadcn/ui, lucide-react.

## Global Constraints

- Preserve existing text-only cards and imports; a set with no categories must behave exactly as today (no filter params = all cards; empty `categoryIds` = all cards).
- All mutations use Next.js server actions and are owner-checked (`set.userId === session.user.id`).
- Validate all action inputs with Zod.
- Category names are **set-scoped** and user-defined; normalize with the existing `normalizeCategoryName` and dedupe by `normalizedName`. Never hard-code domain categories (e.g. "accounting") outside tests/examples.
- Category colors are hex strings drawn from `CATEGORY_PALETTE`; `CardCategory.color` is nullable and a null color renders as a neutral chip.
- Filter semantics across selected categories are **OR** (a card matches if it has ANY selected category); an "Uncategorized" bucket (sentinel id `UNCATEGORIZED_ID`) matches cards with no assignments.
- Vitest runs in `node` — there is **no** component/integration test harness (no jsdom, no testing-library). Write real TDD only for pure functions; verify UI/actions manually via the dev server + `npm run build`/`npm run lint`. Do not fabricate component tests.
- This work is **not** on the default branch: create a feature branch before the first commit (e.g. `git checkout -b stage-3.6-categorization`).
- Test command: `npm test` (all) or `npx vitest run <file>` (one file).

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                                  # MODIFY: add CardCategory.color
├── src/
│   ├── actions/
│   │   └── sets.ts                                     # MODIFY: persist categories + assignments on create/update
│   ├── app/sets/[id]/
│   │   ├── page.tsx                                    # MODIFY: load + pass per-card categories
│   │   ├── edit/page.tsx                               # MODIFY: load categories + assignments into SetForm
│   │   ├── quiz/page.tsx                               # MODIFY: pass category colors through
│   │   ├── match/page.tsx                              # MODIFY: category filter via ?cat=
│   │   └── review/page.tsx                             # MODIFY: category filter via ?cat=
│   ├── components/
│   │   ├── cards/
│   │   │   └── CategoryChip.tsx                        # NEW: colored display chip
│   │   ├── sets/
│   │   │   ├── CategoryPicker.tsx                      # REWRITE: autocomplete tag input
│   │   │   ├── CategoryManager.tsx                     # NEW: rename/merge/recolor/delete panel
│   │   │   ├── CategoryFilterBar.tsx                   # NEW: shared controlled filter chips
│   │   │   ├── CategoryUrlFilter.tsx                   # NEW: URL adapter for match/review
│   │   │   ├── CardRow.tsx                             # MODIFY: mount CategoryPicker
│   │   │   ├── SetForm.tsx                             # MODIFY: category state + manager + submit payload
│   │   │   └── TermsList.tsx                           # MODIFY: render chips per card
│   │   ├── flashcard/
│   │   │   ├── FlashcardSection.tsx                    # MODIFY: client-side category filter
│   │   │   └── FlashcardCarousel.tsx                   # MODIFY: render chips for current card
│   │   └── quiz/
│   │       ├── QuizClientWrapper.tsx                   # MODIFY: pass color through
│   │       └── QuizSetupScreen.tsx                     # MODIFY: colored chips + Uncategorized option
│   └── lib/
│       ├── cards/categories.ts                         # MODIFY: palette, pickDefaultColor, filter predicate, collectSetCategories, UNCATEGORIZED_ID
│       └── quiz/setup.ts                               # MODIFY: filterQuizCards delegates category logic
├── tests/
│   ├── cards/categories.test.ts                        # MODIFY: palette, filter, collect tests
│   └── quiz/setup.test.ts                              # MODIFY: uncategorized + still-green existing tests
├── docs/superpowers/
│   ├── specs/2026-07-05-stage3-6-categorization-system-design.md   # (design, already written)
│   └── plans/2026-07-05-stage3-6-categorization-system.md          # (this plan)
└── CLAUDE.md                                           # MODIFY: add Stage 3.6, correct false 3.5 claim
```

---

## Task 1: Add `color` to `CardCategory` (schema + migration)

**Files:**
- Modify: `prisma/schema.prisma:65-76` (the `CardCategory` model)

**Interfaces:**
- Produces: `CardCategory.color: String?` column available to all later tasks.

- [ ] **Step 1: Add the column**

In `prisma/schema.prisma`, change the `CardCategory` model so it reads:

```prisma
model CardCategory {
  id             String                   @id @default(cuid())
  setId          String
  name           String
  normalizedName String
  color          String?
  createdAt      DateTime                 @default(now())
  set            Set                      @relation(fields: [setId], references: [id], onDelete: Cascade)
  assignments    CardCategoryAssignment[]

  @@unique([setId, normalizedName])
  @@index([setId])
}
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_category_color`
Expected: a new folder `prisma/migrations/<timestamp>_add_category_color/` with a migration that runs `ALTER TABLE "CardCategory" ADD COLUMN "color" TEXT;`, applied to the dev DB, and "✔ Generated Prisma Client".

> Requires a reachable `DATABASE_URL`. If the dev DB is unavailable, generate SQL only with `npx prisma migrate diff` and apply later — but do not proceed to Task 5's manual verification until the column exists.

- [ ] **Step 3: Verify the client picked up the field**

Run: `npx prisma validate`
Expected: "The schema at prisma/schema.prisma is valid 🚀"

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(categories): add color column to CardCategory"
```

---

## Task 2: Category palette + `pickDefaultColor` (pure, TDD)

**Files:**
- Modify: `src/lib/cards/categories.ts`
- Test: `tests/cards/categories.test.ts`

**Interfaces:**
- Produces:
  - `CATEGORY_PALETTE: string[]` (10 hex swatches)
  - `pickDefaultColor(existingColors: string[]): string`

- [ ] **Step 1: Write the failing test**

Append to `tests/cards/categories.test.ts`:

```ts
import {
  normalizeCategoryName,
  parseCategoryInput,
  CATEGORY_PALETTE,
  pickDefaultColor,
} from "../../src/lib/cards/categories";

describe("category colors", () => {
  it("has a non-empty palette of hex colors", () => {
    expect(CATEGORY_PALETTE.length).toBeGreaterThanOrEqual(8);
    for (const c of CATEGORY_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("picks the first unused palette color", () => {
    expect(pickDefaultColor([])).toBe(CATEGORY_PALETTE[0]);
    expect(pickDefaultColor([CATEGORY_PALETTE[0]])).toBe(CATEGORY_PALETTE[1]);
  });

  it("cycles when all palette colors are used", () => {
    const all = [...CATEGORY_PALETTE];
    expect(CATEGORY_PALETTE).toContain(pickDefaultColor(all));
  });
});
```

> Note: the top-of-file import `import { normalizeCategoryName, parseCategoryInput } from ...` already exists — merge the new names into that existing import line instead of adding a duplicate import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards/categories.test.ts`
Expected: FAIL — `CATEGORY_PALETTE`/`pickDefaultColor` are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/cards/categories.ts`:

```ts
export const CATEGORY_PALETTE = [
  "#ef4444", // red
  "#f97316", // orange
  "#eab308", // yellow
  "#22c55e", // green
  "#14b8a6", // teal
  "#3b82f6", // blue
  "#6366f1", // indigo
  "#a855f7", // purple
  "#ec4899", // pink
  "#78716c", // stone
];

export function pickDefaultColor(existingColors: string[]): string {
  const used = new Set(existingColors);
  const free = CATEGORY_PALETTE.find((c) => !used.has(c));
  return free ?? CATEGORY_PALETTE[existingColors.length % CATEGORY_PALETTE.length];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cards/categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cards/categories.ts tests/cards/categories.test.ts
git commit -m "feat(categories): add color palette and default-color picker"
```

---

## Task 3: Shared category filter predicate (pure, TDD)

**Files:**
- Modify: `src/lib/cards/categories.ts`
- Modify: `src/lib/quiz/setup.ts:19-38` (`filterQuizCards` delegates)
- Test: `tests/cards/categories.test.ts`, `tests/quiz/setup.test.ts`

**Interfaces:**
- Produces:
  - `UNCATEGORIZED_ID = "__uncategorized__"`
  - `filterCardsByCategories<T extends { categoryIds?: string[] }>(cards: T[], selectedCategoryIds: string[]): T[]`
- Consumes: `filterQuizCards` (Task 12/quiz), match/review pages (Tasks 13/14) all call `filterCardsByCategories`.

- [ ] **Step 1: Write the failing test**

Append to `tests/cards/categories.test.ts`:

```ts
import { filterCardsByCategories, UNCATEGORIZED_ID } from "../../src/lib/cards/categories";

describe("filterCardsByCategories", () => {
  const cards = [
    { id: "a", categoryIds: ["c1"] },
    { id: "b", categoryIds: ["c2"] },
    { id: "c", categoryIds: ["c1", "c2"] },
    { id: "d", categoryIds: [] },
    { id: "e" }, // no categoryIds field at all
  ];

  it("returns all cards when nothing is selected", () => {
    expect(filterCardsByCategories(cards, []).map((c) => c.id)).toEqual([
      "a", "b", "c", "d", "e",
    ]);
  });

  it("ORs across selected categories", () => {
    expect(filterCardsByCategories(cards, ["c1"]).map((c) => c.id)).toEqual(["a", "c"]);
    expect(filterCardsByCategories(cards, ["c1", "c2"]).map((c) => c.id)).toEqual([
      "a", "b", "c",
    ]);
  });

  it("matches uncategorized cards via the sentinel", () => {
    expect(filterCardsByCategories(cards, [UNCATEGORIZED_ID]).map((c) => c.id)).toEqual([
      "d", "e",
    ]);
  });

  it("combines a real category with uncategorized", () => {
    expect(filterCardsByCategories(cards, ["c1", UNCATEGORIZED_ID]).map((c) => c.id)).toEqual([
      "a", "c", "d", "e",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards/categories.test.ts`
Expected: FAIL — `filterCardsByCategories`/`UNCATEGORIZED_ID` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/cards/categories.ts`:

```ts
export const UNCATEGORIZED_ID = "__uncategorized__";

export function filterCardsByCategories<T extends { categoryIds?: string[] }>(
  cards: T[],
  selectedCategoryIds: string[],
): T[] {
  if (!selectedCategoryIds || selectedCategoryIds.length === 0) return cards;
  const wantUncategorized = selectedCategoryIds.includes(UNCATEGORIZED_ID);
  const realIds = selectedCategoryIds.filter((id) => id !== UNCATEGORIZED_ID);
  return cards.filter((card) => {
    const ids = card.categoryIds ?? [];
    if (wantUncategorized && ids.length === 0) return true;
    return realIds.some((id) => ids.includes(id));
  });
}
```

- [ ] **Step 4: Refactor `filterQuizCards` to delegate**

In `src/lib/quiz/setup.ts`, add the import at the top:

```ts
import { filterCardsByCategories } from "@/lib/cards/categories";
```

Replace the whole `filterQuizCards` function (lines 19-38) with:

```ts
export function filterQuizCards(cards: any[], setup: QuizSetup, quizAnswers: any[] = []) {
  const base = cards.filter((card) => {
    if (!card) return false;
    if (setup.starredOnly && (card.starred === false || card.starred === undefined)) return false;
    if (setup.failedOnly && !isPreviouslyFailed(card.id, quizAnswers)) return false;
    return true;
  });
  return filterCardsByCategories(base, setup.categoryIds);
}
```

- [ ] **Step 5: Run both test files to verify all pass**

Run: `npx vitest run tests/cards/categories.test.ts tests/quiz/setup.test.ts`
Expected: PASS, including the pre-existing `filters categories` / `filters starred only` / `filters failed only` tests (behavior is unchanged for them).

- [ ] **Step 6: Commit**

```bash
git add src/lib/cards/categories.ts src/lib/quiz/setup.ts tests/cards/categories.test.ts
git commit -m "feat(categories): shared card filter predicate with uncategorized bucket"
```

---

## Task 4: `collectSetCategories` save helper (pure, TDD)

**Files:**
- Modify: `src/lib/cards/categories.ts`
- Test: `tests/cards/categories.test.ts`

**Interfaces:**
- Produces:
  - `interface CategoryMetaInput { name: string; color?: string | null }`
  - `interface CollectedCategory { name: string; normalizedName: string; color: string | null }`
  - `collectSetCategories(cards: { categoryNames?: string[] }[], meta?: CategoryMetaInput[]): CollectedCategory[]`
- Consumes: used by `createSet`/`updateSet` in Task 5.

- [ ] **Step 1: Write the failing test**

Append to `tests/cards/categories.test.ts`:

```ts
import { collectSetCategories } from "../../src/lib/cards/categories";

describe("collectSetCategories", () => {
  it("dedupes meta by normalized name, keeping first display name + color", () => {
    const result = collectSetCategories([], [
      { name: "Accounting", color: "#ef4444" },
      { name: "accounting ", color: "#000000" },
    ]);
    expect(result).toEqual([
      { name: "Accounting", normalizedName: "accounting", color: "#ef4444" },
    ]);
  });

  it("adds card-referenced names missing from meta with a null color", () => {
    // normalizeCategoryName only lowercases/trims and replaces whitespace runs
    // with "-", so "Discount Rate" -> "discount-rate".
    const result = collectSetCategories(
      [{ categoryNames: ["Valuation"] }, { categoryNames: ["valuation", "Discount Rate"] }],
      [{ name: "Accounting", color: "#ef4444" }],
    );
    expect(result).toEqual([
      { name: "Accounting", normalizedName: "accounting", color: "#ef4444" },
      { name: "Valuation", normalizedName: "valuation", color: null },
      { name: "Discount Rate", normalizedName: "discount-rate", color: null },
    ]);
  });

  it("ignores blank names", () => {
    expect(collectSetCategories([{ categoryNames: ["", "  "] }], [{ name: " " }])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cards/categories.test.ts`
Expected: FAIL — `collectSetCategories` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/cards/categories.ts`:

```ts
export interface CategoryMetaInput {
  name: string;
  color?: string | null;
}

export interface CollectedCategory {
  name: string;
  normalizedName: string;
  color: string | null;
}

export function collectSetCategories(
  cards: { categoryNames?: string[] }[],
  meta: CategoryMetaInput[] = [],
): CollectedCategory[] {
  const byNormalized = new Map<string, CollectedCategory>();

  const add = (rawName: string, color: string | null) => {
    const name = rawName.trim();
    if (!name) return;
    const normalizedName = normalizeCategoryName(name);
    if (!normalizedName) return;
    if (!byNormalized.has(normalizedName)) {
      byNormalized.set(normalizedName, { name, normalizedName, color });
    }
  };

  // Explicit meta wins (display name + chosen color).
  for (const m of meta) add(m.name, m.color ?? null);

  // Defensive: ensure names referenced by cards exist even if meta missed them.
  for (const card of cards) {
    for (const n of card.categoryNames ?? []) add(n, null);
  }

  return Array.from(byNormalized.values());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cards/categories.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cards/categories.ts tests/cards/categories.test.ts
git commit -m "feat(categories): collectSetCategories save helper"
```

---

## Task 5: Persist categories + assignments on set save

**Files:**
- Modify: `src/actions/sets.ts`

**Interfaces:**
- Consumes: `collectSetCategories`, `normalizeCategoryName` from `@/lib/cards/categories`.
- Produces: `createSet`/`updateSet` now accept `cards[].categoryNames?: string[]` and top-level `categories?: { name: string; color?: string | null }[]`, and persist `CardCategory` rows + `CardCategoryAssignment`s.

- [ ] **Step 1: Add the import**

At the top of `src/actions/sets.ts`, after the existing `ContentBlock` import:

```ts
import { collectSetCategories, normalizeCategoryName } from '@/lib/cards/categories'
```

- [ ] **Step 2: Extend the Zod schemas**

Change `CardInputSchema` (add `categoryNames`):

```ts
const CardInputSchema = z.object({
  term: z.string().min(1, 'Term is required'),
  definition: z.string().min(1, 'Definition is required'),
  termBlocks: z.array(z.any()).optional(),
  definitionBlocks: z.array(z.any()).optional(),
  categoryNames: z.array(z.string()).optional(),
  position: z.number().int().min(0),
})
```

Change `SetInputSchema` (add `categories`):

```ts
const SetInputSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  description: z.string().max(1000, 'Description too long').optional(),
  cards: z.array(CardInputSchema).min(1, 'At least one card is required'),
  categories: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        color: z.string().max(32).nullable().optional(),
      }),
    )
    .optional(),
})
```

- [ ] **Step 3: Add a card-create builder**

Add near `buildContentBlockCreate`:

```ts
function buildCardCreate(
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
    contentBlocks: { create: buildContentBlockCreate(card) },
    categoryAssignments: { create: categoryIds.map((categoryId) => ({ categoryId })) },
  }
}
```

- [ ] **Step 4: Rewrite `createSet`**

Replace the body of `createSet` (the `try` block, keeping the surrounding `try/catch` error handling) with:

```ts
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    const validated = SetInputSchema.parse(input)
    const collected = collectSetCategories(validated.cards, validated.categories ?? [])

    // Create the set + its categories first so we can map names -> ids.
    const set = await prisma.set.create({
      data: {
        title: validated.title,
        description: validated.description,
        userId: session.user.id,
        categories: {
          create: collected.map((c) => ({
            name: c.name,
            normalizedName: c.normalizedName,
            color: c.color,
          })),
        },
      },
      include: { categories: true },
    })

    const map = Object.fromEntries(set.categories.map((c) => [c.normalizedName, c.id]))

    await prisma.$transaction(
      validated.cards.map((card) =>
        prisma.card.create({ data: { setId: set.id, ...buildCardCreate(card, map) } }),
      ),
    )

    await backfillAssetLinks(set.id, session.user.id, validated.cards)

    revalidatePath('/sets')
    return { success: true, data: { setId: set.id } }
```

- [ ] **Step 5: Rewrite `updateSet`**

Replace the body of `updateSet` (inside `try`, after ownership check) so the whole `try` reads:

```ts
    const session = await auth()
    if (!session?.user?.id) {
      return { success: false, error: 'Authentication required' }
    }

    const validated = SetInputSchema.parse(input)

    const existing = await prisma.set.findUnique({ where: { id } })
    if (!existing) return { success: false, error: 'Set not found' }
    if (existing.userId !== session.user.id) return { success: false, error: 'Unauthorized' }

    const collected = collectSetCategories(validated.cards, validated.categories ?? [])

    // Reconcile the set's categories: drop removed ones (cascades assignments),
    // upsert the rest so surviving category ids stay stable across edits.
    await prisma.$transaction([
      prisma.cardCategory.deleteMany({
        where: { setId: id, normalizedName: { notIn: collected.map((c) => c.normalizedName) } },
      }),
      ...collected.map((c) =>
        prisma.cardCategory.upsert({
          where: { setId_normalizedName: { setId: id, normalizedName: c.normalizedName } },
          create: { setId: id, name: c.name, normalizedName: c.normalizedName, color: c.color },
          update: { name: c.name, color: c.color },
        }),
      ),
    ])

    const cats = await prisma.cardCategory.findMany({ where: { setId: id } })
    const map = Object.fromEntries(cats.map((c) => [c.normalizedName, c.id]))

    // Cards are fully replaced (existing behavior); assignments are recreated
    // against the reconciled categories using the new card ids.
    await prisma.$transaction([
      prisma.card.deleteMany({ where: { setId: id } }),
      ...validated.cards.map((card) =>
        prisma.card.create({ data: { setId: id, ...buildCardCreate(card, map) } }),
      ),
      prisma.set.update({
        where: { id },
        data: { title: validated.title, description: validated.description },
      }),
    ])

    await backfillAssetLinks(id, session.user.id, validated.cards)

    revalidatePath('/sets')
    revalidatePath(`/sets/${id}`)
    return { success: true, data: { setId: id } }
```

> Edge note: when `collected` is empty (user removed every category), `notIn: []` deletes all of the set's categories — which is correct. `collectSetCategories` defensively includes any card-referenced name, so a set whose cards still carry categories can never produce an empty `collected`, preventing accidental wipes.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `src/actions/sets.ts`. (Prisma types now include `categoryAssignments` nested create and `color` because Task 1 regenerated the client.)

- [ ] **Step 7: Commit**

```bash
git add src/actions/sets.ts
git commit -m "feat(categories): persist categories and assignments on set save"
```

> Manual verification of this task happens end-to-end in Task 7 (once the picker exists to produce `categoryNames`).

---

## Task 6: Rewrite `CategoryPicker` as an autocomplete tag input

**Files:**
- Rewrite: `src/components/sets/CategoryPicker.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface CategoryOption { name: string; color?: string | null }
  interface CategoryPickerProps {
    value: string[];
    available: CategoryOption[];
    onChange: (names: string[]) => void;
    onCreateCategory?: (name: string) => void;
  }
  export function CategoryPicker(props: CategoryPickerProps): JSX.Element
  ```
- Consumes: `normalizeCategoryName` from `@/lib/cards/categories`.

- [ ] **Step 1: Replace the file contents**

```tsx
import React, { useId, useState } from "react";
import { X } from "lucide-react";
import { normalizeCategoryName } from "@/lib/cards/categories";

interface CategoryOption {
  name: string;
  color?: string | null;
}

interface CategoryPickerProps {
  value: string[];
  available: CategoryOption[];
  onChange: (names: string[]) => void;
  onCreateCategory?: (name: string) => void;
}

export function CategoryPicker({
  value,
  available,
  onChange,
  onCreateCategory,
}: CategoryPickerProps) {
  const [input, setInput] = useState("");
  const listId = useId();

  const colorFor = (name: string) =>
    available.find(
      (c) => normalizeCategoryName(c.name) === normalizeCategoryName(name),
    )?.color ?? null;

  const addCategory = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    const norm = normalizeCategoryName(name);
    if (value.some((v) => normalizeCategoryName(v) === norm)) {
      setInput("");
      return;
    }
    const isNew = !available.some((c) => normalizeCategoryName(c.name) === norm);
    if (isNew) onCreateCategory?.(name);
    onChange([...value, name]);
    setInput("");
  };

  const removeCategory = (name: string) =>
    onChange(value.filter((v) => v !== name));

  const suggestions = available.filter(
    (c) => !value.some((v) => normalizeCategoryName(v) === normalizeCategoryName(c.name)),
  );

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((name) => {
            const color = colorFor(name);
            return (
              <span
                key={name}
                className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
                style={
                  color
                    ? { backgroundColor: `${color}20`, borderColor: color, color }
                    : undefined
                }
              >
                {name}
                <button
                  type="button"
                  onClick={() => removeCategory(name)}
                  aria-label={`Remove ${name}`}
                >
                  <X size={12} />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <input
        type="text"
        list={listId}
        placeholder="Add category..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            addCategory(input);
          }
        }}
        onBlur={() => {
          if (input.trim()) addCategory(input);
        }}
        className="w-full rounded border p-2 text-sm"
      />
      <datalist id={listId}>
        {suggestions.map((c) => (
          <option key={c.name} value={c.name} />
        ))}
      </datalist>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors. (`CardRow` still passes the old `categories` prop — that mismatch is fixed in Task 7; if `tsc` flags the old `CategoryPicker` callers, ignore until Task 7. `CategoryPicker` had no callers before, so there should be none.)

- [ ] **Step 3: Commit**

```bash
git add src/components/sets/CategoryPicker.tsx
git commit -m "feat(categories): autocomplete tag-input CategoryPicker"
```

---

## Task 7: Wire the picker into `CardRow` + `SetForm` state and submit

**Files:**
- Modify: `src/components/sets/CardRow.tsx`
- Modify: `src/components/sets/SetForm.tsx`

**Interfaces:**
- `CardRow` new props:
  ```ts
  categoryNames: string[];
  availableCategories: { name: string; color?: string | null }[];
  onCategoriesChange: (index: number, names: string[]) => void;
  onCreateCategory: (name: string) => void;
  ```
  (removes the old `categories: string[]` prop)
- `SetForm` new prop: `initialCategories?: { name: string; color?: string | null }[]`; `InitialCard` gains `categoryNames?: string[]`.
- Consumes: `CategoryPicker` (Task 6), `pickDefaultColor` + `normalizeCategoryName` (`@/lib/cards/categories`).

- [ ] **Step 1: Rewrite `CardRow.tsx`**

```tsx
'use client'

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Trash2 } from 'lucide-react'
import { RichCardSideEditor } from './RichCardSideEditor'
import { CategoryPicker } from './CategoryPicker'
import { ContentBlock } from '@/lib/cards/content'

interface CardRowProps {
  index: number
  termBlocks: ContentBlock[]
  definitionBlocks: ContentBlock[]
  categoryNames: string[]
  availableCategories: { name: string; color?: string | null }[]
  onChange: (index: number, side: 'term' | 'definition', blocks: ContentBlock[]) => void
  onCategoriesChange: (index: number, names: string[]) => void
  onCreateCategory: (name: string) => void
  onRemove: (index: number) => void
  onUploadStatusChange?: (isUploading: boolean) => void
  canRemove: boolean
  setId: string
}

export function CardRow({
  index,
  termBlocks,
  definitionBlocks,
  categoryNames,
  availableCategories,
  onChange,
  onCategoriesChange,
  onCreateCategory,
  onRemove,
  onUploadStatusChange,
  canRemove,
  setId,
}: CardRowProps) {
  const [, setIsUploading] = useState(false)

  const handleUploadChange = (uploading: boolean) => {
    setIsUploading(uploading)
    onUploadStatusChange?.(uploading)
  }

  return (
    <div className="flex gap-4 items-start mb-6 p-4 border rounded-lg bg-card">
      <div className="flex-1 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Term</label>
            <RichCardSideEditor
              blocks={termBlocks}
              side="term"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'term', blocks)}
              onUploadStatusChange={handleUploadChange}
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs font-semibold text-muted-foreground uppercase">Definition</label>
            <RichCardSideEditor
              blocks={definitionBlocks}
              side="definition"
              setId={setId}
              categories={categoryNames}
              onChange={(blocks) => onChange(index, 'definition', blocks)}
              onUploadStatusChange={handleUploadChange}
            />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase">Categories</label>
          <CategoryPicker
            value={categoryNames}
            available={availableCategories}
            onChange={(names) => onCategoriesChange(index, names)}
            onCreateCategory={onCreateCategory}
          />
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRemove(index)}
        disabled={!canRemove}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        title="Remove card"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  )
}
```

> Note: `categories={categoryNames}` on `RichCardSideEditor` keeps its AI-autocomplete context prop satisfied and now feeds it the card's real assigned category names (an improvement over the old always-empty stub). Do not change `RichCardSideEditor`.

- [ ] **Step 2: Update `SetForm.tsx` imports and `InitialCard`**

Add imports near the existing `@/lib/cards/content` import:

```ts
import { CategoryManager } from './CategoryManager'
import { normalizeCategoryName, pickDefaultColor } from '@/lib/cards/categories'
import { useMemo } from 'react'
```

Extend `InitialCard`:

```ts
interface InitialCard {
  term: string
  definition: string
  position: number
  contentBlocks?: InitialContentBlock[]
  categoryNames?: string[]
}
```

Extend `SetFormProps`:

```ts
interface SetFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialCards?: InitialCard[]
  initialCategories?: { name: string; color?: string | null }[]
  setId?: string
}
```

- [ ] **Step 3: Extend `cardToEditorBlocks` to carry categories**

In `cardToEditorBlocks`, change the returned object to include categories:

```ts
  return {
    term: forSide('term', card.term),
    definition: forSide('definition', card.definition),
    categoryNames: card.categoryNames ?? [],
    position: card.position,
  }
```

- [ ] **Step 4: Replace the category state + remove the stub effect**

Update the component signature to accept `initialCategories`:

```ts
export function SetForm({
  mode,
  initialTitle = '',
  initialDescription = '',
  initialCards = [],
  initialCategories = [],
  setId,
}: SetFormProps) {
```

Replace the old `const [categories, setCategories] = useState<string[]>([])` **and** the entire `useEffect(() => { ... }, [mode, setId])` block with:

```ts
  const [categoryMeta, setCategoryMeta] = useState<{ name: string; color: string }[]>(() => {
    const metas: { name: string; color: string }[] = []
    for (const c of initialCategories) {
      metas.push({ name: c.name, color: c.color ?? pickDefaultColor(metas.map((m) => m.color)) })
    }
    return metas
  })
```

- [ ] **Step 5: Seed `categoryNames` into card state and the add/import helpers**

The `cards` state initializer already spreads `cardToEditorBlocks(c)` which now includes `categoryNames`. Update `addCard` and `handleImport` so new cards carry an empty array:

In `addCard`:

```ts
  const addCard = () => {
    setCards([...cards, {
      term: [{ type: 'text', text: '', position: 0 }],
      definition: [{ type: 'text', text: '', position: 0 }],
      categoryNames: [],
      position: cards.length
    }])
  }
```

In `handleImport`:

```ts
  const handleImport = (importedCards: ParsedCard[]) => {
    const formattedImported = importedCards.map((c, i) => ({
      ...legacyCardToContentBlocks(c.term, c.definition),
      categoryNames: [],
      position: cards.length + i,
    }))
    setCards([...cards, ...formattedImported])
  }
```

- [ ] **Step 6: Add category handlers**

Add after `updateCard`:

```ts
  const handleCategoriesChange = (index: number, names: string[]) => {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, categoryNames: names } : c)))
  }

  const handleCreateCategory = (name: string) => {
    setCategoryMeta((prev) => {
      if (prev.some((m) => normalizeCategoryName(m.name) === normalizeCategoryName(name))) return prev
      return [...prev, { name: name.trim(), color: pickDefaultColor(prev.map((m) => m.color)) }]
    })
  }

  const handleRenameCategory = (oldName: string, newNameRaw: string) => {
    const newName = newNameRaw.trim()
    if (!newName) return
    const oldNorm = normalizeCategoryName(oldName)
    const newNorm = normalizeCategoryName(newName)

    setCards((prev) =>
      prev.map((c) => {
        const replaced = c.categoryNames.map((n) =>
          normalizeCategoryName(n) === oldNorm ? newName : n,
        )
        const deduped = Array.from(
          new Map(replaced.map((n) => [normalizeCategoryName(n), n])).values(),
        )
        return { ...c, categoryNames: deduped }
      }),
    )

    setCategoryMeta((prev) => {
      const collides = oldNorm !== newNorm && prev.some((m) => normalizeCategoryName(m.name) === newNorm)
      if (collides) {
        // merge: drop the renamed-away entry, keep the existing target
        return prev.filter((m) => normalizeCategoryName(m.name) !== oldNorm)
      }
      return prev.map((m) => (normalizeCategoryName(m.name) === oldNorm ? { ...m, name: newName } : m))
    })
  }

  const handleRecolorCategory = (name: string, color: string) => {
    setCategoryMeta((prev) =>
      prev.map((m) => (normalizeCategoryName(m.name) === normalizeCategoryName(name) ? { ...m, color } : m)),
    )
  }

  const handleDeleteCategory = (name: string) => {
    const norm = normalizeCategoryName(name)
    setCategoryMeta((prev) => prev.filter((m) => normalizeCategoryName(m.name) !== norm))
    setCards((prev) =>
      prev.map((c) => ({ ...c, categoryNames: c.categoryNames.filter((n) => normalizeCategoryName(n) !== norm) })),
    )
  }

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of cards) {
      for (const n of c.categoryNames) {
        const k = normalizeCategoryName(n)
        counts[k] = (counts[k] ?? 0) + 1
      }
    }
    return counts
  }, [cards])
```

- [ ] **Step 7: Include categories in the submit payload**

In `handleSubmit`, change `cardsForApi` and the action calls:

```ts
        const cardsForApi = cards.map(c => ({
          term: contentBlocksToPlainText(c.term),
          definition: contentBlocksToPlainText(c.definition),
          termBlocks: c.term,
          definitionBlocks: c.definition,
          categoryNames: c.categoryNames,
          position: c.position
        }))

        const payload = {
          title,
          description,
          cards: cardsForApi,
          categories: categoryMeta.map((m) => ({ name: m.name, color: m.color })),
        }

        const result = mode === 'create'
          ? await createSet(payload)
          : await updateSet(setId!, payload)
```

- [ ] **Step 8: Render the manager panel and update the `CardRow` usage**

Add the manager just above the cards list (inside the "Cards" section, after the header `div`, before `<div className="space-y-4">`):

```tsx
        {categoryMeta.length > 0 && (
          <CategoryManager
            categories={categoryMeta}
            counts={categoryCounts}
            onRename={handleRenameCategory}
            onRecolor={handleRecolorCategory}
            onDelete={handleDeleteCategory}
          />
        )}
```

Replace the `<CardRow ... />` invocation with:

```tsx
            <CardRow
              key={index}
              index={index}
              termBlocks={card.term}
              definitionBlocks={card.definition}
              categoryNames={card.categoryNames}
              availableCategories={categoryMeta}
              onChange={updateCard}
              onCategoriesChange={handleCategoriesChange}
              onCreateCategory={handleCreateCategory}
              onRemove={removeCard}
              onUploadStatusChange={setIsUploading}
              canRemove={cards.length > 1}
              setId={setId || 'new'}
            />
```

> `CategoryManager` is created in Task 8. To keep this task independently typecheckable, do Task 8 before running `tsc`. (These two tasks share a review gate.)

- [ ] **Step 9: Commit**

```bash
git add src/components/sets/CardRow.tsx src/components/sets/SetForm.tsx
git commit -m "feat(categories): per-card picker + category state in SetForm"
```

---

## Task 8: `CategoryManager` panel (rename/merge/recolor/delete)

**Files:**
- Create: `src/components/sets/CategoryManager.tsx`

**Interfaces:**
- Produces:
  ```ts
  interface CategoryManagerProps {
    categories: { name: string; color: string }[];
    counts: Record<string, number>; // normalizedName -> usage count
    onRename: (oldName: string, newName: string) => void;
    onRecolor: (name: string, color: string) => void;
    onDelete: (name: string) => void;
  }
  export function CategoryManager(props: CategoryManagerProps): JSX.Element
  ```
- Consumes: `CATEGORY_PALETTE`, `normalizeCategoryName` (`@/lib/cards/categories`).

- [ ] **Step 1: Create the component**

```tsx
'use client'

import React, { useState } from 'react'
import { Trash2, Pencil, Check } from 'lucide-react'
import { CATEGORY_PALETTE, normalizeCategoryName } from '@/lib/cards/categories'

interface CategoryManagerProps {
  categories: { name: string; color: string }[]
  counts: Record<string, number>
  onRename: (oldName: string, newName: string) => void
  onRecolor: (name: string, color: string) => void
  onDelete: (name: string) => void
}

export function CategoryManager({
  categories,
  counts,
  onRename,
  onRecolor,
  onDelete,
}: CategoryManagerProps) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [paletteFor, setPaletteFor] = useState<string | null>(null)

  const startEdit = (name: string) => {
    setEditing(name)
    setDraft(name)
  }

  const commitEdit = (oldName: string) => {
    if (draft.trim() && draft.trim() !== oldName) onRename(oldName, draft)
    setEditing(null)
  }

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-muted/30">
      <h4 className="text-sm font-semibold text-muted-foreground uppercase">Manage categories</h4>
      <div className="flex flex-col gap-2">
        {categories.map((cat) => {
          const count = counts[normalizeCategoryName(cat.name)] ?? 0
          return (
            <div key={cat.name} className="flex items-center gap-2">
              <button
                type="button"
                className="h-5 w-5 rounded-full border shrink-0"
                style={{ backgroundColor: cat.color }}
                title="Change color"
                onClick={() => setPaletteFor(paletteFor === cat.name ? null : cat.name)}
              />
              {editing === cat.name ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitEdit(cat.name) }
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  onBlur={() => commitEdit(cat.name)}
                  className="flex-1 rounded border p-1 text-sm"
                />
              ) : (
                <span className="flex-1 text-sm">{cat.name}</span>
              )}
              <span className="text-xs text-muted-foreground tabular-nums">{count} card{count === 1 ? '' : 's'}</span>
              {editing === cat.name ? (
                <button type="button" onClick={() => commitEdit(cat.name)} title="Save">
                  <Check size={14} className="text-green-600" />
                </button>
              ) : (
                <button type="button" onClick={() => startEdit(cat.name)} title="Rename">
                  <Pencil size={14} className="text-muted-foreground" />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (count === 0 || confirm(`Remove "${cat.name}" from ${count} card${count === 1 ? '' : 's'}?`)) {
                    onDelete(cat.name)
                  }
                }}
                title="Delete category"
              >
                <Trash2 size={14} className="text-destructive" />
              </button>
              {paletteFor === cat.name && (
                <div className="flex gap-1 flex-wrap ml-2">
                  {CATEGORY_PALETTE.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className="h-4 w-4 rounded-full border"
                      style={{ backgroundColor: color }}
                      onClick={() => { onRecolor(cat.name, color); setPaletteFor(null) }}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck the SetForm + CardRow + Manager triad**

Run: `npx tsc --noEmit`
Expected: no errors across `SetForm.tsx`, `CardRow.tsx`, `CategoryManager.tsx`, `CategoryPicker.tsx`.

- [ ] **Step 3: Manual verification (authoring end-to-end — validates Tasks 5–8)**

Run: `npm run dev`, then in the browser:
1. Create a new set. On a card, type `Valuation` in Categories → Enter. A colored chip appears. Type `val` on another card → the datalist suggests `Valuation`; select it.
2. Confirm the "Manage categories" panel shows `Valuation` with the correct card count. Rename it, recolor it, delete a category.
3. Save the set. Reopen `Edit` — categories and per-card assignments are still present (proves persistence + reconciliation).
4. In a DB check (`npm run db:studio`), confirm `CardCategory` rows have `color` set and `CardCategoryAssignment` rows link the right cards.

Expected: all of the above hold; renaming a category to an existing one merges (no duplicate chip on a card).

- [ ] **Step 4: Commit**

```bash
git add src/components/sets/CategoryManager.tsx
git commit -m "feat(categories): manage-categories panel with rename/merge/recolor/delete"
```

---

## Task 9: Load categories into the edit page and set detail page

**Files:**
- Modify: `src/app/sets/[id]/edit/page.tsx`
- Modify: `src/app/sets/[id]/page.tsx`

**Interfaces:**
- Produces: `SetForm` receives `initialCategories` + each card's `categoryNames`; set detail passes per-card `categories: { name, color }[]` to display components (Task 10).

- [ ] **Step 1: Edit page — include categories + assignments and pass to `SetForm`**

In `src/app/sets/[id]/edit/page.tsx`, change the `include` and the `<SetForm>`:

```tsx
  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: { include: { category: true } },
        },
      },
    },
  })
```

```tsx
      <SetForm
        mode="edit"
        setId={set.id}
        initialTitle={set.title}
        initialDescription={set.description || ''}
        initialCategories={set.categories.map((c) => ({ name: c.name, color: c.color }))}
        initialCards={set.cards.map((c) => ({
          term: c.term,
          definition: c.definition,
          position: c.position,
          contentBlocks: c.contentBlocks,
          categoryNames: c.categoryAssignments.map((a) => a.category.name),
        }))}
      />
```

- [ ] **Step 2: Set detail page — include assignments and build per-card categories**

In `src/app/sets/[id]/page.tsx`, add `categoryAssignments` to the cards include:

```tsx
    prisma.set.findUnique({
      where: { id },
      include: {
        cards: {
          orderBy: { position: 'asc' },
          include: {
            contentBlocks: { orderBy: { position: 'asc' } },
            categoryAssignments: { include: { category: true } },
          }
        }
      },
    }),
```

Then, in both the `FlashcardSection` and `TermsList` card mappings, add a `categories` field. For `FlashcardSection`:

```tsx
        <FlashcardSection
          cards={set.cards.map((c) => ({
            id: c.id,
            term: c.term,
            definition: c.definition,
            categories: c.categoryAssignments.map((a) => ({ name: a.category.name, color: a.category.color })),
            contentBlocks: c.contentBlocks.map(b => ({
              id: b.id,
              type: b.type as 'text' | 'image' | 'video' | 'file',
              position: b.position,
              side: b.side as 'term' | 'definition',
              text: b.text ?? undefined,
              assetId: b.assetId ?? undefined,
            })),
          }))}
        />
```

For `TermsList`, add the same `categories` field inside its `cards={set.cards.map(...)}` object.

- [ ] **Step 3: Typecheck (will surface required prop additions)**

Run: `npx tsc --noEmit`
Expected: errors pointing at `FlashcardSection`/`TermsList` because they don't yet accept `categories`. This is expected — Task 10 adds those props. If you want a clean gate, do Task 10 before running `tsc`. (Tasks 9 and 10 share a review gate.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/sets/[id]/edit/page.tsx" "src/app/sets/[id]/page.tsx"
git commit -m "feat(categories): load categories into edit and set detail pages"
```

---

## Task 10: `CategoryChip` + display on carousel and terms list

**Files:**
- Create: `src/components/cards/CategoryChip.tsx`
- Modify: `src/components/flashcard/FlashcardSection.tsx`
- Modify: `src/components/flashcard/FlashcardCarousel.tsx`
- Modify: `src/components/sets/TermsList.tsx`

**Interfaces:**
- Produces: `CategoryChip({ name, color }: { name: string; color?: string | null })`.
- Consumes: per-card `categories: { name: string; color?: string | null }[]` from Task 9.

- [ ] **Step 1: Create `CategoryChip`**

```tsx
import React from 'react'

export function CategoryChip({ name, color }: { name: string; color?: string | null }) {
  return (
    <span
      className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium"
      style={color ? { backgroundColor: `${color}20`, borderColor: color, color } : undefined}
    >
      {name}
    </span>
  )
}
```

- [ ] **Step 2: Thread categories through `FlashcardSection`**

Change its card interface and pass through to the carousel:

```tsx
interface FlashcardSectionCard {
  id: string
  term: string
  definition: string
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}

interface FlashcardSectionProps {
  cards: FlashcardSectionCard[]
}
```

(Keep the existing `visible` toggle and `<FlashcardCarousel cards={cards} />` — the filter UI is added in Task 15.)

- [ ] **Step 3: Render chips in `FlashcardCarousel`**

Extend `FlashcardCarouselCard`:

```tsx
interface FlashcardCarouselCard {
  id: string
  term: string
  definition: string
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}
```

Add the import at the top:

```tsx
import { CategoryChip } from '@/components/cards/CategoryChip'
```

Add a chips row directly under the flip-card `div` (between the `perspective` container's closing `</div>` and the nav row), reflecting the current card:

```tsx
      {card.categories && card.categories.length > 0 && (
        <div className="flex flex-wrap justify-center gap-1">
          {card.categories.map((c) => (
            <CategoryChip key={c.name} name={c.name} color={c.color} />
          ))}
        </div>
      )}
```

- [ ] **Step 4: Render chips in `TermsList`**

Add the import:

```tsx
import { CategoryChip } from '@/components/cards/CategoryChip'
```

Extend `Term`:

```ts
interface Term {
  id: string;
  term: string;
  definition: string;
  categories?: { name: string; color?: string | null }[];
  contentBlocks?: ContentBlock[];
}
```

Inside the card's `<CardContent>`, add a chips row spanning the grid (after the term/definition columns, before the star/confidence column, or as a full-width row). Simplest: add below the grid inside the same `CardContent` — change the grid wrapper so chips render under it:

```tsx
              {card.categories && card.categories.length > 0 && (
                <div className="col-span-full flex flex-wrap gap-1 pt-2">
                  {card.categories.map((c) => (
                    <CategoryChip key={c.name} name={c.name} color={c.color} />
                  ))}
                </div>
              )}
```

(Place this as the last child inside the `grid grid-cols-[1fr_1fr_auto]` container; `col-span-full` makes it a new row.)

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (Task 9's page mappings now satisfy the new props).

- [ ] **Step 6: Manual verification**

Run: `npm run dev` → open a set detail page. Category chips appear on the carousel card (changing as you navigate) and on each terms-list row, in their assigned colors.

- [ ] **Step 7: Commit**

```bash
git add src/components/cards/CategoryChip.tsx src/components/flashcard/FlashcardSection.tsx src/components/flashcard/FlashcardCarousel.tsx src/components/sets/TermsList.tsx
git commit -m "feat(categories): display colored category chips on cards"
```

---

## Task 11: Shared `CategoryFilterBar` + URL adapter

**Files:**
- Create: `src/components/sets/CategoryFilterBar.tsx`
- Create: `src/components/sets/CategoryUrlFilter.tsx`

**Interfaces:**
- Produces:
  ```ts
  // CategoryFilterBar (controlled)
  interface CategoryFilterBarProps {
    categories: { id: string; name: string; color?: string | null }[];
    value: string[];              // selected ids, may include UNCATEGORIZED_ID
    onChange: (ids: string[]) => void;
    showUncategorized?: boolean;
  }
  // CategoryUrlFilter (syncs value to ?cat= in the URL)
  function CategoryUrlFilter({ categories }: { categories: CategoryFilterBarProps['categories'] }): JSX.Element
  ```
- Consumes: `UNCATEGORIZED_ID` (`@/lib/cards/categories`), `CategoryFilterBar` used by match/review (via URL adapter) and the carousel (Task 15, controlled).

- [ ] **Step 1: Create `CategoryFilterBar`**

```tsx
'use client'

import React from 'react'
import { UNCATEGORIZED_ID } from '@/lib/cards/categories'

interface CategoryFilterBarProps {
  categories: { id: string; name: string; color?: string | null }[]
  value: string[]
  onChange: (ids: string[]) => void
  showUncategorized?: boolean
}

export function CategoryFilterBar({
  categories,
  value,
  onChange,
  showUncategorized = true,
}: CategoryFilterBarProps) {
  if (categories.length === 0) return null

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id])

  const chips = [
    ...categories,
    ...(showUncategorized ? [{ id: UNCATEGORIZED_ID, name: 'Uncategorized', color: null }] : []),
  ]

  return (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <span className="text-xs font-semibold text-muted-foreground uppercase mr-1">Filter</span>
      {chips.map((cat) => {
        const active = value.includes(cat.id)
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => toggle(cat.id)}
            className="rounded-full border px-3 py-1 text-sm transition-colors"
            style={
              active && cat.color
                ? { backgroundColor: `${cat.color}20`, borderColor: cat.color, color: cat.color }
                : active
                  ? { backgroundColor: 'hsl(var(--muted))', borderColor: 'currentColor' }
                  : undefined
            }
            aria-pressed={active}
          >
            {cat.name}
          </button>
        )
      })}
      {value.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="text-xs text-muted-foreground underline ml-1"
        >
          Clear
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `CategoryUrlFilter` (URL adapter for server-rendered pages)**

```tsx
'use client'

import React from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { CategoryFilterBar } from './CategoryFilterBar'

export function CategoryUrlFilter({
  categories,
}: {
  categories: { id: string; name: string; color?: string | null }[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()

  const value = params.get('cat')?.split(',').filter(Boolean) ?? []

  const onChange = (ids: string[]) => {
    const qs = new URLSearchParams(Array.from(params.entries()))
    if (ids.length) qs.set('cat', ids.join(','))
    else qs.delete('cat')
    router.push(`${pathname}?${qs.toString()}`)
  }

  return <CategoryFilterBar categories={categories} value={value} onChange={onChange} />
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/sets/CategoryFilterBar.tsx src/components/sets/CategoryUrlFilter.tsx
git commit -m "feat(categories): shared filter bar + URL adapter"
```

---

## Task 12: Quiz — colored chips + Uncategorized option

**Files:**
- Modify: `src/app/sets/[id]/quiz/page.tsx`
- Modify: `src/components/quiz/QuizClientWrapper.tsx`
- Modify: `src/components/quiz/QuizSetupScreen.tsx`

**Interfaces:**
- Consumes: `set.categories` (with color), `UNCATEGORIZED_ID`.
- Note: the quiz already builds `card.categoryIds` from assignments (`src/actions/quiz.ts:139`) and filters via `filterQuizCards` (now delegating to `filterCardsByCategories`, Task 3), so no action changes are needed — only surfacing color + the Uncategorized chip.

- [ ] **Step 1: Pass color through the quiz page**

In `src/app/sets/[id]/quiz/page.tsx`, the `categories: true` include already loads color. Change the wrapper call to pass the full category objects:

```tsx
        <QuizClientWrapper
          setId={set.id}
          cards={set.cards}
          categories={set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        />
```

- [ ] **Step 2: Widen `QuizClientWrapper`'s category type**

Change its signature and the `availableCategories` mapping:

```tsx
export function QuizClientWrapper({
  setId,
  cards,
  categories,
}: {
  setId: string
  cards: any[]
  categories: { id: string; name: string; color?: string | null }[]
}) {
```

```tsx
      <QuizSetupScreen
        setId={setId}
        availableCategories={categories}
        onStart={(s) => setSetup(s)}
      />
```

- [ ] **Step 3: Update `QuizSetupScreen` to color chips + add Uncategorized**

Change the prop type:

```tsx
interface QuizSetupScreenProps {
  setId: string;
  availableCategories: { id: string; name: string; color?: string | null }[];
  onStart: (setup: QuizSetup) => void;
}
```

Add the import:

```tsx
import { UNCATEGORIZED_ID } from "@/lib/cards/categories";
```

Replace the Categories block (the `<div className="space-y-3">` containing `<Label>Categories</Label>`) with one that colors active chips and appends an Uncategorized chip:

```tsx
        <div className="space-y-3">
          <Label>Categories</Label>
          <div className="flex flex-wrap gap-2">
            {[
              ...availableCategories,
              { id: UNCATEGORIZED_ID, name: "Uncategorized", color: null },
            ].map((cat) => {
              const active = setup.categoryIds.includes(cat.id);
              return (
                <div
                  key={cat.id}
                  className="flex items-center gap-2 rounded-full border px-3 py-1 cursor-pointer hover:bg-gray-50"
                  style={
                    active && cat.color
                      ? { backgroundColor: `${cat.color}20`, borderColor: cat.color, color: cat.color }
                      : undefined
                  }
                  onClick={() => toggleCategory(cat.id)}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300"
                    checked={active}
                    readOnly
                  />
                  <span className="text-sm">{cat.name}</span>
                </div>
              );
            })}
          </div>
        </div>
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

Run `npm run dev`, open a set's Quiz (requires an AI key configured). The setup screen shows the set's categories as colored chips plus "Uncategorized". Select one category → start quiz → only cards in that category are quizzed. Select only "Uncategorized" → only cards with no category are quizzed.

- [ ] **Step 6: Commit**

```bash
git add "src/app/sets/[id]/quiz/page.tsx" src/components/quiz/QuizClientWrapper.tsx src/components/quiz/QuizSetupScreen.tsx
git commit -m "feat(categories): colored category chips + uncategorized in quiz setup"
```

---

## Task 13: Matching game — category filter

**Files:**
- Modify: `src/app/sets/[id]/match/page.tsx`

**Interfaces:**
- Consumes: `filterCardsByCategories` (`@/lib/cards/categories`), `CategoryUrlFilter` (Task 11), `initMatchGame` (existing).

- [ ] **Step 1: Rewrite the match page to filter by `?cat=`**

Replace `src/app/sets/[id]/match/page.tsx` with:

```tsx
import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { MatchGame } from '@/components/game/MatchGame'
import { initMatchGame } from '@/lib/game/match'
import { filterCardsByCategories } from '@/lib/cards/categories'
import { CategoryUrlFilter } from '@/components/sets/CategoryUrlFilter'
import { cn } from '@/lib/utils'

export default async function MatchGamePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cat?: string }>
}) {
  const { id } = await params
  const { cat } = await searchParams

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: { categoryAssignments: true },
      },
    },
  })

  if (!set) notFound()

  const selected = cat?.split(',').filter(Boolean) ?? []
  const cardsWithCats = set.cards.map((c) => ({
    id: c.id,
    term: c.term,
    definition: c.definition,
    categoryIds: c.categoryAssignments.map((a) => a.categoryId),
  }))
  const filtered = filterCardsByCategories(cardsWithCats, selected)

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/sets/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'flex items-center gap-2 -ml-2')}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to set
        </Link>
      </div>

      <CategoryUrlFilter categories={categories} />

      {filtered.length < 2 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">
            {set.cards.length < 2
              ? 'You need at least 2 cards to play the matching game.'
              : 'Fewer than 2 cards match the selected categories.'}
          </p>
          {selected.length > 0 && (
            <Link href={`/sets/${id}/match`} className="text-primary underline text-sm">
              Clear filter
            </Link>
          )}
        </div>
      ) : (
        <MatchGame key={cat ?? 'all'} initialTiles={initMatchGame(filtered, crypto.randomUUID()).tiles} />
      )}
    </div>
  )
}
```

> `key={cat ?? 'all'}` forces `MatchGame` to re-initialize (fresh shuffled tiles) whenever the filter changes.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (`initMatchGame` accepts `GameCard[]` = `{id,term,definition}`; `filtered` items include those plus `categoryIds`, which is a structural superset — fine.)

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open a set's Matching Game. The filter bar shows the set's categories + Uncategorized. Selecting a category with ≥2 cards re-shuffles into a filtered game; selecting one with <2 matching cards shows the "fewer than 2 cards match" message with a Clear link. No filter = all cards (unchanged behavior).

- [ ] **Step 4: Commit**

```bash
git add "src/app/sets/[id]/match/page.tsx"
git commit -m "feat(categories): category filter for matching game"
```

---

## Task 14: Review mode — category filter

**Files:**
- Modify: `src/app/sets/[id]/review/page.tsx`

**Interfaces:**
- Consumes: `filterCardsByCategories`, `CategoryUrlFilter`, existing `ReviewSession`.

- [ ] **Step 1: Add category loading + filtering to the review page**

In `src/app/sets/[id]/review/page.tsx`:

Add imports:

```tsx
import { filterCardsByCategories } from '@/lib/cards/categories'
import { CategoryUrlFilter } from '@/components/sets/CategoryUrlFilter'
```

Change the signature to accept `searchParams`:

```tsx
export default async function ReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ cat?: string }>
}) {
  const { id } = await params
  const { cat } = await searchParams
```

Extend the `include` to load categories + assignments:

```tsx
  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      categories: true,
      cards: {
        orderBy: { position: 'asc' },
        include: {
          progress: { where: { userId: session.user.id } },
          contentBlocks: { orderBy: { position: 'asc' } },
          categoryAssignments: true,
        },
      },
    },
  })
```

After the `if (!set) notFound()` and empty-set guard, filter the cards before mapping to `reviewCards`:

```tsx
  const selected = cat?.split(',').filter(Boolean) ?? []
  const filteredCards = filterCardsByCategories(
    set.cards.map((c) => ({ card: c, categoryIds: c.categoryAssignments.map((a) => a.categoryId) })),
    selected,
  ).map((x) => x.card)

  const categories = set.categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))
```

Change `reviewCards` to build from `filteredCards`:

```tsx
  const reviewCards = filteredCards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    contentBlocks: card.contentBlocks.map(b => ({
      id: b.id,
      type: b.type as 'text' | 'image' | 'video' | 'file',
      position: b.position,
      side: b.side as 'term' | 'definition',
      text: b.text ?? undefined,
      assetId: b.assetId ?? undefined,
    })),
    confidence: card.progress[0]?.confidence ?? 5,
  }))
```

Update the render block to show the filter bar and handle an empty filtered result:

```tsx
  return (
    <div className="max-w-xl mx-auto">
      <div className="mb-6">
        <Link
          href={`/sets/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 mb-1')}
        >
          ← Back to {set.title}
        </Link>
        <h1 className="text-2xl font-bold">Review Mode</h1>
        <p className="text-sm text-muted-foreground mt-1">{reviewCards.length} cards</p>
      </div>
      <CategoryUrlFilter categories={categories} />
      {reviewCards.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-muted-foreground mb-2">No cards match the selected categories.</p>
          {selected.length > 0 && (
            <Link href={`/sets/${id}/review`} className="text-primary underline text-sm">
              Clear filter
            </Link>
          )}
        </div>
      ) : (
        <ReviewSession key={cat ?? 'all'} cards={reviewCards} setId={id} />
      )}
    </div>
  )
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open a set's Review Mode. The filter bar appears; filtering restricts the review deck; the card count updates; an empty match shows the message + Clear link. No filter = all cards (unchanged). Confidence updates still work.

- [ ] **Step 4: Commit**

```bash
git add "src/app/sets/[id]/review/page.tsx"
git commit -m "feat(categories): category filter for review mode"
```

---

## Task 15: Flashcard carousel — client-side category filter

**Files:**
- Modify: `src/components/flashcard/FlashcardSection.tsx`

**Interfaces:**
- Consumes: `CategoryFilterBar` (controlled, Task 11); per-card `categories` (Task 10).

- [ ] **Step 1: Add a client-side filter above the carousel**

Rewrite `src/components/flashcard/FlashcardSection.tsx`:

```tsx
'use client'

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import FlashcardCarousel from './FlashcardCarousel'
import { CategoryFilterBar } from '@/components/sets/CategoryFilterBar'
import { UNCATEGORIZED_ID, normalizeCategoryName } from '@/lib/cards/categories'
import { ContentBlock } from '@/lib/cards/content'

interface FlashcardSectionCard {
  id: string
  term: string
  definition: string
  categories?: { name: string; color?: string | null }[]
  contentBlocks?: ContentBlock[]
}

export default function FlashcardSection({ cards }: { cards: FlashcardSectionCard[] }) {
  const [visible, setVisible] = useState(true)
  const [selected, setSelected] = useState<string[]>([])

  // Build filter chips from the distinct category names present on these cards.
  // The carousel filters by name (there are no ids in this client-only view),
  // so we use the normalized name as the chip id.
  const filterCategories = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color?: string | null }>()
    for (const c of cards) {
      for (const cat of c.categories ?? []) {
        const id = normalizeCategoryName(cat.name)
        if (!map.has(id)) map.set(id, { id, name: cat.name, color: cat.color })
      }
    }
    return Array.from(map.values())
  }, [cards])

  const filtered = useMemo(() => {
    if (selected.length === 0) return cards
    const wantUncat = selected.includes(UNCATEGORIZED_ID)
    const realIds = selected.filter((s) => s !== UNCATEGORIZED_ID)
    return cards.filter((c) => {
      const names = (c.categories ?? []).map((x) => normalizeCategoryName(x.name))
      if (wantUncat && names.length === 0) return true
      return realIds.some((id) => names.includes(id))
    })
  }, [cards, selected])

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Flashcards
        </h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setVisible((v) => !v)}
          className="text-xs h-7"
        >
          {visible ? 'Hide' : 'Show'}
        </Button>
      </div>
      {visible && (
        <>
          {filterCategories.length > 0 && (
            <CategoryFilterBar
              categories={filterCategories}
              value={selected}
              onChange={setSelected}
            />
          )}
          {filtered.length > 0 ? (
            <FlashcardCarousel cards={filtered} />
          ) : (
            <p className="text-center text-sm text-muted-foreground py-8">
              No cards match the selected categories.
            </p>
          )}
        </>
      )}
    </div>
  )
}
```

> This view has no category ids client-side, so it filters by normalized name (its own chip ids). This is self-consistent and independent of the DB-id filtering used by quiz/match/review.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`, open a set detail page with categorized cards. A filter bar appears above the carousel; selecting categories narrows the carousel to matching cards (and resets to card 1 as the deck changes); "Uncategorized" shows only cards with no category; clearing restores all.

- [ ] **Step 4: Commit**

```bash
git add src/components/flashcard/FlashcardSection.tsx
git commit -m "feat(categories): client-side category filter on flashcard carousel"
```

---

## Task 16: Docs — add Stage 3.6, correct the false 3.5 claim

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Correct the "what exists today" categories claim**

In `CLAUDE.md`, in the "What exists today (verified in code)" list, change the Stage 3.5 bullet that reads:

```
- Activity tiles, custom categories, quiz setup/filters (starred/failed/side/mode), rich-card **authoring** scaffolding (`CardContentBlock`/`CardAsset` via Vercel Blob), printable quizzes — Stage 3.5.
```

to:

```
- Activity tiles, quiz setup/filters (starred/failed/side/mode), rich-card **authoring** scaffolding (`CardContentBlock`/`CardAsset` via Vercel Blob), printable quizzes — Stage 3.5. (Custom categories were only a data model + a dead quiz filter in 3.5; the full categorization feature — authoring, display, and games filtering — ships in **Stage 3.6**.)
```

- [ ] **Step 2: Add the Stage 3.6 section**

Immediately after the `### Stage 3.5 — ...` block (before `### Stage 4 — Voice interviews`), insert:

```markdown
### Stage 3.6 — Categorization system (complete)
Detailed plan: `docs/superpowers/plans/2026-07-05-stage3-6-categorization-system.md`. Design: `docs/superpowers/specs/2026-07-05-stage3-6-categorization-system-design.md`. **Sits before Stage 6.**
- Completes the half-built 3.5 categories: users label any card with one or more **custom, colored, set-scoped** categories via an autocomplete tag picker plus a set-level manage panel (rename/merge/recolor/delete). Categories persist transactionally through `createSet`/`updateSet`.
- **Colored category chips render** on the flashcard carousel and the terms list.
- **All study activities filter by category** — Quiz (colored chips + "Uncategorized"), Matching game and Review mode (via `?cat=` query param), and the Flashcard carousel (client-side). One shared pure predicate `filterCardsByCategories` (OR semantics + an "Uncategorized" bucket) backs every mode.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Stage 3.6 categorization, correct 3.5 categories claim"
```

---

## Task 17: Full verification pass

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new category/palette/filter/collect tests and the pre-existing quiz-setup tests.

- [ ] **Step 2: Typecheck + lint + build**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: no type errors, no lint errors, successful production build.

- [ ] **Step 3: End-to-end manual checklist**

Run `npm run dev` and confirm, in order:
1. **Author:** create a set, add categories inline (autocomplete works, new names create colored chips), use the manage panel (rename/merge/recolor/delete with counts), save.
2. **Persist:** reopen Edit — categories + per-card assignments survive; card counts correct.
3. **Display:** set detail shows colored chips on carousel (per current card) and terms list.
4. **Filter — carousel:** client-side chips narrow the deck; Uncategorized + Clear work.
5. **Filter — quiz:** colored chips + Uncategorized; starting quiz honors the filter (cross-check with starred/failed filters still composing).
6. **Filter — matching:** `?cat=` narrows tiles; <2 matches shows message + Clear; re-shuffles on filter change.
7. **Filter — review:** deck narrows; count updates; empty shows message + Clear; confidence still records.
8. **Regression:** a set with **no** categories behaves exactly as before across all four activities.

- [ ] **Step 4: Finalize the branch**

Use the superpowers:finishing-a-development-branch skill to open a PR or merge, per the user's preference.

---

## Self-Review (completed during authoring)

- **Spec coverage:** data model (T1), color palette/picker (T2), shared filter incl. uncategorized (T3), save helper (T4), persistence (T5), authoring picker+manager+state (T6–T8), page loading (T9), display chips (T10), filter bar/URL adapter (T11), quiz/match/review/carousel filtering (T12–T15), docs+staging (T16), verification (T17). All design sections map to tasks.
- **Placeholder scan:** no TBD/TODO; every code step shows full code; every test step shows assertions.
- **Type consistency:** `filterCardsByCategories`, `UNCATEGORIZED_ID`, `collectSetCategories`, `CATEGORY_PALETTE`, `pickDefaultColor`, `CategoryPicker`/`CategoryManager`/`CategoryChip`/`CategoryFilterBar`/`CategoryUrlFilter` signatures are used identically across producing and consuming tasks. `categoryNames` (authoring) vs `categoryIds` (filtering/DB) distinction is intentional and consistent.
- **Known cross-task gates:** T5↔T7 (payload shape), T7↔T8 (`CategoryManager`), T9↔T10 (display props) each note that neighbors share a review/typecheck gate — expected when running `tsc` between partial tasks.
```
