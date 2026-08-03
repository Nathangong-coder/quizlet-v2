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
/// per KLP on the card; MC/TF write at most one (see §4).
model AnswerKlpResult {
  id           String     @id @default(cuid())
  quizAnswerId String
  klpId        String
  status       String     // passed | partial | failed
  evidence     String?    @db.Text  // verbatim learner quote, never regenerated
  createdAt    DateTime   @default(now())
  quizAnswer   QuizAnswer @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
  klp          CardKlp    @relation(fields: [klpId], references: [id], onDelete: Cascade)

  @@unique([quizAnswerId, klpId])
  @@index([klpId, status])
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
  dimWeight      Float
  starBoost      Float
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

`QuizAnswer` gains `klpResults AnswerKlpResult[]` and `errorTags AnswerErrorTag[]`;
`CardKlp` gains the three matching back-references.

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

### The subset invariant

**`CORRUPTIONS` must remain a strict subset of `ACCURACY_TYPES`.** MC and TF
write a distractor's recorded `corruption` *directly* as an error `type` (§4).
If the two lists drift, every MC-derived tag lands on a type the taxonomy does
not recognize, and Spec 3 aggregates silently corrupt data with nothing
throwing.

This gets a dedicated test asserting every `CORRUPTIONS` value appears in
`ACCURACY_TYPES`. It is cheap and it is the only thing standing between a
one-word edit and a poisoned corpus.

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

**Every component is persisted alongside the result.** `relevance` and
`starBoost` are point-in-time facts (the KLP's weight then, whether the card was
starred then) and must be frozen. `dimWeight` and the formula are constants
*today* — persisting them means tuning the weights later can recompute history
instead of leaving two incompatible scales in one dataset.

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
always `accuracy`. `relevance` reads the KLP's stored `weight`. `severity`
derives from a corruption-severity rank adjusted by the mode's guess rate
(MC 0.25, TF 0.5) — a wrong answer under a higher guess rate is weaker evidence.

The TF path exists only because `QuizQuestion.corruption` was added during
Spec 1's final review. Without that column TF would record the target but not
the type, and half the taxonomy triple would be unrecoverable.

**No provenance means no tag.** A v1 cache row, a card with no KLPs, or a
question generated before Spec 1 records correctness only. Never a fabricated
default — a wrong tag pollutes the aggregate more than a missing one.

### The correct-answer asymmetry

- **Short answer, correct**: KLP results are still written (the grader evaluated
  each one), `errorTags` is `[]`.
- **MC/TF, correct**: **no `AnswerKlpResult` rows at all.**

A correct MC pick proves the learner did not fall for three specific
corruptions. It does not prove they hold every KLP on the card, and at a 0.25
guess rate it is weak evidence of anything. Recording it as "all KLPs passed"
would inflate Spec 3's mastery estimates on the cheapest evidence in the system.

An answered question with zero tags is meaningful and distinct from an
unanalyzed one: `errorTags: []` means "analyzed, nothing wrong"; no rows at all
means "not analyzed". Any rate calculation in Spec 3 depends on that distinction.

---

## §5 — Degradation

| Condition | Behaviour |
| --- | --- |
| Card has no KLPs | Grading returns today's three-dimension rubric; `klpResults`/`errorTags` empty. Nothing breaks. |
| No AI credential | Unchanged from today — grading fails as it already does. |
| v1 option cache (no provenance) | Correctness recorded, no tag written. |
| TF question with no `corruption` | Target recorded from `targetKlpIds`, no type. |
| Model returns an unknown `type` | That tag is dropped; the rest of the answer persists. |
| Model returns an out-of-range `klpRef` | That tag is dropped rather than targeting nothing. |

Every degradation drops data rather than inventing it. The corpus is the
product here; a plausible-looking wrong tag is worse than an absent one.

---

## §6 — Testing

Pure and unit-testable without a database:

| Module | Responsibility |
| --- | --- |
| `computeSignificance` | The formula, clamping, and component passthrough |
| `severityFromCorruption` | Corruption rank + mode guess-rate adjustment |
| `validateTagType` | `(dimension, type)` pairing against the vocabularies |
| `capTagsPerDimension` | Keeps highest-severity tags within the per-dimension cap |

Plus the subset-invariant test (§2), prompt-shape tests extending
`tests/ai/prompts.test.ts`, and action tests following the established
`vi.hoisted()` + `vi.mock()` pattern in `tests/actions/`.

---

## Open for 2b

How tags render per answer; whether KLP pass/fail shows as a checklist; how the
session rollup aggregates by `(type, klpId)`; whether "you struggle explaining X"
belongs on the results screen or waits for the Spec 3 dashboard. All of it gets
designed against real accumulated tags.
