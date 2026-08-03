# Stage 8 Spec 1 — Key Learning Points & KLP-Driven Question Generation

**Date:** 2026-08-01
**Status:** design approved, ready for an implementation plan
**Companion:** `docs/ai/error-taxonomy.md` (approved, frozen)
**Depends on:** Stage 6 (memory write path) and the Phase 1 learning-memory
work already on `learning-memory-redesign` — `StudySession`, per-item
`latencyMs`, `confidenceBefore`, `summarizeSession()`, the prompt registry.

---

## Why

Cards today are opaque `term`/`definition` string pairs. Nothing in the system
knows *what a card is actually teaching*, which caps three things at once:

- **Distractors are shallow.** `MULTIPLE_CHOICE_PROMPT` seeds wrong answers from
  sibling card definitions. They are plausible, but no one knows what a wrong
  pick *means*.
- **True/false is a no-op.** `TrueFalseQuiz.tsx` always renders the card's real
  definition and `submitTrueFalseAnswer` hardcodes `correctAnswer: 'true'`
  (`src/actions/quiz.ts:320`). The answer is always true. The mode records
  study events, so it is actively poisoning memory with free correctness.
- **Errors cannot be targeted.** "Got it wrong" is the finest grain available.
  There is nothing to attach a misconception to.

Key Learning Points (KLPs) — 1-5 testable propositions per card — are the
missing unit. They give distractors a provenance, true/false something to
corrupt, and the error taxonomy something to point at.

This spec covers **KLPs and question generation only.** Answer analysis,
session analysis, the learner profile, and action plans are Specs 2-4.

---

## Roadmap context

| # | Spec | Covers |
| --- | --- | --- |
| **1** | **This document** | `CardKlp`, extraction, KLP-driven MC distractors, TF fix |
| 2 | Answer & session analysis | KLP grading, error tags, significance, results UI |
| 3 | Metrics substrate & learner profile | latency index, forgetting curve, BKT, misconceptions, dashboard |
| 4 | Action plan & AI lessons | closed loop; supersedes `2026-07-04-personalized-learning-plans.md` |

---

## §0 — Prerequisite: stop destroying card identity on every edit

**This blocks everything else in the spec and is a pre-existing data-loss bug.**

`updateSet` (`src/actions/sets.ts:222-231`) deletes every card in the set and
recreates them:

```ts
await prisma.$transaction([
  prisma.card.deleteMany({ where: { setId: id } }),
  ...validated.cards.map((card) => prisma.card.create({ ... })),
  ...
])
```

`CardInputSchema` has no `id` field, so the client cannot round-trip card
identity and the action has no way to reconcile. Every card gets a fresh cuid on
every save.

`CardProgress`, `StudyEvent`, `ConfidenceEvent`, `QuizAnswer`, and
`QuizOptionCache` all cascade on `cardId`. **Fixing a typo in one card
therefore erases the entire learning history of the whole set** — confidence,
mastery, spaced-repetition state, every recorded answer.

This is not scope creep. The approved KLP versioning model (§1) preserves
history across card edits, which is meaningless if the card row itself is
deleted. Forgetting curves and BKT in Spec 3 are equally unimplementable
without a stable `cardId`.

**Fix:**

1. `CardInputSchema` gains `id: z.string().optional()`.
2. The set builder round-trips existing card ids (new cards send none).
3. `updateSet` reconciles instead of replacing:
   - id present and owned by this set → `update`
   - id absent → `create`
   - existing id not in the payload → `delete`
4. Ownership is verified per id — a caller must not be able to graft another
   set's card into theirs by supplying its id.

**Migration note:** history already destroyed by past edits is unrecoverable.
This fix stops the bleeding; it cannot backfill.

**Tests:** editing a card's text preserves its `CardProgress` row; reordering
preserves every id; removing a card deletes exactly that card; supplying a
foreign card id is rejected.

---

## §1 — Data model

### `CardKlp`

```prisma
/// Stage 8: the testable propositions a card teaches. Distractor generation,
/// error targeting, and the KLP mastery graph all key off these.
model CardKlp {
  id            String    @id @default(cuid())
  cardId        String
  version       Int       // 1-based; bumped on re-extraction
  index         Int       // ordinal within the version
  text          String    @db.Text
  weight        Int       // 1-5 centrality -> significance.relevance
  kind          String    // definition|mechanism|causal|condition|quantitative|contrast|example
  sourceHash    String    // sha256(term + definition + content blocks)
  promptVersion Int
  source        String    @default("ai")   // ai | user
  supersededAt  DateTime?
  createdAt     DateTime  @default(now())
  card          Card      @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([cardId, version, index])
  @@index([cardId, supersededAt])
}
```

`Card` gains:

