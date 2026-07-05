# Personalized Learning Plans & AI Lessons — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **Depends on:** `2026-07-04-persistent-memory-and-prompting.md` (needs `buildLearnerProfile`, `getDueCards`, `StudyEvent`, the prompt registry). Do not start until that plan's Tasks 1–5 are functional.

**Goal:** Turn the one-shot `TrainingPlan` into a *living, nagging, closed-loop* study coach that (a) generates concrete tasks the user is actually likely to do, (b) **bugs the user** to do them via an in-app "Today's Plan" surface with streaks, (c) **actually steers the quizzes** the user gets, and (d) delivers **AI-generated micro-lessons** — not just questions — targeting weak spots.

**Current reality (verified in code):**
- `generateTrainingPlan(setId)` builds a plan (focusAreas + `recommendedCardIds` + `generatedQuestions`) and stores a `TrainingPlan` row. `TrainingPlanPanel.tsx` displays it. That's it.
- **Nothing consumes the plan afterward.** It doesn't affect quiz card selection (`startQuizAttempt` just filters + random-samples). There's no notion of "tasks," no completion tracking, no streaks, no lessons, no re-generation cadence. The plan is a static artifact the user reads once and forgets.

**Product decisions locked with owner:**
- **Nudging = in-app tasks + streaks.** A persistent "Today's Plan" on the dashboard/set page with a checklist of due cards, retry-failed, and new-lesson items, plus a streak counter and dismissable nudges. (Email digests via Resend and Web Push are explicitly **deferred** — but design the task model so a future cron can read it and send a digest without a rewrite.)
- **Lessons are AI-generated micro-content** (a short explanation + worked example + 1–2 check questions) for a weak concept, gradable/markable like a card.

**Tech stack:** Existing Next.js, Prisma, Zod, Vitest, `@google/generative-ai`, sonner. Reuses the memory + prompt-registry primitives from the memory plan.

## Global Constraints

- **Every plan item is a concrete, doable action** bound to real cards/lessons — never vague advice. "Review these 5 fading cards" (with a launch button), not "study more."
- **The plan is derived, not authoritative.** It's regenerated from live memory (`buildLearnerProfile`, `getDueCards`) on a cadence; completing items updates memory, which reshapes the next plan. Closed loop.
- **Tasks are first-class + persisted** so completion/streaks survive sessions and a future email cron can read them.
- **Plans steer quizzes.** A "focus quiz" launched from a plan item pre-seeds `QuizSetup` (card subset, side, mode) — the plan changes what you get tested on.
- **Lessons are validated content.** AI lesson output is Zod-schema'd, stored, and versioned (prompt version from the registry).
- **Graceful without a key.** No Google key → show due/failed/starred items computed purely from memory (no AI text), and prompt to add a key for lessons + AI framing.
- **Anti-nag hygiene.** Nudges are dismissable, rate-limited, and never block the UI; streaks reward consistency without punishing gaps harshly.

---

## File Map

```
quizlet-v2/
├── prisma/
│   └── schema.prisma                       # MODIFY: PlanItem, StudyStreak, Lesson, LessonAttempt; extend TrainingPlan
├── src/
│   ├── actions/
│   │   ├── training-plan.ts                # MODIFY: profile-driven generation + item creation
│   │   ├── plan-items.ts                   # NEW: complete/dismiss/refresh, streak update
│   │   └── lessons.ts                      # NEW: generate + record lesson attempts
│   ├── lib/
│   │   ├── plan/
│   │   │   ├── assemble.ts                 # NEW: pure — memory -> ordered PlanItems (due/failed/starred/lesson)
│   │   │   └── streak.ts                   # NEW: pure — streak math from StudyEvent dates
│   │   └── ai/prompts/
│   │       ├── training-plan.ts            # MODIFY: consume LearnerProfile block
│   │       └── lesson.ts                   # NEW: micro-lesson prompt + schema
│   ├── app/
│   │   ├── page.tsx                        # MODIFY: "Today's Plan" widget on dashboard
│   │   ├── plan/page.tsx                   # NEW: full plan + streak + lessons view
│   │   └── sets/[id]/lesson/[lessonId]/page.tsx  # NEW: lesson runner
│   └── components/
│       ├── plan/
│       │   ├── TodaysPlanWidget.tsx        # NEW: dashboard checklist + streak + nudges
│       │   ├── PlanItemRow.tsx             # NEW: one actionable item w/ launch button
│       │   └── StreakBadge.tsx             # NEW
│       ├── quiz/TrainingPlanPanel.tsx      # MODIFY: items launch focus-quizzes
│       └── lesson/LessonRunner.tsx         # NEW: explanation + example + check questions
├── tests/
│   ├── plan/assemble.test.ts               # NEW
│   └── plan/streak.test.ts                 # NEW
```

