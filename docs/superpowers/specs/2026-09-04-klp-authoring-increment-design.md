# Spec 2, increment A — grain, ordering, and evidence-based weight

**Date:** 2026-09-04
**Status:** BUILT and FIRST-CARD VERIFIED 2026-09-04. See §9 for the pilot output read against the
owner's own criticisms — all five are addressed on the exact card that prompted them.
**Amends:** `docs/superpowers/specs/2026-09-04-klp-authoring-pipeline-design.md` (Spec 2, built)
**Trigger:** the owner's review of the first real pipeline output — one LBO card, 5 KLPs, separation 0.70.

## What prompted this

The one card that completed before the quota wall produced KLPs that were, in the owner's words,
"right & decent but seems like they could be improved." The specific criticisms are the whole
content of this increment, so they are recorded verbatim rather than paraphrased:

- The claims on debt were "slightly inaccurate and weren't in order."
- On KLP[1] — *"A smaller initial equity outlay increases return metrics like IRR by reducing the
  calculation's denominator"* — "it's not explained clearly" and "it's overkill since you just
  calculate IRR based on % change from original."
- That point "should also be at the end & state that IRR is the return answering the original
  question asked why P/E firms use leverage & how leverage amplifies returns."
- "The beginning should also talk a bit more about how the equity outlay is reduced from taking on
  debt as a funding source."
- "Overall I think it should follow the 'answer' given in the flashcard (has all the general content
  — is obviously terse so each point should be expanded + new points should be added)."
- A request for "an extra layer of AI that sort of determines how detailed the answer should be /
  how many KLP layers it needs to have (starting from a base of 4+ KLPs)."

Two of these are grain problems, two are ordering problems, and one is a sizing problem. A separate
observation from the same card — weights of 2,1,2,1,1 — turns out to share a root cause with the
ordering issue, which is why they are one increment rather than four.

## 1. Weight: blast radius alone does not work on every card shape

**The observation.** The pilot card produced only two relations across five KLPs, so
`weightFromBlastRadius` yielded just two distinct values. That looked like the relate call
under-performing.

**The diagnosis is different, and it changes the fix.** "Why do LBOs use leverage?" is an
**enumeration** — several parallel value drivers, which genuinely do not depend on one another. The
worked example this design was built around ($10 depreciation) is a **derivation chain**, where each
step consumes the previous one's output. Blast radius measures dependency depth. A chain has depth;
a list does not.

So two edges is very likely *correct* for that card, and pushing the relate prompt to find more
would manufacture false dependencies. A fabricated `causes` edge is strictly worse than a flat
weight, because Spec 3 will serve grading probes for a link that does not exist.

**The fix: use the centrality signal already being collected and discarded.**