```prisma
  klpStatus     String   @default("pending") // pending|ready|failed|skipped
  klpVersion    Int      @default(0)
  klpSourceHash String?
  klpError      String?
  klps          CardKlp[]
  quizQuestions QuizQuestion[]
```

and `QuizAttempt` gains `questions QuizQuestion[]`.

The denormalized `klpSourceHash` on `Card` lets `updateSet` decide whether
re-extraction is needed without loading KLP rows for the whole set.

### Versioning contract

Editing a card's text changes its `sourceHash`, which triggers extraction of
version *n+1*. Version *n* rows are stamped `supersededAt` and **kept forever**.

- Historical error tags keep pointing at the KLP version that was actually
  asked. A July session summary renders July's KLPs.
- The live profile, BKT, and question generation read `supersededAt: null` only.
- A question already asked keeps its pinned `klpVersion`. Never re-resolve a
  question mid-attempt.

This is the one rule that keeps the analytics honest across ordinary editing.

### `kind` vocabulary

`definition` · `mechanism` · `causal` · `condition` · `quantitative` ·
`contrast` · `example`

A learner who passes `definition` KLPs and misses `causal` ones has a
nameable pathology — *memorizes terms, fails on why* — derivable from a
`groupBy`. This is the field behind Spec 3's
`cognitive_profile.frequently_missed_klp_type`.

### `QuizQuestion`

The one piece of new architecture. True/false is unfixable without it: the
client currently renders the definition and the server hardcodes the answer,
so there is nowhere to record "this statement is the corrupted variant."
It is also the anchor for MC distractor provenance, and Spec 2 consumes it.

```prisma
/// Stage 8: one asked question, frozen at the moment it was asked. Makes
/// true/false answerable server-side and gives every wrong MC pick a
/// traceable origin.
model QuizQuestion {
  id           String   @id @default(cuid())
  attemptId    String
  cardId       String
  mode         String   // multiple-choice | true-false
  statement    String?  @db.Text  // TF: the (possibly corrupted) statement shown
  isTrue       Boolean?           // TF answer key. NEVER serialized to the client
  options      Json?              // MC: [{text, correct, sourceKlpId?, corruption?}]
  targetKlpIds Json               // which KLPs this question tests
  klpVersion   Int
  createdAt    DateTime @default(now())
  attempt      QuizAttempt @relation(fields: [attemptId], references: [id], onDelete: Cascade)
  card         Card        @relation(fields: [cardId], references: [id], onDelete: Cascade)

  @@unique([attemptId, cardId, mode])
  @@index([attemptId])
}
```

Populated for `multiple-choice` and `true-false` only in this spec. Short
answer and matching keep their current flow.

---

## §2 — Extraction

### Prompt

`src/lib/ai/prompts/extract-klps.ts`, registry-shaped
`{ id, version, schema, build }` like every other prompt, registered in
`src/lib/ai/prompts/registry.ts`. Routes via task **`'autocomplete'`** — this is
structured decomposition, not judgment, so it belongs on the cheap tier. No new
`AI_TASKS` value is invented (see CLAUDE.md).

Batched at **10 cards per call.** The pipe/semicolon importer creates 100+ cards
in one save; fanning that out one-call-per-card would exhaust the user's key
pool and surface as `quota_exhausted` across their whole account.

### Contract

Per card the model returns `cardType` (`atomic | compound`) and 1-5 KLPs, each
with `text`, `weight` (1-5), and `kind`.

Two requirements carry most of the quality:

**KLPs are testable propositions, not topics.**
`"WACC weights each capital source by market value, not book value"` — not
`"weighting"`. Topic-shaped KLPs produce useless distractors and unmatchable
error targets, and every downstream metric inherits the damage.

**The count is model-decided, not fixed at 2-3.** Forcing three KLPs onto
*"EBITDA = Earnings Before Interest, Taxes, Depreciation and Amortization"*
manufactures padding. `cardType: atomic` marks pure-vocabulary cards so Spec 2
does not over-analyze a one-line definition.

`weight` is assigned here, where the model sees every KLP on the card at once
and ranks them against each other. Judging centrality once, in context, is
cheaper and more consistent than re-judging it on every answer forever.

### Trigger

`after()` from `next/server`, fired post-response in `createSet` and
`updateSet` when `sourceHash` differs. The user is never blocked on extraction.

**Self-healing, in layers:**

| State | Behaviour |
| --- | --- |
| `klpStatus = 'ready'` | Normal path |
| `klpStatus = 'pending'` and a quiz needs the card | Extract inline; block that one question only |
| `klpStatus = 'failed'` | Retry inline once, then fall back to the no-KLP path |
| No AI credential | `klpStatus = 'skipped'`; quiz runs on the legacy path |