---

### Task 1: Plan/lesson/streak schema

**Files:** `prisma/schema.prisma`

- [ ] **Step 1: `PlanItem`** — `userId, setId?, type ("review_due"|"retry_failed"|"drill_starred"|"lesson"|"focus_quiz"), title, cardIds Json?, lessonId?, quizSetup Json?, status ("pending"|"done"|"dismissed"), priority Int, dueDate DateTime?, createdAt, completedAt?`. Index `(userId, status, dueDate)`.
- [ ] **Step 2: `StudyStreak`** — `userId @unique, current Int, longest Int, lastStudyDate DateTime`.
- [ ] **Step 3: `Lesson`** — `userId, setId?, concept String, body Json (explanation+example+checkQuestions), promptVersion, createdAt` + `LessonAttempt` (`lessonId, userId, responses Json, score Int?, createdAt`).
- [ ] **Step 4:** Extend `TrainingPlan` with `profileSnapshot Json` (the LearnerProfile it was built from) + `promptVersion`. Migrate + generate.
- [ ] **Step 5: Commit** — `feat: plan items, streaks, lessons schema`.

---

### Task 2: Pure plan assembly + streaks

**Files:** `src/lib/plan/assemble.ts`, `src/lib/plan/streak.ts`, `tests/plan/assemble.test.ts`, `tests/plan/streak.test.ts`

**Interfaces:**
- Produces: `assemblePlanItems(profile, dueCards, failedCards, starredCards, lessons): PlanItem[]` — pure, deterministic ordering by urgency.
- Produces: `computeStreak(studyDates, today): { current, longest, active }`.

- [ ] **Step 1: Assembly rules (pure).** Compose items from memory signals: fading/due cards → `review_due`; recently failed (`QuizAnswer.isCorrect=false`) → `retry_failed`; low-confidence starred → `drill_starred`; weakest concept with no recent lesson → `lesson`. Cap total items (e.g. 3–5/day) so the list feels doable, ordered by priority. **No AI here** — this guarantees a useful plan even without a key.
- [ ] **Step 2: Streak math (pure).** Consecutive study days from `StudyEvent` dates; grace for same-day; `active` if studied today/yesterday.
- [ ] **Step 3: Tests** — assembly caps + ordering + empty-memory; streak continuity, break, longest.
- [ ] **Step 4: Commit** — `feat: pure plan assembly + streak calculation`.

---

### Task 3: Plan generation (AI framing over pure core)

**Files:** `src/actions/training-plan.ts`, `src/lib/ai/prompts/training-plan.ts`

- [ ] **Step 1: Rebuild generation.** Replace the raw-ID/`JSON.stringify` context with `buildLearnerProfile(setId)`. The AI's job shrinks to: title, motivating summary, and *why* each focus area matters — framing, not data-crunching. Item *selection* comes from `assemblePlanItems` (pure), so it's reliable.
- [ ] **Step 2: Persist `PlanItem` rows** (not just the JSON blob) so they're checkable/dismissable and readable by a future cron.
- [ ] **Step 3: Store `profileSnapshot` + `promptVersion`.**
- [ ] **Step 4: Regeneration cadence** — regenerate when stale (e.g. >24h) or on demand; carry over incomplete items instead of duplicating.
- [ ] **Step 5: Commit** — `feat: profile-driven training plan generating actionable items`.

---

### Task 4: "Today's Plan" surface + nudging

**Files:** `src/app/page.tsx`, `src/app/plan/page.tsx`, `src/components/plan/*`, `src/actions/plan-items.ts`

