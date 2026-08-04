# Stage 8 Spec 2a — Answer Analysis (Capture)

**Date:** 2026-08-03
**Status:** design approved, ready for an implementation plan
**Frozen reference:** `docs/ai/error-taxonomy.md` (approved, do not re-litigate)
**Depends on:** Spec 1 (`docs/superpowers/specs/2026-08-01-klp-question-generation-design.md`), shipped as commits `4816578..a0b5ac3`

---

## Why this is split

Spec 2 originally covered capture *and* display. It is split:

- **2a (this document)** — schema, grading, significance, MC/TF tagging. Ships
  **invisibly**: every answer starts writing KLP results and error tags with no
  user-facing change.
- **2b (later)** — per-answer results UI and the session rollup, designed
  against tags real answers actually produced rather than fixtures.

The ordering is deliberate. Diagnostic data is only useful in aggregate, and
aggregate takes time to accumulate. Shipping capture first means 2b and Spec 3
are designed against a real corpus.

---

## Scope

**In:** `AnswerKlpResult` and `AnswerErrorTag` tables; the error-type vocabulary
module; extending short-answer grading to emit KLP results and error tags in the
existing call; computing significance in TypeScript; deriving MC/TF tags from
distractor provenance with no AI call.

**Out:** the results UI, the session rollup (both 2b); per-KLP BKT, forgetting
curves, misconception promotion, the learner-profile dashboard (Spec 3); action
plans and lessons (Spec 4).

---

## §1 — Data model

Two new tables. Both cascade from `QuizAnswer`, so deleting an attempt cleans up
its analysis.

```prisma
/// Stage 8 Spec 2a: per-KLP outcome for one answer. Short answer writes one row
/// per KLP on the card; MC/TF write one per targeted KLP (see §4).
///
/// `status` is the AI's categorical judgment; `credit` is the continuous value
/// computed from it in TypeScript, weighted by how much the mode's evidence is
/// actually worth (§3.1). Both are stored: the categorical drives display, the
/// float drives Spec 3's math.
model AnswerKlpResult {
  id           String     @id @default(cuid())
  quizAnswerId String
  klpId        String
  status       String     // passed | partial | failed
  credit       Float      // 0.0-1.0, computed; status credit x evidence strength
  mode         String     // quiz-mc | quiz-tf | quiz-sa — the evidence's source
  evidence     String?    @db.Text  // verbatim learner quote, never regenerated
  createdAt    DateTime   @default(now())
  quizAnswer   QuizAnswer @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
  klp          CardKlp    @relation(fields: [klpId], references: [id], onDelete: Cascade)

  @@unique([quizAnswerId, klpId])
  @@index([klpId, status])
  @@index([klpId, createdAt])
}

/// Stage 8 Spec 2a: one tagged error on one answer. The (dimension, type,
/// target) triple from docs/ai/error-taxonomy.md, plus the significance inputs.
model AnswerErrorTag {
  id             String     @id @default(cuid())
  quizAnswerId   String
  dimension      String     // accuracy | clarity | conciseness
  type           String     // closed vocabulary per dimension (§2)
  klpId          String?    // null means the target is the whole answer
  secondaryKlpId String?    // conflation only: the concept confused WITH
  relevance      Int        // CardKlp.weight AS OF THIS ANSWER
  severity       Int        // 1-5, the AI's only numeric contribution
  starred        Boolean    // was the card starred AT ANSWER TIME
  significance   Int        // computed; excludes repeatBonus (§3)
  quote          String?    @db.Text
  createdAt      DateTime   @default(now())
  quizAnswer     QuizAnswer @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
  klp            CardKlp?   @relation("ErrorTagKlp", fields: [klpId], references: [id], onDelete: SetNull)
  secondaryKlp   CardKlp?   @relation("ErrorTagSecondaryKlp", fields: [secondaryKlpId], references: [id], onDelete: SetNull)

  @@index([quizAnswerId])
  @@index([klpId, type])
  @@index([klpId, secondaryKlpId, type])
}
```

`QuizAnswer` gains `klpResults AnswerKlpResult[]`, `errorTags AnswerErrorTag[]`,
and:

```prisma
  /// Why this answer has the tags it has — or has none. Nullable ONLY for rows
  /// written before this spec; every answer written after it sets a value.
  analysisStatus  String?  // analyzed | no_provenance | no_klps | failed
  /// Which analysis contract produced these rows: the tag schema, the
  /// significance constants, and the credit constants, versioned together.
  analysisVersion Int?
  /// Non-fatal losses during analysis, e.g. a tag dropped for an unknown type.
  /// Developer telemetry, not read by Spec 3's metrics.
  analysisWarnings Json?   // [{ reason, value }]
```

`CardKlp` gains the three matching back-references.

### Why `analysisStatus` exists

In a relational table, "analyzed and clean" and "could not be analyzed" both
look like **zero tag rows**. They are not the same fact, and Spec 3's rate
calculations depend on separating them: "you make a conflation error 12% of the
time" needs a denominator of *analyzed* answers, not all answers. Without this
column a corpus containing legacy questions silently reads as a learner who
makes fewer mistakes than they do, with no signal that anything was skipped.

| Value | Meaning |
| --- | --- |
| `analyzed` | Tags are complete. Zero tags means a genuinely clean answer. |
| `no_provenance` | The pick (or credit, for a correct answer) cannot be attributed to a KLP — a v1 option-cache row, a stale klp id after a mid-attempt card edit, or a TF answer with no `QuizQuestion` row (no answer key at all) to check against. |
| `no_klps` | The card had no live KLPs at answer time. |
| `failed` | Grading or tag extraction errored. |

**`no_provenance` is a missing-data verdict, not a "nothing happened" verdict.**
It must never be confused with a deliberate zero-row answer (§5) — an
unscored TF answer counted as `analyzed` would silently inflate Spec 3's
"analyzed and clean" denominator with an answer that was never actually
evaluated.

This is also the retrofit path: every `no_klps` row can be found later and
re-analyzed once that card has been extracted. A dropped tag with no marker is
unrecoverable because nothing records that it was ever missing.

**`analysisWarnings` is a separate axis, deliberately.** "Did we analyze?" and
"was the analysis lossy?" are independent questions — an answer can be
`no_klps` *and* have had two tags rejected. Folding a `partial` value into
`analysisStatus` would make those inexpressible. Warnings are also for prompt
debugging ("how often does the model emit an unknown type across the corpus"),
not for Spec 3, which reads `analysisStatus` only.

**Migration:** both new columns are nullable so existing `QuizAnswer` rows are
untouched and remain distinguishable as pre-spec. Every answer written after the
migration must set `analysisStatus` and `analysisVersion`; a null on a new row
is a bug, not a state.

### Why the indexes are what they are

- `@@index([klpId, status])` — Spec 3's per-KLP mastery is
  `groupBy(klpId)` filtered on status. Without it, that is a table scan.
- `@@index([klpId, type])` — "which error types does this learner make on this
  proposition", the basis of the per-KLP error profile.
- `@@index([klpId, secondaryKlpId, type])` — misconception derivation groups
  `conflation` tags by the *pair*. This is the single query Spec 3 runs most.

### Why `klpId` is a real foreign key

`CardKlp` is append-only: editing a card supersedes rows rather than deleting
them (Spec 1 §1). So a tag written in July still resolves to the exact
proposition that was asked in July, not to whatever the card says today. That
property is the reason relational storage was chosen over a JSON blob — it
cannot be expressed by an id embedded in JSON.

`onDelete: SetNull` on the tag's KLP references (rather than `Cascade`) keeps the
tag itself if a card is ever hard-deleted: the learner's error still happened,
even if the target is gone.

---

## §2 — The vocabulary module

`src/lib/errors/taxonomy.ts` exports the closed vocabularies, mirroring how
`CORRUPTIONS` lives in `src/lib/quiz/options.ts`:

```ts
export const ACCURACY_TYPES = [
  'omission', 'incomplete', 'conflation', 'inversion', 'misapplication',
  'factual_error', 'overgeneralization', 'unsupported_leap', 'fabrication',
] as const

export const CLARITY_TYPES = [
  'disorganized', 'no_thesis', 'ambiguous_referent',
  'undefined_jargon', 'hedging', 'incoherent_syntax',
] as const

export const CONCISENESS_TYPES = [
  'rambling', 'padding', 'redundancy',
  'over_qualification', 'kitchen_sink', 'too_terse',
] as const

export const DIMENSIONS = ['accuracy', 'clarity', 'conciseness'] as const

export const DIM_WEIGHTS: Record<Dimension, number> =
  { accuracy: 1.0, clarity: 0.8, conciseness: 0.7 }

export const MAX_TAGS_PER_ANSWER = 4
export const MAX_TAGS_PER_DIMENSION = 2
```

