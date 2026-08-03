# Error Taxonomy & Significance

**Status:** approved 2026-08-01, frozen. Consumed by the Stage 8 specs.
**Companion:** `docs/ai/prompting-strategy.md`

This document defines how a learner's mistakes are named, scored, and
aggregated. It is a reference, not a spec — the schema that persists these
shapes lives in `docs/superpowers/specs/2026-08-01-answer-session-analysis-design.md`.

Two rules govern everything below:

1. **The error vocabulary is closed.** The AI picks from a fixed list; it never
   invents a tag name.
2. **The AI never computes significance.** It supplies one ordinal judgment;
   TypeScript computes the number.

---

## 1. An error is a triple

```
ErrorTag = (dimension, type, target) + significance
```

| Field | Values |
| --- | --- |
| `dimension` | `accuracy` \| `clarity` \| `conciseness` (`delivery` reserved for Stage 4 voice) |
| `type` | closed vocabulary, per dimension — see §2 |
| `target` | a `klpId`, or `whole_answer` |
| `significance` | 1-10, computed (§3) |

The dimensions are deliberately the same three the existing
`ShortAnswerGradeSchema` already grades on, so tags attach to the rubric users
already see rather than introducing a parallel vocabulary.

**Why the type vocabulary must be closed.** A free-forming model emits
`rambling`, `verbose`, `wordy`, `too long`, and `unfocused` across five
sessions. Those are five rows that should have been one, and the aggregate
profile — the entire point of collecting them — becomes noise. Specificity
belongs in `target` (which concept), not in `type` (which failure).

**The joint tag is the unit of meaning.** "Rambling" alone is a writing note.
"Rambling *about the asset-recognition KLP*" is a diagnosis: the learner pads
when they are unsure, and we now know which concept triggers it.

```
"they rambled about assets"
  -> { dimension: conciseness, type: rambling,
       target: klp_2 ("assets are recorded at historical cost"),
       significance: 6 }
```

---

## 2. The vocabularies

### 2.1 Accuracy

Content correctness. The richest dimension — these tags carry most of the
predictive signal.

| Type | Means | What it says about the learner |
| --- | --- | --- |
| `omission` | KLP never mentioned | Forgot, or never knew |
| `incomplete` | KLP named but not explained | Memorized the term, not the mechanism |
| `conflation` | Described X using Y's content | **Wrong mental model** — carries `secondaryKlpId` |
| `inversion` | Direction, sign, or causality reversed | Has the pieces, not the arrow |
| `misapplication` | Right concept, wrong context | Knows the rule, not its conditions |
| `factual_error` | Discrete wrong fact, number, formula term | Retrieval slip |
| `overgeneralization` | "always"/"never" on a conditional | Missing nuance |
| `unsupported_leap` | Conclusion doesn't follow from stated steps | Reasoning gap |
| `fabrication` | Invented mechanism or terminology | Confabulating under pressure |

`conflation` is the only type with a second target (`secondaryKlpId`). That
extra field is what makes the misconception engine in §5 possible without an
LLM.

### 2.2 Clarity

Can a listener follow it.

| Type | Means |
| --- | --- |
| `disorganized` | No logical order; jumps between points |
| `no_thesis` | Never states the answer up front; buries the lede |
| `ambiguous_referent` | "it"/"this"/"they" with no clear antecedent |
| `undefined_jargon` | Leans on a term the answer itself needed to define |
| `hedging` | Non-committal to the point of being uninformative |
| `incoherent_syntax` | Grammar or structure breaks the meaning |

### 2.3 Conciseness

Signal per word. Note this dimension fails in **both** directions.

| Type | Means |
| --- | --- |
| `rambling` | Sustained drift off-topic, or circling |
| `padding` | Filler, throat-clearing, restating the question |
| `redundancy` | Same point made twice |
| `over_qualification` | Excessive caveats and disclaimers |
| `kitchen_sink` | Shotgunning every related concept hoping to hit the answer |
| `too_terse` | So short it isn't an answer |

Two of these earn their place specifically:

- **`kitchen_sink`** is a *confidence* failure, not a knowledge failure. The
  learner may know the answer perfectly and be hedging their bets. It predicts
  differently from every other tag and is common in interview prep.
- **`too_terse`** exists so conciseness is symmetric. Without it an
  under-answer collapses into pure `omission` and the delivery signal is lost.

### 2.4 Clean answers

An answer with no errors stores `errorTags: []`. **The row is always written.**
Absence of a row means "not yet analyzed"; an empty array means "analyzed,
nothing wrong." Conflating those two makes every rate calculation wrong.

### 2.5 Caps

Maximum **4 tags per answer**, maximum **2 per dimension**. This forces the
model to rank rather than enumerate, and bounds the write per answer.

---

## 3. Significance (1-10)

