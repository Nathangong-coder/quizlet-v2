# Task 5 Report: Versioned prompt registry + task-based model routing + memory injection

(Note: this report file previously held a stale report from an unrelated, differently-numbered
task plan — the categorization plan reused the same `.superpowers/sdd/task-5-report.md` path.
It has been overwritten with this task's actual report, per the file's own trailing note.)

Plan: `docs/superpowers/plans/2026-07-04-persistent-memory-and-prompting.md`
Brief: `.superpowers/sdd/task-5-brief.md`
Branch: `stage-6-persistent-memory`

## Final registry structure

```
src/lib/ai/prompts/
  shared.ts               — learnerContextBlock(), distractorMemoryHint() (shared injection phrasing)
  multiple-choice.ts       — MULTIPLE_CHOICE_PROMPT       { id: 'multiple-choice',      version: 1, build, buildParts, schema: MultipleChoiceOptionsSchema }
  grade-short-answer.ts    — GRADE_SHORT_ANSWER_PROMPT     { id: 'grade-short-answer',   version: 1, build, buildParts, schema: ShortAnswerGradeSchema }
  annotation.ts            — ANNOTATION_PROMPT             { id: 'annotation',           version: 1, build, schema: AnnotationSchema }
  mc-feedback.ts           — MC_FEEDBACK_PROMPT            { id: 'mc-feedback',          version: 1, build, schema: MultipleChoiceFeedbackSchema }
  training-plan.ts         — TRAINING_PLAN_PROMPT          { id: 'training-plan',        version: 1, build, schema: TrainingPlanSchema } + TrainingPlanContext type
  quiz-summary.ts          — QUIZ_SUMMARY_PROMPT           { id: 'quiz-summary',         version: 1, build, schema: QuizSummarySchema (z.object({analysis: z.string()})) }
  autocomplete.ts          — AUTOCOMPLETE_PROMPT           { id: 'autocomplete',         version: 1, build, schema: CardAutocompleteSchema }
  registry.ts              — re-exports every module + PROMPT_REGISTRY (id -> entry map)

src/lib/ai/prompts.ts      — thin shim file: old function names (buildMultipleChoicePrompt,
                              buildShortAnswerGradePrompt, buildMultipleChoicePromptParts,
                              buildShortAnswerGradePromptParts, buildTrainingPlanPrompt,
                              buildAnnotationPrompt, buildMultipleChoiceGradePrompt,
                              buildAutocompletePrompt, GRADING_RUBRIC, TrainingPlanContext)
                              now delegate to the registry modules' .build()/.buildParts().
                              Kept only for any import this task missed — no real call site
                              uses it anymore.
```

Every entry follows `{ id, version, build(input), schema }` per the brief. Two modules
(`multiple-choice.ts`, `grade-short-answer.ts`) also export a sibling `buildParts(input)` for
the pre-existing multimodal variant — same id/version/schema, just a second entry point that
returns `{ parts, promptText }` instead of a plain string, matching the shape
`buildMultipleChoicePromptParts`/`buildShortAnswerGradePromptParts` had before this task.

