# Spec 5 — The grader: categorical verdicts with spans, and expression measured in code

**Date:** 2026-09-17 · **Status:** design of record, agreed with the owner, not built
**Builds on:** `2026-08-03-answer-analysis-capture-design.md` (Spec 2a), `2026-09-12-framing-points-design.md`, `BUILD-QUEUE.md` §"Verdicts: promote the accuracy types into per-KLP labels"
**Supersedes:** the first draft of this file (same day), which was a vocabulary widening only. The owner's grader design (recorded in memory as *grader-is-an-instrument-not-a-judge*) is the design of record; this document is that design applied to this codebase.

## Summary

The grader is a **measurement instrument, not a judge**. It reads one response and that question's
key points, relations and form requirements — never the learner's history, profile or ability — and
reports what the answer contains: a categorical verdict per key point with the words that prove it,
a list of claims the card never made, and expression metrics counted in code from those spans. It
emits **no score**. Coverage, verdict composition and expression are reported side by side and never
blended; "what does this person know?" is the mastery engine's question (Spec 7) and it is answered
there, from every observation at once.

Two phases, one implementation plan each. **Phase A — the content pass** replaces `passed | partial |
failed` with the thirteen-label vocabulary (the `omission` vs `contradicted` split is the point: a
hole and a wrong model have opposite fixes, and today both are `failed`), adds spans and
`unwarranted[]`, grades relations and form requirements, removes the learner profile from the
prompt, extends the credit table so the existing mastery engine keeps running unchanged, audits every
reader of `status`, and ships the **grader benchmark** — the acceptance test. **Phase B — expression**
splits the expression judgment into a second, separate call, computes five metrics from Phase A's
spans in pure TypeScript, captures the timing split on the client, retires the 1–10 rubric, and
completes the prediction log.

## Decisions, settled with the owner 2026-09-17

| # | Decision | Settled as |
| --- | --- | --- |
| D1 | Positive verdict spelling | Write `correct`; `passed` is a read-only alias forever. Fixes `KlpGraphCanvas.outcomeOf` rendering historical rows as untested. |
| D2 | Framing-point misses | Recorded and credited exactly like any miss. `CardKlp.role` is on the row for any later layer; what mastery *reads* by role is Spec 7. |
| D3 | Strictness | The authoring grader's strict clause and kind-aware relaxation are ported. `analysisVersion` 4 marks the boundary; pre- and post-port rows are never compared as one series. |
| D4 | Calls per answer | One content call per answer (plus one expression call in Phase B). Per-KLP isolation exists to stop a grader ranking *candidates*; at runtime there is one candidate. |
| D5 | Reference answer | Shown to the grader when `CardAuthoring.referenceAnswer` exists, under the authoring grader's "do not compare wording" framing. |
| D6 | Out-of-vocabulary label | **Strict enum, retry once in place, then fail loudly and record the unknown word.** The historical out-of-vocabulary incident was an *error tag* returned by a prompt that listed no vocabulary at all; with the vocabulary in the prompt it is a genuine signal the owner wants to see, not a row to drop. |
| D7 | Vocabulary spellings | Keep the persisted spellings; adopt the owner's semantics (§1). `fabrication` and `unsupported_leap` leave the per-KLP vocabulary for `unwarranted[]`. |
| D8 | Spans | The model quotes verbatim; TypeScript resolves the quote to `[start, end]`. Models count characters badly. |
| D9 | Relation verdicts | Graded from the free-text answer as **passive** evidence, stored with `provenance: 'passive'` so Spec 3's probes land as `active` beside them. |
| D10 | Form requirements | Authored in a **separate one-call-per-card pass** over the existing reference answer and KLPs — never a re-author. Graded like KLPs. |
| D11 | Communication work | **Un-parked.** The span-derived metrics replace the clarity/conciseness rubric. This is backlog item 14's separation, built. |
| D12 | Card-grain correctness | `isCorrect` (today `grade.overall >= 8`, `src/actions/quiz.ts:963,1087`) becomes a TypeScript rule over verdicts (§10). |
| D13 | `absent` as weak evidence | **Not here.** "Unless it repeats or its neighbours failed" needs history and the whole response as one unit — a mastery-engine rule (Spec 7). The interim credit table keeps `omission = 0`. |

