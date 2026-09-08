# KLP quality pipeline — hygiene, fidelity, and the synthetic panel

**Status:** design agreed in conversation 2026-09-07, **not built**. Owner asked for it to be
implemented in a later session.

**Companion:** the same material with diagrams is in the Claude artifact
"Mistake Detection Engine", tab 04 — <https://claude.ai/code/artifact/9fd12767-b049-4d27-babb-30efbb0b8d88>.
That artifact is a *view*; this file is canonical.

---

## Scope: "set" means ONE CARD'S KLPs

Throughout this document, **set** = the 4-9 key points belonging to a single card. It never means a
flashcard deck. Every hygiene check is bounded by one card:

- *Independence* — do this card's KLPs overlap, so one piece of evidence is counted twice?
- *Atomicity* — can one of this card's KLPs half-fail? ("EBIT falls 10 **and** net income falls 6")
- *Coverage* — can an answer built only from this card's KLPs reconstruct its reference answer?
- *Grain* — are this card's KLPs at comparable specificity **with each other**?

**Grain is a WITHIN-CARD check and must never compare across cards.** Different cards legitimately
sit at different specificity levels — a definitional card and a three-statement walkthrough are not
supposed to match — so a cross-card grain comparison would flag correct authoring as a defect. The
check is variance *inside* one card's set, nothing more.

## The frame: three axes, not one

The shipped pipeline measures one property and treats it as quality.

| Axis | Question | Status today |
| --- | --- | --- |
| **Fidelity** | Is this proposition *true*, and does it trace back to the card? | Barely measured |
| **Discrimination** | Does it separate a strong answer from a weak one? | Well measured, narrowly — `src/lib/klp/separation.ts` |
| **Hygiene** | Is the SET well formed — atomic, independent, complete, one grain, correctly tagged? | ~4 rules in `src/lib/klp/validate.ts` |

Hygiene is a property of the **set**, not of any point in it. Two KLPs can each be true and each
discriminate and still be one piece of evidence counted twice — a conditional-independence
violation that inflates every posterior downstream. Neither of the other two axes can see it.

