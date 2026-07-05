# Persistent Learner Memory & Prompting Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the app *remember the learner* across every session and feed that memory into every Gemini call. Two halves:
1. **Persistent memory** — every study action (review, quiz, matching, short-answer) writes back to a durable per-card and per-user model, and that model is queryable as a compact "learner profile" the AI can consume.
2. **Prompting overhaul** — consolidate the scattered string-concatenation prompts into one versioned, testable prompt layer that injects learner memory, uses spaced-repetition signals, and stops hardcoding a single weak model. (See the companion doc `docs/ai/prompting-strategy.md` for the current-state audit + rationale.)

**Current reality (verified in code):**
- `CardProgress` (latest `confidence` 1–10, `starred`) + `ConfidenceEvent` (append-only history) exist and are written **only** by `src/actions/confidence.ts` (`recordReview`, `updateConfidence`, `starCard`) — i.e. **Review mode only**.
- `src/actions/quiz.ts` writes `QuizAnswer`/`QuizAttempt` but **never touches `CardProgress` or `ConfidenceEvent`.** A user can ace or bomb a quiz and their per-card confidence does not move. This is the single biggest memory gap.
- Matching game persists nothing to memory.
- `TrainingPlan` prompt (`buildTrainingPlanPrompt`) dumps raw `cardId` strings and `JSON.stringify(recentQuizAnswers)` — the model gets opaque IDs and unbounded JSON, no compact profile.
- Every prompt is a hand-built template string in `src/lib/ai/prompts.ts`; model is hardcoded to `DEFAULT_AI_MODEL` (`gemini-3.1-flash-lite`) for *all* calls including grading; no prompt versioning; the quiz-summary prompt is inlined directly in `quiz.ts`.

**Tech stack:** Existing Next.js, Prisma, Zod, Vitest, `@google/generative-ai`. No new services — memory is Postgres.

## Global Constraints

