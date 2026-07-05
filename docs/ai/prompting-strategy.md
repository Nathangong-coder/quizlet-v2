# Gemini Prompting Strategy — Current State & Improvement Plan

_Last updated: 2026-07-04. This doc audits how the app talks to Gemini **today** and what should change. It is the rationale behind the "Prompting Overhaul" half of `docs/superpowers/plans/2026-07-04-persistent-memory-and-prompting.md`._

## How AI calls work today

**Transport.** One helper, `src/lib/ai/google.ts › generateJsonWithGoogle()`:
- Instantiates `GoogleGenerativeAI(apiKey)` with the user's decrypted key.
- Sets `generationConfig.responseMimeType = 'application/json'`.
- Tries the requested model, then walks `MODEL_FALLBACKS`.
- `stripMarkdownJson()` peels ```` ```json ```` fences (and falls back to first `{`…last `}`), `JSON.parse`, then `schema.parse` (Zod).
- Distinguishes `invalid_api_key` (403 / "API key not valid") and stops the fallback loop for it.

**Prompts.** All in one file, `src/lib/ai/prompts.ts`, as template-literal builders:
- `buildMultipleChoicePrompt(card, siblings)` — MC distractors from sibling definitions.
- `buildShortAnswerGradePrompt(card, answer)` — clarity/conciseness/correctness + overall + summary + suggestion.
- `buildAnnotationPrompt(card, answer, correct)` — inline bold/underline/highlight spans.
- `buildMultipleChoiceGradePrompt` / `buildAutocompletePrompt` / `buildTrainingPlanPrompt`.
- Plus **one prompt inlined directly in `src/actions/quiz.ts`** (`getQuizAttemptSummary`).

**Schemas.** `src/lib/ai/schemas.ts` — Zod for every response. This part is genuinely good and should be preserved.

**Models.** `src/lib/ai/model-routing.ts`: `DEFAULT_AI_MODEL = 'gemini-3.1-flash-lite'`, fallback chain `gemini-3.5-flash → gemini-3.1-flash-lite → gemma-4-31b-it`. **Every** call — including grading — passes `DEFAULT_AI_MODEL`.

## What's working

- ✅ **Structured output everywhere.** `responseMimeType: application/json` + Zod validation before persist. This is the right backbone.
- ✅ **Model fallback chain** already matches the litellm dev config philosophy.
- ✅ **Clear per-rubric grading shape** (pros/cons/score per axis) that the UI renders well.
- ✅ **Distractor grounding** — MC uses sibling definitions, so distractors are plausibly on-topic.
- ✅ **Key handling** — per-user encrypted key, invalid-key short-circuit.

## Problems (ranked by impact)

1. **No learner memory in any prompt.** Grading, MC, and even the "training plan" don't know the user's history *per prompt*. The plan prompt dumps raw `cardId` cuids and `JSON.stringify(recentQuizAnswers)` — the model sees opaque IDs and unbounded JSON, not a readable profile. **Biggest lever:** inject a compact `LearnerProfile` block (see memory plan Task 3).
2. **Weakest model does the hardest job.** Grading free-text finance answers is the most judgment-heavy call, yet it runs on `flash-lite` like autocomplete. Route grading/plan to a stronger model; keep autocomplete/distractors cheap.
3. **Prompts aren't versioned.** Tweaking a grading prompt silently changes historical comparability. No prompt ID/version is stored on results — regressions are invisible. Add `{ id, version }` per prompt and persist it on `QuizAnswer.grade` / `TrainingPlan`.
4. **Prompts are scattered & duplicated.** Six builders in one file + one inlined in an action + rubric text (`GRADING_RUBRIC`) that's defined but not actually interpolated into the grading prompt. Consolidate into a registry (`lib/ai/prompts/*`).
5. **Fragile JSON extraction.** `responseMimeType: json` usually returns clean JSON, but `stripMarkdownJson`'s brace-slicing can mangle nested/edge cases. Prefer Gemini **`responseSchema`** (structured output constrained to the Zod shape) over prompt-instructed JSON + regex cleanup.
6. **No media, ever.** Prompts read `card.term`/`card.definition` strings only. Gemini is natively multimodal but never receives an image/audio/sheet. (Fixed by the multimodal plan — `generateJsonMultimodal` + `assetToPart`.)
7. **No few-shot / calibration for grading.** Scores drift run-to-run with no anchor examples. A wrong-but-clear answer vs. a right-but-rambling answer aren't consistently distinguished (the rubric *says* to, but nothing calibrates it).
8. **Redundant round-trips.** Short-answer does grade + annotation as two separate calls; MC/TF do a second call just for one feedback sentence. Some can be merged into one structured response.
9. **No token/cost budget.** Contexts (sibling lists, quiz-answer dumps) are unbounded; no caching of grades; MC cache key ignores card content changes.
10. **No prompt tests.** Builders are pure and trivially testable but untested — easy to snapshot-test input→prompt.

## Target design

- **Prompt registry** — `lib/ai/prompts/<name>.ts`, each exporting `{ id, version, build(input), schema }`; central `registry.ts`. Old exports become shims during migration.
- **Memory injection** — every judgment prompt accepts an optional `profileBlock` from `profileToPromptBlock(buildLearnerProfile(...))`; bounded + ID-free + token-capped.
- **Task-based routing** — `modelFor("grade"|"plan"|"autocomplete"|"distractors")` instead of one global default; fallback chain preserved.
- **Structured output via `responseSchema`** — hand Gemini the schema; keep `stripMarkdownJson` only as a defensive fallback. Zod stays the final gate.
- **Calibration** — a small, versioned set of anchor examples in the grading prompt so scores mean the same thing across sessions; makes "clearly says I don't know" score high on clarity, low on correctness, by construction.
- **Multimodal parts** — `generateJsonMultimodal({ parts, schema })` shares the model-loop core with the string path (multimodal plan Task 4).
- **Versioned + logged** — persist `promptVersion` on AI results; log the assembled prompt (dev) to eyeball memory injection.
- **Budgeted** — cap context list sizes and per-request media parts; content-hash the MC cache; merge grade+annotation where a single structured response suffices.

## Suggested rollout order

1. Registry + de-inline the quiz-summary prompt (pure refactor, no behavior change).
2. Task-based model routing (grading → stronger model) — immediate quality win.
3. `responseSchema` structured output — robustness win.
4. LearnerProfile injection (after memory plan Tasks 1–3) — the big relevance win.
5. Grading calibration examples + prompt versioning.
6. Multimodal parts (with the multimodal plan).
7. Budget/caching cleanup + prompt snapshot tests.

## Open questions

- Which concrete model IDs map to `grade`/`plan` vs `autocomplete` given the user's key tier? (Verify availability against `litellm_config.yaml` + live Google access before hardcoding.)
- Merge grade + annotation into one call, or keep separate for resilience (annotation failure shouldn't block a grade)?
- Where to keep golden grading examples so they're versioned with the prompt but easy for a non-engineer to tune?
