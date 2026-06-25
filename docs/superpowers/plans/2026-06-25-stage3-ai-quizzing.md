# Stage 3 — Quizzing + AI Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AI-powered quiz modes: multiple-choice questions with generated distractors, short-answer questions with structured AI grading, user-managed Google API key settings, and personalized training plans driven by Stage 2 confidence history plus quiz/grading results.

**Architecture:** Store each user's Google API key encrypted in Postgres and only decrypt it inside authenticated server actions. Put all AI prompts, schemas, model defaults, and response parsing in `src/lib/ai/`. Cache multiple-choice options per card/model. Persist quiz attempts and answer-level grading so weak-card analytics and training plans can query both confidence history and quiz performance.

**Tech Stack:** Existing Next.js App Router, Prisma, Auth.js, Zod, Vitest, shadcn/ui. Add `@google/genai` for direct production calls using the user's Google key. Do not route app AI calls through the local LiteLLM proxy; the proxy in `litellm_config.yaml` is for local Anthropic-shaped tooling only.

## Global Constraints

- All mutations use Next.js server actions (no new REST routes except existing auth).
- Every AI response must be requested as JSON and validated with Zod before it is shown or persisted.
- User Google API keys are never logged, never sent to the browser after save, and never stored in plaintext.
- Encryption must use an app-level `GOOGLE_KEY_ENCRYPTION_SECRET` documented in `.env.example`; do not commit real secrets.
- Reuse CLAUDE.md model fallback order for default model labels where practical: `gemini-3-flash` then `gemma-4-31b-it` then `gemini-3.1-flash-lite` then `gemma-3-27b-it` then `gemma-3-12b-it`.
- Multiple-choice distractors are cached by `cardId + model`; regenerate only through an explicit "Regenerate" action.
- Short-answer grading persists structured rubric scores: clarity, conciseness, correctness, overall, feedback, and suggested improvement.
- Training plans must use Stage 2 data (`CardProgress`, `ConfidenceEvent`) plus Stage 3 quiz answer history.
- `src/` layout with `@/` alias; tests in `tests/` mirroring `src/lib/` structure.
- shadcn v4 in this repo does not support `Button asChild`; use `buttonVariants` with `<Link>` or `<a>`.

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                         # MODIFY: AI key, quiz, cache, plan models
├── src/
│   ├── actions/
│   │   ├── ai-settings.ts                    # NEW: save/delete/test Google key
│   │   ├── quiz.ts                           # NEW: MC cache, submit MC, submit short answer
│   │   └── training-plan.ts                  # NEW: generate training plan + targeted questions
│   ├── app/
│   │   ├── settings/
│   │   │   └── ai/page.tsx                   # NEW: API key settings page
│   │   └── sets/[id]/
│   │       ├── page.tsx                      # MODIFY: add Quiz button
│   │       └── quiz/page.tsx                 # NEW: quiz mode shell
│   ├── components/
│   │   ├── settings/
│   │   │   └── GoogleApiKeyForm.tsx          # NEW
│   │   ├── quiz/
│   │   │   ├── QuizModePicker.tsx            # NEW
│   │   │   ├── MultipleChoiceQuiz.tsx        # NEW
│   │   │   ├── ShortAnswerQuiz.tsx           # NEW
│   │   │   ├── GradeCard.tsx                 # NEW
│   │   │   └── TrainingPlanPanel.tsx         # NEW
│   │   └── Navbar.tsx                        # MODIFY: settings link when signed in
│   ├── lib/
│   │   ├── ai/
│   │   │   ├── google.ts                     # NEW: Google JSON generation wrapper
│   │   │   ├── prompts.ts                    # NEW: prompt builders + rubric constants
│   │   │   ├── schemas.ts                    # NEW: Zod schemas for AI outputs
│   │   │   └── model-routing.ts              # NEW: default model + fallback labels
│   │   ├── quiz/
│   │   │   └── scoring.ts                    # NEW: pure scoring/result helpers
│   │   └── security/
│   │       └── google-key.ts                 # NEW: encrypt/decrypt/mask key helpers
│   ├── middleware.ts                         # MODIFY: protect settings + quiz route
│   └── types/action.ts                       # REUSE: ActionResult
├── tests/
│   ├── ai/
│   │   ├── schemas.test.ts                   # NEW
│   │   └── google-key.test.ts                # NEW
│   └── quiz/
│       └── scoring.test.ts                   # NEW
└── .env.example                              # MODIFY: GOOGLE_KEY_ENCRYPTION_SECRET
```

---

### Task 1: Install AI Dependency + Environment Contract

**Files:**
- Modify: `package.json`, `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: `@google/genai` available to server-only AI code
- Produces: documented `GOOGLE_KEY_ENCRYPTION_SECRET`