## The boundary

The grader answers *what does this answer contain?* The mastery engine answers *what does this
person know?* Any proposal that has the grader compare across answers, read history, or emit a
number that blends axes belongs in Spec 7. Concretely, at runtime the grader's inputs are:

```
card            { term, definition, referenceAnswer? }
klps[]          { ref, text, kind }            — role and weight are NOT shown
relations[]     { ref, type, fromRef, toRef }  — the card's KlpRelation edges
formReqs[]      { ref, text }                  — when authored
answer          the learner's text
```

and nothing else. `safeProfileBlock(...)` at `src/actions/quiz.ts:889` and the `profileBlock`
parameter of `GRADE_SHORT_ANSWER_PROMPT` (`grade-short-answer.ts:11,20,132,144`) are **removed**
from the grading path. (The profile stays where it steers *generation* — distractors at
`quiz.ts:273`, plans, lessons — that is a different job.)

---

# Phase A — the content pass

## 1. The vocabulary and the credit table

`src/lib/klp/verdicts.ts` stays canonical. The owner's seven-label cut maps onto it without a
rename, because five of our spellings are persisted as distractor provenance and written directly as
MC/TF verdicts:

| Owner's label | Stored as | Meaning the prompt teaches |
| --- | --- | --- |
| `correct` | `correct` | stated, or entailed unmistakably |
| `partial` | `partial` (`incomplete` accepted as a synonym on read) | mentioned, incomplete or imprecise |
| `absent` | `omission` | not there at all — a **hole** |
| `contradicted` | `contradicted` (`factual_error` accepted on read) | the answer asserts the opposite or a false version — a **wrong model** |
| `inverted` | `inversion` | direction or causality reversed |
| `mislabeled` | `conflation` | the right idea under the wrong name, or two ideas merged |
| `misapplied` | `misapplication` (`overgeneralization` accepted on read) | applied outside its conditions |

`fabrication` and `unsupported_leap` are no longer offered as per-KLP verdicts — they describe what an
answer *adds*, which is `unwarranted[]`'s job (§3). They stay in `KLP_VERDICTS` (the authoring
grader may still emit them, and rows may hold them) and map to credit 0.

`src/lib/errors/klp-credit.ts` imports the vocabulary instead of defining its own:

```ts
export const LEGACY_KLP_STATUSES = ['passed'] as const          // read-only alias of `correct`
export const KLP_STATUSES = [...KLP_VERDICTS, ...LEGACY_KLP_STATUSES] as const
export const STATUS_CREDIT: Record<KlpStatus, number> = { ...VERDICT_CREDIT, passed: 1 }
```

One table, three values (1 / 0.5 / 0). **This is a guard, not a formula:** every new "wrong" label
maps to 0 exactly as `failed` does today, so no learner's mastery number changes. It exists because
`stepBkt` (`src/lib/metrics/bkt.ts:63`) indexes `STATUS_CREDIT[obs.status]` with no fallback — an
unknown status is `undefined`, the posterior is `NaN`, and `KlpState.pKnown` is silently corrupted
for that learner and point, permanently. The totality test lands in the same commit as the
widening. Spec 7 replaces the engine and may discard the table.

`isKlpStatus(value)` (accepts the alias) joins `isKlpVerdict(value)` (does not). Readers that colour,
bucket or count use `STATUS_CREDIT`, never the label.

## 2. The runtime verdict contract, by mode