### §2.1 — The mode vocabulary bridge

Two vocabularies for quiz mode already exist, and **both are persisted**:

| Layer | Column | Values |
| --- | --- | --- |
| Memory | `StudyEvent.source` | `quiz-mc`, `quiz-sa`, `quiz-tf`, `matching`, `review`, `lesson` |
| Quiz | `QuizAnswer.mode`, `QuizQuestion.mode` | `multiple-choice`, `short-answer`, `true-false`, `matching` |

This spec cannot avoid the conversion: `EVIDENCE_STRENGTH` (§3.1) is keyed by
`StudySource`, while the answer row it reads from carries the quiz vocabulary.
Today that translation happens inline at each call site, which is precisely the
pattern that drifts — a fourth site converting slightly differently produces
`EVIDENCE_STRENGTH[undefined]` and a `NaN` credit, silently.

`src/lib/quiz/mode.ts`, pure:

```ts
export const QUIZ_MODES = ['multiple-choice', 'short-answer', 'true-false', 'matching'] as const
export type QuizMode = (typeof QUIZ_MODES)[number]

/** The memory layer's name for a quiz mode. */
export function toStudySource(mode: QuizMode): StudySource
```

**Test:** the mapping is total — every `QUIZ_MODES` value resolves to a real
`StudySource`, and no value maps to `undefined`. Same reasoning as the subset
test below: a `String` column means the type system cannot catch a missing case,
so a test has to.

`AnswerKlpResult.mode` stores the **`StudySource`** form, matching
`StudyEvent.source`, so Spec 3 can join analysis rows against study history
without a translation layer.

### The subset invariant

**`CORRUPTIONS` must remain a strict subset of `ACCURACY_TYPES`.** MC and TF
write a distractor's recorded `corruption` *directly* as an error `type` (§4).
If the two lists drift, every MC-derived tag lands on a type the taxonomy does
not recognize, and Spec 3 aggregates silently corrupt data with nothing
throwing.

This gets a dedicated test:

```ts
it('every corruption is a valid accuracy error type', () => {
  for (const c of CORRUPTIONS) expect(ACCURACY_TYPES).toContain(c)
})
```

The test prevents nothing on its own — it converts a **silent data-corruption
bug into a loud build failure**. Rename a value in either list and `npm test`
fails immediately, rather than the drift surfacing months later as a learner's
worst weakness split across two type names that mean the same thing.

**Why a rename is not free.** These strings are *persisted*, not just internal
constants: `'inversion'` is written into `AnswerErrorTag.type` and
`QuizQuestion.options[].corruption` as a literal. Renaming the constant changes
what future rows say and cannot reach the rows already written.

When the test does fire, the remedy is a deliberate choice, not a revert: rename
both lists together, add an alias map (`{ wrong_fact: 'factual_error' }`) applied
on read, or migrate the existing rows. All three are fine. The point is that the
decision gets made consciously instead of by accident.

---

## §3 — Significance, computed in TypeScript

`src/lib/errors/significance.ts`, pure and unit-testable:

```ts
computeSignificance({ relevance, severity, dimension, starred }): {
  relevance: number; severity: number; dimWeight: number;
  starBoost: number; significance: number
}
```

Implementing, from `docs/ai/error-taxonomy.md` §3:

```
significance = clamp(round((0.55·relevance + 0.45·severity) × 2 × dimWeight × starBoost), 1, 10)
```

**`repeatBonus` is deliberately excluded at write time.** It depends on whether
the same `(type, target)` fires again in *later* attempts — information that does
not exist when the tag is written. Spec 3 applies it at read time. Storing a
frozen `repeatBonus` would mean a tag's significance depends on when it happened
to be computed, and would cost a lookback query on every tag write.

**Persist the inputs, not the derived constants.** `relevance`, `severity`, and
`starred` are point-in-time facts — the KLP's weight then, the AI's judgment
then, whether the card was starred then — and must be frozen. `dimWeight` and
`starBoost` are **not** stored: they are constants derivable from `dimension`
and `starred`, and storing them is actively unhelpful for the goal. Knowing a
row was computed with `dimWeight = 1.0` does not let you recompute it at `0.9`;
knowing the dimension was `accuracy` does.

