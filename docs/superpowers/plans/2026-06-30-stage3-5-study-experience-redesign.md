# Stage 3.5 — Study Experience Redesign + Rich Cards + Customizable Quizzes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the study experience between Stage 3 AI quizzing and Stage 4 voice interviews by redesigning activity entry points, adding rich card content and custom categories, expanding quiz setup options, adding AI autocomplete while creating cards, and supporting print/PDF-friendly quizzes.

**Architecture:** Extend the existing `Card` model rather than replacing it abruptly: keep `term` and `definition` text for backwards compatibility, then add related models for card-side content blocks, attachments, and categories. Add a quiz setup flow before attempts begin so filters and modes are explicit and persisted. Use server actions for mutations and route all AI autocomplete through the existing Stage 3 user-supplied Google key path.

**Tech Stack:** Existing Next.js App Router, Prisma, Auth.js, Zod, Vitest, shadcn/ui, Tailwind CSS, existing Stage 3 AI helpers. Add upload/storage only through an explicit provider decision in Task 2.

## Global Constraints

- Preserve existing text-only cards and imports; migrations must backfill rich content blocks from existing `term` and `definition` values.
- All mutations use Next.js server actions.
- Uploaded files must be owned by the authenticated user and scoped to the set/card.
- Validate file type, file size, category names, quiz setup payloads, and AI autocomplete responses with Zod.
- Category labels are set-scoped and user-defined; avoid hard-coded categories like "accounting" except in examples/tests.
- AI autocomplete uses the user's saved Google API key and must fail gracefully when no key is configured.
- Quiz filtering must compose cleanly: category filters, starred-only, previously-failed-only, quiz mode, and prompt side can all be used together.
- Print/PDF support uses browser print styles; do not generate server PDFs in this stage unless explicitly requested later.

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                         # MODIFY: categories, content blocks, attachments, quiz setup fields
├── src/
│   ├── actions/
│   │   ├── cards.ts                          # MODIFY: save rich card content + categories
│   │   ├── card-autocomplete.ts              # NEW: AI term/definition suggestions
│   │   ├── uploads.ts                        # NEW: upload/register/delete file assets
│   │   └── quiz.ts                           # MODIFY: setup filters, new quiz modes, print data
│   ├── app/
│   │   └── sets/[id]/
│   │       ├── page.tsx                      # MODIFY: large activity tiles
│   │       └── quiz/
│   │           ├── page.tsx                  # MODIFY: setup/loading screen first
│   │           └── print/page.tsx            # NEW: print-friendly test view
│   ├── components/
│   │   ├── sets/
│   │   │   ├── ActivityTiles.tsx             # NEW: large mode tiles with logos/icons
│   │   │   ├── CardRow.tsx                   # MODIFY: rich side editors + category picker
│   │   │   ├── CategoryPicker.tsx            # NEW
│   │   │   ├── RichCardSideEditor.tsx        # NEW
│   │   │   └── AIAutocompleteButton.tsx      # NEW
│   │   └── quiz/
│   │       ├── QuizSetupScreen.tsx           # NEW
│   │       ├── TrueFalseQuiz.tsx             # NEW
│   │       ├── MatchingQuiz.tsx              # NEW or adapt existing matching logic
│   │       └── PrintableQuiz.tsx             # NEW
│   ├── lib/
│   │   ├── cards/
│   │   │   ├── content.ts                    # NEW: normalize/render card side blocks
│   │   │   └── categories.ts                 # NEW: validation + normalization
│   │   ├── quiz/
│   │   │   ├── setup.ts                      # NEW: pure filter/mode helpers
│   │   │   └── printable.ts                  # NEW: printable quiz assembly
│   │   └── ai/
│   │       ├── prompts.ts                    # MODIFY: autocomplete prompt builders
│   │       └── schemas.ts                    # MODIFY: autocomplete response schema
├── tests/
│   ├── cards/
│   │   ├── categories.test.ts                # NEW
│   │   └── content.test.ts                   # NEW
│   └── quiz/
│       ├── setup.test.ts                     # NEW
│       └── printable.test.ts                 # NEW
└── src/app/globals.css                       # MODIFY: print styles
```

---

### Task 1: Prisma Schema for Categories, Rich Content, and Quiz Setup

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: reusable set-scoped categories
- Produces: multiple content blocks per card side
- Produces: uploaded asset metadata
- Produces: persisted quiz setup options

- [ ] **Step 1: Add category models**

Add `CardCategory` and a join model such as `CardCategoryAssignment`. Categories should be unique per set by normalized name:

```prisma
model CardCategory {
  id             String                   @id @default(cuid())
  setId          String
  name           String
  normalizedName String
  createdAt      DateTime                 @default(now())
  set            Set                      @relation(fields: [setId], references: [id], onDelete: Cascade)
  assignments    CardCategoryAssignment[]

  @@unique([setId, normalizedName])
  @@index([setId])
}