| Mode | Verdict source | What changes |
| --- | --- | --- |
| `quiz-sa` | the content call, one verdict per live KLP + per relation + per form requirement | 3 labels → the vocabulary above; strict + kind clauses; quote on every non-`correct` verdict; reference answer when present; no profile |
| `diagnostic` | `DIAGNOSTIC_GRADING_PROMPT`, one verdict per question's KLP | same shared verdict block (§4); batching and `DIAGNOSTIC_MAX_OUTPUT_TOKENS` unchanged; `blankAnswerGrade` writes `omission` |
| `quiz-mc` | `binaryModeDrafts` (`src/actions/quiz.ts:90-151`), no AI | wrong pick: `status = corruption` (was `failed`); correct pick: every `targetKlpIds` → `correct` |
| `quiz-tf` | same | same; rejecting the true statement stays `deliberate_none` (no row) |

MC/TF write exactly one row on a wrong pick (the corrupted KLP); the other targets get no row —
rejecting the other distractors carries no information when the correct option was rejected too.
This is type-safe by construction: `CORRUPTIONS ⊂ ACCURACY_TYPES ⊂ KLP_VERDICTS`, and a test pins
the outer inclusion beside the existing inner one.

## 3. Spans and `unwarranted[]`

**Spans.** Every non-`correct` verdict (and every `correct` verdict on a relation or form requirement)
carries a verbatim `quote`. `src/lib/analysis/spans.ts` (new, pure) resolves each quote to
`[start, end]` over the stored answer: exact match first, then a whitespace/punctuation-normalised
match, then `null` with `analysisWarnings: [{ reason: 'quote_unresolved', ref }]`. An unresolved
quote means the model paraphrased instead of quoting — that rate is a grader-quality number the
benchmark (§8) reports. Spans persist on `AnswerKlpResult.spanStart/spanEnd` (nullable Int) and on
the new relation/form rows; `evidence` (the quote text) stays for display.

**`unwarranted[]`.** The content call returns, per answer, a list of claims the answer makes that
the card's key points do not — each a `{ text, quote }`. This is the contamination check
(`src/lib/errors/contamination.ts`) made first-class: today it is an `AnswerErrorTag` of type
`fabrication`/`unsupported_leap` with `klpId null`, capped at the tag limits. It becomes its own
table, `AnswerUnwarrantedClaim { quizAnswerId, text, spanStart, spanEnd }`, uncapped, and the
contamination factor reads it instead of tags. The tag path keeps working unchanged for
clarity/conciseness tags until Phase B retires them.

## 4. The prompt port, and relations

`grade-candidate.ts` exports the block it already builds — the vocabulary sentence, per-label
guidance, `STRICT_GRADING_CLAUSE`, `KIND_STRICTNESS_CLAUSE`, the quote rule — as
`verdictInstructionBlock({ strict, showKinds })`. `ANALYSIS_BODY` in `grade-short-answer.ts` and the
`klpResults` paragraph in `diagnostic.ts:113-118` (a second, independent copy of the three-label
wording) both call it. **One measured wording, two prompts**; the diagnostic differs only in *which*
key point it chose to ask (`src/lib/diagnostic/select.ts`), which is where targeting lives.

Runtime specifics:

- KLPs are shown as `[ref] (kind) text`. `weight` and `role` are not shown — a grader that sees
  weight grades heavy points differently; the authoring grader sees neither.
- **Relations.** The card's `KlpRelation` rows are listed as `[R1] (causes) [2] → [4]` and the
  grader returns a verdict per relation with the same vocabulary (`correct` = the answer asserts the
  link; `omission` = both endpoints present, link absent; `inversion` = link asserted backwards;
  `contradicted` = the answer denies it). Persisted on `AnswerRelationResult { quizAnswerId,
  relationId, status, spanStart, spanEnd, provenance: 'passive' }`. Nothing reads these yet except
  the results page (§9) and the benchmark; Spec 7 reads them for connectivity.
- **Form requirements.** When `CardFormRequirement` rows exist for the card's `klpVersion` (§5),
  they are listed as `[F1] text` and graded `met | not_met` with a quote, persisted on
  `AnswerFormResult { quizAnswerId, formRequirementId, status, spanStart, spanEnd }`.
- The reference answer sits after the key points and before the learner's answer, in the
  `grade-candidate` prefix order (shared material first, the answer last) so a provider prefix cache
  hits across every answer on the card.