- **Single write path.** Every mode routes memory updates through one server module (`lib/memory/record.ts`) so confidence math and event logging can never drift between Review and Quiz again.
- **Append-only history is sacred.** `ConfidenceEvent` (and new event tables) are never mutated — they are the substrate the plan/lessons AI reasons over. Latest-state tables (`CardProgress`) are derived caches.
- **Deterministic, pure scoring.** Confidence deltas, mastery, and due-date math are pure functions in `lib/memory/*` with unit tests — no AI, no I/O. AI never *computes* mastery; it only *reads* it.
- **Compact, ID-free AI context.** The AI receives a bounded, human-readable `LearnerProfile` (terms as text, not cuids; capped counts) — never raw table dumps. Token budget per profile is fixed and enforced.
- **Prompts are versioned + validated.** Each prompt has an ID + version; every response is Zod-validated (already the norm) and the prompt version is stored on the persisted result for auditing/regression.
- **Model routing by task.** Grading and plan generation may use a stronger model than autocomplete; routing is centralized, not hardcoded per call.
- **Privacy.** Memory is per-user, cascade-deleted with the user. Never send one user's memory into another's context.

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                    # MODIFY: StudyEvent, LearnerProfile cache, add due/mastery to CardProgress
├── src/
│   ├── lib/
│   │   ├── memory/
│   │   │   ├── record.ts                # NEW: single write path (confidence delta + event) for ALL modes
│   │   │   ├── scoring.ts               # NEW: pure confidence/mastery math
│   │   │   ├── schedule.ts              # NEW: pure spaced-repetition (due date) math
│   │   │   └── profile.ts               # NEW: build compact LearnerProfile from tables
│   │   └── ai/
│   │       ├── prompts/                 # NEW dir: one file per prompt, each versioned
│   │       │   ├── registry.ts          # NEW: id/version + builder + schema, central export
│   │       │   ├── grade-short-answer.ts
│   │       │   ├── multiple-choice.ts
│   │       │   ├── training-plan.ts
│   │       │   ├── quiz-summary.ts
│   │       │   └── autocomplete.ts
│   │       ├── model-routing.ts         # MODIFY: task -> model map (grade/plan/autocomplete tiers)
│   │       └── context.ts               # NEW: LearnerProfile -> prompt-ready text block
│   ├── actions/
│   │   ├── quiz.ts                      # MODIFY: call memory/record after every answer
│   │   ├── quiz-matching.ts             # MODIFY: record matching outcomes
│   │   └── confidence.ts               # MODIFY: delegate to memory/record (keep API)
├── tests/
│   ├── memory/scoring.test.ts           # NEW
│   ├── memory/schedule.test.ts          # NEW
│   ├── memory/profile.test.ts           # NEW
│   └── ai/context.test.ts               # NEW
└── docs/ai/prompting-strategy.md        # companion doc (current state + improvements)
```

---

### Task 1: Unified memory write path + schema

**Files:** `prisma/schema.prisma`, `src/lib/memory/record.ts`, `src/lib/memory/scoring.ts`, `tests/memory/scoring.test.ts`

**Interfaces:**
- Produces: `recordStudyEvent({ userId, cardId, source, outcome, meta }): { confidence, mastery, dueAt }` — the *only* function any mode calls to update memory.
- Produces: pure `nextConfidence(old, outcome)` and `masteryScore(events)`.

- [ ] **Step 1: Schema.** Add a general `StudyEvent` table (supersedes/augments `ConfidenceEvent`): `userId, cardId, source ("review"|"quiz-mc"|"quiz-sa"|"quiz-tf"|"matching"|"lesson"), correct Boolean?, score Int?, confidenceAfter Int, latencyMs Int?, createdAt`. Add `mastery Int?`, `dueAt DateTime?`, `lastSeenAt DateTime?`, `reps Int @default(0)` to `CardProgress`. Keep `ConfidenceEvent` (backfill/read) or migrate it into `StudyEvent` — prefer widening to `StudyEvent` and leaving a view/shim.
- [ ] **Step 2: Pure scoring.** `nextConfidence`: Review keeps the ±1 rule; quiz outcomes map to deltas (MC/TF correct +1, wrong −1; short-answer scales by `overall` grade, e.g. ≥8 → +1, ≤4 → −2, middle → 0/−1). `masteryScore`: recency-weighted correctness over recent events (pure, tested).
- [ ] **Step 3: `record.ts`.** Wrap the confidence upsert + `StudyEvent` insert + due-date recompute (Task 4) in one transaction. This is the choke point.
- [ ] **Step 4: Tests** for the deltas + mastery across sequences (all-right, all-wrong, oscillating, high-conf-then-miss).
- [ ] **Step 5: Commit** — `feat: unified study-memory write path + event schema`.

---

### Task 2: Wire every mode into memory

**Files:** `src/actions/quiz.ts`, `src/actions/quiz-matching.ts`, `src/actions/confidence.ts`

- [ ] **Step 1: Quiz MC/TF.** In `submitMultipleChoiceAnswer` / `submitTrueFalseAnswer`, after persisting `QuizAnswer`, call `recordStudyEvent(... source: "quiz-mc"/"quiz-tf", correct: isCorrect)`. **This closes the headline gap.**
- [ ] **Step 2: Quiz short-answer.** In `submitShortAnswer`, map `grade.overall` → outcome and `recordStudyEvent(... source: "quiz-sa", score: grade.overall)`.
- [ ] **Step 3: Matching.** On matching completion, record per-card correct/incorrect (first-attempt match = correct).
- [ ] **Step 4: Refactor `confidence.ts`** `recordReview` to delegate to `recordStudyEvent(... source: "review")` — preserve its return shape so `ReviewSession` is untouched.
- [ ] **Step 5: Manual verify** — run a quiz, confirm `CardProgress.confidence` and `StudyEvent` rows move; confirm Review still behaves identically.
- [ ] **Step 6: Commit** — `feat: quiz and matching sessions now update learner memory`.

---

### Task 3: Compact LearnerProfile + AI context

**Files:** `src/lib/memory/profile.ts`, `src/lib/ai/context.ts`, `tests/memory/profile.test.ts`, `tests/ai/context.test.ts`

**Interfaces:**
- Produces: `buildLearnerProfile({ userId, setId? }): LearnerProfile` — a bounded object: weakest N terms (as text + confidence + mastery + recent trend), starred terms, recent accuracy by mode, "fading" terms (due + dropping), streak/volume stats.
- Produces: `profileToPromptBlock(profile): string` — a compact, ID-free, token-capped text block for injection.

- [ ] **Step 1: Query + shape.** Pull `CardProgress` + recent `StudyEvent`s + `QuizAnswer`s, join to card **text** (never expose cuids to the model), cap list sizes, compute per-mode accuracy and trend (improving/flat/declining).
- [ ] **Step 2: Prompt block.** Render like:
  ```
  Learner snapshot (set: "M&A Basics")
  Weak (conf≤4): "accretion/dilution" (2, ↓), "synergies" (3, flat)
  Fading (due, slipping): "WACC" (was 7, missed twice this week)
  Strong: "EBITDA" (9), "DCF" (8)
  Recent: MC 72% · short-answer avg 6.1/10 · 3-day streak
  ```
- [ ] **Step 3: Tests** — bounded size regardless of history length; trend classification; empty-history default.
- [ ] **Step 4: Commit** — `feat: compact learner profile + AI context block`.

---

### Task 4: Spaced-repetition scheduling

**Files:** `src/lib/memory/schedule.ts`, `tests/memory/schedule.test.ts`, `src/lib/memory/record.ts`

- [ ] **Step 1: Pure `nextDueAt(progress, outcome)`** — a lightweight SM-2-style interval (correct → longer interval scaled by confidence; wrong → reset to soon). Store `dueAt`/`reps` on `CardProgress`.
- [ ] **Step 2: Recompute on every `recordStudyEvent`.**
- [ ] **Step 3: `getDueCards(userId, setId?, limit)`** helper for Review defaults and the Learning-Plan "today" list (consumed by the Personalized Plans plan).
- [ ] **Step 4: Tests** for interval growth/reset and due selection ordering.
- [ ] **Step 5: Commit** — `feat: spaced-repetition scheduling on card progress`.

---

### Task 5: Prompt registry + model routing

**Files:** `src/lib/ai/prompts/*`, `src/lib/ai/model-routing.ts`, callers in `src/actions/*`

- [ ] **Step 1: Registry.** Move each prompt from the monolithic `prompts.ts` into its own module exporting `{ id, version, build(input), schema }`. `registry.ts` re-exports them. Keep old exports as thin shims during migration.
- [ ] **Step 2: Inject memory.** `build()` for grading, MC, training-plan, and quiz-summary accepts an optional `profileBlock` and interpolates it ("Given this learner is weak on X, make distractors probe that confusion…"). Grading stays rubric-identical but gains context.
- [ ] **Step 3: De-inline the quiz-summary prompt** from `quiz.ts` into `prompts/quiz-summary.ts`.
- [ ] **Step 4: Task-based model routing.** `model-routing.ts` exports `modelFor(task)`: `grade`/`plan` → strongest available flash; `autocomplete`/`distractors` → cheap/fast; all with the existing fallback chain. Stop passing `DEFAULT_AI_MODEL` everywhere.
- [ ] **Step 5: Store `promptVersion`** on persisted `QuizAnswer.grade` and `TrainingPlan` for regression tracking.
- [ ] **Step 6: Commit** — `refactor: versioned prompt registry + task-based model routing + memory injection`.

---

### Task 6: Final verification

- [ ] `npm test` · `npx tsc --noEmit` · `npm run build`
- [ ] Manual: quiz a set → confidence + due dates update → `buildLearnerProfile` reflects it → a grading call's prompt (logged) contains the profile block.
- [ ] Commit — `chore: persistent memory & prompting overhaul complete`.

---

## Self-Review Checklist

- [x] Quiz/matching now persist confidence + events (headline gap) — Task 2
- [x] Single write path prevents Review/Quiz drift — Task 1
- [x] Confidence + mastery + due-date are pure & tested — Tasks 1, 4
- [x] AI gets a compact, ID-free, token-capped profile — Task 3
- [x] Prompts versioned, consolidated, memory-injected — Task 5
- [x] Model routing no longer hardcoded to the weakest model — Task 5
- [x] Append-only history preserved for downstream AI — Global Constraints

**Downstream:** `buildLearnerProfile`, `getDueCards`, and the prompt registry are the exact primitives the **Personalized Learning Plans** plan builds on. Land this first.