Call B produces a verdict matrix: every candidate answer × every KLP. That matrix already says how
many of the three adversaries failed each KLP. A KLP all three miss is load-bearing. One only the
vague answer misses is peripheral. That is centrality measured by *evidence*, not by opinion — and
it costs nothing, because the matrix is computed for the discrimination test regardless.

    discriminationBreadth(klp) = (# wrong answers that FAIL it) / (# wrong answers)
    weight = clamp(round(w_graph · blastRadiusTerm + w_evidence · breadthTerm), 1, 5)

Both terms are computed in TypeScript from categorical inputs, preserving the rule that the AI never
computes a score. On chain-shaped cards the graph term dominates; on enumeration cards the evidence
term carries it. **This is what actually closes G1**, because the current formula can only close it
for one card shape.

Weights on the two terms live beside the other authoring thresholds so they are tunable in one edit.
Starting point: equal weighting, revisited against the first real histogram.

## 2. Authoring is anchored to the card's own answer

**Today** `AUTHOR_KLPS_PROMPT` receives `term` and `definition` and writes a reference answer
essentially freely. That is how "slightly inaccurate" claims about debt got in: nothing binds the
model to content the owner has already vetted.

**Change:** the card's definition becomes the SKELETON, not a hint.

1. Expand each point the definition already makes — it is terse by nature, and each point deserves
   the elaboration a strong spoken answer would give it.
2. Then add what a strong answer needs and the card omits.
3. Do not contradict the definition. Where the definition is incomplete, extend it; where it appears
   wrong, say so in a `concerns` field rather than silently rewriting it.

That last part matters: a pipeline that silently "corrects" the owner's own cards is worse than one
that flags them, because the owner never learns their card was wrong.

## 3. Ordering becomes semantic, and is cross-checked

**Today** `CardKlp.index` is array position and carries no meaning.

**Change.** KLPs are ordered as a strong answer delivers them: **setup → mechanism → payoff**, with
the final KLP explicitly landing the answer to the question that was asked. The owner's example is
exactly this shape — open with how taking on debt reduces the equity outlay, close with IRR being
*the return*, which is what "how does leverage amplify returns" actually asks.

**And it can be checked mechanically, with machinery already built.** Order-violation extraction
(design §5) produces `precedes` edges: pairs whose derivation order cannot be swapped. If a
`precedes` edge points backwards against the stored index order, the KLPs are mis-sequenced. That is
a real defect, detectable with no extra AI call, and it joins `validateKlpSet`'s existing rules.

A caveat kept deliberately: `precedes` covers only pairs where the later point *consumes* the
earlier one's output. It says nothing about the setup/payoff framing, which stays a prompt
instruction and is not mechanically enforceable. The check catches contradictions, not blandness.

## 4. Phrasing: prefer the practitioner's framing

The owner's critique of the denominator phrasing is a clarity defect, not an accuracy one — the
claim is technically defensible and pedagogically poor. This is hard to detect mechanically and
easy to demonstrate, so it goes into the prompt as an explicit contrast pair, using the owner's own
example:

- **Not:** "increases IRR by reducing the calculation's denominator"
- **But:** the return is measured against a smaller equity base, so the same dollar gain is a larger
  percentage return

Concrete negative examples move model output far more reliably than abstract instructions to "be
clear," which is why this is a prompt change rather than a validator.

## 5. Sizing: adaptive, and folded into the existing call

The owner asked for "an extra layer of AI" that sets the target KLP count from (1) question length,
(2) sample answer length, and (3) the detail each point of the sample answer needs, floored at 4.

**The intent is right; a fifth AI call is the wrong delivery.** The pipeline is already 6-16 calls
per card, and the pilot proved that volume is above a free-tier quota for a *single* card. A
dedicated call to choose a number is the worst cost-to-value ratio available.

**Design.** Inputs 1 and 2 are free in TypeScript — they are lengths, plus a count of distinct
clauses in the definition. Input 3 needs judgment, but the author call is *already reading the
definition*, so it returns a per-point detail assessment alongside the reference answer.

    target = max(MIN_KLPS_FLOOR, mechanicalPrior, modelAssessment)   // MIN_KLPS_FLOOR = 4

`MIN_KLPS_PER_CARD` drops from 5 to 4, per the owner's "base of 4+". `MAX_KLPS_AUTHORED` stays 9.

**The cost of adaptiveness, stated plainly.** A fixed 5-9 range made the count itself a weak quality
signal — a card returning 3 was visibly under-authored. An adaptive target removes that signal: 4
KLPs might now be correctly small or quietly thin. The discrimination test remains the real check,
and the sizing layer only sets the expectation. Anyone reading a low count in the staff view should
read the separation score beside it, not the count alone.

## 6. What this does not change

- The isolation guarantee (design §1.1). Candidates stay graded in their own calls.
- The separation score, `SEPARATION_FLOOR`, or the revision cap.
- The AI never computing a score.
- The relation vocabulary, the prune rule, or acyclicity.
- The legacy extraction path, which still serves new cards until Spec 4.

## 7. Verification

**What was built, and what the pure-function tests actually pin** (added 2026-09-04):

- `src/lib/klp/histogram.ts` + `npm run klp-histogram` + the same histogram at the end of every
  `author-klps` run. Built FIRST, ahead of everything else in this document, because a check that
  lands after the corpus is rewritten cannot be acted on. **Run against the live corpus the day it
  was built: 272 live KLPs on 124 cards, all legacy — 92.3% at weight 4-5, mean 4.54, 62.5% at the
  single value 5; authored slice empty, confirming independently that no pilot output was ever
  persisted.** The three failure modes are `clustered_high`, `clustered_low` and `uniform`, and all
  that fire are reported rather than one verdict. A **discrimination-breadth histogram** is printed
  beside the weight one so an operator can tell WHICH term is flat when weights come out flat —
  rebalancing the formula against a flat breadth input would be tuning against broken adversaries.
- `discriminationBreadth` (`separation.ts`) and `weightFromSignals` (`relations.ts`), with the term
  weights injectable and defaulting to `authoring-config.ts`. A test pins that the blend REDUCES to
  the old `weightFromBlastRadius` when the evidence term is weighted out, so this is demonstrably a
  generalisation rather than a silent re-scaling of every weight already written. Both the
  chain-shaped and the enumeration-shaped fixture are tested, the second being the case the previous
  formula fails.
- `src/lib/klp/sizing.ts`, `findOrderingDefects` (`validate.ts`), and `AUTHOR_KLPS_PROMPT` /
  `REVISE_KLPS_PROMPT` at **version 2** — `promptVersion` is persisted, so rows written before and
  after this increment stay distinguishable.

**One consequence discovered during the build, not anticipated by §1.** Because the two terms are
weighted to sum to 1, a KLP reaches weight 5 only by scoring high on BOTH — so a purely
enumeration-shaped card, which has no graph term to score on, tops out at **3** under equal
weighting. That matters beyond this file: `computeSignificance` uses weight as `relevance` and
aggregates across cards, so a corpus of only enumeration cards could not produce a top-band error —
the mirror image of G1, where nothing could score low. It is pinned by a test rather than left to be
rediscovered, and it is the specific thing to look for in the first real histogram: **weights
clustered at 2-3 in the authored slice mean the ceiling, not a failing evidence term.** Check the
breadth histogram before rebalancing.

### Original verification plan

Pure functions first, as before: `discriminationBreadth` against a matrix where all three adversaries
fail one KLP and only one fails another; the combined weight formula showing a real spread on BOTH a
chain-shaped and an enumeration-shaped fixture — the second being the case the current formula fails;
the `precedes`-versus-index contradiction check in both directions; and the sizing prior against a
one-line definition and a six-clause one.

The real verification is the same as before and is still owed: a pilot run, read in `/staff/klps`,
with a **weight histogram**. The histogram is the acceptance criterion for §1 — if weights still
cluster at 1-2 after this increment, the evidence term is not doing its job and the formula needs
rebalancing before Spec 4 walks the corpus.

## 8. Out of scope

- Anything in Spec 3 (serving relation probes, verdict storage, the DAG).
- The full corpus walk (Spec 4).
- The communication/clarity dimension, deferred at the owner's explicit instruction.
- Re-authoring `Accounting - Knowledge`. That remains the acceptance run and the owner's call.

## 9. Pilot output, read against the criticisms that prompted this (2026-09-04)

The card is the same one §"What prompted this" quotes: *"Why do LBOs use leverage? How do they use
leverage to increase returns?"* Run on `gemini-3.5-flash` (the default `gemini-3.6-flash` was out of
its daily bucket — see the quota note below). Separation **0.63**, 0 revisions, 4 KLPs, 4 relations.