- [ ] **Step 1: `completePlanItem` / `dismissPlanItem` / `refreshPlan`** actions; completing updates `StudyStreak` (via `computeStreak`) and revalidates.
- [ ] **Step 2: `TodaysPlanWidget`** on the dashboard — checklist of items, each with a one-tap launch (Review due / Retry failed / Start lesson / Focus quiz), `StreakBadge`, and a dismissable nudge line ("3 cards are fading — 2 min to fix"). Rate-limit nudges; never modal.
- [ ] **Step 3: `/plan` full view** — all items, streak history, past lessons, "regenerate" button.
- [ ] **Step 4: Empty/no-key states** — memory-only items render without AI; CTA to add a key for lessons/framing.
- [ ] **Step 5: Commit** — `feat: in-app Today's Plan with streaks and actionable nudges`.

---

### Task 5: Plans steer quizzes (closed loop)

**Files:** `src/components/quiz/TrainingPlanPanel.tsx`, `src/components/plan/PlanItemRow.tsx`, `src/actions/quiz.ts`, `src/lib/quiz/setup.ts`

- [ ] **Step 1: `focus_quiz` items carry a `quizSetup`** (specific `cardIds`, `promptSide`, `mode`). Launching pre-seeds `QuizSetupScreen` so the user is tested on exactly their weak subset.
- [ ] **Step 2: `startQuizAttempt` accepts an explicit card subset** (from a plan item) instead of always random-sampling the filtered pool.
- [ ] **Step 3: Loop closes** — the focus quiz writes `StudyEvent`s (memory plan Task 2), which shifts confidence/due, which reshapes the next `assemblePlanItems`. Completing the quiz auto-marks the plan item done.
- [ ] **Step 4: Manual verify** the loop: plan flags "accretion/dilution" → focus quiz on it → miss again → item persists/re-prioritizes; get it right → confidence rises → item drops off tomorrow's plan.
- [ ] **Step 5: Commit** — `feat: plan items launch targeted focus quizzes (closed feedback loop)`.

---

### Task 6: AI micro-lessons

**Files:** `src/lib/ai/prompts/lesson.ts`, `src/actions/lessons.ts`, `src/app/sets/[id]/lesson/[lessonId]/page.tsx`, `src/components/lesson/LessonRunner.tsx`

- [ ] **Step 1: Lesson schema + prompt.** Output: `{ concept, explanation (short), workedExample, checkQuestions: [{ q, expected }] }`, grounded in the set's cards + the learner profile ("they confuse X with Y — disambiguate"). Zod-validated, versioned.
- [ ] **Step 2: `generateLesson(setId, concept)`** — uses the user's key + `modelFor("plan")`; caches by `(concept, contentHash)`.
- [ ] **Step 3: `LessonRunner`** — read explanation + example, answer check questions (graded via the existing short-answer path), then `recordStudyEvent(source: "lesson")` so lessons feed memory too.
- [ ] **Step 4: `lesson` plan items** deep-link into the runner.
- [ ] **Step 5: Manual verify** a weak-concept lesson end-to-end; confirm completion moves memory + streak.
- [ ] **Step 6: Commit** — `feat: AI-generated micro-lessons targeting weak concepts`.

---

### Task 7: Final verification

- [ ] `npm test` · `npx tsc --noEmit` · `npm run build`
- [ ] Full-loop smoke: fail cards → plan surfaces retry/lesson items + streak → do a lesson + focus quiz → memory updates → next plan reflects progress.
- [ ] Commit — `chore: personalized learning plans & AI lessons complete`.

---

## Self-Review Checklist

- [x] Suggestions are concrete, doable, card-bound — Tasks 2, 3
- [x] App actively bugs the user (in-app tasks + streaks + nudges) — Task 4
- [x] Plans actually change the quizzes given (focus quizzes) — Task 5
- [x] AI-generated *lessons*, not just questions — Task 6
- [x] Closed loop: doing items updates memory, reshaping the plan — Tasks 5, 6
- [x] Works without an AI key (memory-only items) — Global Constraints, Task 4
- [x] Task model ready for a future email/push cron — Task 1 (deferred channels)

**Deferred (design-compatible, not built):** Resend email digests + Web Push. `PlanItem` + `StudyStreak` are shaped so a scheduled job can read "pending items due today" and send without schema changes.
