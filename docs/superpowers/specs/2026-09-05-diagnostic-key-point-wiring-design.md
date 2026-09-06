# Diagnostic ↔ key points: design

**Date:** 2026-09-05
**Queue item:** NEXT UP #1 in `docs/superpowers/BUILD-QUEUE.md`
**Status:** approved 2026-09-05, ready to plan

---

## 1. The problem, measured

`/diagnostic` generates open-ended questions from a set's cards, grades them, and
writes a report. `DiagnosticQuestion.learningPoint` is **free text produced by the
generator**, not a `CardKlp` foreign key. So a completed diagnostic produces no
`QuizAnswer`, and therefore no `AnswerKlpResult` and no `KlpState`. The knowledge
engine — the thing the whole product is for — sees nothing.

The page is currently gated to admins behind a "coming soon" screen for exactly
this reason (`src/app/(app)/diagnostic/page.tsx`).

**Correction to the build queue.** The queue says a completed diagnostic writes
"no `AnswerKlpResult`, no `KlpState`, no `StudyEvent`". The third is wrong:
`submitDiagnosticTest` already calls `recordStudyEvent`, and the completed live
attempt has 12 `StudyEvent` rows and a real `CardProgress` effect. Card-grain
memory works today. **Key-point-grain memory is what is missing**, and that is
the whole of this spec.

### Live measurement, 2026-09-05

| | |
| --- | --- |
| `DiagnosticAttempt` rows, whole database | **2** |
| — completed (Minihotpot, 2026-09-01, score 75) | 12 questions, 12 `StudyEvent`, 0 `QuizAnswer` |
| — `in_progress`, abandoned (nagong1, 2026-08-31) | 12 questions, 0 `StudyEvent` |
| Backfillable questions | **12**, one user |
| — on a card with exactly **one** live KLP (unambiguous match) | **2** |
| — on a card with 2+ live KLPs (ambiguous) | 10 |
| — on a card with no live KLPs | 0 |

That table is the entire justification for §7.

---

## 2. Scope

**In:** generating diagnostic questions from `CardKlp` rows; writing every
diagnostic answer through the same evidence path quizzes use; the constants and
filters that a fourth graded mode makes wrong by omission; removing the admin
gate; labelling the one pre-existing attempt honestly.

**Out:** the answer/solution overlay (queue item 3), re-authoring the corpus
(queue item 2), adaptive question selection *during* a run, multi-card
synthesis questions.

---

## 3. Decisions

Twelve decisions, numbered as approved. Each states the mechanism, not just the
choice.

### 3.1 Where the evidence lands

**D1. A submitted diagnostic creates one `QuizAttempt` (`mode: 'diagnostic'`)
and one `QuizAnswer` per question.** `DiagnosticQuestion.quizAnswerId` links
them.

`AnswerKlpResult.quizAnswerId` is a **required** FK. Making it polymorphic —
nullable parent plus a `diagnosticQuestionId` — would touch `erase.ts`,
`erase-execute.ts`, `metrics/state-writer.ts`, `metrics/read.ts`,
`staff/queries.ts` and every read that assumes a `QuizAnswer` parent, and would
leave two shapes of evidence that must be kept in agreement forever. Writing a
`QuizAnswer` instead costs one row per question and makes every existing
downstream reader work with no change at all.

**D2. The `QuizAttempt` and the `DiagnosticAttempt` share one `StudySession`.**
`QuizAttempt.sessionId` and `DiagnosticAttempt.sessionId` are `@unique` within
their own tables, so two rows referencing one session is legal.

This is load-bearing for erasure, not tidiness. `erase-execute.ts` reaches
sessions **by `setId`** for the `set` scope, deletes the session, and both
attempts cascade. Give the diagnostic its own second session and "forget this
set" would delete the quiz half of a diagnostic and leave the diagnostic half
behind, pointing at nothing.

**D3. `createAnswerWithAnalysis` moves to `src/lib/analysis/write-answer.ts`**
and gains an optional `tx: Prisma.TransactionClient`, exactly as
`recordStudyEvent` already has. Quiz call sites are unchanged in behaviour.

It is currently a private 170-line function inside a 1,773-line `'use server'`
module, and a `'use server'` module may not export non-async helpers anyway. It
holds the KLP-state locking discipline, the supersede-and-replay rule, and the
`CardProgress` recompute. A second copy of that for the diagnostic is how two
posteriors start disagreeing.

### 3.2 Choosing what to ask

**D4. Selection is a pure function with no AI call:
`selectDiagnosticProbes` in `src/lib/diagnostic/select.ts`.**