| The owner's criticism | What the increment produced |
| --- | --- |
| "the claims on debt … weren't in order" | KLP order is now setup → mechanism → mechanism → payoff: reduce the equity cheque; cash flows pay down principal; paydown converts EV into equity value; the return is measured against the smaller base. |
| "[the IRR point] should be at the end & state that IRR is the return answering the original question" | KLP[3] is last and ends "…yielding a much higher percentage return (IRR)". |
| "it's not explained clearly … overkill since you just calculate IRR based on % change from original" | The word *denominator* is gone. The KLP reads "measured against a significantly smaller initial equity base" — the contrast pair in §4 landed verbatim. |
| "the beginning should talk a bit more about how the equity outlay is reduced from taking on debt" | KLP[0] is exactly that, and is now first. |
| "should follow the 'answer' given in the flashcard … each point expanded + new points added" | The reference answer tracks the definition's points in order and extends them; §2's skeleton rule. |

**The `concerns` field earned its place on its first run.** It returned: *"The card says leverage
decreases the 'upfront capital required.' To be precise, it decreases the upfront **equity** capital
required; the total transaction capital (purchase price) remains exactly the same."* That is a real
precision error in the owner's own card, surfaced rather than silently patched — which is the whole
argument for the field.

**Relations went from 2 to 4** on the same card, including a `precedes` edge (1 → 2) that agrees
with the stored order, so the §3 cross-check passed rather than merely not running.