```
significance = clamp(
    round( (0.55·relevance + 0.45·severity) × 2 × dimWeight × starBoost ) + repeatBonus,
    1, 10 )
```

| Input | Range | Source |
| --- | --- | --- |
| `relevance` | 1-5 | **Looked up from `CardKlp.weight`** — assigned once at extraction |
| `severity` | 1-5 | AI, per instance. The only genuinely per-answer judgment |
| `dimWeight` | accuracy 1.0, clarity 0.8, conciseness 0.7 | Constant |
| `starBoost` | ×1.15 when the card is starred | `CardProgress.starred` |
| `repeatBonus` | +1 | Same `(type, target)` fired on this KLP within the last 3 attempts |

Three notes on why it is shaped this way:

**Relevance is a lookup, not a judgment.** `CardKlp.weight` is assigned at
extraction time, where the model sees every KLP on the card at once and ranks
them against each other. Judging centrality once, in context, is both cheaper
and more consistent than re-judging it on every answer forever.

**Dimension weights encode the product.** This is finance interview prep: being
wrong is worse than being wordy. A different product would pick different
weights, which is exactly why they are named constants and not inlined.

**`repeatBonus` is what makes the profile predictive.** A one-off slip and a
mistake made for the fourth time are not the same event, and only the second
one belongs at the top of an action plan.

---

## 4. Multiple-choice and true/false: significance without an AI call

Short-answer error tagging rides the existing grading call. MC and TF need
**no AI call at all**, because the question generator already knows what each
wrong option was built to test.

Each distractor is generated by corrupting **one named KLP** with **one named
corruption** drawn from §2.1, and that provenance is persisted on the question:

```json
{ "text": "…", "correct": false, "sourceKlpId": "klp_2", "corruption": "inversion" }
```

A wrong pick is therefore self-diagnosing:

| Significance input | Where it comes from |
| --- | --- |
| `relevance` | The target KLP's stored `weight` |
| `type` | The chosen distractor's recorded `corruption` |
| `target` | The chosen distractor's `sourceKlpId` |
| `severity` | Corruption severity rank, adjusted by the mode's guess rate |
| `starBoost`, `repeatBonus` | Identical to short answer |

This is the load-bearing idea of the whole design. Generating distractors from
sub-concepts turns multiple choice from a binary right/wrong into a diagnostic
instrument at zero marginal cost, and lets MC, TF, and short answer all feed
one misconception graph.

**True/false** carries signal in both directions. Answering "true" to a
corrupted statement means the KLP isn't known. Answering "false" to the real
definition means the learner is second-guessing a KLP they *do* know — a
confidence problem, not a knowledge problem, and it should not be tagged as
`omission`.

**Fallback.** A question generated before this scheme (a v1 `QuizOptionCache`
blob, or any card with no KLPs) has no provenance. Those answers record
correctness only, with significance omitted — never a fabricated default that
would pollute the aggregate.

---

## 5. Misconceptions are derived, never emitted

An `active_misconceptions[]` entry such as
`confuses_money_supply_with_rates` must **not** be an AI output. A model asked
to name a misconception invents fresh phrasing every time, and the same
confusion never aggregates with itself.

Derive it instead:

> Group error tags where `type = 'conflation'` by `(klpId, secondaryKlpId)`.
> At **≥2 occurrences across ≥2 distinct sessions**, promote the pair to an
> active misconception. Retire it after **30 days with no recurrence**, or
> after **3 consecutive clean answers on both KLPs**.

Fully deterministic, reproducible, zero LLM cost, and it decays honestly rather
than accumulating forever. Only the human-readable label needs a model, and
only once per promoted misconception.

The `evidence_snippet` is the verbatim learner quote captured on the triggering
tag — stored, never regenerated.

---

## 6. `kind` and the learning-pathology signal

`CardKlp.kind` is one of:

`definition` · `mechanism` · `causal` · `condition` · `quantitative` ·
`contrast` · `example`

A learner who reliably passes `definition` KLPs and reliably misses `causal`
ones has a specific, nameable pathology — *memorizes terms, fails on why* — and
it falls out of a `groupBy` over KLP results. No AI required to detect it; the
AI is only needed to phrase it.

This is the field behind `cognitive_profile.frequently_missed_klp_type`.

---

## 7. Cost

| Operation | AI calls | When |
| --- | --- | --- |
| KLP extraction | 1 per 10 cards | Once, async, cached, version-pinned |
| Short-answer grade **+ error tags** | 1 (folded into the existing grade call) | Per short answer |
| MC / TF significance | **0** | Deterministic from distractor provenance |
| Session analysis | 1 (existing `SESSION_INSIGHT_PROMPT`, extended) | Per quiz |
| Learner profile rebuild | **0** | Fully deterministic |
| Misconception labelling | 1 | Once per promoted misconception |

Net new steady-state cost: roughly **one call per ten new cards**. Everything
else rides calls that already happen.
