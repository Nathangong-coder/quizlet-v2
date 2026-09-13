# The rebuild test — replacing the reference score

**Status:** designed 2026-09-12 with the owner, NOT built. Replaces `referenceScore` /
`referenceVerdicts` as the authoring pipeline's measure of whether a key-point set is
complete and faithful. Builds on the three-family rotation (`--rotate`, built the same day).

## Why the reference score has to go

Today: model 1 writes a reference answer, extracts the key points FROM it, and the grader
checks whether that same answer satisfies those points. It is circular by construction.
It catches a key point the answer does not state (a hallucinated point) and nothing else —
a set that omits how sponsor equity works scores 1.00 because the reference omitted it too
(the owner's sources & uses example, Part F of `docs/ai/model-performance.md`). The number
says "consistent", and reads as "complete".

## What the owner wants measured

Whether the key points, on their own, carry what the CARD says the answer is — and whether
they lost anything the writer knew. Not whether a rebuilt answer reproduces the points
(the owner ruled that out: "not reconstruction fidelity").

## The three roles

Extends the rotation's families rule: writer, rebuilder and grader from three different
families (google / cn = {DeepSeek, GLM} / qwen), so the grader never wrote the answer, the
points, or the rebuild.

1. **Writer (model 1)** — as now: reference answer, `definitionPoints` (the owner's
   definition split into its points), key points, revisions.
2. **Rebuilder (model 2)** — receives ONLY the question and the key points. Never the
   reference, never the card's definition (the owner: "not fair if it gets the definition").
   Writes the best answer those points can build — reorder, connect, phrase; add nothing.
   Output: `rebuiltAnswer`. This is the instrument: if the points are sufficient, the rebuild
   is a strong answer; if they are steps rather than propositions, or missing a concept,
   it shows here.
3. **Grader (model 3)** — grades the rebuild TWICE, categorical verdicts only; every score
   is computed in TypeScript (the AI never assigns a number — the project's standing rule):
   - **`cardCoverage`** — the rebuild against the card's `definitionPoints`
     (`correct | partial | missing` per point). Share of the owner's points the rebuild
     establishes. **This replaces `referenceScore`** and is the number the quality bar
     reads: below the bar (proposed 0.8), revise with the missing points named.
   - **`referenceParity`** — the rebuild against the claims of model 1's reference answer
     (the grader lists the reference's claims, then marks each `present | partial | absent`
     in the rebuild). `1 − referenceParity` is EXTRACTION LOSS: what the writer knew that
     never made it into a key point. This is where "sponsor equity is the plug" surfaces
     when the writer said it and the points dropped it.
   - **`cardDisputes`** — the override channel. When grading against the card, the grader
     may find the rebuild (or the reference) CONTRADICTS a card point and judge the answer
     right and the card wrong. It records `{ point, cardSays, answerSays, reason }`. The
     dispute is a WARNING surfaced to the set owner on the card and in the run summary; it
     never changes a score, never edits the card, never silently accepts the answer. The
     owner: "rare, brought up with the set owner as a warning, not to be used unless it is
     a special situation." The existing `concerns` channel (writer disagrees with the
     card) stays; disputes are the grader's version of it, from a different family.

## What is persisted

`CardAuthoring` gains `rebuiltAnswer` (text), `cardCoverage` (float), `referenceParity`
(float), `cardDisputes` (JSON, usually `[]`), and the two verdict lists as JSON so a formula
change can recompute history — the same rule `AnswerKlpResult` follows. `referenceScore`
stays on old rows as history; new rows write null there. `klpHistogram` and the smoke test
are unchanged (the smoke test's `rejects_reference` reads the reference's verdicts against
the points, which remain graded — as `klpFidelity`, demoted from a score to a check).

## Cost

Three calls more per card: rebuild, coverage grade, parity grade. On the rotation that is
one call on the rebuilder's family and two on the grader's.

## Known limit, stated so it is not rediscovered

The rubric is the card. A definition that lists "equity contribution" without the plug
mechanic cannot fail a rebuild that lists equity as a line item. Two consequences: the
fix for that class of miss is the card's definition or notes — the vetted layer — and
`referenceParity` is the metric that catches it WHEN the writer knew more than the card.

## Build order

1. `WRITE_REBUILD_PROMPT` (question + key points → answer), `GRADE_COVERAGE_PROMPT`
   (rebuild vs definition points, with the dispute field), `GRADE_PARITY_PROMPT` (rebuild
   vs reference claims). Version 1 each; tests pin that the rebuild prompt never receives
   the definition or the reference.
2. `rebuildScores()` in TypeScript: coverage, parity, disputes from the two verdict lists.
3. `authorCard`: rebuild after the key points settle (after revisions, before relate), a
   `REBUILD_COVERAGE_BAR` in the quality bar with missing points named for the revise call.
4. Migration adding the columns; `persistAuthoring` writes them; `/staff/klps` shows
   coverage, parity and a dispute badge.
5. Run on the three bench cards under `--rotate` and compare against the reference scores
   they carry today.