### The weight ceiling, now measured rather than predicted

Weights came out **3, 3, 3, 2**. Working it through: radii `[1,1,0,0]`, breadths
`[0.67, 0.67, 1.0, 0.33]`.

Both terms are doing their job — the breadth histogram spans three distinct values, so the evidence
term is emphatically not flat. **The averaging is what collapses them.** KLP[2], the only point all
three adversaries failed, is the most load-bearing claim on the card, and equal weighting hands it
the same 3 as two KLPs that scored lower on breadth but happen to have one dependent each. The two
signals disagree and the mean lands in the middle.

This is the §1 ceiling arriving exactly as the tests predicted, and it is now backed by a real card
rather than an argument. **Recommended rebalance, for the owner's call:** take `max(graphTerm,
breadthTerm)` rather than a weighted mean. On this card that yields **4, 4, 5, 2** — three distinct
values spanning 2-5, with the universally-failed KLP correctly at the top. It also matches what §1
already says the design intends ("graph term dominates on chains, evidence term carries
enumerations"): `max` is precisely "whichever signal has something to say about this KLP", where a
mean is "both signals must agree before anything can be important". Not applied unilaterally —
`weightFromSignals` takes its term weights as an injectable parameter so the change is one config
edit plus one test.

**Do not read the single-card histogram as evidence of clustering.** Four KLPs across five buckets
cannot distinguish clustering from noise, and the check now says so instead of firing `uniform` —
see the sample-floor note below.

### Two defects this run found, both fixed

1. **The daily-quota classifier was wrong, and it cost seven minutes per attempt.** Google's free
   tier is **20 requests per day, per model** (`GenerateRequestsPerDayPerProjectPerModel-FreeTier`),
   and it returns that cap with a **34-second** retry hint. The pacing code's only discriminator was
   the hint's magnitude, so it honored the hint and retried a limit that resets tomorrow, halting
   with "rate limit did not clear" — which reads as transient. The 429 carries a
   `google.rpc.QuotaFailure` detail naming the period outright; `parseQuotaViolation` now reads it
   and halts on the first failure, naming the model and the limit.
2. **The histogram fired a FAIL on four data points.** `uniform` at 75% of four KLPs is arithmetic,
   not evidence — and since a single card carries 4-9 KLPs, it would have fired on essentially every
   run summary an operator ever saw. Findings now require `HISTOGRAM_MIN_SAMPLE` (20); below it the
   shape is printed without a verdict.

**Consequence for the pilot, worth stating plainly:** at ~6 calls per card against a 20/day
per-model cap, one model authors roughly **three cards a day**. A 10-card pilot therefore needs
either several models rotated via `KLP_DIRECT_MODEL` (each has its own bucket — verified working on
`gemini-3.5-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-2.5-flash`), several
days, or a paid tier. Rotating models is fine for the weight histogram, which is model-independent
given the verdicts and edges, but it is a confound for judging authoring QUALITY across cards, and
the model used is not recorded on `CardAuthoring`.
