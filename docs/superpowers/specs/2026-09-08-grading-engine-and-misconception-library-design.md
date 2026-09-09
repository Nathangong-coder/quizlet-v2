# Grading engine, accuracy signatures, and the automatic misconception library

**Status:** design, 2026-09-08. Not built. Written after the KLP hygiene work
(C1–C4, the competence panel, the negative check) established what key points
can and cannot do.

**Companions:** `docs/ai/error-taxonomy.md` (frozen vocabulary),
`docs/superpowers/specs/2026-09-07-klp-quality-pipeline-design.md` (hygiene),
artifact "Mistake Detection Engine" tabs 01–02 (gaps G1–G10, insight pairings).

---

## 0. The premise this rests on, and why it changed

The quality pipeline was built on the assumption that key-point quality was the
bottleneck on diagnosis. Three measurements say otherwise:

| Measurement | Result |
| --- | --- |
| C1 exploit test, 20 cards, calibrated | 10% of cards had a verified coverage hole; **zero** omission holes; every survivor was a *contamination* |
| Discrimination AUC, 130 authoring runs | **1.000 on 129** — saturated |
| Panel per-point shapes, 49 real points | **96% healthy** |

And one structural fact, verified in code: **a key-point set is a conjunction of
positive requirements.** It can say what an answer must contain. It cannot say
"and nothing false was asserted", and no point can be added to make it — you
would have to enumerate every falsehood.

> **So the division of labour is: a key point's job is to be true, atomic,
> independent and complete. Deciding *how* wrong an answer is, *what kind* of
> wrong, and *what to do about it* is a different system.** That system is what
> this document specifies.

---

## 1. The central design claim: diagnosis is longitudinal

**A single answer cannot distinguish a gap from a slip from a misconception.**
This is not a modelling weakness to be engineered around; it is a property of
the evidence. The same row — "failed KLP 3, type `inversion`" — is produced by:

- a learner who has never understood the direction (**misconception**)
- a learner who knows it and mis-spoke under time pressure (**slip**)
- a learner who never encountered it (**gap**)
- a learner blocked by a missing prerequisite (**blocked** — already computable,
  `src/lib/klp/prerequisites.ts`)

Today the engine tries to answer this per answer and therefore cannot. Every
diagnosis below is computed over a learner's **history on one KLP**, never over
one row.

This is also why the misconception engine that already exists
(`src/lib/metrics/misconceptions.ts`) is the right shape and the wrong scope: it
promotes a conflation at ≥2 occurrences across ≥2 sessions — longitudinal,
deterministic, decays honestly — but it only handles `conflation`.

---

## 2. Layer 1 — Capture. Two holes, both known

Capture is mostly built: per-KLP verdicts, closed-vocabulary error tags,
significance computed in TypeScript, `analysisStatus` distinguishing "clean"
from "could not analyse". The negative check now docks credit when an answer
adds a falsehood.

**Hole 1 — self-rated confidence (gap G3).** Nothing records what the learner
thought they knew *before* the answer was revealed. Without it,
**wrong-and-certain cannot be told from wrong-and-guessing** — and those are a
misconception and a gap respectively, the single most valuable split in this
document. A three-state tap (`guessing / think so / certain`) on the answer row.

**This is the highest-value unbuilt capture in the system and it blocks §3.**
It is also the only one that is unrecoverable: every week it is not captured is
a week of history that can never be classified.

**Hole 2 — follow-ups (gap G9).** A `partial` verdict is three different
learners with the same row: knows-it-said-it-badly, half-knows-it,
guessed-adjacent. One targeted follow-up on the specific point that came back
partial resolves more uncertainty per token than any formula change here.

---

## 3. Layer 2 — The accuracy signature

**An accuracy signature is a label on a `(learner, klpId)` pair, derived in
TypeScript from persisted evidence.** The AI never assigns one. This is the same
division the engine already enforces for significance and mastery, and for the
same reason: a model asked "is this a misconception or a gap?" produces a
plausible answer with no stable anchor, and the label would then be
indistinguishable from a measured one once written.

### 3.1 The vocabulary

Closed, like the error types. Specificity lives in the target, never the label.