`klpStatus` and `klpError` surface in the set builder with a retry control.

No cron, no queue, no new dependency. The status column means a Vercel Cron
sweep can be added later as a small, additive change if `after()` proves
unreliable under load.

### Editing

KLPs are user-editable in the set builder. An edit **writes a new version**, it
does not update a row in place: the whole live set is superseded and re-written
at version n+1, where the edited point carries `source: 'user'` and every
untouched point is copied forward unchanged, keeping its original `source`.
This is the same versioned write path AI extraction uses — there is exactly one
mutation path for `CardKlp`.

In-place editing would break the append-only invariant stated above:
`QuizQuestion.targetKlpIds` rows already in the database name specific
`CardKlp` ids as the provenance of questions already asked, so rewriting one of
those rows' text retroactively changes what a past question is recorded as
having tested. Superseded rows are also not editable through the public action.

A user edit sets `klpSourceHash` to the current hash so the next save does not
clobber the correction. Without this, one bad extraction is permanent.

---

## §3 — Question generation

### Multiple choice

Each distractor is generated by corrupting **one named KLP** with **one named
corruption** from the accuracy vocabulary in `docs/ai/error-taxonomy.md`
(`inversion`, `conflation`, `misapplication`, `overgeneralization`,
`factual_error`). Sibling definitions remain in the prompt as flavour, but
provenance now comes from KLPs.

```json
{ "text": "…", "correct": false, "sourceKlpId": "klp_2", "corruption": "inversion" }
```

A wrong pick becomes self-diagnosing with **no grading call**. This is the
load-bearing idea of the whole design: it turns multiple choice from a binary
into a diagnostic instrument at zero marginal cost, and lets MC, TF, and short
answer feed one misconception graph in Spec 3.

`QuizOptionCache.options` becomes a versioned union:

```json
{ "v": 2, "correctAnswer": "…", "options": [ { "text": "…", "correct": true }, … ] }
```

Existing v1 blobs (`{options: string[], correctAnswer: string}`) parse as
provenance-less and fall back to correctness-only recording. **No cache wipe and
no migration of generated content.**

### True/false

Server-side coin flip at question generation:

- **Heads** — real definition, `isTrue = true`.
- **Tails** — a statement corrupting one KLP, `isTrue = false`, with the
  corrupted `klpId` and corruption type recorded.

The client receives `statement` only. `isTrue` never leaves the server;
`submitTrueFalseAnswer` grades against the persisted `QuizQuestion` row.

Both directions carry signal, and Spec 2 must not conflate them:

| Shown | Answered | Means |
| --- | --- | --- |
| Corrupted | "true" | The KLP isn't known |
| Real | "false" | Second-guessing a KLP they *do* know — a confidence problem, not a knowledge one |

The corrupted-statement variant is cached alongside MC options, keyed by
`(cardId, model)`, so the generation cost is paid once per card.

---

## §4 — Pure functions & testing

Unit-testable without a database, per the standing repo convention:

| Function | Responsibility |
| --- | --- |
| `klpSourceHash(card)` | Stable hash over term + definition + content blocks |
| `coinFlip(rng)` | Injectable RNG so TF variant selection is deterministic in tests |
| `selectKlpsForQuestion(klps, n, rng)` | Weight-biased KLP choice for distractor targeting |
| `resolveDistractorProvenance(options, picked)` | Text → `{sourceKlpId, corruption}`; null on v1 blobs |
| `parseOptionCache(json)` | v1/v2 union parse |

Prompt-shape tests extend `tests/ai/prompts.test.ts`. Action tests follow the
`vi.hoisted()` + `vi.mock()` pattern in `tests/actions/ai-credentials.test.ts`.

### Degradation

A user with no AI credential must still get a working quiz.

- **No KLPs** → MC falls back to today's sibling-definition prompt.
- **No KLPs, TF** → falls back to always-true, and the answer is recorded as
  **unscored for diagnostics** rather than silently producing fake signal.
  This is the one behaviour that must not regress quietly.
- **Extraction failed** → visible in the set builder with a retry; quiz runs.
- **Version mismatch mid-attempt** → the question keeps its pinned version.

---

## §5 — Cost

| Operation | Calls |
| --- | --- |
| KLP extraction | 1 per 10 cards, once, cached, version-pinned |
| MC options (incl. provenance + TF variant) | 1 per card, cached — **unchanged from today** |

Steady-state increase: roughly **one call per ten new cards.** Question
generation cost does not change.

---

## Out of scope

Error tagging and significance (Spec 2), KLP-level BKT and the mastery graph
(Spec 3), action plans and lessons (Spec 4), voice delivery metrics (Stage 4),
and any AI-extracted cross-card concept layer — categories are the concept
layer, per the approved design.
