# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Starting work? Read `docs/superpowers/BUILD-QUEUE.md` first.** It holds the build order (which is not derivable from spec filenames), every carried-over finding, current test/lint baselines, and two environment traps that otherwise waste a session.

## Project status

**Active codebase — Stages 1 through 3.5 are built.** The app is a working Next.js App Router project (`src/`), with a Prisma schema covering users, sets, cards, categories, rich content blocks + assets, confidence/progress memory, quiz attempts/answers, training plans, and multi-provider AI credentials. Stage 4 (voice) is not built. Keep this file in sync with reality as stages land.

**What exists today (verified in code):**
- Flashcards, set builder, import parser (`src/lib/parser/import.ts`), search, matching game — Stage 1.
- Star/confidence memory (`CardProgress` + `ConfidenceEvent`), flashcard carousel, Review mode — Stage 2.
- AI multiple-choice, short-answer grading + annotations, training-plan generation, autocomplete, encrypted per-user AI credentials — Stage 3 (credentials are multi-provider as of Stage 6; see "AI integration" below).
- Activity tiles, quiz setup/filters (starred/failed/side/mode), rich-card **authoring** scaffolding (`CardContentBlock`/`CardAsset` via Vercel Blob), printable quizzes — Stage 3.5. (Custom categories were only a data model + a dead quiz filter in 3.5; the full categorization feature — authoring, display, and games filtering — ships in **Stage 3.6**.)

**Known gaps being addressed by the plans in `docs/superpowers/plans/` (dated 2026-07-04):**
- Rich content is authored but **not rendered and never sent to Gemini** — see the Multimodal plan.
- **Quiz sessions do not update confidence memory** (only Review mode does); prompts use raw-ID data dumps — see the Persistent Memory & Prompting plan.
- Training plans are static artifacts that don't steer quizzes or produce lessons — see the Personalized Learning Plans plan.

See also: `docs/ai/prompting-strategy.md` (current Gemini approach + improvements) and `docs/vision/beyond-a-gpt-wrapper.md`.

## What we're building

A redesigned Quizlet-style study app with first-class **short-answer** practice aimed at finance interview prep. Beyond flashcards, the app uses AI (Gemini/Gemma by default; a user may also add Anthropic, OpenAI, OpenRouter, or custom-endpoint credentials) to generate multiple-choice options, grade free-text and **spoken** answers, and produce personalized training plans.

## Decided stack

- **Framework:** Next.js (App Router) + React + TypeScript, Tailwind CSS. API routes / server actions for the backend. Target deploy: Vercel.
- **Database / ORM:** Postgres (Neon or Supabase) via Prisma.
- **Auth:** Auth.js (NextAuth), JWT sessions. Two providers: GitHub OAuth and **Credentials**
  (handle or email + password, bcryptjs cost 12). The Credentials provider lives in `src/auth.ts`
  and **must never** be added to `src/auth.config.ts` — `src/middleware.ts` bundles that file for
  the **edge runtime**, where a hashing library breaks every protected route at request time,
  invisibly to `tsc` and to the test suite. `tests/auth/edge-safety.test.ts` walks the transitive
  import graph to enforce it. Sign-up requires an **invite code** (`InviteCode`, a bearer code with
  `maxUses` + expiry, minted by `npm run invite`) and a **verified email address** — `emailVerified`
  is null for a new credentials account and `authorizeCredentials` refuses sign-in until it is set.
  `CREDENTIALS_SIGNUP_ENABLED` survives as a **master kill switch** (off unless exactly `"true"`),
  not as the growth control; invite codes are the cap. Password reset exists (`/forgot`,
  `/reset/[token]`) on one `UserToken` table whose `tokenHash` is `sha256(purpose + ':' + raw)` —
  the purpose is bound into the hash so a verification token cannot be presented at the reset
  endpoint. Mail goes through `src/lib/mail/` (raw `fetch` to Resend; **no `resend` package**),
  and with `RESEND_API_KEY` absent it falls back to a console transport that prints links to the
  server log. Signing in is never gated. JWTs cannot be revoked, so `User.sessionVersion` is
  compared on every session resolution and bumped on password change **and on reset**; without it
  a password change is theatre. Accounts are required for starring/confidence memory, saved quiz
  history, and (later) multiplayer.

  **Roles (Spec 1, 2026-09-03).** `User.role` (`learner | staff | admin`, vocabulary in
  `src/lib/auth/roles.ts`) replaced the `KLT_EDITORS` env allowlist. It is resolved on every
  session by the primary-key lookup `jwtCallback` already makes for `sessionVersion` — never
  stored as a JWT claim, which would leave a revoked admin admin until their token expired.
  Pure predicates (`isStaff`/`isAdmin`, Prisma-free, client-importable) are separate from the
  async gates (`requireStaff`/`requireAdmin` in `src/lib/staff/access.ts`); only gates
  authorize. Bootstrap and recovery are `npm run grant-role` — the migration deliberately does
  not read the old env var, because `prisma migrate deploy` runs inside `npm run build` where
  it may be absent, and a silent no-op grant locks the operator out.