`significance` itself is stored as computed, so the historical number survives
a formula change, and `QuizAnswer.analysisVersion` records which constants
produced it. Together those give both readings: what the score *was* under the
contract of the day, and what it *would be* under today's.

**`starred` reads `CardProgress.starred` at answer time.** A learner with no
`CardProgress` row for that card has never interacted with it, so the value is
`false` — the absence of a row is not missing data, it is a definite "not
starred".

### §3.1 — KLP credit, on the same principle

`src/lib/errors/klp-credit.ts`, pure:

```ts
export const STATUS_CREDIT = { passed: 1.0, partial: 0.5, failed: 0.0 }

/** 1 - guessRate. How much a correct answer in this mode actually proves. */
export const EVIDENCE_STRENGTH: Record<StudySource, number> = {
  'quiz-sa': 0.95,   // guess rate 0.05
  'quiz-mc': 0.75,   // guess rate 0.25 (4 options)
  'quiz-tf': 0.5,    // guess rate 0.5  (coin flip)
}

klpCredit(status, mode): number   // STATUS_CREDIT[status] * EVIDENCE_STRENGTH[mode]
```

**The AI never emits the float.** It returns `passed | partial | failed`, which
is what a model is actually reliable at; asking for a 0-100 score yields values
bunched on round numbers, precision that reads as real and isn't. The mapping and
the mode weighting happen in TypeScript — the same split significance uses, and
the same standing rule: the AI supplies a judgment, code supplies the number.

This removes the special case that an earlier draft of this spec carried. A
correct multiple-choice pick is not "no evidence"; it is **weak positive
evidence**, and now records as `0.75`. A correct true/false records as `0.50`,
because a coin flip is right half the time. A failed KLP is `0.0` regardless of
mode — getting it wrong is unambiguous no matter how easy guessing would have
been.

Spec 3's BKT is natively probabilistic and wants graded evidence rather than
booleans, so this is the shape it needs anyway. Storing `mode` on the row means
the weighting can be recomputed if the guess rates are ever revised — the same
reasoning as persisting significance's components.

---

## §4 — Writing tags

### Short answer — folded into the existing call

`ShortAnswerGradeSchema` gains:

```ts
klpResults: z.array(z.object({
  klpRef: z.number().int().min(0),           // index, never a cuid
  status: z.enum(['passed', 'partial', 'failed']),
  evidence: z.string().optional(),
})),
errorTags: z.array(z.object({
  dimension: z.enum(DIMENSIONS),
  type: z.string(),                          // validated against the dimension in TS
  klpRef: z.number().int().min(0).optional(),
  secondaryKlpRef: z.number().int().min(0).optional(),
  severity: z.number().int().min(1).max(5),
  quote: z.string().optional(),
})).max(MAX_TAGS_PER_ANSWER),
```

Same `generateJson` call, same prompt module, one version bump. No new AI cost
and no window where a grade exists without its tags — both are written in the
transaction that already persists the grade.

KLPs are passed to the prompt as `ref` indices and mapped back to ids afterward,
per the standing no-cuid-in-prompts rule. A `klpRef` that does not resolve drops
that tag rather than writing a null target.

`type` is validated in TypeScript against its `dimension` (Zod cannot express
"this enum depends on that field" cleanly here). An invalid pairing drops the
tag — a fabricated type is worse than a missing one.

**The per-dimension cap is enforced in code, not by the model.** Zod's `.max()`
bounds the total; `MAX_TAGS_PER_DIMENSION` is applied when mapping, keeping the
highest-severity tags per dimension.

### MC and TF — zero AI calls

On a wrong answer:

| Mode | Source of `(target, type)` |
| --- | --- |
| Multiple choice | `resolveDistractorProvenance(parsed, picked)` → `{ sourceKlpId, corruption }` |
| True/false | `QuizQuestion.corruption` + `QuizQuestion.targetKlpIds` |

`corruption` becomes `type`, `sourceKlpId` becomes `klpId`, `dimension` is
always `accuracy`. `relevance` reads the KLP's stored `weight`.

#### Severity for MC/TF, concretely

`src/lib/errors/severity.ts`, pure:

```ts
/** How deep a misunderstanding each corruption implies. */
export const CORRUPTION_SEVERITY: Record<Corruption, number> = {
  conflation:         5,  // wrong mental model — the whole concept is misfiled
  inversion:          5,  // direction/causality backwards — structurally wrong
  misapplication:     4,  // knows the rule, not its conditions
  overgeneralization: 3,  // missing nuance on an otherwise-held idea
  factual_error:      2,  // a retrieval slip, not a conceptual failure
}

severityFromCorruption(corruption, mode): number  // clamped 1-5
```

MC uses the rank as-is. **TF subtracts 1** (clamped to 1): selecting one of four
specific texts is a deliberate choice among named alternatives, while true/false
flips a single bit. The same corruption evidenced by an MC pick is a stronger
signal about *this* learner's model than the same corruption evidenced by one
binary answer.

Note this is **not** a guess-rate adjustment, despite an earlier draft saying so.
Guess rate discounts *correct* answers, because luck can produce them — that is
what `EVIDENCE_STRENGTH` does in §3.1. A wrong answer is not luck; the learner
actively chose it. The MC/TF difference here is about how much the *choice*
narrows down what they believe, which is a different thing.

The TF path exists only because `QuizQuestion.corruption` was added during
Spec 1's final review. Without that column TF would record the target but not
the type, and half the taxonomy triple would be unrecoverable.

**No provenance means no tag.** A v1 cache row, a card with no KLPs, or a
question generated before Spec 1 records correctness only. Never a fabricated
default — a wrong tag pollutes the aggregate more than a missing one.

### What a *wrong* MC/TF answer records

A wrong answer writes a tag (above) **and** a `failed` KLP result — but only for
the KLP the wrong answer actually implicates, never for every targeted KLP.

| Case | `AnswerKlpResult` written |
| --- | --- |
| MC, picked a provenanced distractor | one `failed` for that distractor's `sourceKlpId` |
| MC, picked a distractor with no provenance | none (`analysisStatus = 'no_provenance'`) |
| TF, shown the corrupted statement, answered "true" | one `failed` for the corrupted KLP |
| TF, shown the real definition, answered "false" | **none** |

**Why a wrong MC writes only one row.** The question targeted three KLPs, one
per distractor. Picking the `klpX` distractor is direct evidence about `klpX`.
It says nothing about `klpY` and `klpZ`: the learner rejected those distractors,
but they also rejected the correct answer, so the rejection carries no positive
information.