- **Output ceiling is fluid, from measurement.** `gradeMaxOutputTokens(n)` =
  `GRADE_TOKENS_BASE + n × GRADE_TOKENS_PER_ITEM`, where `n` is KLPs + relations + form
  requirements. The two constants are set by `scripts/probe-grade-tokens.ts`: grade ~20 stored
  answers across 4–9-point cards on the two grading models in use, record `usage.outputTokens`
  per call, fit the per-item slope, and set base and slope so the ceiling is ≈2× the observed p95.
  Recorded in `docs/ai/model-performance.md`. A `finishReason: 'length'` is classified as
  `output_truncated`, never `schema_invalid`.
- D6 at the schema: `status: z.enum(KLP_VERDICTS)`. A parse failure retries once in place (the
  existing malformed-reply pattern in `generateJson`); a second failure throws, the answer's
  `analysisStatus` is `failed`, and the offending label is written to `AiCallLog` and
  `analysisWarnings: [{ reason: 'unknown_status', value }]` so it shows on `/staff/ai-history`.
- `GRADE_SHORT_ANSWER_PROMPT.version` 4 → 5; `DIAGNOSTIC_GRADING_PROMPT` bumps. The 1–10 rubric
  block is **unchanged in Phase A** (retired in Phase B), so `isCorrect` keeps its current rule until
  §10 replaces it.

Games: `gradeGameAnswer` (`src/actions/games.ts:295-340`) calls the same prompt and receives the new
labels; `accuracyOf`/`isHit` switch to `STATUS_CREDIT` comparisons and `src/lib/games/hot-seat.ts:44`
widens its type. Game grades are never persisted.

## 5. Form requirements — the authoring pass

A form requirement is a **shape** rule the answer must satisfy, distinct from the **content** the KLPs
require: *answers the question asked*, *states direction and magnitude*, *in causal order*, *closes
the loop*. They catch the failure every content metric misses — a fluent 6-of-7 answer to a slightly
different question — which is the memorised-template trap by construction.

- `CardFormRequirement { id, cardId, klpVersion, index, text, promptVersion, model, createdAt }`,
  versioned with the KLPs so a re-authored card invalidates them.
- `src/lib/klp/form-requirements.ts` + `WRITE_FORM_REQS_PROMPT`: one call per card over the
  card, `CardAuthoring.referenceAnswer` and the live KLPs, returning 3–5 requirements. Grader-family
  model (they are judgments about the question, not writing). ~$0.001 a card; the corpus is
  ~$0.30.
- `npm run author-form-reqs -- --set <id>` (resumable, skips cards that have them at the current
  `klpVersion`); the cron drains them like topics. `build-set.ts` gains it as a step after
  authoring.
- A check in TS: the stored `memorized_template` probe (`AuthoringProbe`) is graded against the
  new requirements once; if it *meets all of them* the requirements are flagged `weak` on the
  card — the trap should fail at least one. Reported, never retried.

## 6. Persistence

- `ANALYSIS_VERSION` 3 → 4 (`src/lib/analysis/persist.ts:31`), with the doc comment recording:
  vocabulary widened, strictness on, profile removed, `correct` replaces `passed`, spans and
  unwarranted claims added. `QuizAnswer.analysisVersion` is the discriminator for every mode.
- **`graderVersion`.** One integer, `GRADER_VERSION` in `src/lib/analysis/version.ts`, bumped on any
  change to the content prompt, the expression prompt, the span resolver, or the metrics code
  (Phase B). Persisted as `QuizAnswer.graderVersion`. `analysisVersion` describes the *contract*
  (what rows exist); `graderVersion` describes *which instrument* produced them. A lexicon edit
  changes numbers without touching a prompt, and the stamp has to move.