- **AI access:** Each user stores their own AI provider credentials (`AiCredential`, many per user) in settings; all AI calls on their behalf run against those credentials. See "AI integration" below.
- **Multiplayer:** Single-player first; live vs-friends matching is a later add-on (Supabase Realtime or WebSockets when built).

## AI integration (important — read before touching AI code)

Two paths exist and must not be conflated:

1. **Production:** each user stores their own provider credentials in `AiCredential` — many per user, not one. Fields: `provider` (`google | anthropic | openai | openrouter | custom`), `label`, `defaultModel`, `role` (`primary | backup`), `enabled`, `lastUsedAt`, `lastErrorKind`. An optional `AiTaskRouting` row pins a task (`grade | plan | distractors | autocomplete` — see `AI_TASKS` in `src/lib/ai/model-routing.ts`) to one specific credential + model; without a pin, every enabled credential is eligible. A routing **model override is only valid alongside a pinned credential** (`saveTaskRouting` rejects a model with no credential, and `generateJson` ignores one) — a model id is provider-specific, so applying it across a heterogeneous pool 404s every non-matching provider and false-badges healthy keys. Credential CRUD, model listing, and credential testing live in `src/actions/ai-credentials.ts`.
2. **Local dev:** the `litellm_config.yaml` proxy — a separate concern from `AiCredential`, used to run Claude Code / Anthropic-shaped clients against Google models locally. It exposes an **Anthropic-compatible** endpoint at `http://localhost:4000`; `.env` points the Anthropic SDK vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL`, etc.) at it. The fallback chain lives only in the yaml: primary `gemini-3.6-flash` falling back through `gemini-3.5-flash` → `gemini-3.1-flash-lite` → `gemini-3.5-flash-lite` → `gemma-4-31b-it` → `gemma-4-26b-a4b-it`.

To run the proxy locally: `litellm --config litellm_config.yaml` (requires `LITELLM_MASTER_KEY` and `GOOGLE_API_KEY` in env).

**Generation and rotation.** All generation funnels through `generateJson()` in `src/lib/ai/generate.ts`, built on Vercel AI SDK v7. For a given user/task it resolves the eligible credentials and orders them with the pure function `selectAttemptOrder` (`src/lib/ai/key-pool.ts`) — least-recently-used on `lastUsedAt`, primaries before backups, disabled credentials excluded — then attempts each in order until one succeeds. LRU (not a counter) was chosen because a counter can't be shared across serverless instances. **`lastUsedAt` is stamped before each attempt, not after success** — it means "least recently *tried*". Concurrent callers (a quiz fans one generation out per card) otherwise all read the same value and pile onto one key.

Two Vercel AI SDK v7 facts that are easy to get wrong:
- **`generateObject` does not exist in v7.** Structured output is `generateText({ model, output: Output.object({ schema }) })`.
- **The Google provider factory is `createGoogle`** (`@ai-sdk/google`), renamed from `createGoogleGenerativeAI`.

`src/lib/ai/google.ts` and its `stripMarkdownJson` regex JSON cleanup are deleted — the SDK's native structured output replaced them.

**Model ids must be verified by a real generation call, never a listing call.** Google's `ListModels` has returned ids (e.g. `gemini-2.5-flash`) that 404 from `generateContent` — a hardcoded, nonexistent model id caused a real production outage here. `testCredential`/`testRawCredential` (`src/actions/ai-credentials.ts`) always issue a real `generateText` call to verify a model; never trust the model-listing call alone.

**Failure classification.** `src/lib/errors/classify.ts` maps any provider error to a `FailureKind` (`no_credentials`, `credentials_unavailable`, `invalid_key`, `quota_exhausted`, `rate_limited`, `unknown_model`, `provider_down`, `schema_invalid`, `config_invalid`, `internal`) carrying a `user`/`system` attribution, so the UI can say whose problem it is. Classification prefers the SDK's real `statusCode` (`APICallError`) and only falls back to message wording — never bare digit substrings, which let a trace id inside a 503 body classify as `invalid_key`. `schema_invalid` is reached from the AI SDK's `NoObjectGeneratedError`/`TypeValidationError`/`JSONParseError`, i.e. a reply that failed `Output.object` parsing or Zod validation. `no_credentials` means the account has zero keys; `credentials_unavailable` means keys exist but none is usable (all disabled, or task routing pins a disabled one). On total failure, the thrown error aggregates **every** attempt, not just the last — surfacing only the last error is what made an earlier multi-credential outage here unreadable.

**AI grading is a core domain concept, not a feature bolt-on.** Grading must return structured output (not prose) so the UI can render scores and the system can track weaknesses over time. The grading rubric differs by mode:
- **Short-answer (text):** clarity, conciseness, correctness, plus an overall grade. Note that a wrong answer can still score well on clarity (e.g. clearly admitting "I don't know").
- **Spoken answer (Stage 4):** the above **plus** delivery metrics specific to live/interview settings — filler words (transcribe the "ums"/"ahs", don't strip them), pacing, confidence, structure. Transcription must preserve disfluencies for the delivery grade.

Every `generateJson` call passes a Zod `schema`; it is the structured-output contract and must be validated before persisting.

**KLP authoring is discrimination-tested, not merely generated (Stage 8 Spec 2, `npm run author-klps`).** For one card at a time, `src/lib/klp/authoring.ts` drafts a reference answer, a KLP set, and three deliberately wrong candidate answers (`confident_wrong`, `vague`, `memorized_template` — `PROBE_KINDS`), then grades every candidate against the current KLPs and computes a **separation score in TypeScript** (`src/lib/klp/separation.ts`) from the AI's per-candidate categorical verdicts — the score is never an AI opinion. Below `SEPARATION_FLOOR` (`src/lib/klp/authoring-config.ts`), the KLPs are revised and re-graded up to `MAX_REVISIONS` times; a card that still won't separate is persisted anyway and flagged `low_discrimination` (`CardAuthoring.status`) rather than silently retried until it looks clean — that flag is the entire point of the loop. **Each grading call is isolated per candidate** (`GRADE_CANDIDATES_SEPARATELY`, on by default): the grader is shown one candidate at a time, never all four together, because a grader that can see every candidate ranks them against each other and manufactures separation the KLPs never earned. **Weight is a computed blast radius, not an AI centrality rating** (`weightFromBlastRadius`, `src/lib/klp/relations.ts`) — it comes from how many other KLPs on the card a given KLP is related to, derived from `KlpRelation` edges that survive cycle/out-of-range pruning, replacing audit finding G1 (AI-assigned weights clustered at 4-5 with no real spread). The legacy single-pass extractor (`src/lib/ai/prompts/extract-klps.ts`) still authors newly created cards until a later spec migrates card creation onto this pipeline; `author-klps` is an operator tool run per-set (`--set <setId>`, required; it never walks the whole corpus), with `--direct` bypassing the stored-credential pool to use a raw `GOOGLE_API_KEY` for local runs.

## Staged execution plan

Build in four main stages, with Stage 3.5 as an added experience-expansion stage between AI quizzing and voice interviews. Do not start a later stage's work until the prior stage is functional, unless explicitly directed.

### Stage 1 — Flashcards + import + activities
- Flashcard data model (sets → cards with term/definition).
- **Import format:** term and definition separated by a **pipe (`|`)**; each card separated by a **semicolon**. (Changed 2026-06-26 from comma to pipe so definitions can contain raw commas, e.g. "$1,000,000", without needing to be quoted; delimiters remain configurable via `ParseOptions`.) Write the parser to be tolerant of whitespace and quoted values containing the delimiters.
- In-app set builder (create/edit cards directly, Quizlet-style).
- Search across questions/cards.
- Polished, responsive UI.
- Active-recall activities, including a **timed matching game** (single-player first; design the game state so multiplayer can be layered on later).

### Stage 2 — Confidence memory + Flashcard view + Review mode
- **Star/flag** cards the user struggles with.
- **1–10 confidence scale** per card ("fully don't know" → "fully know"), persisted per user and per card.
- This memory feeds later stages: weak cards should be surfaceable and testable. Design the schema so confidence history (not just latest value) can be queried for the training-plan AI in Stage 3. Use a `CardProgress` model (latest state) + `ConfidenceEvent` model (append-only history) — both written on every review answer.
- **Flashcard carousel view:** Displayed above the card list on the set detail page. One card at a time; click to flip (term → definition) with a CSS 3D rotation. Prev/next navigation. Show/hide toggle driven by local React state (no persistence needed).
- **Review mode (`/sets/[id]/review`):** Cycles through all cards one at a time. User flips the card to see the definition, then marks "Know It" or "Don't Know." Cards marked "Don't Know" are re-queued at the end of the deck. Exception: if the card's stored confidence score is > 5 at the time of the wrong answer, it gets **at most one** extra appearance — after that it is retired for the session. Low-confidence cards (≤ 5) keep cycling until the user marks them known. Each answer updates confidence by ±1 (clamped 1–10) and logs a `ConfidenceEvent` row.

### Stage 3 — Quizzing + AI grading
- **Multiple-choice** questions built from flashcards; **distractors generated by AI** (the user's Google key). Cache generated options.
- **Settings UI to enter/store the Google API key.**
- **Short-answer** questions with the AI grading rubric above (clarity/conciseness/correctness + overall).
- AI produces a **suggested training plan** and **new questions targeting weaknesses** (driven by Stage 2 confidence data + grading history).

### Stage 3.5 — Study experience redesign + richer cards + customizable quizzes
- **Visual redesign of set activity entry points:** On the set detail page, show large tile-format launch cards for Matching Game, Review Mode, and Quiz. Each tile should have a prominent mode-specific logo/icon above the label, replacing small text-only buttons.
- **Custom categories per card:** Let users assign one or more custom category labels to each term/definition pair (for example: text, image, talking, accounting, valuation, vocabulary). Categories are user-defined, set-scoped, and should be reusable through autocomplete.
- **Customizable quiz targeting:** Add a quiz setup/loading screen before questions begin. Users can choose quiz type (multiple choice, short answer, matching, true/false), which side is tested (term-to-definition, definition-to-term, or mixed), and which categories to include.
- **Focused quiz filters:** Quiz setup must support "starred terms only" and "previously failed terms only" filters, using Stage 2 `CardProgress` and Stage 3 `QuizAnswer` history.
- **Rich card inputs:** Cards are no longer limited to text-only term/definition fields. Terms and definitions can include uploaded images, videos, and other files saved to the user's account/set. Preserve text support as the default and design the data model so each card side can contain multiple content blocks.
- **AI-assisted card creation:** While creating or editing flashcards, provide AI autocomplete suggestions for partially typed terms and definitions. Suggestions must be opt-in per field action and use the user's saved Google API key.
- **Printable quizzes:** Quiz setup/results should support a print-friendly test view with answer key controls and browser-native PDF export via print styles.

### Stage 3.6 — Categorization system (complete)
Detailed plan: `docs/superpowers/plans/2026-07-05-stage3-6-categorization-system.md`. Design: `docs/superpowers/specs/2026-07-05-stage3-6-categorization-system-design.md`. **Sits before Stage 6.**
- Completes the half-built 3.5 categories: users label any card with one or more **custom, colored, set-scoped** categories via an autocomplete tag picker plus a set-level manage panel (rename/merge/recolor/delete). Categories persist transactionally through `createSet`/`updateSet`.
- **Colored category chips render** on the flashcard carousel and the terms list.
- **All study activities filter by category** — Quiz (colored chips + "Uncategorized"), Matching game and Review mode (via `?cat=` query param), and the Flashcard carousel (client-side). One shared pure predicate `filterCardsByCategories` (OR semantics + an "Uncategorized" bucket) backs every mode.

### Stage 4 — Voice interviews
- AI **narrator asks questions aloud** (TTS); user **responds by voice** (STT).
- Transcription **preserves filler words** ("um", "ah").
- Grading extends Stage 3's rubric with **delivery & interview-specific metrics** (filler frequency, pacing, confidence, structure).

### Stage 5 — Multimodal content & testing
Detailed plan: `docs/superpowers/plans/2026-07-04-multimodal-content-and-testing.md`.
- Widen ingestion to images, audio, video, spreadsheets (Excel/CSV), PDFs, and general files; render them on the flashcard, in Review/Learn, and in every quiz mode via one shared renderer.
- **Send media to Gemini natively** (multimodal `inlineData` parts) for MC generation and grading — not OCR/transcription-to-text. Voice *delivery* metrics remain Stage 4.
- **Excel is dual-path:** bulk-import a `term,definition` sheet into cards, **or** attach a sheet to a card side as a testable artifact (rendered table + fed to Gemini as data).
- Private assets are owner-checked on every byte fetch (authenticated proxy route). Text-only cards and the legacy importer stay unchanged.

### Stage 6 — Persistent learner memory & prompting overhaul
Detailed plan: `docs/superpowers/plans/2026-07-04-persistent-memory-and-prompting.md`. Companion: `docs/ai/prompting-strategy.md`. **Foundational — build before Stage 7.**
- **Single memory write path** so every mode (Review, Quiz MC/SA/TF, matching, lessons) updates per-card confidence + an append-only `StudyEvent` history. Closes the gap where quizzes don't touch confidence today.
- Pure, tested scoring: confidence deltas, mastery, and spaced-repetition due dates. AI never *computes* mastery, only reads it.
- Compact, **ID-free, token-capped `LearnerProfile`** injected into every judgment prompt.
- Prompts are consolidated into a **versioned registry** (`src/lib/ai/prompts/registry.ts`). There is no automatic per-task model routing — the old `modelFor`/`MODEL_FALLBACKS` helper is deleted; model choice is entirely user-configured via `AiCredential.defaultModel` plus an optional `AiTaskRouting` pin. Structured output goes through the AI SDK's native `Output.object({ schema })`, not regex JSON cleanup — see "AI integration" above.
- **Multi-provider AI credentials**: `AiCredential` (many per user; `provider`, `label`, `defaultModel`, `role`, `enabled`, `lastUsedAt`, `lastErrorKind`) replaced the single per-user Google key. `AiTaskRouting` optionally pins a task to one credential + model. Rotation, generation, and failure classification are detailed in "AI integration" above.
- **Scoped memory history** (`/profile/memory`, design: `docs/superpowers/specs/2026-07-27-scoped-memory-history-design.md`): one `HistoryScope` (`src/lib/memory/scope.ts`) narrows the event feed, the stat tiles, and the filter options together — empty scope is the consolidated view. Categories present **across sets** by grouping per-set `CardCategory` rows on `normalizedName`, so no schema migration was needed; `CardCategory` remains set-scoped. Scope is URL-synced.

### Stage 7 — Personalized learning plans & AI lessons
Detailed plan: `docs/superpowers/plans/2026-07-04-personalized-learning-plans.md`. **Depends on Stage 6.**
- Turn the static `TrainingPlan` into a living, closed loop: memory → concrete `PlanItem`s (due/failed/starred/lesson/focus-quiz) → doing them updates memory → reshapes the next plan.
- **Nudge in-app** with a "Today's Plan" checklist + streaks (email/push deferred but schema-ready).
- **Plans steer quizzes** — plan items launch targeted focus-quizzes on the weak subset.
- **AI-generated micro-lessons** (explanation + worked example + check questions), gradable and fed back into memory.
- Item selection is a **pure function** so a useful plan exists even without an AI key; AI only adds framing + lessons.

### Stage 8 — Key Learning Points, error diagnosis & the learner profile
Frozen reference: `docs/ai/error-taxonomy.md`. **Supersedes Stage 7's plan once Spec 4 lands.** Decomposed into four specs, built in order:
1. **KLPs & question generation** (design: `docs/superpowers/specs/2026-08-01-klp-question-generation-design.md`) — `CardKlp` (1-5 testable propositions per card, **versioned**: editing a card supersedes rather than overwrites, so history stays truthful). Distractors are generated by corrupting **one named KLP** with **one named corruption**, and that provenance persists on a new `QuizQuestion` row — which also fixes True/False, currently a no-op that always answers "true" (`src/actions/quiz.ts`). Extraction is `after()`-triggered, batched 10 cards/call, self-healing via `Card.klpStatus`.
2. **Answer & session analysis** — every error is a triple `(dimension, type, target)` + a 1-10 significance **computed in TypeScript, never by the AI**. Error types are a **closed vocabulary** (open-ended tags fragment into synonyms and can't aggregate); specificity lives in `target` (a `klpId`). MC/TF get significance with **zero AI calls** by reading distractor provenance. Split into **2a (capture)** — design: `docs/superpowers/specs/2026-08-03-answer-analysis-capture-design.md`; relational `AnswerKlpResult`/`AnswerErrorTag` (a JSON blob can't be indexed or FK'd, and Spec 3 aggregates these hardest), significance **components persisted alongside the computed value** so tuning the formula can recompute history, `repeatBonus` applied at read time since it depends on later attempts, and KLP outcomes stored as **both** a categorical `status` (from the AI) and a continuous `credit` computed in TS as `statusCredit × evidenceStrength(mode)` (SA .95 / MC .75 / TF .50 — i.e. `1 − guessRate`), so a correct MC is recorded as weak positive evidence rather than discarded, and a `failed` is `0.0` in every mode — and **2b (surface)**, the results UI + session rollup, designed against real accumulated tags. `QuizAnswer.analysisStatus` (`analyzed | no_provenance | no_klps | failed`) exists because a relational tag table **cannot** distinguish "analyzed and clean" from "couldn't analyze" — both are zero rows — and Spec 3's error rates need a denominator of *analyzed* answers or a legacy-heavy corpus silently reads as a better learner. Degradation never fabricates a tag (a fake row is indistinguishable from a real one and would promote fictional misconceptions), but the raw record is always written. `CORRUPTIONS` must stay a strict subset of `ACCURACY_TYPES`: MC/TF write a distractor's `corruption` directly as an error `type`, and these strings are *persisted*, so a rename strands existing rows — a test asserts the subset so drift is a build failure, not silent corruption.
3. **Metrics substrate & learner profile** — latency index, forgetting curve, session velocity/fatigue, per-KLP BKT (guess rate varies by mode: MC 0.25, TF 0.5, SA 0.05), deterministically-derived misconceptions, `/profile/learner` dashboard.
4. **Action plan & AI lessons** — replaces `docs/superpowers/plans/2026-07-04-personalized-learning-plans.md`.

**Concept layer decision:** existing user-authored **Categories are the concept nodes**; KLPs roll up to them. No AI-extracted concept graph — that stays a later bet (see below), because a bad cluster silently corrupts every downstream metric.

**Known limit of that decision, raised 2026-08-14 — revisit before Spec 4's lessons.** A user-authored category is not necessarily a *concept*. It is whatever the learner found useful to label with, and in practice that is often a **format or modality** — "label the image", "talking", "vocabulary" — rather than a subject. A bio student may legitimately want a "label the image" category *and* still need the concept-grain rollup those cards belong to. Categories and concepts are therefore two different axes that the current model collapses into one, which is fine for filtering and wrong for mastery: a "label the image" mastery number aggregates across unrelated biology, and the concept it should have rolled up to has no node at all. The eventual answer is likely KLP-inherent topics living *beside* user categories, not replacing them — which is the concept-graph bet above, now with a concrete motivating case. **Consequence already in effect (Spec 3C):** uncategorized KLPs participate in **targeting** (KLP-grain, needs no concept) but not in **topic mastery** (concept-grain), rather than being dropped from both as they were before.

**Beyond the roadmap:** `docs/vision/beyond-a-gpt-wrapper.md` argues the moat is the owned longitudinal learner model + concept graph + closed loop (not the prompts), and lists the next bets — error-type diagnosis, concept-graph extraction, source-grounded grading, cohort signal.

## Conventions

- Validate all AI responses and import data with a schema (Zod) before use/persist.
- Keep AI prompts and rubric definitions in one place (e.g. `lib/ai/`) so grading criteria are versioned and testable.
- The matching-game and grading logic are the highest-risk areas — favor pure, unit-testable functions for scoring and parsing.

## Security note

`.env` is gitignored — keep it that way and never commit real keys. Use `.env.example` (placeholders only) for documenting required variables.

**Corrected 2026-08-09:** this note previously said `.env` holds live `GOOGLE_API_KEY` and `RESEND_API_KEY`. It no longer does — the local file contains **only `DATABASE_URL`**. A consequence worth knowing before debugging: `NEXTAUTH_SECRET` is absent, so `auth()` throws `MissingSecret` and the app misbehaves locally in confusing ways. See `docs/superpowers/BUILD-QUEUE.md` for the workaround.

**Updated 2026-08-20:** `.env` may now optionally carry `RESEND_API_KEY` and `MAIL_FROM` (see `.env.example`). Absent, `src/lib/mail/` falls back to a console transport — verification and reset links print to the server log instead of being emailed, which is what makes the invite/verify/reset flow agent-runnable end to end with no real inbox.

`GOOGLE_KEY_ENCRYPTION_SECRET` now encrypts `AiCredential` rows for **every** provider, not just Google — the name is kept deliberately. Renaming it, or changing the `v1:<iv>:<tag>:<ciphertext>` payload format, makes every already-stored credential permanently undecryptable. A golden-vector test (`tests/security/api-key.test.ts`) pins the current format against a fixed plaintext/secret/output; if it fails, either revert or ship a re-encryption migration before deploying.

## Future Considerations
- **Important Terms:** Starred cards are considered "important terms." Need to define specific behavior:
  - Should they be tested more frequently in review mode?
  - Should they appear more often in flashcard carousels?
- **RESOLVED 2026-08-10 — "forget" erases the evidence, not just the estimate.** `forgetCard`/`forgetSet` now delete the card's `QuizAnswer` rows (cascading `AnswerKlpResult`/`AnswerErrorTag`) and replay `KlpState`; granular per-quiz and per-question resets exist. Every verb routes through one pure planner, `src/lib/memory/erase.ts`. See `docs/superpowers/specs/2026-08-10-deletion-and-forgetting-design.md`.
- **RESOLVED 2026-08-09 — sets are private by default, owner-togglable to link-shareable.** See `docs/superpowers/specs/2026-08-08-set-visibility-design.md`; built on branch `spec3b-tunable-scoring`. Readability is a Prisma `where` fragment (`readableSetWhere`, `src/lib/sets/visibility.ts`) spread into every set read, so a forgotten guard returns nothing instead of everything. **Delete the stale paragraph below once that branch merges.** It described the pre-fix state:
- **Set/card visibility was undecided.** `src/app/sets/[id]/page.tsx` fetches `prisma.set.findUnique({ where: { id } })` with no owner check — `isOwner` only gates the Edit/Delete buttons, not visibility — so any set (and its cards' term/definition/content-block content) is viewable by anyone who has or guesses the `setId`, authenticated or not. `startQuizAttempt` (`src/actions/quiz.ts`) has the identical shape. Found 2026-08-04 during a security review of `AnswerKlpResult`/`AnswerErrorTag` read paths (`docs/superpowers/specs/2026-08-04-answer-analysis-display-design.md`, "Found and fixed during implementation"), which fixed the analogous bug for *attempts* (a user's personal quiz session data, clearly meant to be private) but deliberately left *sets* alone, since the open-by-id behavior is consistent across the app, not an isolated oversight — patching one call site would be inconsistent, not a fix. Needs an explicit product decision — private-by-default vs. intentionally link-shareable — before any code changes.
