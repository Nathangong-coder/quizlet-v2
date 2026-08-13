# Stage 8 Spec 3B — User-tunable scoring & targeting

**Date:** 2026-08-05
**Revised:** 2026-08-12 — see §0. Three build items landed between the original
draft and this revision, and two of them change what this spec must specify.
**Status:** design, revised against the code as it stands on branch
`spec3b-tunable-scoring`. Not built.
**Depends on:** Spec 3 (metrics substrate & learner profile) **and its hardening
pass** (`plans/2026-08-07-spec3-hardening.md`, landed 2026-08-08 — ten defects,
three of them criticals in the knowledge posterior). Do not design or build
against pre-hardening numbers.
**Sibling:** Spec 3C (learner dashboard)
**Plan:** `plans/2026-08-06-stage8-spec3b-tunable-scoring.md` (rebuilt 2026-08-08,
patched 2026-08-12 alongside this revision)

---

## 0. What changed since 2026-08-05, and what it costs this spec

Four things landed on this branch after the original draft. Each is recorded
here because the original text is wrong without it, not as a changelog.

**1. The knob set grew from two to five** (user-approved 2026-08-08). Bands and
strategy are joined by `MIN_OBSERVATIONS`, `ARTICULATION_MIN_PKNOWN` and
`READINESS_WEIGHT_PER_ANSWER`. The reasoning is the same one that motivates the
whole spec, applied one level down: *how much evidence justifies an opinion*
depends on how far out the interview is, so it is a learner's judgement, not a
constant in `bkt.ts`. The data model in §2 and the new §3.5 cover them.

**2. Deletion & forgetting shipped** (queue item 2, live-verified 2026-08-12).
Every erasure verb now routes through `planErasure`/`executeErasure` and deletes
the *evidence*, replaying `CardProgress` and `KlpState` from what survives. The
governing invariant is **no derived number may claim knowledge from evidence
that no longer exists**. Two consequences for this spec, both in §2.3: tuning is
a preference, not memory, so it is deliberately absent from
`ERASABLE_MEMORY_MODELS`; and because bands and thresholds are applied at read
time, erasure needs no tuning-aware step at all — the invariant is satisfied by
construction here.

**3. Empty quiz attempts were closed out** (queue item 2b, 2026-08-12).
`ANSWERED_ATTEMPT_WHERE` (`src/lib/quiz/history.ts`) now hides zero-answer
attempts at the two history read paths, one of which is **the `repeatBonus`
attempt window in `src/lib/metrics/read.ts`**. That makes the attempt sequence a
*filtered* population, which §3.4 must now match exactly on the results screen —
it is the difference between "one number everywhere" and two screens that
silently disagree. This is the single most important correction in this
revision.

**4. The live corpus is empty.** The 2026-08-12 account reset drove every memory
count to zero. There is no longer a thin corpus of 19 answers to tune against;
there is none. Nothing here can be demonstrated against real data until the user
studies again, which changes how §6 gates the work — and **synthetic study data
is still forbidden** (the posterior is incremental and not self-correcting, so
fabricated evidence does not cleanly come back out).

Unchanged and still true: `getLearnerMetrics` has **zero production callers**
(re-verified 2026-08-12). See §4.4 — it bounds what this spec can honestly claim
to ship.

---

## 1. Scope

Spec 3 ships the scoring model with fixed defaults. Spec 3B hands the knobs to
the learner:

- **Severity bands** — the `[floor, ceiling]` per error type from Spec 3 §2
  become editable (§3).
- **Metric thresholds** — the observation floor and the two articulation
  constants become editable (§3.5).
- **Targeting strategy** — the ordering Spec 3 §6.4 deliberately declined to
  pick becomes a selectable option (§4).
- **Read-time derivation on the quiz results screen** (§3.4), so a retune
  re-scores every surface rather than only the dashboard. Added 2026-08-06;
  without it the two views disagree the moment a band is edited.

All three panels live under **AI settings** (`src/app/settings/ai/`), as the
user directed. Worth noting for later: these govern TypeScript-computed scoring
rather than AI behaviour, so if that route ever narrows to strict credential
management, they move rather than being deleted.

The animating principle, stated by the user: ranking and weighting decisions
belong to the learner, not baked into a metric's definition. A metric that
hardcodes one ordering silently makes that call for everyone.

---

## 2. Data model

One row per user:

```prisma
model LearnerTuning {
  userId     String   @id
  strategy   String   @default("balanced")
  bands      Json?    // versioned, Zod-validated, SPARSE band overrides
  thresholds Json?    // versioned, Zod-validated, SPARSE threshold overrides
  version    Int      @default(1)
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

### 2.1 Blobs, not tables

Spec 2a argued the opposite for `AnswerKlpResult`/`AnswerErrorTag` — "a JSON
blob can't be indexed or FK'd, and Spec 3 aggregates these hardest" — and that
reasoning genuinely does not transfer. Tuning is never aggregated across users,
never joined, never filtered on. It is read wholesale for exactly one user at
the start of a computation. The applicable precedent is `SESSION_INSIGHT_VERSION`
(`src/lib/memory/insight.ts`): a versioned blob that readers parse with a Zod
schema and fall back on rather than rendering stale.

Overrides are **sparse** — only edited keys are stored, and the shipped defaults
fill the rest. A user who retunes one type does not freeze the other twenty
against future default improvements.

`strategy` is a column rather than part of a blob because it is a closed
vocabulary that ranking reads on every request, and an invalid value must be
caught at parse time rather than ranked with.

### 2.2 A resolved band table is always complete

`resolveSeverity` (`src/lib/errors/bands.ts:78`) does `input.bands ?? DEFAULT_BANDS`
— a **replacement, not a merge**. Hand it a partial table and every type missing
from it silently resolves to `FALLBACK_BAND` `[1, 3]` instead of its shipped
default: a `conflation` would drop from `[3, 5]` to `[1, 3]` because the user
edited `hedging`.

So the storage layer is sparse and every value crossing a module boundary is
**fully resolved**. One function (`resolveBands`) performs the merge, and a test
asserts its output has the same key set as `DEFAULT_BANDS`. This is a rule about
the *shape* that crosses boundaries, not a suggestion.

### 2.3 Tuning is a preference, not memory

Queue item 2 made erasure exhaustive: `ERASABLE_MEMORY_MODELS`
(`src/lib/memory/erase.ts`) is the closed list of what an account reset
truncates, and a model omitted from it survives a reset. `LearnerTuning` is
**deliberately not on that list**. Resetting your study history is a request to
destroy evidence; it is not a request to forget that you prefer a lower evidence
floor. Account *deletion* is a different act and is covered by
`onDelete: Cascade` on the relation above.

The second half is the part worth stating because it is easy to get wrong in the
other direction: **erasure needs no tuning-aware step.** Bands and thresholds
never reach BKT (§3.3), and everything they do affect is derived at read time
from surviving rows. The invariant "no derived number may claim knowledge from
evidence that no longer exists" is satisfied here by construction — there is no
tuned value stored anywhere for a deletion to invalidate. If a future change
materializes a tuned number into a column, that stops being true and the
erasure planner has to learn about it.

---

## 3. Editing severity bands

### 3.1 The panel

Grouped by dimension (accuracy, clarity, conciseness), each type showing its
current band, the shipped default alongside it, and a reset. A global reset
clears the blob entirely.

Validation, enforced server-side and mirrored in the UI: `floor ≤ ceiling`, both
integers within 1-5. A band inverted or out of range is rejected, not clamped —
silently clamping would let a user believe they had set something they had not.

### 3.2 Two consequences the UI must state plainly

**Editing a band re-scores history.** Per Spec 3 §3.2, severity and significance
are derived at read time, so retuning changes what past answers scored. This is
the intended behaviour — the reason to open this panel is "inversions are
overweighted *for me*", and a change that only applied going forward would leave
the profile wrong for weeks. But it means a KLP can move from weak to fine
without the learner studying anything, and the UI must say so rather than
letting the number quietly shift.

**Editing one of the five pinned ceilings changes multiple-choice and
true/false scoring too.** MC/TF answers carry `MC_TF_MAGNITUDE` (10) and
therefore resolve to the ceiling (Spec 3 §2.3). A user retuning `inversion`'s
ceiling to soften short-answer grading will also change every MC and TF
inversion they have ever picked. This is non-obvious and needs surfacing at the
point of edit, not in a help page.

### 3.3 Saving triggers NOTHING — and that is the design working

**Corrected 2026-08-06, after implementation.** An earlier draft of this
section claimed a band change staled the materialized per-KLP knowledge cache
and required a full replay. That was wrong, and it contradicted Spec 3's own
architecture. (`src/lib/metrics/cache.ts` repeated the same error in a doc
comment and was corrected on this branch in commit `00f0aef`, because the next
reader would have taken it as an instruction.)

BKT reads `AnswerKlpResult.status` and `.mode` and nothing else — deliberately,
since collapsing the mode discount into the update is what creates a hard
ceiling on `pKnown`. Bands and thresholds never touch it. What they *do* affect
is severity → significance → the verbosity index, readiness and candidate
ranking, and every one of those is derived at read time from stored inputs.

So saving new tuning requires **no recomputation, no replay, and no background
job**. The next read simply produces different numbers. This is precisely the
payoff Spec 3 §3.2 was built for; a replay here would be expensive work
achieving nothing. If an implementer finds themselves adding an `after()` call
to a save path, they have rebuilt the mistake.

The only obligation is that every surface reading these values derives them —
see §3.4.

### 3.4 Every surface must derive — and derive over the same population

At the end of Spec 3, exactly one caller derived severity and significance at
read time: `getLearnerMetrics`. The quiz results screen still reads the values
**stored on the row when the answer was graded** — `QuizSummary.tsx:157` sorts
tags by the stored `significance`, and `rollupSessionAnalysis`
(`src/lib/analysis/rollup.ts`) sums it. Verified still true 2026-08-12.

Left alone, the first band retune makes the same error show one number on the
results page and a different one on the dashboard, with nothing on either screen
explaining the discrepancy. Worse, the stored value silently reflects whichever
bands happened to be active on the day it was graded.

**Spec 3B therefore migrates the Spec 2b display to read-time derivation** — the
per-answer badges and the session rollup both.

The stored `severity`/`significance` columns keep their narrowed role: a
fallback for legacy rows that predate `magnitude` (`deriveTagScores` already
branches on `magnitude === null`).

#### 3.4.1 "One number everywhere" has exactly one hard part: `repeatBonus`

Added 2026-08-12. Decompose what the results screen has to reproduce:

```
significance = min(10, computeSignificance(relevance, severity, dimension, starred) + repeatBonus)
```

`severity` is pure in the tag's own fields plus the band table, and
`computeSignificance` is pure in the tag. **Both agree between any two surfaces
automatically.** `repeatBonus` does not: it is a judgement about *other* tags in
*other* attempts, so its value depends entirely on the population the caller
derives over. Two ways to get it wrong, and the naive implementation hits both:

**(a) The attempt sequence must be the same filtered population.** `read.ts:122`
queries `{ userId, ...ANSWERED_ATTEMPT_WHERE }` — zero-answer attempts excluded,
because an empty attempt is not a sitting and counting it dilutes "within the
last N attempts". Abandoned attempts still accumulate in the table by design
(2b filters rather than deletes), so an unfiltered query on the results screen
produces a *different index for the same attempt*, and therefore a different
`repeatBonus`, for a learner who has ever closed a quiz tab. The results screen
must use the identical predicate. This is not hypothetical bookkeeping; it is
the most likely way this feature ships broken and looks fine in tests.

**(b) The tag context must include the preceding attempts.** `deriveTagScores`
builds its `seen` set only from the tags handed to it, and its window looks
**strictly backward** (`here > s.attemptIdx`), so two tags within one sitting are
one problem, not a repeat. Deriving over a single attempt's tags therefore makes
`repeatBonus` **structurally always zero** on the results screen — the code runs,
every test on a single-attempt fixture passes, and the number is quietly wrong
for exactly the learner the bonus exists to describe.

So the results screen must derive over the attempt's own tags **plus the tags of
the `REPEAT_WINDOW_ATTEMPTS` answered attempts immediately preceding it**, then
read its own tags back out of the result. That window is provably sufficient:
the bonus only looks back `REPEAT_WINDOW_ATTEMPTS` positions. Pin the query to
the exported constant, never to a literal `3`.

The context query must also match the dashboard's tag population
(`analysisStatus: 'analyzed'`). An answer can carry error tags under `no_klps`
or `no_provenance` — `buildAnalysisWrites` still writes whole-answer
clarity/conciseness tags in those cases — and `read.ts` excludes them so
readiness's numerator shares a population with its denominator. Including them
as *context* would reintroduce the divergence from the other direction. The
attempt's own tags are displayed regardless of status, which is harmless: a
same-attempt tag can never award a repeat bonus.

#### 3.4.2 The one divergence left standing, deliberately

A **scoped** dashboard view (one set, one category) derives over a scoped tag
set, so an intervening repeat may be filtered out and the same tag can read one
point lower there than on the consolidated view. That is inherited from Spec 3,
not introduced here.

The ruling: **the unscoped value is canonical**, and the results screen must
match the unscoped view. Making scoped views agree means deriving `repeatBonus`
from an unscoped tag query inside `getLearnerMetrics` — the same fix its attempt
query already applies one level up, for the same reason. It is Spec 3C's to
close, when there is a dashboard to notice it on.

### 3.5 The three metric thresholds

Not cosmetic, and not a "show more data" toggle:

| Knob | Default | What it decides |
| --- | --- | --- |
| `minObservations` | `MIN_OBSERVATIONS` (3) | How much evidence counts as enough to have an opinion about a KLP |
| `articulationMinPKnown` | `ARTICULATION_MIN_PKNOWN` (0.6) | Above what knowledge level a terse answer is an expression gap rather than a knowledge gap |
| `readinessWeightPerAnswer` | `READINESS_WEIGHT_PER_ANSWER` (12) | The average per-answer expression-error weight at which readiness reaches 0 |

Defaults are **derived from the shipped constants, never a second copy of the
numbers** — the same rule `guessRate` follows against `EVIDENCE_STRENGTH`. A test
pins the equality so a change to either side is a build failure rather than a
silent divergence between "the default" and "the constant".

Bounds are correctness, not taste. `minObservations` below 1 lets a KLP with
zero evidence report a posterior indistinguishable from a measured one.
`readinessWeightPerAnswer` is a **divisor**; zero or negative yields `Infinity`
or an inverted metric. Unknown keys are rejected outright, so a typo is an error
rather than a silently-ignored setting the panel still displays as saved.

**The floor must be threaded through all three of its consumers** —
`topic-profile.ts`'s knowledge filter, `articulation.ts`'s terseness
classification, and §4's ranking. A partial thread is worse than none: the floor
would mean one thing for topic knowledge and another for the same topic's
terseness, on the same screen.

The panel must say what lowering the floor actually does. It does not produce
more evidence; it lowers the bar for acting on what exists. A knowledge figure
computed from one answer is a guess with a number attached. The honest framing
is the trade-off — an interview next week justifies acting on thinner evidence
than one six months out.

---

## 4. Targeting strategies

Each strategy is a **pure ranking function** over Spec 3's metrics, and the
setting selects one. Every function ranks the same candidate set and returns the
same shape, so adding a strategy never touches a call site.

### 4.1 The candidate is a KLP, and only a live one

A KLP is the finest actionable unit — it is what a focus quiz targets and what
Spec 4's action plan will schedule — and topic-level ordering is derivable by
aggregating candidates, while the reverse is not. Each candidate carries its own
`pKnown` and `observations`, the topic it rolls up to, that topic's readiness,
its `CardKlp.weight`, and the card's due state.

**Live KLP ids only.** The hardening pass split `TopicRow.klpIds` (live) from
`supersededKlpIds` (retired by a card edit) precisely because the two have
different jobs: a superseded KLP still attributes a *historical tag* — the tag
names the version that was asked — but it describes a version of the card the
learner can no longer see, so handing it back as something to study targets text
that does not exist. Candidates are built from `klpIds`; `supersededKlpIds` never
enters this path.

### 4.2 The strategies

| Key | Ranks by | For |
| --- | --- | --- |
| `shore_up_weaknesses` | low `pKnown`, weighted by KLP centrality | Early prep, broad gaps |
| `polish_near_ready` | high `pKnown` × low SA readiness — the articulation residual | Interview imminent |
| `follow_forgetting` | due and overdue first, saturating | Maintenance |
| `balanced` | normalized blend of the three | Default |

`polish_near_ready` is the one the Spec 3 articulation work exists to enable: it
targets material the learner knows but expresses poorly. `balanced` is the
default because a learner who has never opened settings should not be silently
enrolled in an aggressive strategy.

The strategy affects **ordering only** — never which data is recorded, and never
the metrics themselves. A learner switching strategies sees the same underlying
profile ranked differently, not a different profile.

### 4.3 The observation floor applies under every strategy

Candidates below the learner's `minObservations` rank last under every strategy
and are marked, not dropped: an unmeasured proposition is not evidence of
weakness, and `polish_near_ready` in particular must not promote a KLP whose
high `pKnown` rests on one lucky answer. Dropping them instead of marking them
would hide the proposition entirely rather than reporting it as unmeasured.

The floor is **the learner's**, not the constant. This matters more than it
looks: on a thin corpus every candidate is sub-threshold, so the order carries
no information at all until the learner lowers it. That is the concrete payoff
of §3.5's first knob, and it is why the floor and the strategies ship together.

### 4.4 Honesty about what this ships

`getLearnerMetrics` has **zero production callers** (tests only; re-verified
2026-08-12). Making it tuning-aware and returning a ranked list is worth doing
here — 3C should consume a tested, tuning-aware read API rather than grow one —
but **the ranked list renders nowhere until Spec 3C builds the dashboard.**

So the observable surface of this spec is: the three settings panels persist and
reload, and the quiz results screen re-scores history. The strategy selector
must say plainly that the ranking it controls is not yet displayed. A setting
that appears to do nothing is worse than one labelled as forthcoming.

---

## 5. Saving: partial writes, not read-modify-write

Added 2026-08-12. Three panels edit one row. If `saveTuning` writes all three
fields on every call, each panel has to send back the two it is not editing,
read from whatever it loaded at mount — and then the ordinary sequence "open
settings, change a threshold, change a band, save both" reverts one of them,
because the second panel echoes a snapshot taken before the first panel wrote.
The bug is invisible in a single-panel test and reproducible in about ten
seconds by hand.

So `saveTuning` takes each field as **optional, with absent meaning "leave
unchanged"**:

- `strategy` absent → the stored strategy stands.
- `bandOverrides` absent → the stored blob stands. `bandOverrides: {}` → cleared
  (this is the global reset, and it must remain expressible).
- `thresholdOverrides` likewise.

Each panel sends only what it owns. No panel needs to know the others exist,
which is also what keeps a fourth panel from re-introducing the same defect.

A **save** is validated strictly and rejected on invalid input — it is an
explicit user act, and silently discarding it would show the panel a value the
scorer is not using. A corrupt **stored** blob is a different case: it degrades
to defaults rather than throwing, matching `SESSION_INSIGHT_VERSION`, because a
bad settings row must not make the app unusable. Each field degrades
independently — one corrupt blob must not discard a perfectly good strategy.

---

## 6. Testing

Pure-function coverage:

- Band validation rejects inverted and out-of-range input rather than clamping.
- Sparse overrides merge correctly over defaults; an absent type resolves to the
  shipped default, and a cleared blob restores every default. `resolveBands`
  returns a table whose key set equals `DEFAULT_BANDS`' — the guard against
  §2.2's silent downgrade.
- A blob failing Zod validation falls back to defaults rather than throwing.
- Threshold defaults equal the shipped constants by reference, not by
  transcription.
- Each targeting strategy is a pure function tested against fixture metrics,
  with its documented intent asserted (e.g. `polish_near_ready` ranks a
  high-`pKnown`/low-readiness KLP above a low-`pKnown` one), and the observation
  floor asserted under **every** strategy.
- A lowered floor promotes a candidate the default floor demotes — the knob's
  reason for existing, asserted rather than assumed.

Cross-surface, which is where this spec's real risk lives:

- **The same tag scores the same on both surfaces**, including a tag that *is* a
  repeat. A fixture with one attempt cannot fail this; it needs a prior attempt
  inside the repeat window and a zero-answer attempt interleaved, or it does not
  test §3.4.1 at all.
- The attempt-order query on the results screen carries `ANSWERED_ATTEMPT_WHERE`.
  Assert the predicate, not just the call.
- No tuning save triggers a replay, an `after()` call, or a background job.

**Mutation-test every guard.** A test that has never been seen to fail is
decoration; this repo has shipped one gate that was structurally incapable of
failing and one that matched a comment instead of code. For each assertion that
exists to catch a specific defect, introduce that exact defect, confirm the test
reddens, revert.

**Live verification is a human gate, and it is blocked on a corpus.** No
signed-in page is reachable from an agent session (GitHub OAuth only, no
`GITHUB_ID` in `.env`), so every "set a knob and look at the screen" step is the
user's to run. And per §0, the database currently holds **no** study history, so
the headline demonstration — lower `minObservations` to 1 and watch topic
knowledge appear where it read null — cannot be run until the user has quizzed
enough to produce at least one KLP with an observation. Write it as an explicit
gate on real data; do not substitute seeded data, and do not let a green suite
close it.

---

## 7. Deferred

- **Per-topic band overrides** (harsher on accounting than on vocabulary) —
  plausible, not requested; the versioned blob tolerates the addition.
- **Unscoped `repeatBonus` derivation inside `getLearnerMetrics`** — §3.4.2.
  Spec 3C's, since it needs a dashboard to be visible on.
- **Spec 3 §14's two prompt-block defects** — `profileToPromptBlock`'s callers
  hardcode `topics: []`, and `capBlock` truncates the topic section first. Also
  3C's, and they must be fixed together or the topic signal is silently dropped
  the moment an active learner's card section fills the budget.