- Migration `spec5_phase_a`: `AnswerKlpResult.spanStart/spanEnd Int?`, `AnswerRelationResult`,
  `AnswerFormResult`, `AnswerUnwarrantedClaim`, `CardFormRequirement`, `QuizAnswer.graderVersion
  Int?`. All additive, all nullable or new tables. **No historical row is rewritten**; a legacy
  `failed` stays `failed`. No CHECK on `status` — the vocabulary is a TypeScript enum guarded by
  tests, as `mode` and `analysisStatus` are.
- The erase planner (`src/lib/memory/erase.ts`) covers the three new answer-child tables by cascade
  from `QuizAnswer`; the schema source-scan test that guards `onDelete: Cascade` on answer children
  is extended to name them.
- **Regrade tool.** `npm run regrade -- --set <id> [--attempt <id>] [--dry-run]`
  (`scripts/regrade.ts` over `src/lib/analysis/regrade.ts`): re-runs the grader over stored
  answers against the `CardKlp` version their rows point at, writes a *new* generation of rows
  stamped with the current `graderVersion`, and marks the old generation `supersededAt` rather
  than deleting it — the same versioning discipline `CardKlp` uses. "Grader changes are
  recoverable by re-grading" is only true once this exists. It reuses the existing
  `src/lib/klp/regrade-run.ts` credential and pacing path.

## 7. Every reader of `status`, and what changes

| Reader | Today | Change |
| --- | --- | --- |
| `src/lib/metrics/bkt.ts:63` | `STATUS_CREDIT[obs.status]` | none — totality test guards it |
| `src/lib/metrics/cache.ts:106` | cast to `KlpStatus` | type only |
| `src/lib/metrics/misconceptions.ts:100` | `o.status !== 'passed'` breaks the clean streak | **`STATUS_CREDIT[o.status] < 1`** — otherwise every `correct` row ends a streak and no observed misconception ever retires |
| `src/lib/metrics/missed.ts:57-62` | `MISS_STATUSES = {failed, partial}` | **`STATUS_CREDIT[r.status] < 1`** — otherwise an `inversion` row is not a miss |
| `src/lib/analysis/rollup.ts:73` | `r.status !== 'failed'` | **`STATUS_CREDIT[r.status] > 0`** |
| `src/lib/metrics/read.ts:336` | cast to the three | type only |
| `src/lib/errors/labels.ts:43-51` | 3 labels | 13 + alias; the existing "label for every status" test enforces totality |
| `src/components/quiz/QuizSummary.tsx:130-140` | icon by label | icon by credit bucket, text by `labelForKlpStatus`; a learner reads "Inverted: …" not "Missed: …" |
| `src/components/klp/KlpGraphCanvas.tsx:59-66` | `isKlpVerdict` → `passed` untested | `isKlpStatus`; overlay stays unwired (NEXT UP item 5 is not this spec) |
| `src/lib/staff/queries.ts:34,116`, `KlpTable.tsx` Verdicts | status-agnostic | none |
| `src/actions/games.ts:275-283`, `hot-seat.ts:117-131,211`, `HotSeatGame.tsx:131,225` | label comparison | credit comparison |
| `src/lib/errors/contamination.ts` | reads tags | reads `AnswerUnwarrantedClaim` (§3) |
| `src/lib/klp/regrade.ts:146-152` | `PriorResult.status: KlpStatus` | type only |

The three bolded rows fail *silently* today's way: nothing throws, the numbers stop moving. The
audit is a self-contained first task in the plan, before the prompt port.

## 8. The grader benchmark — the acceptance test

The traps proved the KLPs discriminate. This proves the grader, reading those KLPs, ranks answers
the way a knowledgeable adversary intended. Same discipline, pointed at the instrument.

1. **Panel authoring** — `WRITE_GRADER_PANEL_PROMPT`, one call per card (adversary = the writer
   family, GLM): given the card, the reference answer, the live KLPs, relations and form
   requirements, write four answers at four intended levels — `expert`, `competent`, `weak`,
   `wrong` — each with its intended rank and a paragraph saying *why* it sits there (which points
   it nails, fudges, omits, inverts; which form rules it breaks). A second, optional panel mode
   writes one answer per **failure shape** — a gap answer, a misconception answer, a connectivity
   answer (endpoints right, link missing), a template answer — with the shape named. Persisted as
   `GraderPanel { cardId, klpVersion, kind: 'levels' | 'modes', model, promptVersion }` +
   `GraderPanelAnswer { panelId, level | mode, intendedRank, text, rationale }`. A re-authored
   card invalidates its panel.