- [ ] **Step 1: Install Google GenAI SDK**

```bash
npm install @google/genai
```

- [ ] **Step 2: Document the encryption secret**

Add to `.env.example`:

```dotenv
# 32-byte base64 secret used to encrypt user-supplied Google API keys.
# Generate with: openssl rand -base64 32
GOOGLE_KEY_ENCRYPTION_SECRET=""
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .env.example
git commit -m "chore: add Google GenAI SDK and API key encryption env contract"
```

---

### Task 2: Prisma Schema Migration for AI + Quiz History

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: encrypted credential storage
- Produces: MC option cache
- Produces: quiz attempt and answer history
- Produces: saved training plans

- [ ] **Step 1: Add relations to existing models**

Inside the existing `User` model block, add:

```prisma
  aiCredential  AiCredential?
  quizAttempts  QuizAttempt[]
  quizAnswers   QuizAnswer[]
  trainingPlans TrainingPlan[]
```

Inside the existing `Set` model block, add:

```prisma
  quizAttempts QuizAttempt[]
```

Inside the existing `Card` model block, add:

```prisma
  quizOptionCaches QuizOptionCache[]
  quizAnswers      QuizAnswer[]
```

- [ ] **Step 2: Append Stage 3 models**

```prisma
model AiCredential {
  id              String    @id @default(cuid())
  userId          String    @unique
  provider        String    @default("google")
  encryptedApiKey String    @db.Text
  keyHint         String
  verifiedAt      DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model QuizOptionCache {
  id        String   @id @default(cuid())
  cardId    String
  model     String
  options   Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  card      Card     @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([cardId, model])
  @@index([cardId])
}

model QuizAttempt {
  id        String       @id @default(cuid())
  userId    String
  setId     String
  mode      String
  score     Int?
  createdAt DateTime     @default(now())
  user      User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  set       Set          @relation(fields: [setId], references: [id], onDelete: Cascade)
  answers   QuizAnswer[]

  @@index([userId, createdAt])
  @@index([setId, createdAt])
}

model QuizAnswer {
  id            String      @id @default(cuid())
  attemptId     String
  userId        String
  cardId        String
  mode          String
  prompt        String      @db.Text
  answer        String?     @db.Text
  correctAnswer String      @db.Text
  selectedOption String?    @db.Text
  isCorrect     Boolean?
  grade         Json?
  score         Int?
  feedback      String?     @db.Text
  createdAt     DateTime    @default(now())
  attempt       QuizAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)
  card          Card        @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@index([userId, cardId])
  @@index([userId, createdAt])
  @@index([attemptId])
}

model TrainingPlan {
  id                 String   @id @default(cuid())
  userId             String
  sourceSetId         String?
  title              String
  summary            String   @db.Text
  focusAreas          Json
  recommendedCardIds  Json
  generatedQuestions  Json
  createdAt           DateTime @default(now())
  user               User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
  @@index([sourceSetId])
}
```

- [ ] **Step 3: Run migration**

```bash
npx prisma migrate dev --name stage3-ai-quizzing
```

Expected: `Your database is now in sync with your schema.`

- [ ] **Step 4: Regenerate client**

```bash
npx prisma generate
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add AI credential, quiz history, option cache, and training plan models"
```

---

### Task 3: API Key Encryption Helpers (TDD)

**Files:**
- Create: `tests/ai/google-key.test.ts`
- Create: `src/lib/security/google-key.ts`

**Interfaces:**
- Produces: `encryptGoogleApiKey(apiKey: string): string`
- Produces: `decryptGoogleApiKey(payload: string): string`
- Produces: `maskGoogleApiKey(apiKey: string): string`

