# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

**Active codebase — Stages 1 through 3.5 are built.** The app is a working Next.js App Router project (`src/`), with a Prisma schema covering users, sets, cards, categories, rich content blocks + assets, confidence/progress memory, quiz attempts/answers, and training plans. Stage 4 (voice) is not built. Keep this file in sync with reality as stages land.

**What exists today (verified in code):**
- Flashcards, set builder, import parser (`src/lib/parser/import.ts`), search, matching game — Stage 1.
- Star/confidence memory (`CardProgress` + `ConfidenceEvent`), flashcard carousel, Review mode — Stage 2.
- AI multiple-choice, short-answer grading + annotations, training-plan generation, autocomplete, encrypted per-user Google key — Stage 3.
- Activity tiles, quiz setup/filters (starred/failed/side/mode), rich-card **authoring** scaffolding (`CardContentBlock`/`CardAsset` via Vercel Blob), printable quizzes — Stage 3.5. (Custom categories were only a data model + a dead quiz filter in 3.5; the full categorization feature — authoring, display, and games filtering — ships in **Stage 3.6**.)

**Known gaps being addressed by the plans in `docs/superpowers/plans/` (dated 2026-07-04):**
- Rich content is authored but **not rendered and never sent to Gemini** — see the Multimodal plan.
- **Quiz sessions do not update confidence memory** (only Review mode does); prompts use raw-ID data dumps — see the Persistent Memory & Prompting plan.
- Training plans are static artifacts that don't steer quizzes or produce lessons — see the Personalized Learning Plans plan.

See also: `docs/ai/prompting-strategy.md` (current Gemini approach + improvements) and `docs/vision/beyond-a-gpt-wrapper.md`.

## What we're building

A redesigned Quizlet-style study app with first-class **short-answer** practice aimed at finance interview prep. Beyond flashcards, the app uses AI (Google Gemini/Gemma models) to generate multiple-choice options, grade free-text and **spoken** answers, and produce personalized training plans.

## Decided stack

- **Framework:** Next.js (App Router) + React + TypeScript, Tailwind CSS. API routes / server actions for the backend. Target deploy: Vercel.
- **Database / ORM:** Postgres (Neon or Supabase) via Prisma.
- **Auth:** Auth.js (NextAuth). Accounts are required for starring/confidence memory, saved quiz history, and (later) multiplayer.
- **AI access:** Each user pastes **their own Google API key** in settings; it is used for all AI calls on their behalf. See "AI integration" below.
- **Multiplayer:** Single-player first; live vs-friends matching is a later add-on (Supabase Realtime or WebSockets when built).

## AI integration (important — read before touching AI code)

Two paths exist and must not be conflated:

1. **Production:** user-supplied Google API key, entered in the UI, stored encrypted per-user, used directly against Google's API (via the Vercel AI SDK or `@google/genai`).
2. **Local dev:** the `litellm_config.yaml` proxy. It exposes an **Anthropic-compatible** endpoint at `http://localhost:4000` that routes to Gemini/Gemma models with a fallback chain. The `.env` points the Anthropic SDK vars (`ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL=gemini-3-flash`, etc.) at this proxy. This lets Claude Code / Anthropic-shaped clients run against Google models locally without a separate Google integration.

Model routing & fallbacks are defined in `litellm_config.yaml`: primary `gemini-3-flash` falling back through `gemma-4-31b-it` → `gemini-3.1-flash-lite` → `gemma-3-27b-it` → `gemma-3-12b-it`. Reuse this fallback ordering when choosing default models in app code so behavior matches dev.

To run the proxy locally: `litellm --config litellm_config.yaml` (requires `LITELLM_MASTER_KEY` and `GOOGLE_API_KEY` in env).

**AI grading is a core domain concept, not a feature bolt-on.** Grading must return structured output (not prose) so the UI can render scores and the system can track weaknesses over time. The grading rubric differs by mode:
- **Short-answer (text):** clarity, conciseness, correctness, plus an overall grade. Note that a wrong answer can still score well on clarity (e.g. clearly admitting "I don't know").
- **Spoken answer (Stage 4):** the above **plus** delivery metrics specific to live/interview settings — filler words (transcribe the "ums"/"ahs", don't strip them), pacing, confidence, structure. Transcription must preserve disfluencies for the delivery grade.

Always request **structured/JSON output** from grading and MC-generation calls and validate it (e.g. Zod) before persisting.

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
- Consolidate scattered prompts into a **versioned registry**; route grading/plan to a stronger model than autocomplete; prefer Gemini structured-output `responseSchema` over regex JSON cleanup.

### Stage 7 — Personalized learning plans & AI lessons
Detailed plan: `docs/superpowers/plans/2026-07-04-personalized-learning-plans.md`. **Depends on Stage 6.**
- Turn the static `TrainingPlan` into a living, closed loop: memory → concrete `PlanItem`s (due/failed/starred/lesson/focus-quiz) → doing them updates memory → reshapes the next plan.
- **Nudge in-app** with a "Today's Plan" checklist + streaks (email/push deferred but schema-ready).
- **Plans steer quizzes** — plan items launch targeted focus-quizzes on the weak subset.
- **AI-generated micro-lessons** (explanation + worked example + check questions), gradable and fed back into memory.
- Item selection is a **pure function** so a useful plan exists even without an AI key; AI only adds framing + lessons.

**Beyond the roadmap:** `docs/vision/beyond-a-gpt-wrapper.md` argues the moat is the owned longitudinal learner model + concept graph + closed loop (not the prompts), and lists the next bets — error-type diagnosis, concept-graph extraction, source-grounded grading, cohort signal.

## Conventions

- Validate all AI responses and import data with a schema (Zod) before use/persist.
- Keep AI prompts and rubric definitions in one place (e.g. `lib/ai/`) so grading criteria are versioned and testable.
- The matching-game and grading logic are the highest-risk areas — favor pure, unit-testable functions for scoring and parsing.

## Security note

`.env` currently holds **live secrets** (`GOOGLE_API_KEY`, `RESEND_API_KEY`). It is gitignored — keep it that way and never commit real keys. These keys were exposed during setup; rotate them. Use `.env.example` (placeholders only) for documenting required variables.

## Future Considerations
- **Important Terms:** Starred cards are considered "important terms." Need to define specific behavior:
  - Should they be tested more frequently in review mode?
  - Should they appear more often in flashcard carousels?