2. **Grading** — the runtime grader exactly as shipped (same prompt, strictness, ceiling), each
   panel answer graded **in isolation**, never shown together — `GRADE_CANDIDATES_SEPARATELY`'s
   lesson verbatim. Results persisted as `GraderPanelResult { answerId, graderVersion, model,
   verdicts Json, spans Json, unresolvedQuotes Int }`.
3. **Scoring in TypeScript** (`src/lib/analysis/benchmark.ts`, pure): per answer, coverage =
   credit-weighted KLPs right. For a `levels` panel: **rank agreement** (pairwise over the 6 pairs;
   6/6 is perfect) and **gap** (score distance between adjacent levels — where an order that is
   right by a hair is caught). For a `modes` panel: **shape agreement** — does the gap answer
   produce `omission`, the misconception answer `contradicted`, the connectivity answer `correct`
   KLPs with `omission` relations, the template answer form-rule failures — a confusion matrix over
   shapes. Plus the quote-unresolved rate. An inverted pair is listed with the adversary's rationale
   beside the grader's quotes.
4. **Re-runnable.** `npm run bench-grader -- --set <id> [--author]` authors panels only for cards
   without one at the current `klpVersion`, then grades. A prompt or model change is a re-grade
   against a fixed panel — the fixed-card-set rule from the model bench. The summary prints beside
   the weight histogram at the end of `author-klps` runs on the same set.

Cost: one adversary call + four grading calls per card; ~$0.05 per 20 cards on DeepSeek. **The
benchmark panel is also the cold-start item-parameter source for Spec 7**: four answers per card at
four levels, graded per KLP, is a hit pattern across levels for every KLP — a discrimination estimate
before any real learner exists.

---

# Phase B — expression

## 9. The expression pass and the metrics

**Separate call, separate schema, never averaged.** `EXPRESSION_PROMPT` (new, v1) receives the
answer, the key points and Phase A's verdicts, and returns only the judgment-shaped things:

```
followable        boolean | null     can the reasoning be followed start to end
overclaimed       boolean | null     stated with more certainty than it earns
hiddenAssumption  string | null      one load-bearing unstated premise, or null
```

No scores. It **skips** below `EXPRESSION_MIN_WORDS` (proposed 25; measured in the probe) and on a
blank answer — nulls, no call. It may run on a cheaper model than the content pass (nothing numeric
depends on it); the task is `expression` in `AI_TASKS` with its own measured default. Content and
expression are separate calls so they cannot contaminate each other: a model that has just decided
the content is wrong finds the prose worse, and vice versa.

**Metrics in code** — `src/lib/analysis/expression-metrics.ts`, pure, from Phase A's spans and the
card's canonical KLP order (`CardKlp.index`, which authoring already orders setup → mechanism →
payoff):

| Metric | Definition | Null when |
| --- | --- | --- |
| `wordCount` | words in the answer | never |
| `paddingRatio` | `1 − coveredChars / totalChars`, covered = union of all resolved spans | any quote unresolved, or below the floor |
| `signalDensity` | `nCorrectKlps / (words / 100)` | below the floor |
| `ledePosition` | start of the first `correct` span ÷ answer length | no `correct` span, or below the floor |
| `orderInversions` | inversion count of resolved-span order vs `CardKlp.index` | fewer than 2 resolved spans |
| `hedgeDensity` | matches of `HEDGE_LEXICON` ÷ words × 100 | below the floor |