Inputs: the set's live `CardKlp` rows (`id, cardId, index, text, label, weight,
kind`), the learner's `KlpState` rows for those KLPs, a requested count.
Output: an ordered `DiagnosticProbe[]`.

**Regime is read off the data, never configured.** Zero `KlpState` rows for this
set ⇒ *baseline*; otherwise ⇒ *targeted*. A setting here would be one more thing
to get wrong, and the DB already answers the question.

- **Baseline** — round-robin across cards: every eligible card contributes one
  probe before any card contributes a second. Within a card, highest `weight`
  first. This maximises spread, which is what a cold-start map of a set is for.
- **Targeted** — rank by `(1 − pKnown) × weight`, still round-robin across
  cards so one weak card cannot consume the whole run. Never-observed key points
  need **no special case**: `BKT_PRIOR` is 0.25, below most observed posteriors,
  so they sort near the top on their own. A key point observed once and failed
  sorts above an unobserved one, which is the correct priority.
- **Follow-ups** — the final `FOLLOW_UP_COUNT` (2, matching today's floor)
  probes re-ask a key point already probed in this run, highest weight first.
  Two observations of one key point in one sitting, phrased two ways, is the
  recognition-versus-production signal at zero extra cost.

Deterministic given its inputs. No shuffling, so the tests can assert order.

**D5. One key point per question.** A question is anchored to exactly one
`CardKlp`, and the grader returns a verdict for that one and nothing else.

Short-answer quiz grades *every* live KLP on the card from one answer, because
there the answer is the whole definition. A diagnostic question probes a slice,
so the same rule would write verdicts on points the question never asked about —
a fabricated observation, indistinguishable from a real one once written.
Anchoring to one point makes "only what it asked" true by construction rather
than a rule the grader must be trusted to respect.

`DiagnosticQuestion.learningPoint` survives as a **denormalised copy of
`CardKlp.text` at ask time** — the same reason `AnswerErrorTag.relevance` stores
the weight as of the answer. Editing a card supersedes its KLPs; the question
must still render what was actually asked.

*Considered and rejected:* anchoring 2–3 related points per question, for
richer prompts. It gives the grader room to reach. Note that widening later is
**not** free under the schema in §3.5 — one `klpId` column would have to become
a join table — so this is a decision to revisit deliberately, not a default that
can drift.

### 3.3 Grading

**D6. All three prompts go to version 2, and the free-text learning point is
deleted from the model's output.**

- `DIAGNOSTIC_QUESTIONS_PROMPT` v2 — receives probes (`probeRef`, card term and
  definition, the key point text, `kind`), returns exactly one question per
  probe as `{ probeRef, question, expectedAnswer }`. It no longer chooses a card
  and no longer invents a learning point; both come from the probe. The expected
  answer must be answerable from the key point alone. A follow-up probe is told
  it is a second angle on a point already asked.
- `DIAGNOSTIC_GRADING_PROMPT` v2 — per question: the key point, the expected
  answer, the learner's answer. Returns `score`, `feedback`, `mistake?`, plus
  `klpResults: [{ klpRef, status, evidence? }]` and `errorTags: [...]` — the
  same contract `ShortAnswerGradeSchema` already defines, so `magnitude` is the
  model's only numeric contribution and severity/significance are computed in
  TypeScript by `buildAnalysisWrites`.
- `DIAGNOSTIC_REPORT_PROMPT` v2 — same shape, but the results it summarises now
  carry real key-point text.

`klpRef` stays a ref (always `0` under D5) rather than being dropped, so
widening to multiple anchors later is a prompt change, not a schema change.

**Validation, matching the existing `cardRef` check:** a response naming a
`probeRef` that was not supplied, or missing one that was, is rejected and the
run is not persisted. A question whose `klpResults` is empty when it *had* an
anchor forces `analysisStatus: 'no_provenance'` — the identical rule short
answer uses, and the only honest way to record "the grader did not do the
per-point judgment it was asked for."

**AMENDED 2026-09-06 by live measurement — it is no longer three calls.** Two
defects were found by running the prompts against a real model, neither of which
any mocked test could see:

1. **The closed error-type vocabulary must be spelled out in the prompt.** Left
   implicit, gemini-3.6-flash returned `missing_response` and
   `incorrect_answer`, neither in `ACCURACY_TYPES`, so `buildAnalysisWrites`
   dropped **every** tag and three plainly wrong answers recorded zero errors.
   The unit tests passed throughout because they hand-wrote a valid type the
   model never produces. The short-answer prompt already enumerates the
   vocabulary; the v2 grading prompt now does too.
2. **One grading call per sitting exhausts the model's output budget.**
   Measured: grading one answer costs ~900 output tokens of which ~92% are
   **reasoning**. A four-question grading call returned `finishReason: 'length'`
   — surfaced by the SDK as `NoObjectGeneratedError`, i.e. classified
   `schema_invalid`, so it reads as a model that cannot follow a schema rather
   than one that ran out of room. This fails at **submit**, after the learner
   has answered everything.

   The fix is both halves, because batching alone was not enough — at four per
   batch, two grading batches succeeded and the third still hit the ceiling,
   since the budget is per call and reasoning varies per question:
   - `DIAGNOSTIC_BATCH_SIZE = 4` — generation and grading each run one call per
     four questions, with refs **local to the batch** and mapped back by
     position, so a grader that renumbers cannot attach one question's verdict
     to another.
   - `DIAGNOSTIC_MAX_OUTPUT_TOKENS = 16384`, passed through a new optional
     `maxOutputTokens` on `generateJson`. Roughly 7x the measured worst batch.
     An unused ceiling costs nothing; a tight one costs the sitting.

   A 12-question run is therefore **7 calls** (3 generation + 3 grading + 1
   report), not 3. That matters against a free tier capped at 20 requests per
   day per model, and it is the price of a diagnostic that finishes.

**Verified end to end on gemini-3.5-flash, 12 questions, 2026-09-06:** all 3
generation batches and all 3 grading batches returned complete, correctly-reffed
sets; 12 of 12 graded with exactly one `klpResult` at `klpRef 0`; verdicts
separated a correct answer from a blank one; worst grading batch 2,263 output
tokens against the 16,384 ceiling.

**D7. `EVIDENCE_STRENGTH['diagnostic'] = 0.95`, closing gap G8.**

`'diagnostic'` was added to `STUDY_SOURCES` but never to `EVIDENCE_STRENGTH`, so
it fell through to `DEFAULT_STRENGTH = 0.75` — a guess rate of 0.25, identical
to four-option multiple choice. A diagnostic answer is free text with no options
to choose from; its guess rate is `quiz-sa`'s, so its strength is `quiz-sa`'s.

**Plus a test that every mode reachable by `klpCredit` has an explicit entry.**
G8 happened because a mode was added to one vocabulary and not the other, and
nothing failed. The next occurrence should be a build failure.

`ANALYSIS_VERSION` is **not** bumped: no existing row's numbers change, because
no diagnostic row exists.

### 3.4 The ripple — four filters wrong by omission, one right by addition

**D8.** A fourth graded mode breaks assumptions that were correct when
`short-answer` was the only free-text mode.

| Site | Change | Why |
| --- | --- | --- |
| `src/lib/quiz/mode.ts` | `QUIZ_MODES` += `'diagnostic'`; `TO_STUDY_SOURCE.diagnostic = 'diagnostic'` | Otherwise `toQuizMode('diagnostic')` is `null`, and `buildQuizAnswerScopeWhere` translates a scope filtered to diagnostic into a query matching **zero** rows — silently, reading as "no diagnostic activity" rather than as an error. |
| `src/lib/memory/scope.ts` | `EXPRESSION_QUIZ_MODE` (singular) → `EXPRESSION_QUIZ_MODES` list including `'diagnostic'`; the `where` becomes `{ mode: { in: … } }` | Diagnostic answers are free text and can carry clarity/conciseness tags, so they belong in readiness's numerator *and* denominator. The original reasoning is unchanged: MC/TF still must not be counted, because they can only ever produce accuracy tags. |
| `src/lib/memory/profile.ts` | graded-events filter `source === 'quiz-sa'` also accepts `'diagnostic'` | Same reason — it selects the written-answer signal for the learner profile. |
| `src/lib/quiz/history.ts` | **new** `QUIZ_HISTORY_WHERE = { ...ANSWERED_ATTEMPT_WHERE, mode: { not: 'diagnostic' } }`, applied to exactly two call sites: `getUserStats` (`src/actions/user.ts`) and the library page's recent list (`src/app/(app)/sets/page.tsx`) | This is "hidden from quiz history". `ANSWERED_ATTEMPT_WHERE` itself is **not** modified — its own doc says over-applying is the dangerous direction, and it is also used by `loadAnsweredAttemptIds`. |
| `src/lib/quiz/history.ts` `loadAnsweredAttemptIds` | **unchanged** — diagnostic attempts stay in the window | That is the `repeatBonus` window. A mistake made in a diagnostic is still a repeat of a mistake, and excluding it would make the same tag score differently depending on where the learner made it. |

`QUIZ_MODES` is referenced only by `mode.ts` and its own test, so widening it has
no UI consequence. `printable.ts` and `setup.ts` carry their own literal unions
and are untouched.

### 3.5 Schema

**D9.** One migration.

```prisma
model DiagnosticAttempt {
  // status: in_progress | completed | abandoned   (abandoned is new)
  engineVersion Int @default(1)   // 1 = pre-key-point, 2 = key-point-linked
}