- [ ] **Step 1: Write tests**

Test that encryption round-trips, ciphertext does not contain the plaintext key, invalid payloads throw, and `maskGoogleApiKey('AIzaSyExample123456')` returns a non-secret hint like `AIza****3456`.

- [ ] **Step 2: Implement helper with AES-256-GCM**

Use Node `crypto`:
- Decode `process.env.GOOGLE_KEY_ENCRYPTION_SECRET` as base64.
- Require exactly 32 bytes.
- Generate a 12-byte IV.
- Store payload as `v1:<base64 iv>:<base64 auth tag>:<base64 ciphertext>`.

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/ai/google-key.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/ai/google-key.test.ts src/lib/security/google-key.ts
git commit -m "feat: encrypt user Google API keys with AES-GCM"
```

---

### Task 4: AI Schemas, Prompts, and Model Routing (TDD)

**Files:**
- Create: `tests/ai/schemas.test.ts`
- Create: `src/lib/ai/schemas.ts`
- Create: `src/lib/ai/prompts.ts`
- Create: `src/lib/ai/model-routing.ts`

**Interfaces:**
- Produces: `MultipleChoiceOptionsSchema`
- Produces: `ShortAnswerGradeSchema`
- Produces: `TrainingPlanSchema`
- Produces: prompt builders for MC distractors, short-answer grading, and training plans

- [ ] **Step 1: Define validated schemas**

`src/lib/ai/schemas.ts` must export:

```typescript
export const MultipleChoiceOptionsSchema = z.object({
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.string().min(1),
})

export const ShortAnswerGradeSchema = z.object({
  clarity: z.number().int().min(1).max(10),
  conciseness: z.number().int().min(1).max(10),
  correctness: z.number().int().min(1).max(10),
  overall: z.number().int().min(1).max(10),
  feedback: z.string().min(1),
  suggestedImprovement: z.string().min(1),
})

export const TrainingPlanSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  focusAreas: z.array(z.object({
    label: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high']),
  })),
  recommendedCardIds: z.array(z.string()),
  generatedQuestions: z.array(z.object({
    cardId: z.string().optional(),
    question: z.string().min(1),
    expectedAnswer: z.string().min(1),
  })),
})
```

- [ ] **Step 2: Write schema tests**

Cover valid responses, missing fields, score bounds, wrong option counts, and malformed training-plan priorities.

- [ ] **Step 3: Add prompt builders**

`src/lib/ai/prompts.ts` should keep the rubric in one place and export:
- `buildMultipleChoicePrompt(card, siblingCards)`
- `buildShortAnswerGradePrompt(card, answer)`
- `buildTrainingPlanPrompt(context)`

Prompt requirements:
- MC prompt asks for exactly 4 options, one exact correct answer, and 3 plausible but incorrect distractors.
- Short-answer prompt grades clarity, conciseness, correctness, and overall independently.
- Training-plan prompt receives weak cards, confidence events summary, recent quiz answers, starred cards, and asks for targeted new questions.

- [ ] **Step 4: Add model routing constants**

`src/lib/ai/model-routing.ts` should export:

```typescript
export const DEFAULT_AI_MODEL = 'gemini-3-flash'
export const MODEL_FALLBACKS = [
  'gemini-3-flash',
  'gemma-4-31b-it',
  'gemini-3.1-flash-lite',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
] as const
```

- [ ] **Step 5: Run tests**

```bash
npm test -- tests/ai/schemas.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add tests/ai/schemas.test.ts src/lib/ai/
git commit -m "feat: add AI response schemas, prompts, and model routing constants"
```

---

### Task 5: Google AI Wrapper

**Files:**
- Create: `src/lib/ai/google.ts`

**Interfaces:**
- Produces: `generateJsonWithGoogle<T>(params): Promise<T>`
- Consumes: user-supplied decrypted Google key
- Consumes: Zod schema for validation

- [ ] **Step 1: Create a server-only wrapper**

Add `import 'server-only'` at the top of `src/lib/ai/google.ts`.

The wrapper should:
- Instantiate `GoogleGenAI` with the decrypted user key.
- Request JSON-only output.
- Try models in `MODEL_FALLBACKS`.
- Parse JSON safely from the model response.
- Validate with the caller-provided Zod schema.
- Throw a sanitized error that does not include prompts, responses, or API keys.

- [ ] **Step 2: Keep failure modes explicit**

Export small error classes or discriminated error codes:
- `missing_api_key`
- `invalid_api_key`
- `ai_generation_failed`
- `ai_response_invalid`

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/ai/google.ts
git commit -m "feat: add validated Google JSON generation wrapper with model fallbacks"
```