| Signature | Derived from | Intervention it implies |
| --- | --- | --- |
| `gap` | omission-dominant, low pKnown, **low self-rated confidence** | Instruction, then spaced retrieval |
| `misconception` | repeated *same wrong content* across ≥2 sessions, **high self-rated confidence** | Confrontation — elicit, predict, contradict, reconcile |
| `slip` | isolated failure amid passes, high pKnown, latency at or below baseline | Nothing. Do not surface it |
| `brittle` | passes recognition (MC/TF), fails production (SA) on the same KLP | Same concept, many surface forms, spaced |
| `boundary` | `misapplication` clustered on a KLP with an `applies_within` edge | Edge cases and counterexamples |
| `blocked` | failure explained by a failed prerequisite (`requires` edge) | Fix the prerequisite; do not drill this |
| `contaminated` | passes every KLP **and** carries a whole-answer accuracy tag | The negative check's finding — see §3.3 |
| `unstable` | verdicts flip on re-grade of the same answer | **Not a learner signature at all** — see §5 |

`unstable` sits in the same vocabulary deliberately, because the read path must
be able to say "we cannot classify this" rather than picking the nearest label.
It is the equivalent of `analysisStatus: no_provenance` one layer up.

### 3.2 Two signatures are computable today, with zero new capture

- **`brittle`** — `AnswerKlpResult` already stores `mode` and `klpId` on every
  row. Grouping one KLP's verdicts by mode and comparing recognition against
  production is a query against data that has been accumulating this whole time.
  The artifact calls this "the cheapest real insight available"; nothing
  computes it.
- **`blocked`** — `attributeBlame` is built and tested. It needs `requires`
  edges, which `klp-independence --write` now produces.

Everything else needs §2's confidence capture, or volume.

### 3.3 `contaminated` is the answer to "hits all the KLPs but adds something wrong"

This is already half-built. `contaminationFactor`
(`src/lib/errors/contamination.ts`) docks key-point credit when an answer
carries a whole-answer accuracy tag, and it is cross-model validated: 11 of 15
real contamination exploits caught, graded by a different model than wrote them.

**What is missing is that it produces no signature.** A learner who repeatedly
satisfies every point and repeatedly adds the same falsehood has a
misconception; today that is recorded as a credit dock and an error tag, with
nothing joining them across sessions. The corpus already holds 2 whole-answer
accuracy tags — both written by the re-grade pass — and nothing reads them.

> **Proposal: promote a repeated whole-answer accuracy tag exactly as a repeated
> conflation is promoted today** — ≥2 occurrences across ≥2 sessions, retiring
> after 30 days or 3 clean answers. The machinery is `deriveMisconceptions`;
> what changes is the predicate feeding it, from `type = 'conflation'` to
> "accuracy tag, whole-answer or KLP-targeted".