model CardCategoryAssignment {
  id         String       @id @default(cuid())
  cardId     String
  categoryId String
  card       Card         @relation(fields: [cardId], references: [id], onDelete: Cascade)
  category   CardCategory @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([cardId, categoryId])
  @@index([categoryId])
}
```

- [ ] **Step 2: Add rich card-side content models**

Create block-based storage so a term or definition can include text, image, video, or file blocks:

```prisma
model CardContentBlock {
  id          String      @id @default(cuid())
  cardId      String
  side        String      // "term" | "definition"
  type        String      // "text" | "image" | "video" | "file"
  text        String?     @db.Text
  assetId     String?
  position    Int
  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
  card        Card        @relation(fields: [cardId], references: [id], onDelete: Cascade)
  asset       CardAsset?  @relation(fields: [assetId], references: [id], onDelete: SetNull)

  @@index([cardId, side, position])
}

model CardAsset {
  id            String             @id @default(cuid())
  userId        String
  setId         String
  cardId        String?
  storageKey    String             @unique
  originalName  String
  mimeType      String
  sizeBytes     Int
  createdAt     DateTime           @default(now())
  user          User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  set           Set                @relation(fields: [setId], references: [id], onDelete: Cascade)
  card          Card?              @relation(fields: [cardId], references: [id], onDelete: SetNull)
  contentBlocks CardContentBlock[]

  @@index([userId])
  @@index([setId])
}
```

- [ ] **Step 3: Add persisted quiz setup fields**

Either extend `QuizAttempt` with setup JSON or add `QuizSetup` if attempts should remain lean. Minimum fields:
- `questionMode`: `multiple-choice`, `short-answer`, `matching`, `true-false`
- `promptSide`: `term`, `definition`, `mixed`
- `categoryIds`: JSON array
- `starredOnly`: boolean
- `failedOnly`: boolean
- `printable`: boolean

- [ ] **Step 4: Backfill content blocks**

Create a migration strategy that creates one text `CardContentBlock` for each existing card term and definition. Keep `Card.term` and `Card.definition` populated for backwards compatibility.

- [ ] **Step 5: Run migration and regenerate Prisma**

```bash
npx prisma migrate dev --name stage3_5_rich_cards_categories_quiz_setup
npx prisma generate
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add rich card content, categories, assets, and quiz setup schema"
```

---

### Task 2: Choose and Wire File Storage

**Files:**
- Modify: `.env.example`
- Create: `src/actions/uploads.ts`
- Create: storage helper under `src/lib/uploads/`

**Interfaces:**
- Produces: authenticated upload/register/delete actions
- Produces: safe asset URLs for rendering rich card content

- [ ] **Step 1: Pick the storage provider**

Choose one implementation path before coding:
- Vercel Blob for simplest Vercel deploy alignment.
- Supabase Storage if the database is already Supabase and row-level ownership is desired.
- Local filesystem only for development, behind a storage adapter interface.

- [ ] **Step 2: Document environment variables**

Add provider-specific placeholders to `.env.example`; never add real tokens.

- [ ] **Step 3: Implement upload validation**

Validate:
- allowed MIME types: images, videos, PDFs, and common document files
- per-file size limit
- per-set ownership
- user authentication

- [ ] **Step 4: Persist `CardAsset` metadata**

The action should store file metadata and return an asset ID plus display URL. Do not trust client-provided MIME type alone if the provider exposes verified metadata.

- [ ] **Step 5: Manual verification**

Upload an image, video, and PDF to a test set. Confirm assets render only for the owning signed-in user where required.

- [ ] **Step 6: Commit**

```bash
git add .env.example src/actions/uploads.ts src/lib/uploads/
git commit -m "feat: add authenticated card asset uploads"
```

---

### Task 3: Category Helpers and Picker UI

**Files:**
- Create: `tests/cards/categories.test.ts`
- Create: `src/lib/cards/categories.ts`
- Create: `src/components/sets/CategoryPicker.tsx`
- Modify: card create/edit actions

**Interfaces:**
- Produces: `normalizeCategoryName(name: string): string`
- Produces: `parseCategoryInput(input: string): string[]`
- Produces: reusable category picker/autocomplete in card editing

- [ ] **Step 1: Write category helper tests**

Cover trimming, duplicate removal, case-insensitive matching, empty labels, punctuation, and max label length.

- [ ] **Step 2: Implement category normalization**

Use a stable normalized form for uniqueness, but preserve the display name the user typed first.

- [ ] **Step 3: Add category picker UI**

The picker should allow:
- selecting existing categories in the set
- typing a new category
- removing assigned categories
- keyboard-friendly autocomplete

- [ ] **Step 4: Save assignments in card mutations**

On create/edit, upsert categories by `(setId, normalizedName)` and update card-category assignments transactionally.

- [ ] **Step 5: Run tests and typecheck**

```bash
npm test -- tests/cards/categories.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add tests/cards/categories.test.ts src/lib/cards/categories.ts src/components/sets/CategoryPicker.tsx src/actions/
git commit -m "feat: add custom card categories with editor autocomplete"
```

---

### Task 4: Rich Term/Definition Editors

**Files:**
- Create: `tests/cards/content.test.ts`
- Create: `src/lib/cards/content.ts`
- Create: `src/components/sets/RichCardSideEditor.tsx`
- Modify: `src/components/sets/CardRow.tsx`
- Modify: set create/edit pages/actions

**Interfaces:**
- Produces: ordered content blocks for term and definition sides
- Preserves existing plain text card behavior

- [ ] **Step 1: Write content normalization tests**

Cover converting legacy text to blocks, preserving block order, rejecting empty non-file blocks, and validating side/type combinations.

- [ ] **Step 2: Implement content helpers**

Expose helpers for:
- `legacyCardToContentBlocks(card)`
- `contentBlocksToPlainText(blocks)`
- `validateCardContentBlocks(input)`

- [ ] **Step 3: Build rich side editor**

Support multiple blocks per side:
- text block
- image upload
- video upload
- file upload
- remove/reorder controls

- [ ] **Step 4: Keep legacy fields synchronized**

When saving a card, derive `Card.term` and `Card.definition` from text blocks or file names so search, matching, and existing UI continue working.

- [ ] **Step 5: Manual verification**

Create a card where the term is an image plus text and the definition is a video plus note. Confirm it renders in set detail, review, and quiz prompts with a sensible fallback.

- [ ] **Step 6: Commit**

```bash
git add tests/cards/content.test.ts src/lib/cards/content.ts src/components/sets/RichCardSideEditor.tsx src/components/sets/CardRow.tsx src/actions/
git commit -m "feat: support rich card sides with text, image, video, and file blocks"
```

---

### Task 5: Visual Redesign of Activity Entry Points

**Files:**
- Create: `src/components/sets/ActivityTiles.tsx`
- Modify: `src/app/sets/[id]/page.tsx`

**Interfaces:**
- Produces: large tile-format launch cards for Matching Game, Review Mode, and Quiz

- [ ] **Step 1: Create activity tile component**

Use large, scan-friendly tiles with prominent logos/icons above labels:
- Matching Game
- Review Mode
- Quiz

Use existing icon library if available; otherwise add a small local icon strategy that keeps the tiles visually consistent.

- [ ] **Step 2: Replace small activity buttons on set detail**

The set page should show the three activity tiles near the top of the page. Preserve auth behavior: Review and Quiz should respect signed-in requirements.

- [ ] **Step 3: Responsive QA**

Verify tiles are a 3-column layout on desktop and stack cleanly on mobile. Icons should remain visibly larger than text labels.

- [ ] **Step 4: Commit**

```bash
git add src/components/sets/ActivityTiles.tsx src/app/sets/[id]/page.tsx
git commit -m "feat: redesign study activity launchers as large icon tiles"
```

---

### Task 6: Quiz Setup and Loading Screen

**Files:**
- Create: `tests/quiz/setup.test.ts`
- Create: `src/lib/quiz/setup.ts`
- Create: `src/components/quiz/QuizSetupScreen.tsx`
- Modify: `src/app/sets/[id]/quiz/page.tsx`
- Modify: `src/actions/quiz.ts`

**Interfaces:**
- Produces: quiz setup selection before questions start
- Produces: filtered quiz card list

- [ ] **Step 1: Write filter helper tests**

Cover:
- category include filters
- starred-only
- previously-failed-only
- category + starred combined
- empty result handling
- prompt side selection

- [ ] **Step 2: Implement pure setup helpers**

Expose:
- `filterQuizCards(cards, setup)`
- `buildQuizPrompts(cards, setup)`
- `isPreviouslyFailed(cardId, quizAnswers)`

- [ ] **Step 3: Build setup/loading UI**

Before the quiz starts, let users choose:
- Multiple Choice
- Short Answer
- Matching
- True/False
- test term, definition, or mixed
- categories
- starred terms only
- failed terms only
- printable test option

- [ ] **Step 4: Persist setup into quiz attempt**

Store setup options when the attempt starts so results and printable views can reproduce the same test.

- [ ] **Step 5: Empty state**

If filters produce no cards, explain which filters are active and let the user clear them.

- [ ] **Step 6: Run tests**

```bash
npm test -- tests/quiz/setup.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add tests/quiz/setup.test.ts src/lib/quiz/setup.ts src/components/quiz/QuizSetupScreen.tsx src/app/sets/[id]/quiz/page.tsx src/actions/quiz.ts
git commit -m "feat: add customizable quiz setup with categories and focus filters"
```

---

### Task 7: Add Matching and True/False Quiz Modes

**Files:**
- Create: `src/components/quiz/MatchingQuiz.tsx`
- Create: `src/components/quiz/TrueFalseQuiz.tsx`
- Modify: `src/actions/quiz.ts`
- Modify: `src/lib/quiz/scoring.ts`

**Interfaces:**
- Produces: matching quiz mode inside quiz flow
- Produces: true/false quiz mode inside quiz flow

- [ ] **Step 1: Reuse matching logic where possible**

Use existing matching-game pure helpers for matching behavior, but persist results as quiz answers/attempts.

- [ ] **Step 2: Implement true/false prompts**

Generate true/false questions from card pairs. False prompts should use plausible mismatches from the same filtered card pool.

- [ ] **Step 3: Persist results**

Ensure `QuizAnswer.mode` distinguishes:
- `matching`
- `true-false`
- `multiple-choice`
- `short-answer`

- [ ] **Step 4: Manual verification**

Complete matching and true/false quizzes and confirm attempt scores update correctly.

- [ ] **Step 5: Commit**

```bash
git add src/components/quiz/MatchingQuiz.tsx src/components/quiz/TrueFalseQuiz.tsx src/actions/quiz.ts src/lib/quiz/scoring.ts
git commit -m "feat: add matching and true-false quiz modes"
```

---

### Task 8: AI Autocomplete for Card Creation

**Files:**
- Create: `src/actions/card-autocomplete.ts`
- Create: `src/components/sets/AIAutocompleteButton.tsx`
- Modify: `src/lib/ai/prompts.ts`
- Modify: `src/lib/ai/schemas.ts`
- Modify: `src/components/sets/RichCardSideEditor.tsx`

**Interfaces:**
- Produces: AI suggestions while writing terms/definitions

- [ ] **Step 1: Add AI schema**

Add a Zod schema for autocomplete:

```typescript
export const CardAutocompleteSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1).max(5),
})
```

- [ ] **Step 2: Add prompt builder**

The prompt should receive:
- set title/description
- existing nearby cards
- current side: term or definition
- current partial text
- optional selected categories

- [ ] **Step 3: Create server action**

The action should:
- require auth
- require saved Google key
- validate input
- call existing Google JSON helper
- return suggestions only, not auto-write them

- [ ] **Step 4: Add UI affordance**

Each text block should have an AI suggestion button. Suggestions appear in a small menu/list; clicking one inserts or replaces the current text based on a clear UI choice.

- [ ] **Step 5: Manual verification**

With a saved Google key, type a partial finance term and request suggestions. Without a key, verify the UI links to AI settings instead of throwing.

- [ ] **Step 6: Commit**

```bash
git add src/actions/card-autocomplete.ts src/components/sets/AIAutocompleteButton.tsx src/lib/ai/prompts.ts src/lib/ai/schemas.ts src/components/sets/RichCardSideEditor.tsx
git commit -m "feat: add AI autocomplete suggestions for card authoring"
```

---

### Task 9: Printable Quiz and PDF-Friendly Styles

**Files:**
- Create: `tests/quiz/printable.test.ts`
- Create: `src/lib/quiz/printable.ts`
- Create: `src/components/quiz/PrintableQuiz.tsx`
- Create: `src/app/sets/[id]/quiz/print/page.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: print-friendly quiz view
- Produces: optional answer key display