---

### Task 6: Google API Key Settings UI + Actions

**Files:**
- Create: `src/actions/ai-settings.ts`
- Create: `src/components/settings/GoogleApiKeyForm.tsx`
- Create: `src/app/settings/ai/page.tsx`
- Modify: `src/components/Navbar.tsx`
- Modify: `src/middleware.ts`

**Interfaces:**
- Produces: `saveGoogleApiKey(apiKey: string): Promise<ActionResult<void>>`
- Produces: `deleteGoogleApiKey(): Promise<ActionResult<void>>`
- Produces: `testGoogleApiKey(apiKey?: string): Promise<ActionResult<void>>`

- [ ] **Step 1: Create settings actions**

Actions must:
- Require `auth()`.
- Validate key shape enough to catch empty/obviously invalid values.
- Encrypt before upsert.
- Store only `keyHint` and `verifiedAt` metadata in readable form.
- Revalidate `/settings/ai`.

- [ ] **Step 2: Create settings form**

`GoogleApiKeyForm.tsx` should show:
- Current saved status: "Saved key: AIza****1234" or "No key saved".
- Password input for a new key.
- Save, Test, and Delete buttons.
- `sonner` toast feedback for success/failure.

- [ ] **Step 3: Create settings page**

`src/app/settings/ai/page.tsx` loads the current user's `AiCredential` and renders the form. Do not load or decrypt the key for display.

- [ ] **Step 4: Add navbar and middleware links**

Add a signed-in "AI Settings" link to `Navbar`.

Protect:

```typescript
'/settings/ai'
'/sets/:id*/quiz'
```

- [ ] **Step 5: Manual verification**

```bash
npm run dev
```

Verify:
1. Signed-out users are redirected from `/settings/ai`.
2. Saving a key stores an encrypted `AiCredential`.
3. The saved page shows only the key hint.
4. Delete removes the row.

- [ ] **Step 6: Commit**

```bash
git add src/actions/ai-settings.ts src/components/settings/ src/app/settings/ai/ src/components/Navbar.tsx src/middleware.ts
git commit -m "feat: add encrypted Google API key settings"
```

---

### Task 7: Quiz Scoring Helpers (TDD)

**Files:**
- Create: `tests/quiz/scoring.test.ts`
- Create: `src/lib/quiz/scoring.ts`

**Interfaces:**
- Produces: `shuffleOptions(options: string[], seed?: string): string[]`
- Produces: `scoreMultipleChoice(selected: string, correct: string): boolean`
- Produces: `overallQuizScore(results: { score: number | null }[]): number | null`

- [ ] **Step 1: Write tests**

Cover:
- MC answer comparison is exact after trimming.
- Empty selected answer is incorrect.
- Overall score ignores null scores.
- Overall score returns null when there are no scored answers.
- Shuffling preserves all options.

- [ ] **Step 2: Implement helpers**

Keep this file pure and independent of Prisma/React.

- [ ] **Step 3: Run tests**

```bash
npm test -- tests/quiz/scoring.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add tests/quiz/scoring.test.ts src/lib/quiz/scoring.ts
git commit -m "feat: add pure quiz scoring helpers"
```

---

### Task 8: Multiple-Choice Quiz Actions

**Files:**
- Create: `src/actions/quiz.ts`

**Interfaces:**
- Produces: `getOrGenerateMultipleChoiceOptions(cardId: string): Promise<ActionResult<{ cardId: string; options: string[]; correctAnswer: string; cacheHit: boolean; model: string }>>`
- Produces: `startQuizAttempt(setId: string, mode: 'multiple-choice' | 'short-answer'): Promise<ActionResult<{ attemptId: string }>>`
- Produces: `submitMultipleChoiceAnswer(input): Promise<ActionResult<{ isCorrect: boolean; score: number }>>`