**Ordering: local hygiene → fidelity → set-level hygiene.** Local first, because a compound or
vaguely-worded point breaks every downstream check (ask a verifier whether "EBIT falls 10 and net
income falls 6" is true and you get a muddled answer — it is two claims). Set-level last, because
there is no point measuring whether a *false* point overlaps its neighbours.

---

## Phase A — local structure

Cheap, mostly deterministic, runs per KLP independently.

| Check | How | Fail action |
| --- | --- | --- |
| Atomicity | Regex for conjunctions/semicolons/two-or-more numbers, then a model confirm: "could a student satisfy exactly half of this?" | Auto-split |
| Abstraction level | Model classifies `concrete` / `relational` / `dispositional`. **Dispositions are never KLPs** — they are DAG nodes. | Reject, or convert to a tag |
| Self-containment | No pronouns without in-KLP antecedents, no "as mentioned above" | Auto-rewrite |
| Not a restatement | N-gram overlap with the question stem | Reject |
| No meta-language | Rejects "the student should mention…" — KLPs are propositions about the world | Auto-rewrite |
| Tag validity | Exactly one DAG node, node exists, tag is not an embedding outlier vs sibling KLPs | Auto-retag if confident, else flag |
| **Numeric consistency** | TypeScript, no model: the numbers in the set must be arithmetically consistent (10 × (1 − 0.4) = 6) | Flag — see R6 |

## Phase B — fidelity

Unchanged from today plus the coverage/entailment check: every point in the card definition should
map to a KLP, and every KLP should trace back to the definition. Anything with no trace is either
an inference the model added or a fabrication, and those two look identical today.

## Phase C — adversarial set-level checks

Framing: **the KLP set is a specification and you are red-teaming it.** If the spec can be
satisfied by a bad answer, the spec is broken.

- **C1 — exploit test.** Give a model the question and the full KLP set; ask for an answer that
  satisfies every KLP and is still not good. Three strategies: *omission*, *contamination*
  (satisfies all, also asserts something false), *scope drift* (answers a neighbouring question).
  A success is a coverage hole, and the exploit says what is missing. **Highest-value check in the
  pipeline.**
- **C2 — minimal-answer test.** Generate the shortest answer satisfying every KLP and nothing more,
  then ask independently whether it is good. A mediocre minimum passing answer means the bar is too
  low. Catches holes C1's adversary happens to miss.
- **C3 — pairwise independence.** Can an answer satisfy K_i but not K_j, both directions? If one
  direction is impossible, K_j is entailed by K_i and evidence is double-counted.
- **C4 — necessity.** Delete each KLP; is an answer lacking it still acceptable? If yes it is an
  optional detail. Keeps sets from bloating to 15 where 7 do the work.

### Routing

```
atomicity fail       -> auto-split, re-enter Phase A
format fail          -> auto-rewrite, re-enter Phase A
redundancy (C3)      -> auto-merge, re-enter Phase A
coverage hole (C1)   -> generate candidate KLP, re-enter Phase A
necessity fail (C4)  -> auto-delete, re-run C1 and C2
abstraction outlier  -> flag, human
tag ambiguity        -> flag, human
fidelity fail        -> quarantine, human, NEVER auto
```

**Cap iterations at two and log the count.** Without the cap the pipeline oscillates: add a KLP to
close a hole, necessity removes it, coverage re-adds it. Questions needing multiple rounds are
exactly the ones worth reviewing by hand.

### What to store

`klp_id, version, status, abstraction_level, atomicity_pass, fidelity (verified|contested|failed) +
verifier votes, coverage_exploits[] {strategy, exploit_text, resolution}, entailed_by[],
necessity_pass, iterations`

**Keep the exploit text.** It is a labelled dataset of how KLP sets fail, and it is what eventually
improves the authoring prompt rather than patching its output forever.

---

## Six revisions to the framework as proposed

### R1 (CRITICAL) — auto-fixes reset mastery, and the fix is to RE-GRADE, not to gate publishing

Auto-split / rewrite / merge / retag / delete all supersede a `CardKlp` row, and **superseding one
silently resets its `KlpState`**. A typo fix already does this. Running hygiene over a live corpus
wipes accumulated mastery at scale, invisibly, in the name of quality.

**An earlier draft of this document proposed gating hygiene behind pre-publication. That was
rejected by the owner and the rejection was correct**: users edit cards and sets constantly and
will not wait on a publish step, and gating would make the quality pipeline something people route
around.

**The right fix is to replay history against the new KLPs, and the machinery is mostly built:**

| Piece | Status |
| --- | --- |
| The learner's raw answer text | **Stored** — `QuizAnswer.answer`, with `prompt`, `mode`, `latencyMs` |
| Rebuilding `KlpState` from evidence | **Built** — `rebuildKlpStates` (`src/lib/metrics/state-writer.ts`) reads surviving `AnswerKlpResult` rows in chronological order and re-derives the posterior; it already deletes states with no evidence left |
| Writing analysis for one answer | **Built** — `createAnswerWithAnalysis` (`src/lib/analysis/write-answer.ts`) |
| A background job that re-grades stored answers against a NEW KLP set | **The only missing piece** |

So the flow on a KLP change becomes: supersede the old KLPs, write the new ones, enqueue the card's
historical answers for re-grading, and let `rebuildKlpStates` recompute each posterior from the new
`AnswerKlpResult` rows. **No publish gate, no waiting, no lost mastery.** The user's edit lands
immediately; the evidence catches up in the background.

**Idempotency needs no new column.** "Has this answer been graded against KLP version N?" is
answerable by checking whether it has `AnswerKlpResult` rows pointing at version-N KLPs. Re-grading
is not deterministic — the same grader on the same answer can return a different verdict — so it
must be gated on that check rather than re-run freely.

**THE ONE REAL LIMITATION: multiple-choice and true/false history cannot be re-graded.** Their
diagnosis does not come from text; it comes from distractor provenance — `QuizQuestion.options`
carries `sourceKlpId` + `corruption` per option, and `targetKlpIds` + `klpVersion` pin it to a KLP
version. A distractor was *generated* to corrupt a KLP that no longer exists, so the learner's wrong
pick diagnosed that KLP and there is no honest mapping to a new one. `selectedOption` text survives,
but asking a model to map it onto a new KLP is inference presented as provenance — the fabrication
this engine refuses everywhere else.

**So MC/TF evidence is carried forward where its KLP survived and dropped where it did not**, with
`analysisStatus` recording which. Short-answer and diagnostic answers — the ones carrying the most
signal per row — re-grade cleanly.

**Cost:** one AI call per stored short-answer per re-authored card. A card with five historical
answers costs five calls, bounded and background-able on the existing cron.

### R2 (HIGH) — necessity deletes jointly-essential points

C4 asked per point, independently, deletes both halves of a two-KLP idea: each individually looks
optional. **Necessity must be greedy-sequential, never batch** — delete one, re-run coverage, then
reconsider the next against the reduced set.

### R3 (HIGH) — C1 has no stopping rule

"An answer satisfying every KLP that is still not good" is something a capable model can *always*
produce. Without a bar, C1 is an infinite hole generator and the iteration cap does all the work.
**The exploit must be judged against a stated standard** — "would this be marked down in a real
interview?" — in the prompt. Otherwise C1's output is unfalsifiable.

### R4 (HIGH) — "grain" collides with `CardKlp.kind`

The proposed scale was `claim / mechanism / disposition`, but `mechanism` is already a `CardKlp.kind`
value (`definition|mechanism|causal|condition|quantitative|contrast|example`) meaning *what type of
proposition*, not *how abstract*. This project already made this exact mistake once — user
categories pressed into service as concept nodes, still noted as an open limit in CLAUDE.md.

**Rename to `abstraction`, levels `concrete / relational / dispositional`.** Keep `kind` as is. The
rule that dispositions are never KLPs is correct and is the most useful check in Phase A.

**And the check is variance WITHIN one card's set, never a cross-card comparison** — see Scope
above. A definitional card sitting entirely at `concrete` and a walkthrough spanning `concrete` and
`relational` are both correctly authored.

### R5 (MEDIUM) — C3 is quadratic and half of it is free

42 calls for a 7-KLP set, 90 for a 10. But the authoring run already builds a verdict matrix — every
candidate's verdict on every KLP. **Two KLPs with identical verdict vectors are co-firing**, at zero
cost, because the matrix is computed for the discrimination test anyway. Use it to **shortlist**,
then spend calls only on the shortlist. Quadratic becomes roughly linear; the subtle cases it misses
are the ones live co-occurrence catches later.

### R6 (MEDIUM, an addition) — numeric consistency

The corpus is finance. "EBIT falls 10", "net income falls 6", "40% tax rate" are arithmetically
linked and checkable in TypeScript with no model in the loop. **Catches a class of error no LLM
check reliably catches**, because a model that got the arithmetic wrong when authoring will
confidently confirm it when verifying. Cheapest high-value check available.

---

## R7 (CRITICAL, measured 2026-09-07) — C1 is not yet a measurement instrument

**Built and run.** `npm run klp-exploit` (`scripts/klp-exploit.ts`,
`src/lib/klp/exploit.ts`, `src/lib/ai/prompts/exploit-klps.ts`). Read-only:
no schema change, no mutation, exploit text to a JSON file. Two calls per
attempt — the new generator prompt, then the EXISTING `GRADE_CANDIDATE_PROMPT`
verifying independently that the exploit really does satisfy every key point,
because the generator is otherwise the party grading its own success.

**The same 20 cards, one model (`deepseek-v4-flash`), two phrasings of the
same bar:**

| | prompt v1 | prompt v2 |
| --- | --- | --- |
| cards with a verified hole | 8/20 (40%) | 19/20 (95%) |
| abstentions | 43/60 (72%) | 8/60 (13%) |
| `omission` confirmed | 1 | 16 |

**44 of 60 attempts flipped**; 36 went straight from `abstained` to
`confirmed`. The corpus did not change — the sample is seeded, so both runs hit
byte-identical cards. **The headline number is dominated by prompt framing, not
by the key points being measured.**

Both prompts are defensible. v1 said "the list is the entire specification:
nothing else is checked", describing the automated grader; the model read it as
the *standard of judgment* and concluded that an answer satisfying the list
cannot be marked down — making `omission` unfindable by construction. On one
card it named the hole ("the question also asks how leases change over time")
in the same sentence as abstaining from it. v2 scoped that rule to the grader
and stated that the interviewer has never seen the list. That correction was
right, and it over-corrected.

**Why R3 is necessary but not sufficient.** R3 requires a stated bar so the
check is falsifiable. It is now stated, and abstention does occur, so
`unfalsifiable` never fires — yet the number still moves 2.4x on wording.
Stating a bar does not calibrate it. **An exploit makes two claims and only one
is verified:**

- **A: "this satisfies every key point."** Verified by an independent grader.
  Stable — of the 15 attempts graded in both runs, the grader agreed on 10, and
  the texts were different, so that understates its stability.
- **B: "this would be marked down in a real interview."** The generator's own
  judgment. **This is where the entire 40%-to-95% swing lives.**

**So `confirmed` was an upper bound, and C1 could not produce a corpus number
until B had a blind judge. THE JUDGE IS NOW BUILT** (2026-09-07, same session)
and it needed no new prompt: `GRADE_SHORT_ANSWER_PROMPT` called with NO key
points is its shipped rubric-only path — the app's own short-answer grader,
scoring the answer against the card exactly as it scores a real learner's, with
no knowledge of the key points or of the answer's origin. That also makes the
bar operational rather than hypothetical: an exploit the product's own grader
likes was never an exploit. It fires only where claim A held, so it costs one
call per otherwise-confirmed attempt.

### The calibrated result (same 20 cards, same model, third run)

| | v1 | v2 | **v2 + blind judge** |
| --- | --- | --- | --- |
| cards holed | 40% | 95% | **10% (2/20)** |
| confirmed attempts | 16 | 46 | **2** |
| rejected by the judge as fine answers | n/a | n/a | **31** |

Of 42 attempts the generator claimed, **40 did not survive checking** — 9
because the key points caught the answer, 31 because the app's own grader
thought the answer was good. The generator's raw claim rate is not a usable
measure of anything.

**COVERAGE IS NOT THE PROBLEM.** `coverage_clean` fires. And the per-strategy
split is sharper than the headline: **zero confirmed `omission` holes and zero
confirmed `scope_drift` holes.** Both surviving holes are `contamination`.
Authored cards had none at all (0/10); the two were one reused and one legacy.

**Read the curve, not the number.** `threshold_sensitive` fires: confirmed
counts by judge floor are `<4: 0, <5: 0, <6: 0, <7: 2, <8: 9, <9: 22`. The
answer is stable across every defensible bar — a "marked down" answer is one
scoring below about 7 — and only takes off at floors 8 and 9, which would mark
down an answer scoring 8/10. So *at any bar worth defending, coverage holes are
rare*; the run does not support a stronger claim than that.

### What the run does establish, independent of the framing

**The routing table is wrong for most holes.** Under v1 the split of 16
confirmed exploits was `scope_drift` 8, `contamination` 7, `omission` 1; under
v2, 16 / 14 / 16. Either way the design's single C1 action — *"generate
candidate KLP, re-enter Phase A"* — only applies to `omission`:

| Strategy | Fix |
| --- | --- |
| `omission` | add a key point — the routing table's action |
| `contamination` | **a negative check.** No added key point fixes "and it also said something false"; the model has no concept of a requirement that something be ABSENT |
| `scope_drift` | **anchoring to the question.** Every key point is present and true; the answer addresses a neighbour |

Routed as designed, most findings become key points that fix nothing, C4 then
deletes them as unnecessary, and C1 re-finds the hole — the oscillation the
iteration cap was meant to bound, arising for a structural reason a cap cannot
fix. **C1 must route by strategy, and two of the three routes do not exist
yet.** On the calibrated run the shipped action fits **0%** of confirmed holes.

### The proposed routing table

`add_klp` is the only route that touches key points, and therefore the only one
that needs the re-grade job (R1) to be safe. `KLP_MUTATING_ROUTES`
(`src/lib/klp/exploit.ts`) encodes that so the claim is computed, not asserted.

| C1 outcome | What it means | Route | Auto? |
| --- | --- | --- | --- |
| `refuted` | the key points caught it | discard | — |
| `judged_fine` | key points accepted it, the app's grader liked it | discard, but TREND it — a rising rate means the generator is drifting | — |
| `omission`, missing content traceable to the card | a real coverage hole | draft the point, re-enter Phase A, re-run C1/C2, capped at 2 | auto |
| `omission`, missing content NOT in the card | the CARD is thin; the key points are faithful to it | the existing `concerns` channel, to a human. **Never auto-add** — Phase B's own rule is that a proposition with no trace to the artifact is a fabrication | human |
| `contamination` | **a gap in the grading contract, not in this card** | do not touch the key points | never |
| `scope_drift` | **a gap in the grading contract, not in this card** | do not touch the key points | never |

**Why the last two are not key-point defects.** A key-point set is a
*conjunction of positive requirements*. No such conjunction can express "and
nothing false is asserted", nor "and this answers THIS question". Adding
members never gets you either, so this is an expressiveness limit rather than a
tuning problem — which is exactly why the iteration cap bounds the loop's cost
without making it converge.

**Contamination is worse than an evasion — VERIFIED IN CODE, 2026-09-07.**
`klpResults` and `errorTags` are written independently
(`src/lib/analysis/write-answer.ts`) and `klpCredit` reads only
`status x mode`. Nothing reduces key-point credit because of a card-level error
tag. So an answer that satisfies every key point AND asserts something false is
recorded as **full positive evidence on every point**: the error tag lands
beside it and feeds severity, while `KlpState` and the BKT posterior go UP. The
learner is marked as knowing the card better for having said something wrong.
That is the argument for the negative check, and it does not depend on C1's
numbers at all.

### Corpus, measured the same day (`npm run klp-histogram`)

The queue's figures were stale. **923 live KLPs on 200 cards — 432 authored,
373 reused, 118 legacy**, across 130 authoring runs. Authored and reused both
read mean weight 2.83 with no failure mode firing; only the 118 legacy rows
still fail `clustered_high` (92.4% at 4-5). Provenance made no clear difference
to hole rate in either run, but 20 cards cannot support that comparison — the
per-slice samples are 10 / 5 / 5.

---

## Discrimination: replace the three adversaries with a synthetic panel

| Shipped today | Synthetic panel |
| --- | --- |
| 1 reference + 3 adversaries by *kind of failure* (`confident_wrong`, `vague`, `memorized_template`) | 5 answers by *level of competence*: L4 expert, L3 competent, L2 partial, L1 confused, L0 off-target |
| One number: `reference − best wrong` | A curve, and a diagnosis from its shape |
| Adversaries regenerated every revision | Panel is **fixed** — a reusable regression suite |

### Three things it buys

1. **L3 is the near-miss that does not currently exist. THIS IS THE REAL ARGUMENT.** Re-measured
   2026-09-08 across all 130 authoring runs: AUC is **1.000 on 129 of them** (one at 0.996). The
   reference outranks every adversary, every time, on every model. `bestWrongScore` uses `max`
   specifically to catch an answer that nearly passes, and nothing is nearly passing — so the
   test is SATURATED. It can still catch a set so loose that an obviously bad answer passes; it
   cannot tell a sharp set from a merely adequate one, which is the distinction the pipeline
   exists to make.
2. **Monotonicity is a free, stronger test.** Five ordered levels should score in order; an
   inversion is a defect the single-gap test cannot express.
3. ~~**A fixed panel is a regression suite — and its absence is a real flaw in what is shipped.**~~
   **THIS ARGUMENT IS FALSE ABOUT THE SHIPPED CODE, and it was billed as the strongest.**
   Checked in `src/lib/klp/authoring.ts` on 2026-09-08: the revision loop grades
   `draft.wrongAnswers` — written ONCE by the author call — against each revised key-point set.
   The adversaries are already fixed within a run, so a rising separation score is already
   attributable to the edit. Reason 1 (the missing near-miss) and reason 2 (monotonicity) both
   hold and are enough on their own; this one should not be repeated, or someone will go looking
   for a bug that is not there.

   What IS still missing is a panel fixed ACROSS runs, so two separate authoring passes on one
   card are comparable. That needs the panel persisted against the CARD rather than the
   klpVersion — a schema change, and not in this increment.

### Per-KLP diagnosis from the curve

| Shape | Diagnosis |
| --- | --- |
| Fires at L1 | Too loose — satisfied by a confident misconception |
| Does not fire at L4 | Too strict, or unfaithful to the reference — a fidelity alarm |
| Identical at L2 and L3 | Not measuring what separates competent from partial |
| Fires at L0 | Matching surface keywords, not content — the worst case |
| Non-monotonic | Ambiguous wording, or an unstable grader — re-grade to tell them apart |

**Cost: +25% grading calls** (5 candidates instead of 4) against a measured ~70s and 6–16 calls per
card. On any card that revises twice the panel is *cheaper*, because it is written once per card
rather than once per revision.

**Keep from the current design:** `max` rather than mean over the weak levels, all arithmetic in
TypeScript, one model pinned per card, each candidate graded in isolation.

---

## Online item analysis — once there are real answers

Synthetic answers are a model imagining how someone fails; real failures are stranger and lumpier.
Treat offline discrimination as a filter for obviously-broken KLPs and switch to live data when
there is any.

| Quantity | Reads | Threshold |
| --- | --- | --- |
| Point-biserial | Correlation between hitting this KLP and overall strength on its concept | <~0.15 dead weight; **negative is a fidelity alarm** |
| Hit rate | Fraction of answers satisfying it | >0.95 or <0.05 is no variance, therefore no information |
| Verdict entropy | Spread across categorical verdicts | Only ever correct/absent means it is a binary not earning its cost |
| Grader stability | Re-grade a sample, count flips | **Most underrated** — see below |

**Grader stability deserves more weight than its position suggests.** It is the only one that
catches ambiguous *wording*, and it is invisible in aggregates: an unstable KLP looks exactly like a
mediocre one, so the other three misdiagnose it and suggest the wrong fix. It is also the cheapest —
grade a sample twice and count disagreements.

**Two cautions.** 0.15 and 0.05/0.95 are classical-test-theory conventions, not laws; tune them
against this corpus the way severity bands were. And all four need ~50+ responses per KLP to mean
anything, which is a long way off — until then they are a design target, not a gate.

**Endpoint: Item Response Theory.** Fit each KLP a difficulty and a discrimination parameter from
real responses by maximum likelihood — the same quantity separation approximates, measured against
humans instead of three synthetic adversaries. The data is already accumulating in
`AnswerKlpResult`.

---

## Build order

1. ~~**C1 alone, read-only, over the existing bank.**~~ **BUILT AND RUN 2026-09-07 - see R7.**
   `npm run klp-exploit`. It did NOT answer whether coverage is the problem: the headline number
   moves 2.4x (40% -> 95% of cards) on prompt wording alone, over a byte-identical card sample.
   R3's bar shipped as required and is necessary but NOT sufficient - stating a bar does not
   calibrate it, and the swing lives entirely in the one claim nothing verifies. Needs a blind
   judge for "would this be marked down" before any coverage figure is usable.
   It DID establish that the routing table is wrong for roughly 90% of holes.
2. ~~**The background re-grade job, before writing any auto-fix.**~~ **BUILT 2026-09-07.**
   `npm run regrade-klps` — `src/lib/klp/regrade.ts` (pure planner) and
   `regrade-run.ts` (executor). Carries a result forward when its key point survived
   VERBATIM (whitespace/case normalised, nothing looser), re-grades a free-text answer only
   when the new set has points the carried evidence does not cover, drops what is gone, and
   NEVER re-grades multiple choice or true/false. Idempotent with no new column and no queue
   table: "does every result point at a live key point" is both the gate and the work queue.
   **Live dry-run, 2026-09-07: 7 cards, 8 answers, 9 stranded results — and only 1 of 9
   `KlpState` rows in the whole corpus sits on a live key point.** The damage is not
   hypothetical; it has already happened. Two answers (one MC, one TF) lose their evidence
   with no honest alternative.

   **RUN AGAINST PRODUCTION 2026-09-08 — and it fabricated evidence before it repaired any.**
   All 9 stranded results were cleared, but 5 of the 6 re-graded answers were DIAGNOSTIC, and a
   diagnostic must not be re-graded. The reason is SCOPE, not format: a diagnostic question
   probes exactly one key point (`DiagnosticQuestion.klpId`), while
   `GRADE_SHORT_ANSWER_PROMPT` judges the card's whole set. The grader marked every untouched
   point `failed`, because an answer to one question does not mention the other five — 30
   systematic false negatives. A learner who correctly answered "Gross Profit" was recorded as
   failing four points on operating expenses, EBIT, EBITDA and net income.
   `diagnostic` is now in `CARRY_ONLY_MODES`; `scripts/repair-diagnostic-overcredit.ts` removed
   the fabricated rows and replayed the posteriors. Not one of the 12 diagnostic questions had a
   probed key point that survived re-authoring, so keeping no key-point evidence is the honest
   outcome for all of them.

   **An answer's re-gradable scope is WHAT IT WAS ASKED, never its format.** "Is it free text"
   was the wrong test and it is the one this module originally used. `quiz-sa` qualifies because
   its prompt IS the card; nothing else currently does.

   **A defect the 3,000-test suite could not see, found by the live dry-run.**
   `QuizAnswer.mode` stores a `QuizMode` (`short-answer`); `AnswerKlpResult.mode` and the
   whole memory layer store a `StudySource` (`quiz-sa`). The planner reasons in
   `StudySource`, and the loader compared the raw column — matching nothing, so every
   short-answer answer fell to the carry-only branch and had its evidence DROPPED instead of
   re-graded. That is the exact damage this job exists to repair, caused by the repair. Every
   unit test passed because they were written with `quiz-sa`, which is what the RESULT rows
   use. Fixed via the existing bridge in `src/lib/quiz/mode.ts`; a test now pins that every
   `QUIZ_MODE` classifies only after translation, and that the raw values do not.

3. **Phase A, plus numeric consistency.** Needs R4's renaming, adds R6.
4. **The synthetic panel, replacing the three adversaries.** Before C3 and C4, not after — it is the
   only change that makes revisions comparable, and C3/C4 are revision-generating machines.
5. **C3 and C4**, with R5's shortlist and R2's greedy loop. Last, because they matter most on long
   sets and current sets are short (median 6–9 KLPs).

## Related, already built

- Exact-hash KLP reuse: `npm run reuse-klps`, `src/lib/klp/reuse.ts`
- Three-measure discrimination check: `npm run klp-stats`, `src/lib/klp/discrimination-stats.ts`
- Weight histogram: `npm run klp-histogram`
- Benchmark record: `docs/ai/model-performance.md`