`EXPRESSION_METRICS_MIN_WORDS` (proposed 12): below it every ratio is `null`, never 0 — a 12-word
answer's lede position is noise, and the null-vs-zero convention has bitten this codebase before.
`HEDGE_LEXICON` is a versioned constant in the same module (finance answers legitimately hedge;
density is raw, interpretation is Spec 7's). Raw numbers persist; **no thresholds at grader level**.

Persisted on `QuizAnswer.expression Json` as
`{ metrics: {...}, notes: {...}, graderVersion }` — one column, because nothing indexes on a
metric; Spec 7 reads the column. (If Spec 7 needs an index it adds it; a column per metric now
would be six columns guessing at that.)

## 10. Retiring the rubric, and `isCorrect`

- The clarity/conciseness/correctness 1–10 scores, `overall`, `summary` and
  `suggestedImprovement` leave `ShortAnswerGradeSchema`. The content call returns verdicts, quotes,
  unwarranted claims and the accuracy error tags only; **clarity and conciseness tags are no longer
  requested** (their dimensions stay in the taxonomy for historical rows; `AnswerErrorTag`'s schema
  does not change).
- **`isCorrect` becomes a TypeScript rule** (`src/lib/analysis/correctness.ts`, pure):
  `correct = every substance KLP has credit ≥ 0.5 AND no KLP is contradicted or inverted AND
  unwarranted.length === 0`. Framing points (`role: 'framing'`) do not gate it (D2 — recorded, not
  gating). This is the boolean `recordStudyEvent` needs for `CardProgress.confidence ±1` and what
  the quiz's "N of M correct" counts. `QuizAnswer.score` is set to coverage × 100 (an Int the
  existing UI already shows) and documented as coverage, not a grade.