- [ ] **Step 1: Fetch/decrypt the user key inside the action**

If the user has no saved key, return an `ActionResult` error that the UI can turn into a link to `/settings/ai`.

- [ ] **Step 2: Generate and cache MC options**

For a card:
- Load the card and sibling cards from the same set.
- Build the prompt from `buildMultipleChoicePrompt`.
- Call `generateJsonWithGoogle` with `MultipleChoiceOptionsSchema`.
- Ensure the exact card definition is included once as the correct answer.
- Store in `QuizOptionCache` under `(cardId, DEFAULT_AI_MODEL)`.

- [ ] **Step 3: Persist MC answers**

`submitMultipleChoiceAnswer` should create a `QuizAnswer` row with:
- `mode = 'multiple-choice'`
- `selectedOption`
- `correctAnswer`
- `isCorrect`
- `score = 100` or `0`

It should update `QuizAttempt.score` after each answer using `overallQuizScore`.

- [ ] **Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/actions/quiz.ts
git commit -m "feat: generate cached multiple-choice options and persist quiz answers"
```

---

### Task 9: Short-Answer Grading Actions

**Files:**
- Modify: `src/actions/quiz.ts`

**Interfaces:**
- Produces: `submitShortAnswer(input): Promise<ActionResult<{ grade: ShortAnswerGrade; score: number }>>`

- [ ] **Step 1: Add short-answer submission**

The action should:
- Require auth.
- Require a saved Google API key.
- Load the card by `cardId`.
- Build the grading prompt with term, expected definition, and user answer.
- Call `generateJsonWithGoogle` with `ShortAnswerGradeSchema`.
- Persist `QuizAnswer.grade`, `score = grade.overall * 10`, and `feedback`.
- Update `QuizAttempt.score`.

- [ ] **Step 2: Preserve rubric independence**

Do not collapse rubric fields into a single prose summary. Store the full validated grade JSON.

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/actions/quiz.ts
git commit -m "feat: grade short-answer quiz responses with structured AI rubric"
```

---

### Task 10: Quiz UI

**Files:**
- Create: `src/app/sets/[id]/quiz/page.tsx`
- Create: `src/components/quiz/QuizModePicker.tsx`
- Create: `src/components/quiz/MultipleChoiceQuiz.tsx`
- Create: `src/components/quiz/ShortAnswerQuiz.tsx`
- Create: `src/components/quiz/GradeCard.tsx`
- Modify: `src/app/sets/[id]/page.tsx`

**Interfaces:**
- Produces: `/sets/[id]/quiz`
- Produces: set detail "Quiz" button

- [ ] **Step 1: Create quiz page shell**

The server page should:
- Require auth.
- Load set + ordered cards.
- Check if the user has an `AiCredential`.
- If missing, show a concise callout linking to `/settings/ai`.
- Render `QuizModePicker` with cards and set ID.

- [ ] **Step 2: Add mode picker**

Modes:
- Multiple Choice
- Short Answer

Start an attempt when the user picks a mode. Keep the attempt ID in client state.

- [ ] **Step 3: Build MC quiz component**

Expected behavior:
1. Show one card at a time as a question using the card term.
2. Load cached/generated options before displaying answers.
3. User picks one option and submits.
4. Show correct/incorrect result immediately.
5. Move to next card.
6. Summary screen shows score and answer count.

- [ ] **Step 4: Build short-answer quiz component**

Expected behavior:
1. Show the term and a textarea.
2. Submit answer to AI grading action.
3. Render `GradeCard` with clarity, conciseness, correctness, overall, feedback, suggested improvement.
4. Move to next card.
5. Summary screen shows average score.

- [ ] **Step 5: Add set detail button**

On `src/app/sets/[id]/page.tsx`, add a signed-in `Quiz` button next to Matching Game and Review Mode.

- [ ] **Step 6: Manual verification**

```bash
npm run dev
```

Verify:
1. User without saved key sees settings callout.
2. MC quiz generates four options and caches them.
3. Refreshing/retrying the same card uses cached options.
4. Short-answer mode returns rubric scores and feedback.
5. Quiz attempts and answers appear in Prisma Studio.

- [ ] **Step 7: Commit**