**The honest limit, measured:** the negative check catches what the *grader*
knows is false. The 4 misses in the probe were subtle domain claims ("DSCR is
mostly used for real estate"). No amount of scoring fixes that; it needs the
curated library of §4 as ground truth.

---

## 4. Layer 3 — The misconception library

### 4.1 Two populations that must never merge

| | **Observed** | **Curated** |
| --- | --- | --- |
| Origin | derived from real learner tags | written by a human, or seeded |
| Evidence | occurrence counts, sessions, verbatim quotes | none — it is an assertion |
| Decays | yes, on clean answers | no |
| Can be wrong about a learner | no — it is a record | yes — it is a prediction |

**They must be schema-distinct.** A curated entry mistaken for measured evidence
would let a seeded belief inflate a learner's misconception profile without that
learner ever having demonstrated it — the same fabrication the engine refuses
everywhere else. This is already the queue's Spec 8 position; it is restated
because the automatic library makes the temptation to merge them stronger.

### 4.2 Scope: keyed to the set, origin recorded per card

The user's framing, and it is right. A misconception is a property of the
**subject matter**, not of a card — "confuses accretion/dilution with EPS
impact" is the same error wherever it surfaces. But the *first place it was
seen* is a card, and that card is what a probe or a lesson needs.

```
MisconceptionEntry
  setId          the study unit — where it is surfaced and drilled
  originCardId   where it was FIRST observed. Never overwritten
  klpId          the point it attaches to
  secondaryKlpId conflation only: the point it was confused WITH
  kind           'observed' | 'curated'      <- the hard partition
  signature      the accuracy signature that produced it
  occurrences / sessionCount / lastSeenAt    observed only
  statement      curated only: the false belief, in the learner's voice
```

`originCardId` is never overwritten, for the same reason `CardKlp` versions
rather than mutates: the record of where something came from is what makes it
auditable later.

### 4.3 The library is a generator, not just a reference

This is the leverage, and it is already noted in the artifact: **a curated
misconception is a high-quality corruption.** The distractor pipeline generates
options by corrupting one named KLP in one named way; a curated misconception is
exactly that, written by someone who has seen real learners hold it.

So the same rows serve three jobs:
1. **Diagnosis** — does this learner hold it?
2. **Distractors** — a better wrong option than a model invents.
3. **Follow-up probes** — the targeted question that disambiguates a `partial`.

### 4.4 Cold start, honestly

An automatic library has nothing on day one, and the corpus has **18 quiz
answers, 13 with text** — nowhere near enough to derive anything. Three sources,
in order of when they become available:

1. **Authoring already produces them for free, and they are already in the
   database — verified 2026-09-08: 130 `confident_wrong` probes.** Every
   authored card carries one: a plausible, specific, wrong answer with per-KLP
   verdicts attached. They are misconceptions in everything but name. A sample,
   taken verbatim:

   > *"LBOs use leverage because debt has a cheaper cost of capital than equity,
   > which directly lowers the company's WACC. By lowering the WACC, the firm's
   > intrinsic enterprise value is automatically maximized during the holding
   > period."*

   That is a real, common, confidently-held belief with a specific false
   mechanism — exactly what a curated entry would say, written months ago as a
   by-product of discrimination testing and never read since. **This is the
   cheapest seed available by a wide margin.**
2. **C1's exploit corpus.** `docs/ai/klp-exploit-*.json` holds contamination
   exploits — answers that satisfy every point and assert something false, with
   two independent graders agreeing. That is precisely the shape §3.3 wants.
3. **Curated content from the user**, which the queue has been waiting on.

---

## 5. Unbiasedness: how this avoids being an opinion with a schema

The user asked for this specifically, and it is the part most likely to be
skipped. Four mechanisms, in increasing cost.

### 5.1 The AI never assigns a signature (free)

Already the rule for significance, mastery, weight and separation. Extended
here. The model supplies categorical judgments about *one answer*; TypeScript
derives every label from *history*. A model cannot see a learner's history and
should not be asked to.

### 5.2 Grader stability — the cheapest real bias check, still unbuilt

Re-grade a sample of answers with the same model and count verdict flips.

**This deserves more weight than its position suggests, and the reason is that
its failure is invisible everywhere else.** An unstable KLP looks exactly like a
mediocre one to every aggregate: point-biserial, hit rate and entropy all
misdiagnose it, and each suggests a different wrong fix. Stability is the only
measurement that separates "ambiguous wording" from "genuinely hard", and it
costs one re-grade of a sample.

**It is also a prerequisite for §3's signatures.** A `misconception` is "the
same wrong content, repeatedly". If the grader is unstable, repetition is noise
and the library fills with artefacts of grader variance.

### 5.3 Cross-model validation (cheap, already demonstrated)

The pattern is built and proven twice in this codebase:

- The **negative check probe** graded DeepSeek's exploits with Gemini — 11/15.
- **C1's role separation** has the attacker, the verifier and the blind judge as
  three distinct roles, with the verifier preferring the model that *authored*
  the key points, because the author is motivated to defend its own
  specification.

**Extend it to signatures:** any answer that produces a `misconception`
signature should have its triggering verdict confirmed by a second model before
the entry is promoted. Promotion already requires ≥2 occurrences; requiring that
at least one be cross-model confirmed costs one call per promoted entry — rare
by construction — and stops a single model's idiosyncrasy from becoming a
recorded belief about a person.

### 5.4 A held-out, human-labelled set (the real unlock)

Everything above measures *consistency*. Only human labels measure
*correctness*.

~50 answers spanning correct / partial / vacuous / confidently-wrong /
off-topic, each with a human verdict. Then:

- **Report agreement, not accuracy.** Cohen's kappa, which corrects for
  agreement by chance — most answers are neither perfect nor worthless, and raw
  accuracy inflates on the easy middle.
- **Grade the graders first.** If two humans agree at 0.6, a model at 0.6 is at
  the human ceiling, not failing. Without the inter-rater number there is no way
  to tell those apart.
- Blind, shuffled, ≥3 samples per cell.

**The second life of that set:** its confidently-wrong answers are better panel
members and better misconception seeds than anything a model writes.

---

## 6. "Pass discrimination checks in the real world"

Offline discrimination is a filter for obviously-broken points. The real
measurement is **online item analysis**, and it needs volume this corpus does
not have (~50 responses per KLP; the corpus has 18 answers total).

| Quantity | Reads | Threshold |
| --- | --- | --- |
| Point-biserial | correlation between hitting this KLP and overall strength on its concept | <~0.15 dead weight; **negative is a fidelity alarm** |
| Hit rate | fraction of answers satisfying it | >0.95 or <0.05 is no variance, therefore no information |
| Verdict entropy | spread across categorical verdicts | only-correct-or-absent is a binary not earning its cost |
| Grader stability | re-grade a sample, count flips | see §5.2 |

0.15 and 0.05/0.95 are classical-test-theory conventions, not laws — tune them
against this corpus the way the severity bands were.

**Endpoint: Item Response Theory.** Fit each KLP a difficulty and a
discrimination parameter from real responses by maximum likelihood — the same
quantity separation approximates, measured against humans instead of synthetic
adversaries. The data accumulates in `AnswerKlpResult` whether or not anything
reads it.

---

## 7. What order to build this in

Ordered by what unblocks what, not by size.

1. **Self-rated confidence capture (§2).** Days of work, blocks nothing, and
   nothing blocks it. Every week it waits is unrecoverable history. It is the
   difference between `gap` and `misconception`.
2. **Grader stability (§5.2).** One re-grade of a sample. Prerequisite for
   trusting any repetition-based signature.
3. **`brittle` and `blocked` signatures (§3.2).** Zero new capture; both are
   queries over data already stored.
4. **Seed the library from authoring probes and C1 exploits (§4.4).** Also zero
   new AI cost — 130 pre-written candidates are sitting in `AuthoringProbe`.
5. **Promote whole-answer accuracy tags into misconceptions (§3.3).** Reuses
   `deriveMisconceptions`; changes a predicate.
6. **Follow-ups (§2, gap G9).** The largest new capability, and the thing that
   resolves a `partial`.
7. **The human-labelled set (§5.4).** The only one that needs people, and the
   only one that turns consistency into correctness.

**Deliberately not scheduled:** the communication split (G6) — still waiting on
a design for diagnosing expression failures on their own terms; and IRT, which
needs two orders of magnitude more answers than exist.

---

## 8. Open questions this design does not settle

Stated plainly rather than papered over.

- **Whether a `misconception` can be distinguished from a `gap` without
  self-rated confidence.** §3 assumes not, and that assumption drives the build
  order. If it is wrong, the ordering changes.
- **Whether the negative check's ceiling is acceptable.** It catches what the
  grader knows is false — 11/15 on a real sample. The curated library is the
  proposed floor under that, and it depends on content that does not exist yet.
- **Whether double-counting a blocked failure in BKT matters enough to fix.**
  `attributeBlame` identifies them; the mastery engine still steps both
  posteriors. The owner's judgment on 2026-09-08 was that it is liveable, and
  the fix requires changing `rebuildKlpStates` to see an answer's full result
  set. Recorded so the decision is visible rather than forgotten.
- **How a set-scoped library behaves for a learner studying two overlapping
  sets.** §4.2 keys entries to a set; the same misconception in two decks would
  be two rows. Deduplicating on `klpId` across sets is the obvious answer and
  needs the concept layer to be trustworthy first, which CLAUDE.md's own open
  note says it is not.