- **The results page shows three axes side by side** (`QuizSummary.tsx`): coverage ("6 of 8 key
  points"), composition (the misses listed *by verdict* — "2 missing, 1 inverted", each with its
  quote), and expression (padding, density, lede — as plain numbers with one-line glosses, or "too
  short to measure"). No blended number appears anywhere. The `annotations` feature keeps working
  from the quotes.
- `feedback` (the one-paragraph coaching text) is dropped from the grade; the session-level
  coaching (`session-insight.ts`) already covers it from computed data.

## 11. The timing split

`t1` — time to first input — is captured beside `latencyMs` on every quiz mode via the existing
`timer` in `ShortAnswerQuiz.tsx:50`, `MultipleChoiceQuiz.tsx:82`, `TrueFalseQuiz.tsx:72`: the first
`keydown`/`input` in the answer field for SA, the first option click for MC/TF (so `t1 ≈ latencyMs`
there, which is itself the retrieval signal). Persisted as `QuizAnswer.firstInputMs Int?` and
`StudyEvent.firstInputMs Int?` (beside `latencyMs` at `schema.prisma:889`). Review captures
nothing — it is flip-driven and self-scored. Composition time is `latencyMs − firstInputMs`,
computed on read. Raw milliseconds only; within-user normalisation is Spec 7's.

## 12. The prediction log — completing it

The owner's minimum per graded response, and where each field already lives or lands:

| Field | Where |
| --- | --- |
| user, question, mode | `QuizAnswer.userId / cardId / mode` (exists) |
| verdicts[], spans[] | `AnswerKlpResult` + `AnswerRelationResult` + `AnswerFormResult` (Phase A) |
| unwarranted[] | `AnswerUnwarrantedClaim` (Phase A) |
| expression metrics + notes | `QuizAnswer.expression` (Phase B) |
| t1, T | `QuizAnswer.firstInputMs / latencyMs` (Phase B) |
| confidence | `StudyEvent.selfRating` (Spec 6) |
| grader version, model | `QuizAnswer.graderVersion / analysisVersion / model` |
| prediction_shown, probe_outcome | **schema slots now, empty**: `QuizAnswer.predictionShown Json?`, `AnswerRelationResult.provenance` (`active` rows are Spec 3's probe outcomes) |

Every response graded before this lands is a response that cannot be trained or evaluated against
later; grader changes are recoverable by regrading (§6), unlogged features are not.

---

## 13. Testing

Unit (pure):

- **Prompt lists the closed vocabulary.** Every member of `KLP_VERDICTS` offered at runtime appears
  verbatim in the SA prompt and in the diagnostic grading prompt when KLPs are supplied; `passed`
  does not. Written against `verdictInstructionBlock`, so returning `''` from it must fail the test
  — the fixture-shaped guard that passes and is dead in production has happened here twice.
- **Totality.** `STATUS_CREDIT` has an entry for every `KLP_STATUSES` member and equals
  `VERDICT_CREDIT` on every verdict; `stepBkt` over every status × `GRADED_KLP_MODES` returns a
  finite number in [0, 1]. **Mutation:** deleting one entry from the table must fail this test.
- **Inclusion.** every `Corruption` is a `KlpVerdict`.
- **Spans.** exact, normalised and unresolved cases; a quote that appears twice resolves to the
  first occurrence; overlapping spans union correctly for `paddingRatio`.
- **Metrics.** each metric on a hand-built answer with known spans; every ratio `null` below the
  floor and never 0 there; `orderInversions` on a reversed answer equals n(n−1)/2.
- **Correctness rule.** framing miss does not gate; one `contradicted` gates; one unwarranted
  claim gates; `partial` on a substance point passes.
- **Readers.** `computeCleanStreaks` counts `correct` and `passed` as clean and `inversion` as a
  break; `shapeMissedWork` treats every zero- and half-credit label as a miss;
  `summarizeAttemptAnalysis` counts `omission` as a fail; `outcomeOf('passed') === 'right'`.
- **No profile in the grader.** the built SA prompt contains no learner-context block regardless
  of input; a source scan asserts `safeProfileBlock` is not referenced from `submitShortAnswer`.
- **Benchmark scoring.** rank agreement and gap on synthetic verdict sets; shape agreement matrix
  on hand-built mode answers.
- **Erase.** the planner's answer-child table list names the three new tables; the cascade
  source-scan test covers them.
- **Games write nothing** — the existing guard, unchanged, still passes.

Live (real model, raw key, read-only DB, the shape of `scripts/probe-diagnostic-ai.ts`):

- `scripts/probe-grade-tokens.ts` — sets the ceiling constants (§4).
- `scripts/probe-runtime-grade.ts` — one authored LBO card, three fixed answers (reference, blank,
  hand-inverted): one verdict per KLP/relation/form requirement, every label in vocabulary,
  reference all `correct`, inverted answer's causal point not `correct`, quotes resolve, metrics
  computed; then the same answers through `GRADE_CANDIDATE_PROMPT` strict, printing per-point
  agreement — the number that says the port preserved the measured grader. Run on DeepSeek and once
  on a Google key; record in `docs/ai/model-performance.md`.
- `npm run bench-grader -- --set <LBO>` on the 10-card set: the first rank-agreement and shape
  numbers, recorded as the baseline this prompt version is held to.
- After the build: one real short-answer quiz on the LBO set, then read the rows —
  `analysisVersion 4`, `graderVersion` set, statuses in vocabulary, spans resolved, `expression`
  populated, `firstInputMs` set, `KlpState` finite.

## Out of scope

- How mastery reads any of this: `absent` weighting, per-response pooling, shrinkage, conjunctive
  multi-topic, DAG priors, the mode classifier and its emission table, within-user timing
  normalisation, the padding-vs-confidence fit, calibration diagrams, the closed diagnosis
  vocabulary (Spec 7 — the queue's 9 diagnoses vs the owner's 8 incl. `direction` must be
  reconciled there).
- Active relation probes (Spec 3) — this spec stores passive relation verdicts with the provenance
  slot they will share.
- Recognition/production scheduling and the residual read (Spec 7, or a small item between).
- Self-rated confidence (Spec 6, concurrent).
- Wiring the `KlpGraphCanvas` answer overlay (NEXT UP item 5) — this spec only makes the rows
  renderable.
- Re-grading history under the new vocabulary by default — the regrade tool exists; running it over
  the corpus is the owner's call.
