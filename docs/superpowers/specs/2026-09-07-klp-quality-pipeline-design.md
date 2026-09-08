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

## Discrimination: replace the three adversaries with a synthetic panel

| Shipped today | Synthetic panel |
| --- | --- |
| 1 reference + 3 adversaries by *kind of failure* (`confident_wrong`, `vague`, `memorized_template`) | 5 answers by *level of competence*: L4 expert, L3 competent, L2 partial, L1 confused, L0 off-target |
| One number: `reference − best wrong` | A curve, and a diagnosis from its shape |
| Adversaries regenerated every revision | Panel is **fixed** — a reusable regression suite |

### Three things it buys

1. **L3 is the near-miss that does not currently exist.** Measured 2026-09-07: AUC = 1.000 for every
   model — the reference outranks every adversary every time. `bestWrongScore` uses `max`
   specifically to catch an answer that nearly passes, and nothing is nearly passing.
2. **Monotonicity is a free, stronger test.** Five ordered levels should score in order; an
   inversion is a defect the single-gap test cannot express.
3. **A fixed panel is a regression suite — and its absence is a real flaw in what is shipped.**
   The current loop regenerates adversaries on every revision, so a revised set is tested against
   *different* wrong answers. A rising separation score cannot distinguish "the edit improved the
   item" from "the new adversaries were weaker". **This is the strongest argument for the change**,
   and no additional statistic on top of the current design can fix it.

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

1. **C1 alone, read-only, over the existing bank.** One prompt, no infrastructure. Answers whether
   the quality problem is coverage holes or something else, in an afternoon. **Ship R3's stated bar
   in the prompt from the start** or the output is unfalsifiable.
2. **The background re-grade job, before writing any auto-fix.** Re-grade a card's stored answers
   against its new KLPs, then `rebuildKlpStates`. This is what makes every auto-fix safe, so it
   comes first — building checks that mutate KLPs before this exists is how the evidence-wipe
   ships. Handle MC/TF by carrying forward or dropping, never by inferring. Closes R1.
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
