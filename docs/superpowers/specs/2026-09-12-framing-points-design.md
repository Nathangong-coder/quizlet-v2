# Framing points and the conditional communication dimension

**Date:** 2026-09-12 · **Status:** classification built; the dimension is a draft
**Builds on:** `2026-09-12-rebuild-test-design.md`, `docs/ai/card-tagging-axes.md` Parts F–I

## The observation

The definition-length spread (7 cards; GLM 5.3 flash writes, DeepSeek revises,
writes the traps and grades strictly) put the same failure on every
"define X" / "walk me through" card: the `memorized_template` trap is credited
on the definition and the contrast points, and separation lands at 0.3–0.5.

That is not a defect in those points. A prepared candidate always has the
definition — that is what preparation *is* — so a point that says "X is Y"
cannot tell a strong answer from a rehearsed one, and asking the revise call
to "tighten" it produces either a contorted definition or a dropped one. The
owner's read: these points should be flagged so they do not drag the
separation the pipeline tests, still map to topics, and still count toward
learning — but as **communication**, not knowledge.

Measured on the spread, roles and substance separation (full → substance):

| card | full | substance | framing / points |
|---|---|---|---|
| Intangible assets not on the balance sheet | 0.50 | 0.58 | 1 / 7 |
| CapEx & depreciation shift | 0.81 | 0.81 | 0 / 8 |
| DTL vs DTA | 0.44 | 0.44 | 0 / 9 |
| Luxury soap brand (working capital) | 0.72 | 0.72 | 0 / 9 |
| Two ways an acquisition creates value | 0.29 | 0.50 | 3 / 7 |
| Sell-side M&A process | 0.39 | 0.39 | 0 / 9 |
| WACC 6% / acquirer's yield | 0.22 | 0.29 | 2 / 9 |

Three cards move — the acquisition-value card from below the floor to above it — and the rest have no framing point the template passed. The WACC card stays low for a different reason (a writer knowledge gap, recorded in `docs/ai/model-performance.md`), which is exactly what the split is for: framing explains one low number and not the other. The
mechanism is narrow by design — see "what does not qualify".

Re-run after the build (same configuration, `--dry-run --force`, the three M&A cards):
acquisition-value 0.38 full / **0.60 substance** with 3 framing points, now `separated`;
WACC 0.81 (a different, correct draft — not attributable to the strictness change);
sell-side 0.61 with no framing point. Full record in `docs/ai/model-performance.md`.

## The rule (built)

`src/lib/klp/framing.ts`, pure, pinned by `tests/klp/framing.test.ts`:

- A point is **framing** iff `kind ∈ {definition, contrast}` **and** the
  `memorized_template` trap's verdict on it is `correct`. Everything else is
  **substance**.
- `substanceSeparation` = `computeSeparation` over the substance points
  only. The quality bar (`revisionFindings`), the revise call's
  `discrimination`, and `status` read this number. `separationScore` stays
  on the full set so every stored score remains on one scale; both are
  persisted (`CardAuthoring.substanceSeparation`, nullable, no backfill).
- The per-point finding "accepted by the memorized_template answer" is not
  raised for a framing point. Any other trap's acceptance still is.
- The role is written on the KLP row (`CardKlp.role`, nullable — legacy
  extraction never ran the traps, so it must not read as "substance").
- Roles are recomputed every revision round: a rewrite can move a point
  between roles.
- With a competence panel there is no template member, so every point is
  substance; the panel path is unchanged.

### What does not qualify

- A **mechanism/causal/quantitative** point the template recites is still
  substance. A template that can produce the mechanism has the mechanism;
  the point is loose and the revise call should see it.
- A **definition only the `vague` answer passes** is substance — that is a
  loose definition, a real defect.
- A **definition the `confident_wrong` answer passes** is substance — the
  point does not pin the term.

### Deferred: the model override

The owner suggested DeepSeek could rule "this is not a real separation
failure". It is deferred because it would put a model opinion inside a number
the pipeline otherwise computes in TypeScript, and nothing measured yet says
the deterministic rule is wrong often enough to pay for that. If it is
added, it goes in as a **third verdict channel** beside disputes, recorded and
surfaced, never silently applied.

## The communication dimension (draft)

### What it measures

A learner who misses framing points on a card where they exist can open an
answer badly while knowing the content — or the reverse. That is a delivery
gap, diagnosed differently from a substance miss, and it is what the
short-answer rubric's *clarity* was reaching for without a per-point
evidence base.

### Conditional

The dimension exists **only on cards that have at least one framing point**.
A card with none reports no communication score — not zero, not full — because
there is no evidence for one. This is the same rule `AnalysisStatus` follows:
"no evidence" and "clean" must never share a value.

### Computation (TypeScript, from existing rows)

For a graded short answer on card `c` with framing points `F` and substance
points `S` (roles read off `CardKlp.role`):

- `substanceCredit = mean(credit over S)` — this is what knowledge mastery
  reads. **Framing points leave the knowledge number.**
- `framingCredit = mean(credit over F)` when `|F| > 0`, else undefined.
- `communication(c) = framingCredit` — no blending; it is its own series.

`credit` is the existing `AnswerKlpResult.credit` (`statusCredit ×
evidenceStrength(mode)`), so the dimension needs **no new capture** and no AI
call: it is a `groupBy` on a column the pipeline now writes.

Aggregation follows the mastery engine's existing per-KLP → per-card →
per-topic rollup, restricted to `role = 'framing'` rows. The rollup must
carry a denominator (`framingPointsObserved`) so a topic with two framing
observations does not read like one with forty.

### What it does NOT change

- Topic minting: framing points map to topics exactly as before. A definition
  is often the *best* topic anchor.
- Weights: `weightFromSignals` is untouched. A framing point's
  discrimination breadth is low by construction, which already gives it a
  lower weight; nothing extra is needed.
- Significance: an error on a framing point is still an error triple; only
  its aggregation home changes.

### Where it surfaces

- `/profile/learner`: a "communication" tile beside knowledge, shown only
  when `framingPointsObserved > 0`.
- The short-answer results view: framing points rendered with their own
  marker, so "you had the mechanism but did not define the term" is visible
  per answer.
- Spec 4's lessons: a learner with high substance and low framing gets an
  "open the answer" drill, not a content lesson.

### Open questions

0. **`definitionPoints` can launder the card** (found on the re-run). The writer split
   "purchase price > NAV" into "a price that *differs from* the worth", so the coverage
   grader saw a correct point and `disputes` stayed empty on a card with a known error.
   The split must quote the card's wording, or the coverage grader must get the raw
   definition beside the points. Until then an empty `disputes` is not evidence.

1. Whether `example` should be a framing kind. The spread had none the
   template passed; leave it out until one shows up.
2. Whether `role` should be re-derived when a card is re-graded
   (`src/lib/klp/regrade.ts`). It should: the role is a property of the
   verdicts, not the text.
3. The dimension name. The owner said "communication"; the row value is
   `framing`. Keep `framing` on the data (it says what the point is) and
   "communication" in the UI (it says what the learner lacks).

## Kind-aware strictness (built alongside)

`GRADE_CANDIDATE_PROMPT` in strict mode now tags each point with its kind and
appends `KIND_STRICTNESS_CLAUSE`: **mechanism, condition, quantitative** are
judged on substance (steps / condition-and-consequence / figure-and-direction,
in the answer's own words); **causal** must state the link itself, naming both
ends is at most `incomplete`; every other kind stays strict. Outside strict
mode nothing changes — stored scores were graded on one prompt and stay so.
`RELAXED_KINDS` is pinned by test; changing it is a prompt version bump.