**Why "answered false to the real definition" writes nothing.** The learner
rejected a *true* statement. That is not evidence they lack the proposition — it
is evidence they are second-guessing one they may well hold. `docs/ai/error-taxonomy.md`
§4 draws this distinction explicitly ("a confidence problem, not a knowledge
problem"), and recording it as `failed` would teach Spec 3 that the learner
lacks a proposition they actually have. The answer is still scored wrong; it
just produces no KLP-level claim.

### What a correct answer records

Every mode writes KLP results on a correct answer — the difference is what the
evidence is *worth*, which §3.1's `credit` now expresses directly rather than
through a special case.

| Mode | Correct answer writes | Credit |
| --- | --- | --- |
| Short answer | one row per KLP on the card (the grader evaluated each) | per-KLP status × 0.95 |
| Multiple choice | one row per KLP the question targeted | 0.75 |
| True/false | one row per KLP the question targeted | 0.50 |

A correct MC pick proves the learner did not fall for three specific
corruptions. That is real but weak evidence, and `0.75` says so honestly.
A correct true/false is weaker still at `0.50`, because a coin flip gets it
right half the time. Neither is discarded, and neither is treated as proof of
mastery — which is what recording it as a flat "passed" would have done.

MC and TF write results only for the KLPs the question actually targeted
(`QuizQuestion.targetKlpIds`), never for every KLP on the card. A question that
tested one proposition says nothing about the other four.

**Zero tags is meaningful, but only alongside `analysisStatus`.** The tag table
alone cannot distinguish a clean answer from an unanalyzable one — both are zero
rows. `analysisStatus = 'analyzed'` with no tags is a clean answer;
`analysisStatus = 'no_provenance'` with no tags is a row we could not read. Every
rate calculation in Spec 3 filters on `analyzed` for its denominator.

---

## §4.1 — Write semantics: one transaction, replacement-safe

**Analysis is written in the same transaction as the answer it describes.** Not
in an `after()`, not in a follow-up write. A `QuizAnswer` that exists without its
`analysisStatus` is a row Spec 3 cannot classify — neither analyzed nor
explicitly unanalyzable — and there is no way to tell it apart later from a row
whose analysis genuinely failed.

**Resubmission replaces analysis, and must not orphan it.** The submit paths do
not agree on semantics today, which is fine, but each has to be handled:

| Mode | Resubmit behaviour | Consequence for analysis |
| --- | --- | --- |
| Short answer | `deleteMany` then `create` | Old `QuizAnswer` row is deleted, so both analysis tables cascade. New analysis is written with the new row. Correct by construction. |
| Multiple choice | `deleteMany` then `create` (per mode) | Same. |
| True/false | rejected outright (Spec 1, finding I4) | No second analysis is possible. |

The cascade is what makes this safe: `AnswerKlpResult` and `AnswerErrorTag` both
declare `onDelete: Cascade` from `QuizAnswer`. **A test must pin that** —
resubmitting a short answer leaves exactly one set of analysis rows, not two.
If either relation were ever changed to `SetNull`, resubmission would silently
accumulate duplicate diagnostic rows and every Spec 3 rate would inflate with
each retry.

## §5 — Degradation

| Condition | Behaviour | `analysisStatus` |
| --- | --- | --- |
| Card has no KLPs | Today's three-dimension rubric; no KLP results or tags | `no_klps` |
| No AI credential | Unchanged from today — grading fails as it already does | `failed` |
| v1 option cache (no provenance) | Correctness recorded, no tag written | `no_provenance` |
| TF/MC, no `QuizQuestion` row (predates generation, or generation never ran) | Correctness recorded (or left unscored for TF), no claim written | `no_provenance` |
| Correct answer whose `targetKlpIds` no longer resolve against the live KLP set (mid-attempt card edit superseded them) | Correctness recorded, nothing credited | `no_provenance` |
| TF, learner rejected the real (uncorrupted) statement | No KLP result written — second-guessing, not a knowledge gap (§3, "Why 'answered false to the real definition' writes nothing") | `analyzed` |
| TF question with no `corruption` | Target recorded from `targetKlpIds`, no type | `analyzed` |
| Model returns an unknown `type` | That tag dropped; the rest of the answer persists | `analyzed` |
| Model returns an out-of-range `klpRef` | That tag dropped rather than targeting nothing | `analyzed` |

**Nothing observable is ever discarded.** The raw record — `selectedOption`,
`answer`, `correctAnswer`, `isCorrect` — is written on every path exactly as it
is today. What degradation drops is only the *interpretation*: the claim about
which proposition a wrong answer implicates.

The reason is asymmetric cost. A fabricated tag is indistinguishable from a real
observation — same table, same columns — so Spec 3 counts it, and two invented
`conflation` rows on the same KLP pair promote an "active misconception",
putting a confident and entirely fictional diagnosis on the learner's dashboard.
Nothing marks which rows were guesses, so it cannot be undone later.

Missing data makes a conclusion weaker; wrong data makes it wrong. Weak is
recoverable by answering more questions. Wrong is not, because you cannot tell
which rows to distrust. `analysisStatus` is what keeps "weak" visible rather
than silent.

---

## §6 — Testing

Pure and unit-testable without a database:

| Module | Responsibility |
| --- | --- |
| `computeSignificance` | The formula, clamping, and input passthrough |
| `toStudySource` | Totality of the quiz→memory mode mapping (§2.1) |
| `klpCredit` | `STATUS_CREDIT × EVIDENCE_STRENGTH`; every status/mode pair |
| `severityFromCorruption` | Rank table; MC as-is, TF minus one, clamped |
| `validateTagType` | `(dimension, type)` pairing against the vocabularies |
| `capTagsPerDimension` | Keeps highest-severity tags within the per-dimension cap |

`klpCredit` needs an explicit case asserting a `failed` status is `0.0` in
**every** mode — the one place the mode weighting must *not* apply, since a wrong
answer is unambiguous however easy guessing would have been.

Four integration cases carry the edge semantics this spec exists to pin down,
and each would silently corrupt the corpus if it regressed:

1. **A wrong MC writes exactly one `failed` result** — for the picked
   distractor's KLP, not for every targeted KLP.
2. **TF "answered false to the real definition" writes no KLP result** — the
   answer is scored wrong, but no proposition is claimed failed.
3. **An invalid tag is dropped AND recorded** — `analysisStatus` stays
   `analyzed`, `analysisWarnings` names what was rejected, so a lossy analysis
   is distinguishable from a clean one.
4. **Resubmitting a short answer leaves one set of analysis rows, not two** —
   pinning the `onDelete: Cascade` that makes replacement safe.

Plus the subset-invariant test (§2), prompt-shape tests extending
`tests/ai/prompts.test.ts`, and action tests following the established
`vi.hoisted()` + `vi.mock()` pattern in `tests/actions/`.

---

## §7 — Verbatim learner text

`AnswerKlpResult.evidence` and `AnswerErrorTag.quote` store the learner's own
words. Three things make this proportionate rather than a new exposure:

1. **No new data class.** Both are excerpts of `QuizAnswer.answer`, which already
   stores the complete typed answer. Nothing is retained that is not retained
   today.
2. **They cascade.** Deleting an answer or an attempt removes them, with no
   orphan rows holding quotes whose context is gone.
3. **They are never regenerated.** A quote is captured once, at analysis time,
   and read thereafter — so it always reflects what the learner actually wrote,
   not a model's later paraphrase of it.

**One gap worth stating rather than assuming.** The existing selective memory
reset (`src/actions/memory.ts`) deletes `ConfidenceEvent`, `StudyEvent`, and
`CardProgress` — it does **not** touch `QuizAnswer`. So analysis rows survive a
memory reset today, because the answers they hang off do. That is consistent
with current behaviour (quiz history already survives a memory reset), but a
user who resets their memory may reasonably expect their error tags gone too.
Whether reset should extend to quiz history is a **2b/Spec 3 decision** — this
spec neither changes nor assumes it, and flags it so the choice is deliberate.

## Known drift risks, deliberately out of scope

The same shape as §2's subset invariant — **a string that means something,
persisted in the database, defined in more than one place**. Type checking
cannot catch any of them, because every one is a `String` column. Recorded here
rather than fixed, because neither is on this spec's path:

- **`src/lib/memory/insight.ts:36` and `:50`** duplicate the `StudySource` list
  inline as two literal `z.enum([...])` arrays instead of deriving from
  `StudySource`. Adding a study mode makes both silently reject it, and
  `SessionInsight` parsing fails at runtime on a shape the type system accepted.
  Fix: derive from a shared `STUDY_SOURCES` const.
- **`Card.klpStatus`** (`pending | ready | failed | skipped`) has no shared
  constant; the literals are scattered across `src/actions/klp.ts`,
  `src/actions/sets.ts`, `src/components/sets/KlpEditor.tsx`, and a Prisma
  comment. A typo compiles cleanly and silently never matches.

Two existing patterns are the model to copy when these are addressed:
`AI_TASKS` (`src/lib/ai/model-routing.ts`) is a single `as const` with a derived
type, and the credential encryption format is pinned by a golden-vector test
(`tests/security/api-key.test.ts`).

- **`analysisStatus: 'failed'` is never actually written.** §5's degradation
  table lists "No AI credential → `failed`", but `submitShortAnswer`
  (`src/actions/quiz.ts`) doesn't wrap its `generateJson` grading call in
  try/catch — a grading failure throws out of the action before any
  `QuizAnswer` row is created, so there's no row left to mark `'failed'` on.
  The table entry describes intended, not current, behaviour. Fix would mean
  catching the grading failure and writing a `QuizAnswer` with
  `analysisStatus: 'failed'` (still no fabricated tags) instead of just
  returning `{ success: false }`. Left out of scope: it changes
  `submitShortAnswer`'s error contract with the client, which is a bigger
  decision than a status-mapping fix.
- **`submitShortAnswer`'s two `buildAnalysisWrites` calls (text and
  multimodal paths) never pass `forcedStatus`.** Unlike MC/TF there's no
  legacy-cache equivalent for short answer, so an empty `grade.klpResults` on
  a card that has live KLPs is indistinguishable from a genuinely clean grade
  — both read as `analyzed`. Whether that's the right call, or whether a
  malformed/incomplete grader response deserves its own status, is undecided.

## Open for 2b

How tags render per answer; whether KLP pass/fail shows as a checklist; how the
session rollup aggregates by `(type, klpId)`; whether "you struggle explaining X"
belongs on the results screen or waits for the Spec 3 dashboard. All of it gets
designed against real accumulated tags.