- [ ] **Step 1: Write printable assembly tests**

Cover:
- question ordering
- answer key inclusion/exclusion
- prompt side handling
- category-filtered quiz data

- [ ] **Step 2: Implement printable quiz builder**

Use saved quiz setup and selected cards to produce a deterministic printable test payload.

- [ ] **Step 3: Build print page**

Provide controls for:
- show/hide answer key
- print
- return to quiz

Use `window.print()` on the client and CSS `@media print` for page breaks, hidden controls, and clean typography.

- [ ] **Step 4: Manual PDF verification**

Open the browser print dialog and save to PDF. Confirm questions do not overlap, controls are hidden, and answer key behavior is correct.

- [ ] **Step 5: Commit**

```bash
git add tests/quiz/printable.test.ts src/lib/quiz/printable.ts src/components/quiz/PrintableQuiz.tsx src/app/sets/[id]/quiz/print/page.tsx src/app/globals.css
git commit -m "feat: add printable quiz view with PDF-friendly styles"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Build check**

```bash
npm run build
```

- [ ] **Step 4: Manual smoke test**

Walk through:
1. Create a text-only card and confirm old behavior still works.
2. Create a rich card with an image term, video definition, and file attachment.
3. Add custom categories such as `accounting`, `image`, and `talking`.
4. Open a set and verify Matching Game, Review Mode, and Quiz appear as large logo tiles.
5. Start quiz setup and filter by category.
6. Run multiple-choice, short-answer, matching, and true/false modes.
7. Run a quiz using starred-only cards.
8. Run a quiz using previously failed cards.
9. Use AI autocomplete while editing a card with and without a saved Google key.
10. Print a quiz to PDF and verify answer key controls.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Stage 3.5 complete — redesigned study experience, rich cards, customizable quizzes"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Visual redesign of website activity launchers — Task 5
- [x] Bigger logos/icons for Matching Game, Review Mode, and Quiz in tile format — Task 5
- [x] Custom categorization of each term/definition — Tasks 1, 3
- [x] Quiz can test any user-entered category — Task 6
- [x] Terms/definitions support images, videos, and files — Tasks 1, 2, 4
- [x] Uploaded files saved to user account/set — Tasks 1, 2
- [x] AI autocomplete while creating flashcards — Task 8
- [x] Quiz loading/setup screen — Task 6
- [x] Quiz type options: multiple choice, short answer, matching, true/false — Tasks 6, 7
- [x] Quiz can test term or definition side — Task 6
- [x] Starred-only and failed-only quiz filters — Task 6
- [x] Printable test / PDF-friendly output — Task 9

**Placeholder scan:** Storage provider is intentionally selected in Task 2 before implementation; all other work has concrete files, interfaces, and verification steps.

**Compatibility notes:**
- Existing `Card.term` and `Card.definition` remain as searchable fallback text.
- Existing Stage 2 confidence and starred data powers focus filters.
- Existing Stage 3 quiz history powers previously-failed filters.
- Existing Stage 3 AI key flow powers autocomplete.