model DiagnosticQuestion {
  klpId        String?  // FK CardKlp, onDelete: SetNull
  quizAnswerId String?  @unique  // FK QuizAnswer, onDelete: SetNull
  klp          CardKlp?    @relation(fields: [klpId], references: [id], onDelete: SetNull)
  quizAnswer   QuizAnswer? @relation(fields: [quizAnswerId], references: [id], onDelete: SetNull)
}
```

- **`SetNull`, not `Cascade`, on both.** The question text and the learner's
  answer are a record of what happened. They must not disappear because a
  proposition was edited away or an answer row was erased; an unattributed
  question is merely incomplete, a deleted one is a hole in someone's history.
  (`CardKlp` is versioned rather than deleted in normal operation, so this is a
  safety property, not a routine path.)
- **`engineVersion` is a column even though it is derivable** from
  `questions.some(q => q.klpId !== null)`. The results page needs one field to
  decide whether to show the legacy banner, and deriving it would misreport a
  *new* attempt on a set whose cards happen to have no key points.
- The migration sets `engineVersion = 1` on both existing rows and marks the
  stale `in_progress` attempt `abandoned` (see D10).

### 3.6 Backfill: none

**D10. Nothing is backfilled. The gap is labelled instead.**

The population is 12 questions from one user, and only **2** sit on a card with
exactly one live key point — the only case where a match is unambiguous. The
remaining 10 would require the AI to guess which key point a free-text string
meant, and a wrong guess writes a false fact into a real learner's history that
is indistinguishable from an observation. That is the fabrication this engine
refuses everywhere else, for a payoff of 2 rows.

Backfilling only the 2 unambiguous ones is not obviously better: it costs a
script, a matching rule and a second writer into `KlpState`, and buys two
observations for one user.

So:

- The completed attempt keeps its 12 `StudyEvent` rows and its `CardProgress`
  effect. That evidence is real and stays.
- Its `engineVersion: 1` renders a line on its results page: it ran before
  key-point tracking, so it moved card confidence but not key-point mastery —
  with a link to run a fresh one.
- The stale `in_progress` attempt is marked `abandoned` by the migration. It is
  five days old, its browser session is gone, and leaving it alive would force a
  permanent legacy branch in `submitDiagnosticTest` to serve exactly one row.
  Abandoned attempts are hidden from listings and cannot be submitted.

### 3.7 Traps and verification

**D11. Two things that would quietly break this.**

- **Never call `ensureKlpsReady` per card at diagnostic start.** It gap-fills by
  invoking extraction, so across a 120-card set it fires a burst of AI calls the
  moment somebody presses Start — on a free tier capped at 20 requests per day
  per model. Read live `CardKlp` rows for the whole set in **one** query; a card
  with no live key points is simply not eligible for a probe.
- **Transaction size.** Quiz writes one answer per transaction at
  `{ maxWait: 10s, timeout: 30s }`, and that ceiling was already raised once
  because a five-KLP card exceeded the 5s default — each KLP costs a serialized
  advisory lock, a read and a write. A diagnostic writes **12 answers at once**.
  A `P2028` here does not degrade: it discards a test the learner spent twenty
  minutes on. The submit path gets its own sized options and the pilot run in
  D12 must be timed.

  **MEASURED 2026-09-06 against the live database: 6 answers took 9.2s**, i.e.
  ~1.5s each. So a 12-question sitting is ~18s and a 30-question one ~46s —
  meaning a 30-question diagnostic would have **exceeded the 30s per-answer
  ceiling** and thrown the whole sitting away. `DIAGNOSTIC_TX_OPTIONS`
  (`{ maxWait: 15s, timeout: 120s }`) was necessary, not precautionary.

**Preconditions.** A diagnostic requires at least `MIN_DIAGNOSTIC_KLPS` = **12**
live key points in the set. Twelve, not the generator schema's `.min(8)`, because
`DiagnosticStartSchema` already floors `questionCount` at 12 — a set with 8 key
points would otherwise cap the count at 8 and fail its own input validation.
Below the floor, Start refuses with a message pointing at key-point extraction
rather than producing a thin test. Above it, the requested count is capped at the
number of available key points and the UI states the number.

`Accounting - "Talking"` (152 live KLPs) and `Accounting - Knowledge` (106) clear
this comfortably on the legacy corpus, so the floor does not block today's sets.

**D12. Verification.**

- Pure-function tests for `selectDiagnosticProbes`: baseline spread (no card
  gets a second probe before every card has one), targeted ordering, follow-up
  reuse, count capping, determinism.
- A test that `EVIDENCE_STRENGTH` covers every mode reachable by `klpCredit`.
- Submit-path tests: N answers produce N `QuizAnswer`, N `AnswerKlpResult`, a
  `KlpState` per distinct key point, and N `StudyEvent` **each carrying
  `quizAnswerId`** (today's diagnostic events do not); a grader response naming
  an unknown `probeRef` is rejected and nothing is persisted; an empty
  `klpResults` records `no_provenance` rather than silence.
- **One real 12-question run against the live database, with the counts
  predicted in writing before they are measured.** A green suite has gone over a
  statement Postgres rejects here before.

**The admin gate in `src/app/(app)/diagnostic/page.tsx` comes off only after
that run passes** — it is the last step, not the first.

---

## 4. Data flow, end to end

```
START
  read live CardKlp for set (1 query)  ──┐
  read KlpState for those KLPs (1 query)─┴─► selectDiagnosticProbes (pure)
                                              │
                                              ▼  probes[]
                              DIAGNOSTIC_QUESTIONS_PROMPT v2  (AI call 1)
                                              │  { probeRef, question, expectedAnswer }
                                              ▼
        StudySession ─┬─ DiagnosticAttempt (engineVersion 2)
                      │     └─ DiagnosticQuestion { klpId, learningPoint = klp.text }
                      └─ QuizAttempt (mode 'diagnostic')