```bash
git add src/app/sets/[id]/quiz/ src/components/quiz/ src/app/sets/[id]/page.tsx
git commit -m "feat: add multiple-choice and short-answer quiz UI"
```

---

### Task 11: Training Plan Generation

**Files:**
- Create: `src/actions/training-plan.ts`
- Create: `src/components/quiz/TrainingPlanPanel.tsx`
- Modify: `src/app/sets/[id]/quiz/page.tsx`

**Interfaces:**
- Produces: `generateTrainingPlan(setId: string): Promise<ActionResult<TrainingPlanView>>`
- Consumes: `CardProgress`, `ConfidenceEvent`, `QuizAnswer`

- [ ] **Step 1: Build training context query**

For the current user and set:
- Weak cards: confidence ≤ 5.
- Starred cards.
- Recent confidence events, newest first, capped at 50.
- Recent quiz answers, newest first, capped at 50.
- Incorrect MC answers.
- Short-answer grades where correctness or overall ≤ 6.

- [ ] **Step 2: Generate validated plan**

Call `generateJsonWithGoogle` using `TrainingPlanSchema`, then persist:
- `title`
- `summary`
- `focusAreas`
- `recommendedCardIds`
- `generatedQuestions`
- `sourceSetId`

- [ ] **Step 3: Render training panel**

`TrainingPlanPanel` should show:
- Generate/refresh button.
- Latest saved plan if present.
- Focus areas with priority.
- Recommended cards.
- Generated short-answer questions targeting weaknesses.

- [ ] **Step 4: Manual verification**

Seed or create mixed quiz results, then generate a plan. Confirm the plan references weak cards and poor grading results rather than generic study advice.

- [ ] **Step 5: Commit**

```bash
git add src/actions/training-plan.ts src/components/quiz/TrainingPlanPanel.tsx src/app/sets/[id]/quiz/page.tsx
git commit -m "feat: generate personalized AI training plans from confidence and quiz history"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: parser, matching, review, AI schema/encryption, and quiz scoring tests pass.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Build check**

```bash
npm run build
```

Expected: build completes without errors.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Walk through:
1. Sign in.
2. Open `/settings/ai`; save and test a Google API key.
3. Open a set with 4+ cards.
4. Click `Quiz`.
5. Complete a multiple-choice quiz; verify options cache and answer history.
6. Complete a short-answer quiz; verify rubric grades and answer history.
7. Generate a training plan; verify it uses weak/confidence/quiz data.
8. Delete the saved key; verify quiz mode returns the settings callout instead of crashing.
9. Check Prisma Studio for encrypted key only, no plaintext API key.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: Stage 3 complete — AI quizzing, grading, and training plans"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] Multiple-choice questions built from flashcards — Task 8, Task 10
- [x] AI-generated distractors using user's Google key — Task 5, Task 6, Task 8
- [x] Generated options cached — Task 2 (`QuizOptionCache`), Task 8
- [x] Settings UI to enter/store Google API key — Task 6
- [x] Key stored encrypted, never plaintext — Task 3, Task 6
- [x] Short-answer questions with AI grading — Task 9, Task 10
- [x] Rubric includes clarity, conciseness, correctness, overall — Task 4, Task 9
- [x] Grading returns structured JSON and validates with Zod — Task 4, Task 5, Task 9
- [x] AI suggested training plan — Task 11
- [x] New questions targeting weaknesses — Task 11
- [x] Uses Stage 2 confidence data and grading history — Task 2, Task 11

**Placeholder scan:** No unresolved placeholder markers. Each task has concrete files, interfaces, and verification steps.

**Type consistency:**
- `MultipleChoiceOptionsSchema`, `ShortAnswerGradeSchema`, and `TrainingPlanSchema` are defined in Task 4 and consumed by Tasks 8, 9, and 11.
- `QuizOptionCache.@@unique([cardId, model])` matches the cache upsert in Task 8.
- `QuizAttempt` and `QuizAnswer` persist both MC and short-answer results with mode-specific nullable fields.
- `AiCredential.userId @unique` matches one saved Google key per user.
- `GOOGLE_KEY_ENCRYPTION_SECRET` is required only on the server and never exposed to client components.