**Grouping decisions:** `annotation.ts` got its own module (distinct schema + a separate AI
call in `submitShortAnswer`, even though it's conceptually part of SA grading) rather than
living inside `grade-short-answer.ts`. `mc-feedback.ts` (the "is this MC/TF answer right"
post-answer feedback prompt) is separate from `multiple-choice.ts` (distractor generation) —
different schema, different call sites, different model-routing bucket in spirit even though
both land in `modelFor('distractors')`.

## Memory injection — exact signatures

Two shared helpers in `shared.ts`, both no-ops (return `''`) when `profileBlock` is undefined:

- `learnerContextBlock(profileBlock?: string)` → `"Learner context: {profileBlock}\n\n"`,
  prepended. Used by `GRADE_SHORT_ANSWER_PROMPT`, `ANNOTATION_PROMPT`, `TRAINING_PLAN_PROMPT`,
  `QUIZ_SUMMARY_PROMPT`.
- `distractorMemoryHint(profileBlock?: string)` → a directive block ("Given this learner's
  recent performance, make distractors probe their specific confusions where relevant:
  {profileBlock}"), inserted into `MULTIPLE_CHOICE_PROMPT` just before the "Requirements"
  section.

`MC_FEEDBACK_PROMPT` and `AUTOCOMPLETE_PROMPT` do **not** accept a `profileBlock` — the brief's
injection list is grading (SA + annotation), MC generation, training-plan, and quiz-summary
only; per-answer feedback and authoring-time autocomplete aren't in that list.

At every call site, the profile is built via `buildLearnerProfile({ userId, setId })` +
`profileToPromptBlock(profile)`, wrapped in try/catch exactly like Task 2's
`recordStudyEvent` error-isolation pattern — a profile-build failure never blocks the AI call,
it just falls back to no context. In `src/actions/quiz.ts` this is factored into one helper,
`safeProfileBlock(userId, setId, label)`, reused across `getOrGenerateMultipleChoiceOptions`,
`submitShortAnswer` (profile built once, reused for both the grade prompt and the annotation
prompt — avoids a duplicate DB round-trip), and `getQuizAttemptSummary`.
`src/actions/training-plan.ts` inlines the same try/catch (only one call site, no need for a
shared helper there).

## modelFor(task) — exact mapping and rationale

```ts
export type AiTask = 'grade' | 'plan' | 'autocomplete' | 'distractors';

function modelFor(task: AiTask): AiModel {
  switch (task) {
    case 'grade':
    case 'plan':
      return 'gemini-3-flash';           // strongest model in the chain
    case 'autocomplete':
    case 'distractors':
      return 'gemini-3.1-flash-lite';    // cheap/fast tier
  }
}
```

`MODEL_FALLBACKS` corrected to match `litellm_config.yaml` (this repo's source of truth per
CLAUDE.md):
`['gemini-3-flash', 'gemma-4-31b-it', 'gemini-3.1-flash-lite', 'gemma-3-27b-it', 'gemma-3-12b-it']`
— replacing the old chain which named `'gemini-3.5-flash'`, a model that doesn't exist in
`litellm_config.yaml`'s model list at all.

**Why `gemini-3.1-flash-lite` for the cheap tier** (rather than e.g. `gemma-3-27b-it`): it's
the same model every `distractors`/`autocomplete` call site was already using as
`DEFAULT_AI_MODEL` pre-Task-5. Choosing it keeps `QuizOptionCache`'s `{cardId, model}` cache
key value-identical across this refactor (no cache invalidation for existing cached MC
options), and keeps this task's behavior change scoped to "grade/plan get upgraded to the
strongest model" rather than also silently changing what model autocomplete/distractors use
day-to-day.

**Call-site → task mapping:**

| Call site | Task |
|---|---|
| `getOrGenerateMultipleChoiceOptions` (MC distractor generation) | `distractors` |
| `submitMultipleChoiceAnswer` / `submitTrueFalseAnswer` (MC/TF feedback via `MC_FEEDBACK_PROMPT`) | `distractors` |
| `submitShortAnswer` (grading + annotation) | `grade` |
| `getQuizAttemptSummary` (quiz-summary analysis) | `grade` |
| `generateTrainingPlan` | `plan` |
| `getCardAutocompleteSuggestions` | `autocomplete` |

`src/app/sets/[id]/print/page.tsx` reads the same `QuizOptionCache` table (to render cached MC
options in the printable view) — updated its cache lookup from the raw `DEFAULT_AI_MODEL` to
`modelFor('distractors')` too, so it stays consistent with whatever model
`getOrGenerateMultipleChoiceOptions`/`getQuizAttemptSummary` actually write/read under. This
file wasn't named in the brief's call-site list but shares the same cache key, so leaving it on
the old constant would have silently desynced the moment `modelFor('distractors')` diverges
from `DEFAULT_AI_MODEL` in the future.

`src/actions/ai-settings.ts` (the "test this API key" ping) still uses `DEFAULT_AI_MODEL`
directly — deliberately left alone, it's a connectivity check with no prompt/task shape, not
one of the four task buckets.

**Known quirk (not introduced by this task, but worth flagging):** `generateJsonWithGoogle`'s
existing fallback mechanism builds `[model, ...MODEL_FALLBACKS.filter(m => m !== model)]`. When
`model` isn't first in `MODEL_FALLBACKS` (true for `'gemini-3.1-flash-lite'`), the fallback list
after a primary failure walks back UP to `'gemini-3-flash'` before trying the weaker models
below the primary. So a cheap `distractors`/`autocomplete` call that fails over still tries the
premium model second, before `gemma-3-27b-it`/`gemma-3-12b-it`. The brief explicitly said not
to change this mechanism ("just make sure modelFor returns a sensible primary"), so this is
flagged rather than fixed — a future task could special-case the fallback slice per task if
this cost profile matters.

## TrainingPlanContext — what was kept/dropped/merged

Pre-Task-5, `TrainingPlanContext` was:
```ts
{ weakCards: Card[]; starredCards: Card[]; confidenceEventsSummary: string; recentQuizAnswers: any[] }
```
`confidenceEventsSummary` came from `prisma.confidenceEvent.findMany(...)` — stale since Task 2
(the brief's tracked, must-fix gap: `recordReview` stopped writing `ConfidenceEvent` rows after
Task 2, in favor of `StudyEvent`, so this summary has been silently frozen/empty for any user
whose only activity was post-Task-2).

**New shape:** `{ profileBlock?: string }` — everything else dropped. Rationale:

- `confidenceEventsSummary` → **replaced** (required by the brief) with `profileBlock`, built
  fresh from `buildLearnerProfile({ userId, setId })` on every call — reads live `CardProgress`
  + `StudyEvent` data, not a stale/dead table.
- `weakCards`/`starredCards` (raw `Card[]`, only ever used for `.map(c => c.term).join(', ')`
  in the old prompt text) → **dropped**. `LearnerProfile.weak`/`.starred` already carry this
  (term + confidence + trend, capped at `WEAK_CAP`/`STARRED_CAP`) in the ID-free
  `profileToPromptBlock` rendering — keeping both would have meant the same weak/starred terms
  appearing twice in one prompt, once via the old raw list and once via the profile block.
- `recentQuizAnswers` (raw `quizAnswer.findMany` dump, `JSON.stringify`-able, unbounded aside
  from `take: 50`) → **dropped**. `LearnerProfile.recent.byMode`/`.recent.graded` already
  surfaces recent per-mode accuracy and short-answer average score in a few bounded lines —
  the raw 50-row JSON dump was strictly more tokens for less-organized information.

Net effect: `generateTrainingPlan` in `src/actions/training-plan.ts` no longer runs the
`Promise.all([cardProgress×2, confidenceEvent, quizAnswer])` fan-out at all — it's one call to
`buildLearnerProfile`. This both fixes the stale-`ConfidenceEvent`-read gap and removes three
now-redundant DB queries.

**Pre-existing quirk observed, left alone (out of scope):** neither the old prompt nor the new
one ever sends real card IDs to the model, yet `TrainingPlanSchema.recommendedCardIds` asks the
AI to output `string[]` "recommended card IDs" — the model has never had real IDs to reference
here, before or after this task. Not introduced by this refactor; flagged for whoever tackles
Stage 7 (personalized learning plans), since that stage's `PlanItem`s presumably need real,
resolvable card IDs.

## promptVersion — persistence

- **`QuizAnswer.grade`** (already `Json?`, no schema change): `submitShortAnswer` now writes
  `{ ...grade, annotations, promptVersion: GRADE_SHORT_ANSWER_PROMPT.version }` in both the
  text-only and multimodal branches.
- **`TrainingPlan.promptVersion`**: new nullable `Int?` column, populated as
  `TRAINING_PLAN_PROMPT.version` in `generateTrainingPlan`.

### Migration

Hit the same pre-existing dev-DB drift Task 1/4 documented (`prisma migrate dev` would refuse
due to unrelated drift). Used the same documented workaround:

1. `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   → produced exactly:
   ```sql
   -- AlterTable
   ALTER TABLE "TrainingPlan" ADD COLUMN     "promptVersion" INTEGER;
   ```
2. Hand-wrote that into `prisma/migrations/20260724160000_add_training_plan_prompt_version/migration.sql`.
3. `npx prisma db execute --file prisma/migrations/20260724160000_add_training_plan_prompt_version/migration.sql`
   (note: this repo's Prisma version reads the datasource from `prisma.config.ts` — `--schema`
   is not a valid flag for `db execute` here, unlike the flag Task 1 may have used; omitted it).
   → "Script executed successfully."
4. `npx prisma migrate resolve --applied 20260724160000_add_training_plan_prompt_version` →
   "Migration ... marked as applied."
5. `npx prisma generate` → regenerated client cleanly.
6. `npx prisma migrate status` → "Database schema is up to date!"
7. Final `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
   → "This is an empty migration." (confirms schema and DB now match exactly, no drift
   introduced).

## Test results

No pre-existing tests for `src/lib/ai/prompts.ts` or `model-routing.ts` (confirmed via
`tests/` search before starting — nothing under `tests/ai/` covered either file). Added:

- `tests/ai/model-routing.test.ts` — `modelFor` returns the right primary per task; every
  primary is a real `MODEL_FALLBACKS` member; `MODEL_FALLBACKS` matches the documented
  `litellm_config.yaml` chain order.
- `tests/ai/prompts.test.ts` — pure `build()`/`buildParts()` tests for every registry module:
  confirms `profileBlock` actually appears in the rendered text when supplied (both the
  "Learner context: ..." prefix style and the MC distractor-hint style), confirms omitting it
  doesn't crash and doesn't leave a stray "Learner context" label, confirms the grading rubric
  JSON-schema keys (`clarity`/`conciseness`/`correctness`/`overall`) are present regardless of
  profileBlock, and confirms `buildParts()` returns `{ parts: [{ text: promptText }], promptText }`
  consistently. Also a `PROMPT_REGISTRY` sanity test (every entry's `.id` matches its key,
  `.version` is a number, `.build` is a function, `.schema` is defined).

**Full suite:**
- `npx tsc --noEmit`: same 4 pre-existing errors, all in `tests/quiz/setup.test.ts`
  (unrelated readonly-tuple typing issue, untouched by this task). Zero new errors — confirmed
  by grepping the file list out of the full tsc output before and after.
- `npx vitest run`: **189 passed** (172 baseline + 17 new), **5 failed** — the same baseline 5
  (4 in `tests/parser/import.test.ts`, 1 in `tests/ai/schemas.test.ts`), zero new failures.

## Manual verification

No live browser or authenticated Next.js request was available, so verification was two-part:

1. **Traced every call site by inspection** (`src/actions/quiz.ts`, `src/actions/training-plan.ts`,
   `src/actions/card-autocomplete.ts`, `src/app/sets/[id]/print/page.tsx`) — confirmed each old
   `build*Prompt(...)` call was replaced with the matching registry `.build()`/`.buildParts()`
   call, each `DEFAULT_AI_MODEL`/hardcoded-model-string was replaced with `modelFor(task)`, and
   `promptVersion` is written in both places the brief specifies.
2. **Ran a throwaway script** (`_verify-prompts.ts`, repo root, deleted before finishing — not
   committed) exercising `MULTIPLE_CHOICE_PROMPT.build`, `GRADE_SHORT_ANSWER_PROMPT.build`,
   `TRAINING_PLAN_PROMPT.build`, and `QUIZ_SUMMARY_PROMPT.build` with realistic fixture data
   (a card, a sibling card, and a hand-written `profileBlock` string shaped like a real
   `profileToPromptBlock` output) via `npx tsx`. Confirmed: prompt text reads sensibly, the
   profile block appears verbatim in the expected location for each prompt (prefixed
   "Learner context: ..." for grading/plan/summary, appended as a distractor-hint sentence for
   MC), and omitting `profileBlock` produces the exact same prompt as before this task with no
   stray text.

**Not performed:** no live DB read/write, no real Gemini API call, no exercise of the actual
`src/actions/*.ts` server actions in a running Next.js process (would require an authenticated
session + a real/proxy Google API key). This mirrors the same limitation prior tasks in this
plan (1-4) documented.

## Concerns

- The fallback-mechanism quirk noted above (a non-strongest primary's fallback list still tries
  the strongest model before working down further) — flagged, not fixed, per the brief's
  explicit instruction not to touch that mechanism.
- `TrainingPlanSchema.recommendedCardIds` — pre-existing disconnect between what the model is
  asked to output and what the prompt actually gives it (no real card IDs in-prompt, before or
  after this task). Flagged for Stage 7.
- `src/lib/ai/prompts.ts` shims are believed unused by any real call site after this task (all
  four call-site files were updated to import the registry directly) — kept only as a safety
  net per the brief's explicit instruction, not because any known caller still needs them.
- Preserved two pre-existing, low-risk prompt-text quirks verbatim rather than "fixing" them
  mid-refactor, to keep prompt behavior equivalent as instructed: `getQuizAttemptSummary`'s
  performance-details join and `buildAutocompletePrompt`'s existing-cards join both use the
  literal two-character sequence `'\\n'` (backslash + n) rather than an actual newline
  (`'\n'|`) — cosmetic only (doesn't affect the JSON schema/output), ported unchanged into
  `quiz-summary.ts` and `autocomplete.ts` respectively.

## Files changed

- `src/lib/ai/prompts/` (new directory: `shared.ts`, `multiple-choice.ts`,
  `grade-short-answer.ts`, `annotation.ts`, `mc-feedback.ts`, `training-plan.ts`,
  `quiz-summary.ts`, `autocomplete.ts`, `registry.ts`)
- `src/lib/ai/prompts.ts` (rewritten as thin shims)
- `src/lib/ai/model-routing.ts` (corrected `MODEL_FALLBACKS`, added `modelFor`/`AiTask`)
- `src/actions/quiz.ts` (all AI call sites use registry + `modelFor`; memory injection added;
  `promptVersion` persisted; `getQuizAttemptSummary`'s inline prompt de-inlined)
- `src/actions/training-plan.ts` (simplified to `buildLearnerProfile` + registry;
  `promptVersion` persisted)
- `src/actions/card-autocomplete.ts` (registry + `modelFor('autocomplete')`, replacing the
  second hardcoded model string)
- `src/app/sets/[id]/print/page.tsx` (cache lookup now uses `modelFor('distractors')`)
- `prisma/schema.prisma` (`TrainingPlan.promptVersion Int?`)
- `prisma/migrations/20260724160000_add_training_plan_prompt_version/migration.sql` (new)
- `tests/ai/model-routing.test.ts`, `tests/ai/prompts.test.ts` (new)