SUBMIT
  DIAGNOSTIC_GRADING_PROMPT v2  (AI call 2) ─► per question:
        score, feedback, mistake?, klpResults[], errorTags[]
                      │
                      ▼  per question, inside ONE transaction
        buildAnalysisWrites({ mode: 'diagnostic', klps: [anchor], … })   (pure)
                      │
                      ▼
        createAnswerWithAnalysis(tx)  ─► QuizAnswer
                                      ─► AnswerKlpResult   (credit = status × 0.95)
                                      ─► AnswerErrorTag    (significance in TS)
                                      ─► KlpState          (locked, stepped)
                      │
                      ▼
        recordStudyEvent({ source: 'diagnostic', quizAnswerId })  ─► CardProgress, StudyEvent
                      │
                      ▼
        DiagnosticQuestion.quizAnswerId = answer.id

  DIAGNOSTIC_REPORT_PROMPT v2  (AI call 3) ─► DiagnosticAttempt.report
```

`replace` is never passed: a diagnostic question is answered exactly once.

---

## 5. Degradation

| Situation | Behaviour |
| --- | --- |
| Set has < 12 live key points | Start refuses, names the shortfall, points at extraction. Nothing written. |
| Set has fewer key points than the requested count | Count capped to what exists; the UI states the number. |
| A card has no live key points | Not eligible for a probe. Never triggers extraction. |
| Generation AI call fails | `AiGenerationError` surfaced as today. No attempt row created. |
| Grading AI call fails | Surfaced as today; attempt stays `in_progress` and is resubmittable. **No fabricated verdicts.** |
| Grader returns an unknown or missing `probeRef` | Whole submission rejected, nothing persisted, learner retries. |
| Grader returns empty `klpResults` for an anchored question | Answer persisted with `analysisStatus: 'no_provenance'`; no `AnswerKlpResult`, no `KlpState` step. |
| Report AI call fails | Existing `fallbackReport` path, now built from real key-point text. |
| Pre-key-point attempt (`engineVersion: 1`) viewed | Results render with the legacy banner and a re-take link. |

Nothing in this table fabricates a verdict. Every degradation loses evidence
rather than inventing it.

---

## 6. Consequences

- `/diagnostic` opens to everyone.
- A diagnostic moves `KlpState`, so it feeds topic mastery, the learner
  dashboard, misconception derivation and `repeatBonus` like any quiz.
- **G8 closes.**
- Diagnostic answers are erasable through the existing forget/reset paths with
  no new code, via D1 and D2.
- Diagnostics do not appear in quiz history or quiz statistics (D8), but their
  errors do count toward repeat-mistake significance.
