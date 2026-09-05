# Build queue & carried-over findings

**Last updated:** 2026-09-04 (**third update same day** — the 10-card LBO pilot RAN TO COMPLETION
and **G1 is closed by measurement**: authored weights 22.0% at 4-5 against the 92.3% baseline,
histogram verdict OK. 9 separated, 1 low_discrimination. Four defects found by running it, listed in
the Spec 2 entry — including one where my own daily-quota guard passed its test and was dead against
real traffic. Still owed: reading the output in `/staff/klps`, which needs a signed-in browser.)

**Last updated (previous):** 2026-09-04 (**second update same day** — increment A is built: the weight
histogram check (`npm run klp-histogram`, run against the live corpus and reproducing the G1
baseline exactly at 92.3%), the two-signal weight blend, definition-anchored authoring with
`concerns`, semantic ordering with the `precedes` cross-check, and adaptive sizing floored at 4.
Suite 2770 passing, tsc clean, lint 164 — all unchanged from baseline except the added tests. The
pilot is still owed and still blocked on quota. See the Spec 2 build-order entry and the G1 caveat.)

**Last updated (previous):** 2026-09-04 (Spec 2's code — the discrimination-tested authoring pipeline, Tasks 1-12 of `.superpowers/sdd/2026-09-04-klp-authoring-pipeline/` — is built, unit-tested, and wired into `/staff/klps`. Its required pilot run on the LBO set is **not** done: two full foreground runs both failed every card on Google API free-tier quota exhaustion before producing a single KLP. G1 and G7 stay open pending a pilot that actually runs. See the Spec 2 build-order entry and the caveats on G1/G7 below.)

**Last updated (previous):** 2026-09-03 (**third update same day.** The user added the full edge-type set, promoted the accuracy types into per-KLP verdict labels, **DEFERRED the communication split entirely** ("basically pretend I didn't say it"), and specified **insight generation + matched learning plans** — recorded at the END of the queue as the payoff layer. Design of record is "The KLP engine rebuild" below; build order is the eight-spec cut with **visibility FIRST**. Also today: the `codex` branch reconciled after 6 days of drift, and the engine audit recorded as gaps G1-G10)
**Read this first** before starting any Stage 8 work. The order below is not derivable from spec filenames or dates.

This file is the canonical queue. A Claude-Code memory (`build-queue.md`) mirrors it, but **this file wins** — it is in the repo and readable by any tool.

## The codex branch — reconciled 2026-09-03

**The user works on branch `codex` with a parallel Codex agent.** That branch merges to `main`
through PRs (#38-#44 so far) and this queue did not know about any of it. Run `git log
6f6f745..codex` before assuming the queue describes the code.

**Baseline on `codex` at 2026-09-03: 204 test files, 2,505 tests, all passing.**

Shipped there between 2026-08-28 and 2026-09-03 — **7 migrations, 9 new models**, no design docs:

| Feature | Models | Routes |
| --- | --- | --- |
| Postmortems — debrief of an *offline* session (paper test, mock/real interview) | `PostmortemSession` | `/postmortem/*` |
| Folders — nested, pinnable, tagged; joins sets + notes + postmortems | `Folder`, `FolderSet`, `FolderNote`, `FolderPostmortem`, `FolderFolder` | `/folders/*` |
| Study notes — AI-summarized, source-linked | `StudyNote` | `/notes/*` |
| Diagnostic tests | `DiagnosticAttempt`, `DiagnosticQuestion` | `/diagnostic` |
| Rich text formatting on card blocks | `CardContentBlock.marks/listType/indent` | — |
| Timed quiz, dark mode, home recents, library toolbar, collapsible shell | `StudySession.kind += 'diagnostic'` | — |

**Two things to know before building on it:**
- `PostmortemSession`'s doc comment already states the right rule — it deliberately does **not**
  touch confidence or mastery, because an offline session has no trustworthy per-card events.
  Same principle as Spec 2a's refusal to fabricate a tag. Do not "improve" this.
- **`'diagnostic'` was added to `STUDY_SOURCES` but NOT to `EVIDENCE_STRENGTH`**, so it silently
  falls back to `DEFAULT_STRENGTH = 0.75` — a guess rate of 0.25, identical to four-option MC. If
  diagnostic questions are not four-option MC, every BKT posterior they produce is wrong. This is
  gap **G8** below. The fallback's own comment says a guessed number for an unreasoned mode is
  worse than none; this is that case, arriving through the back door.

---

## Engine audit, 2026-09-03 — the ten gaps

Requested by the user as the thing that "will guide the specs for the foreseeable future."
Published as an artifact; the durable findings live here because the artifact is not in the repo.

Three findings are arithmetic, not opinion:

- **G1 — the significance scale does not span 1-10 and never has.** `relevance` carries the
  LARGER coefficient (0.55) and reads `CardKlp.weight`, but **92% of live KLPs are weight 4 or 5**
  (178 at w5, 82 at w4, exactly one at w2, none at w1). Substituting the real distribution:
  accuracy on a w5 KLP can only reach **6-10**; conciseness on a w5 KLP only **4-7**. **No accuracy
  error can score below 5. No conciseness error can score above 7.** The bands are nearly disjoint,
  so `significance` largely encodes *which dimension the error was* rather than how bad it was —
  and severity, the only genuinely per-answer AI judgment, moves it by at most four points while
  `dimWeight` sets the band it lands in. **G1: the fix is BUILT and unit-tested as of 2026-09-04,
  but NOT CLOSED — unverified.** The LBO pilot that would produce a real weight histogram to check
  the spread against failed entirely (Google API quota exhaustion, 0 cards authored across two full
  foreground runs); see the Spec 2 build-order entry below. Do not treat G1 as closed until a pilot
  actually authors cards and the histogram is read.

  **G1 IS CLOSED, 2026-09-04, on the measurement that opened it.** The 10-card LBO pilot ran to
  completion (9 separated, 1 `low_discrimination`, mean separation 0.52). Authored slice, 50 KLPs:
  **22.0% at 4-5 (was 92.3%), 40.0% at 1-2 (was 0.4%), mean 2.86 (was 4.54), 4 of 5 values present,
  and `npm run klp-histogram` returns OK — no failure mode.** Relevance spans its range, so
  significance can no longer be pinned to one band by the weight term. The breadth histogram shows
  32/32/34% across one, two and three adversary failures, so the spread is earned rather than lucky.
  **Do not reopen G1 without a new measurement.**

  **The measuring instrument: `npm run klp-histogram` (increment A, built 2026-09-04).** Read-only, splits the corpus into authored-vs-legacy by `(cardId, klpVersion)`, and
  names three failure modes with different causes — `clustered_high` (≥75% at 4-5, i.e. G1 itself),
  `clustered_low` (≥75% at 1-2, meaning both weight terms are flat), and `uniform` (any single value
  ≥60%, which catches flatness in the middle that neither tail check sees). **Measured baseline,
  whole live corpus, 2026-09-04: 272 live KLPs on 124 cards, ALL legacy — 92.3% at 4-5, mean 4.54,
  and 62.5% at the single value 5, so it fires `clustered_high` AND `uniform`. Authored slice: 0
  KLPs, 0 `CardAuthoring` rows** — independent confirmation that no pilot output has ever been
  persisted. `npm run author-klps` prints the same histogram over its own run, so a run that posts a
  healthy mean separation and a useless weight signal is visible without a second command.

  **The fix also changed shape, because blast radius alone cannot close G1.** Weight is now
  `weightFromSignals` — the blast-radius term blended with a **discrimination-breadth** term (how
  many of the three adversaries fail a KLP, read off call B's verdict matrix at no extra AI cost).
  Blast radius measures dependency DEPTH, which a derivation chain has and an enumeration does not;
  the first pilot card was an enumeration and produced weights 2,1,2,1,1 off two edges, and two
  edges was very likely CORRECT. Pushing the relate prompt for more would fabricate `causes` links
  that Spec 3 then serves grading probes for. **The ceiling was real but not binding, and the
  rebalance was WITHDRAWN.** Because the terms sum to 1, a KLP reaches 5 only by scoring on both,
  and one card's early weights (3,3,3,2) looked like the mean collapsing the two signals —
  `max(graph, breadth)` was recommended on that basis. At n=50 it is wrong: weight 5 is reachable,
  two KLPs earned it, and the distribution passes. **Four data points is exactly the sample the
  histogram now refuses to judge** (`HISTOGRAM_MIN_SAMPLE = 20`, added after it fired a FAIL on 4
  KLPs). Equal weighting stays; if a future corpus says otherwise, rebalance in
  `authoring-config.ts` and never in the prompt.
- **G2 — 57% of the library cannot be diagnosed.** 166 of 291 cards are `klpStatus: 'pending'`
  with a **null source hash — never attempted, zero failures**. `selectRefreshableStaleCardIds`
  deliberately excludes never-extracted cards from the edit path, so extraction is demand-driven
  and coverage records *what you happened to quiz*, not what you are learning. Two identical
  68-card sets sit at 100% and 0%; M&A (82 cards) is 96% dark. **Blind-spot detection is
  unbuildable on this trigger** — the card you have never been quizzed on is exactly the one most
  likely to hold missing knowledge, and it has no KLPs to detect a gap with.
- **G3 — calibration is not computable.** `CardProgress.confidence` is an outcome-derived counter,
  and `StudyEvent.confidenceBefore` stores the *system's* prior value, not the learner's. Nothing
  captures what the learner *thought* they knew at answer time. **A data-capture gap, not a
  modelling gap — no formula change recovers it retroactively.**

The rest: **G4** speed multiplies nothing (`latencyMs` reaches only `paceIndex`, never
`masteryScore`/`stepBkt`/`nextDueAt`/`rankCandidates`/`computeSignificance`, while `pace.ts`'s own
comment says a card answered at 2.4x baseline is not mastered); **G5** two knowledge estimates that
never reconcile (card grain: 10-event window at `0.8^i`; KLP grain: full-history BKT, no decay);
**G6** knowledge and writing summed into one number — the `too_terse` pKnown check in
`computeArticulation` is exactly the right shape but applies to that ONE tag type, so `rambling`
and `kitchen_sink` are booked as writing failures even when the learner plainly does not know the
material; **G7** extraction quality is a hard ceiling on diagnostic resolution (a learner can only
be wrong in ways the KLP list permits; the corpus shows both duplicates and un-judgeable run-ons)
— **the discrimination-tested pipeline that fixes this (Spec 2) is BUILT and unit-tested as of
2026-09-04, but NOT CLOSED**, same caveat as G1: the LBO pilot has not yet successfully authored a
single card, so no live evidence of improved extraction quality exists yet;
**G8** the diagnostic-mode guess rate above; **G9** no follow-up, so `partial` cannot distinguish
"knows it, said it badly" from "half-knows it"; **G10** no `User.role` at all — `KLT_EDITORS` is an
env var of user IDs, so granting access requires a redeploy. **G10 CLOSED 2026-09-03 by Spec 1** —
`User.role` (`learner | staff | admin`) plus the `RoleGrant` audit table and `npm run grant-role`
replaced the env allowlist; see the build-order entry above and `CLAUDE.md`'s Roles paragraph.

**Load-bearing things a rework must NOT break:** MC as a zero-cost diagnostic via distractor
provenance; the closed error vocabulary; never defaulting a tag into existence; `analysisStatus`
distinguishing "analyzed and clean" from "could not analyze"; significance *inputs* persisted for
recompute; `stepBkt` reading `STATUS_CREDIT` and `EVIDENCE_STRENGTH` in their two different
positions and never the stored `credit` product.

---

## The KLP engine rebuild — design of record, 2026-09-03

**Specified by the user, and it supersedes the "two-pass extract-then-critique" approach agreed
earlier the same day.** The difference is not cosmetic and is worth stating plainly: a critique
pass is a *second opinion*; this is a *test*. Quality is a matter of taste, discrimination is a
checkable property.

### The per-question authoring pipeline

1. **Write a reference answer first**, at the quality bar expected of a strong candidate. Deriving
   propositions from a concrete artifact produces far better grain than generating them from the
   question in the abstract. *(Side benefit not in the original ask: grading today compares the
   learner's answer to `card.definition` — often a terse personal note. A real reference answer
   improves grading on its own, and can be shown to the learner after they respond.)*
2. **Extract draft KLPs from that answer.**
3. **Write 3-4 realistic wrong answers** at different competence levels — the confident-but-wrong
   one, the vague one, the memorized-template one.
4. **Grade the wrong answers against the draft KLPs. THIS IS THE STEP.** Any KLP that fires
   identically across a strong and a weak answer is not discriminating and gets cut or split.
   **If the vague answer scores 6/7, the KLPs are too loose.**
5. **Revise and re-grade until the wrong answers separate cleanly.** A loop with a numeric exit
   condition, not a review someone signs off on.
6. **Extract relations on the surviving set** (perturbation + order violation — below).
7. **Validate mechanically:** no compound KLPs (nothing joined by "and" that could half-fail), no
   restatements of the question, each independently checkable, each tagged to exactly one node,
   numbers stated where numbers matter, **5-9 per question**.

**Consequences to plan for:**
- This is **per-question**. The current 10-cards-per-call batching on the cheap `autocomplete` tier
  is incompatible and goes away. Authoring cost rises a lot; runtime cost does not.
- Grain target moves from 1-5 to **5-9**, against an observed corpus mode of **2**. Expect ~3x the
  KLPs, ~3x the BKT evidence per card, and a materially larger short-answer grading response.
  `MAX_KLPS_PER_CARD = 5` must change.
- The count is a **smell test, not a quota** — an atomic card genuinely has one point, and the
  discrimination test is authoritative over the range. Padding to reach 5 is exactly what step 4
  catches, since a padded KLP fires the same way on every answer.

### Relations

The user's worked example ($10 depreciation, 40% tax): K1 EBIT −10 · K2 NI −6 · K3 non-cash,
added back · K4 CFO +4 · K5 PP&E −10 · K6 Cash +4 · K7 BS balances (A −6, E −6). Edges:
R1 `causes` K3→K4 · R2 `precedes` K2→K4 · R3 `causes` K1→K2 · R4 `contrasts` K5↔K6 ·
R5 `requires` K7←K5,K6.

**Two extraction techniques, neither requiring the model to introspect about pedagogy:**
- **Perturbation.** For each KLP: if this were false, which others break? That asymmetry IS the
  causal structure — read the dependency graph off the blast radius. K3 false breaks K4 and K6,
  leaves K1/K2/K5 untouched. **Design detail that decides whether this works: the perturbation must
  be a substantive COUNTERFACTUAL PREMISE, not a negation.** "K3 is false" cannot be propagated;
  "depreciation is a cash charge" can. Ask for the counterfactual world, then re-derive inside it.
- **Order violation.** Shuffle and ask which orderings are incoherent. Pairs that cannot swap are
  `precedes`. K2-before-K4 fails; K5/K6 swap freely, so no edge. **Require a reason with each
  rejection** and keep only those where the later point's derivation consumes the earlier one's
  output — otherwise you collect stylistic ordering preferences, which are now *communication*
  findings and belong to a different dimension entirely.
- Neither yields `contrasts`. That comes from asking which pairs get substituted for each other —
  which makes **a `contrasts` edge a PREDICTED CONFLATION**, on the same axis as the *observed*
  conflations `metrics/misconceptions.ts` already derives from `(klpId, secondaryKlpId)`. That is
  the predicted-vs-observed provenance split backlog item 13 demands, arriving early and free.

**Prune hard — it is the same test one level up.** 7 KLPs = 21 possible pairs, maybe 4 that matter.
Keep only relations where a learner could plausibly hold both endpoints and still miss the link.
K1→K2 is real (people know EBIT drops 10 and NI drops 6 without connecting them through the 40%
rate). "PP&E is on the balance sheet" is definitional, carries zero information, costs grading
tokens. **Mechanically: for each candidate edge, generate an answer that gets both endpoints
demonstrably correct and the link wrong. If none can be written, the edge is definitional — cut it.**

**And that adversarial artifact IS the grading instrument** — proving an edge informative produces,
in the same step, the exact near-miss the probe must discriminate against. Same economy as
generating a distractor from a named corruption.

**Grade relations with dedicated probes, never by inference.** Extracting relation verdicts from an
unprompted walkthrough marks them absent constantly: the learner may know why CFO rises and simply
not have said so, because nobody asked. **Absence of stated reasoning is not absence of reasoning.**
So relations are their own item type — a one-line follow-up right after the main answer, templated
on *what the learner actually said* (not the reference, or it leaks the answer):

> You said net income falls by 6 and cash flow rises by 4. What connects those?

2-3 probes per relation-dense question, chosen from which KLPs the learner hit, and
**only where BOTH endpoints came back correct** — that is exactly where the connectivity signal
lives and where a miss is unambiguous rather than a knowledge gap in disguise.

**This fixes G1 for free.** Perturbation makes centrality *measurable*: a KLP's weight is how many
others break when it does. K3 has two dependents; a leaf has none. **Weight stops being an AI
opinion and becomes a computed graph property** — a better fix than asking the model to try harder,
and it recomputes whenever the graph changes.

### Edge types — the full set, specified by the user 2026-09-03

An edge type is admitted only if it makes a **specific failure nameable**. That is the test.

| Type | Shape | Derived by | Failure it makes nameable |
| --- | --- | --- | --- |
| `causes` | directed | perturbation | Knows both facts, misses the mechanism linking them |
| `requires` | directed, conjunctive | perturbation | Prerequisite missing — **drives blame propagation** |
| `precedes` | directed | order violation | Derivation sequenced wrongly |
| `confused_with` | **symmetric** | substitution probe | Conflation, detectable **structurally** instead of hoping the model notices |
| `applies_within` | directed, to a condition | boundary probe | Boundary failure — rule applied outside its scope |
| `analogous_to` | **symmetric, cross-question** | corpus pass | Transfer — and it is what *builds* transfer items |
| `part_of` | directed, hierarchical | — already exists — | Lives in the `Klt` tree. **Do not duplicate it here.** |

`confused_with` **replaces the earlier `contrasts`** — the user's name is better, and it says what
the edge detects rather than what it looks like.

**Three structural consequences:**
- `confused_with` and `analogous_to` are **symmetric**: store once under a canonical endpoint
  ordering, and exempt from the acyclicity check, which governs only the directed types.
- `analogous_to` is the only **cross-question** type — its endpoints live on different cards, so
  **the relation table must not assume same-card endpoints**, and it comes from a corpus pass rather
  than per-question authoring. Build it last.
- `applies_within` fits what already exists: `condition` is already a `CardKlp.kind`, so a scope
  edge links a claim KLP to a condition KLP with no new node type. Pairs with the `misapplication`
  verdict and the in-scope/out-of-scope insight pairing.

### Verdicts: promote the accuracy types into per-KLP labels

The user's direction: keep credit separate from the labels, **and turn the existing accuracy types
(`omission`, `incomplete`, …) into labels too**, raising the precision at which the model can name a
mistake. Merged vocabulary — **13 labels**:

`correct` · `partial` · `failed` · `omission` · `incomplete` · `contradicted` · `inversion` ·
`conflation` · `misapplication` · `factual_error` · `overgeneralization` · `unsupported_leap` ·
`fabrication`

**USE THE EXISTING SPELLINGS. This is not a style choice.** The user proposed `inverted`,
`mislabeled`, `misapplied`. Five of these strings are members of `CORRUPTIONS`
(`src/lib/quiz/options.ts`) — written straight onto every generated distractor as its provenance,
**persisted**, and guarded by a subset test in `tests/errors/taxonomy.test.ts` precisely because a
rename strands rows. Renaming would cost the entire existing distractor corpus its diagnosis. Only
genuinely new concepts get new names: `correct` and `contradicted`.

**Credit stays separate.** The labels are not ordered — `inversion` is not "more wrong" than
`omission`, it is differently wrong — so mapping 13 labels onto one number invents a ranking nobody
chose. `STATUS_CREDIT` keeps its three values (`correct`/`incomplete`→ 1.0/0.5, rest 0.0) and BKT is
untouched, preserving the subtlest correct thing in the engine: `stepBkt` reads the categorical
fraction and `EVIDENCE_STRENGTH` in two different positions and never the stored product.

**`partial` and `failed` survive as FALLBACKS**, usable only when the grader cannot commit to a
specific label — and they are what every historical row already holds. A migration cannot know which
specific failure a legacy `failed` was, and inventing one is exactly the fabrication this engine
refuses everywhere else. One extra enum member keeps months of history truthful.

### Communication: DEFERRED, at the user's explicit instruction

The user's words: *"let's make that a later step (and basically pretend I didn't say it now), as i
need to first figure out how i'm actually going to be diagnosing communication errors (presumably
similar to a KLP-type system that can later recombine to show errors on both a communication &
knowledge scale)."*

So **clarity and conciseness stay exactly where they are.** `AnswerErrorTag` is NOT migrated, and
the runtime verdict change touches only `AnswerKlpResult.status`. Do not reintroduce the
communication split as a near-term step. The eventual direction is recorded above: its own
decomposition unit, parallel to KLPs, recombining with knowledge verdicts for a reading on both
scales.

**Consequence to remember:** the `expression` diagnosis in the insight layer (bottom of this file)
is therefore not computable yet. That is what the deferred work unlocks — not an abstract tidiness
win.


---

## Build order — RE-CUT 2026-09-03 (second pass)

**Visibility goes FIRST, at the user's explicit request** — "I want to see if what I think you're
building is good or not." Everything after it is inspectable rather than taken on faith, and the
engine rebuild ships against a pilot set reviewed in that view before it touches the corpus.

1. **Spec 1 — Visibility: staff view, roles, grant dashboard. ✅ BUILT 2026-09-03.** A real
   `User.role` plus a grant table replacing the `KLT_EDITORS` env var, so access is assignable from
   a dashboard instead of a redeploy. Every KLP with weight and posterior; per-learner verdicts and
   tags; **the concept ladder expanded to every generated topic rather than just the roots** (the
   user reports `/concepts` shows only e.g. DCF and accounting with no dropdown for generated
   sub-topics). **Build against the TARGET schema with empty states for relations and verdicts**, so
   Specs 2 and 3 light up panels that already exist instead of forcing a rebuild. **Closes G10.**
   **`/staff/coverage` also shipped** — optional in the design, built anyway at the owner's explicit
   call. Full suite 213 files / 2580 tests, `tsc --noEmit` clean, lint below the standing ceiling;
   see Task 18's report. Live browser verification and the `requireStaff` mutation test are
   **deferred** pending the repository owner running `npm run grant-role` to grant themselves a
   role — see `.superpowers/sdd/2026-09-03-staff-visibility/task-18-report.md`.
2. **Spec 2 — KLP engine: discrimination-tested authoring. ✅ CODE BUILT 2026-09-04, PILOT
   BLOCKED — see below.** The seven-step pipeline: draft a reference answer + KLPs + three
   adversary candidates (`confident_wrong`, `vague`, `memorized_template`); grade every candidate
   in an ISOLATED call against the current KLPs (`GRADE_CANDIDATES_SEPARATELY` — a grader shown all
   four at once ranks them against each other and manufactures separation); compute a separation
   score in TypeScript (`src/lib/klp/separation.ts`), never an AI opinion; revise and re-grade up to
   `MAX_REVISIONS` (2) times; persist even a card that still won't separate, flagged
   `low_discrimination` rather than retried silently; weight from computed blast radius
   (`weightFromBlastRadius`, relation edges surviving cycle/out-of-range pruning) rather than an AI
   centrality rating. Relation extraction rides along as step 6 so **the corpus is only ever walked
   once**. `/staff/klps` gained a Separation column (Task 12) joining each `CardKlp` to its most
   recent `CardAuthoring` row by `(cardId, klpVersion)` — an em dash for a legacy KLP with no
   authoring run (never `0.00`, same convention as `meanPKnown`), and a visible `low discrimination`
   flag rather than a silently-equivalent score. Full suite 223 files / 2687 tests, 0 failures;
   `tsc --noEmit` clean; lint 164 (ceiling 175). **Absorbs item 10.**

   **The pilot did not run.** `npm run author-klps -- --set cmtj7pxfc000005l4rv4krxxy --direct`
   (the 10-card LBO set) was run twice, in the foreground, to completion (exit code 0 both times).
   **Every single card failed on every single attempt** with
   `AI_APICallError: quota exceeded — generativelanguage.googleapis.com/generate_content_free_tier_requests`
   (reported limit 20, dropping to 5 partway through the second run), starting on card 1's very
   first call — not a mid-run rate limit, a block that held for the entire duration of both runs.
   Result, both times: **0 cards authored, 0 KLPs, 0 relations, 0 `CardAuthoring` rows** (verified
   directly against the database, not just the script's own summary line, which reports "mean
   separation 0.00" as its no-data floor — the same null-vs-zero distinction Task 12 just encoded in
   the staff view, so read that 0.00 as "no runs succeeded," not "runs succeeded with zero
   separation"). **No weight histogram exists, because no authoring outcome exists.** `--direct`
   uses a single `GOOGLE_API_KEY` on (evidently) the Gemini free tier with no pacing between calls;
   one card alone costs roughly 1 (author) + ~4 (isolated grades, one per candidate) + up to 2
   revision rounds' worth of re-grades + 1 (relate) ≈ 6-10 calls fired back to back, which a 5-20
   req/min free tier cannot survive even once, let alone across 10 cards run without delay. Before
   the acceptance run on `Accounting - Knowledge` — or before treating G1/G7 as closed — either
   raise that key's quota tier or add inter-call pacing/backoff to the `--direct` path, then re-run
   this exact pilot and read the real histogram in `/staff/klps`. **Does NOT close G1 or G7 yet** —
   see the caveats added next to each finding above.

   **THE PILOT IS DONE (2026-09-04). Spec 2 Task 13's authoring half is complete; what remains is
   reading it in `/staff/klps`, which needs a signed-in browser.** All 10 cards authored, every one
   `klpStatus: ready`. Four defects were found by RUNNING it that the whole mocked suite could not —
   the same argument Task 11 made: (a) the free tier is 20 requests per day **per model**, and Google
   returns that cap with a **34-second** retry hint, so the delay-magnitude heuristic retried a limit
   that resets tomorrow — the 429's `QuotaFailure.quotaId` states the period and now decides; (b)
   that fix did not fire against real traffic, because the SDK wraps the provider error in an
   `AI_RetryError` and `collectErrorText` read only the top level — a guard that passed its
   hand-built fixture and was dead in production; (c) the AI SDK **retries 3x internally** before the
   pacing layer sees anything, so 8 pacing attempts were up to 24 real requests — `--direct` now sets
   `maxRetries: 0`, and note **`maxRetries` is set NOWHERE else in the codebase, so `generateJson`
   has the same 3x multiplication on every production call** (left alone deliberately: it trades SDK
   resilience against faster credential failover and affects grading and quizzing, not just
   authoring); (d) the histogram fired a FAIL on 4 KLPs, so findings now need `HISTOGRAM_MIN_SAMPLE`.

   **Rotation for `--direct` (`src/lib/klp/direct-pool.ts`)**: the pool is the cross product of
   `GOOGLE_API_KEYS` x `KLP_DIRECT_MODELS`, ordered by the website's own `selectAttemptOrder` rather
   than a second LRU implementation. A combo is **pinned per card** — grading one card's four
   candidates on different models would fold the gap between two graders into the separation score,
   where it is indistinguishable from the gap between a strong and a weak answer. A per-day quota
   retires the combo and the run continues; a non-quota failure moves the card to the next model
   (bounded at 3 attempts), because models differ in structured-output compliance —
   `gemini-2.5-flash` returned "response did not match schema" on one key and "no longer available
   to new users" on two others. Cards 3 and 8 were saved by that fallback.

   **Increment A is BUILT (2026-09-04)** — design:
   `docs/superpowers/specs/2026-09-04-klp-authoring-increment-design.md`, written from the owner's
   review of the one card that completed before the quota wall. Five changes, in the order they were
   built: (1) `npm run klp-histogram` and the run-summary histogram — deliberately FIRST, because a
   check that lands after the corpus is rewritten is a check you cannot act on; (2) the two-signal
   weight blend; (3) definition-anchored authoring — the card's definition is now the SKELETON the
   reference answer expands, and a disagreement with it goes into a `concerns` field that is printed
   and never applied, because a pipeline that silently corrects the owner's cards is worse than one
   that flags them; (4) semantic ordering (setup → mechanism → payoff, the last KLP landing the
   answer asked) cross-checked mechanically against `precedes` edges by `findOrderingDefects`; (5)
   adaptive sizing — `MIN_KLPS_PER_CARD` drops 5 → 4, a mechanical prior is computed in TypeScript
   and passed to the prompt as a floor, and the author call returns a per-point detail assessment
   that TypeScript sums, so no fifth AI call was added to a pipeline the free tier already cannot
   afford. `AUTHOR_KLPS_PROMPT` and `REVISE_KLPS_PROMPT` are both **version 2** — `promptVersion` is
   persisted, so pre- and post-increment rows stay distinguishable. **The cost of (5), stated:** a
   fixed 5-9 range made the KLP count a weak quality signal on its own; adaptive sizing removes it,
   so read a low count beside its separation score, never alone.
3. **Spec 3 — Relations: probes, verdicts, DAG.** Relations as their own item type; probes served
   after the main answer, templated on the learner's own words, fired only where both endpoints
   came back correct, capped at 2-3 per question. Verdicts stored **with provenance** so a predicted
   edge is never confused with an observed one. **Acyclicity enforced on write** — an AI will
   happily emit X→Y and Y→X across two calls, and `src/lib/klt/invariants.ts` was needed for a
   strictly easier invariant. DAG rendered in the staff view. **Closes half of G9; largely absorbs
   item 13.** `/staff/klps` (Spec 1) already has a `Relations` column, shipped empty and rendering
   an em dash (`src/components/staff/KlpTable.tsx`) — fill it, don't add a new one.
4. **Spec 4 — Coverage: full corpus walk, permanent self-healing.** Only once the pipeline is proven
   on the pilot. Extraction stops being demand-driven; all 166 pending filled and the 124 existing
   re-authored. **Take the window while only 5 `KlpState` rows exist.** Background claim loop holds
   coverage at 100% so no user ever meets a card without KLPs. **Closes G2.**
5. **Spec 5 — Verdict labels at runtime.** `AnswerKlpResult.status` widens to the 13 labels;
   `STATUS_CREDIT` gains the new members mapping to the same three credit values; BKT untouched.
   **`AnswerErrorTag` is deliberately LEFT ALONE — no communication split.** Small and low-risk
   precisely because it moves no table; the `CORRUPTIONS` subset test keeps passing unchanged.
   `/staff/klps` (Spec 1) already has a status-agnostic `Verdicts` column — it reads whatever
   statuses actually exist rather than a hardcoded three, so the widening to 13 labels needs no
   change there.
6. **Spec 6 — Self-rated confidence capture.** One tap before the answer is revealed. Changes no
   formula, blocks nothing, nothing blocks it — **pull it forward into any gap.** Every week it
   waits is a week of history that can never be calibrated. **Closes G3.**
7. **Spec 7 — Mastery engine rework.** Speed as a SECOND AXIS, not a multiplier (latency is
   untrusted by construction; a multiplier propagates noise into the knowledge estimate — model
   fluency separately, degrade to no-signal below 3 timed observations, gate `mastered` on both).
   KLP grain authoritative, card mastery a rollup. Calibration from Spec 6. Plus a test asserting
   every KLP-crediting `STUDY_SOURCES` member has an explicit `EVIDENCE_STRENGTH`. **Item 12.
   Closes G4, G5, G8.**
8. **Spec 8 — Misconception library & KLP-level follow-ups.** Curated, shareable, per-topic, kept
   schema-distinct from the observed misconceptions the engine derives. Also a generator: a curated
   misconception is a high-quality corruption. **Needs the seed content the user is writing in a
   separate chat — poke them.** **Absorbs item 11. Closes the rest of G9.**

9. **Spec 9 — Insight generation + matched learning plans.** The payoff layer — see "Insight generation" at the END of this file. Replaces Stage 8 Spec 4's plan half.

**Then** Stage 8 Spec 4's remaining lesson work. Note this leaves the Analysis tab's
in-progress block (item 6g) pointing at lessons that will not exist for a while — stub it honestly
or repoint it.

---

<details>
<summary>The superseded first-pass seven-spec order from earlier on 2026-09-03</summary>

## Build order — REPLACED 2026-09-03

Items 1, 6c, 6f and 6g are done. Item 7 moved to the back at the user's direction. Backlog items
10, 11, 12 and 14 are absorbed into the specs below.

1. **Spec 1 — two-pass extraction & the question-type axis.** Pass 1 extracts, pass 2 critiques and
   repairs: dedup within the card, split run-ons into separately judgeable propositions, enforce a
   real weight spread. Question type assigned in the SAME pass so the corpus is walked once.
   Decides whether type generalises `CardKlp.kind` or replaces it. **Absorbs item 10. Closes G1, G7.**
   Approach chosen with the user: **card-scoped critique.** Set-scoped was ruled out for v1 —
   merging KLPs across cards needs a KLP-identity concept the schema lacks, and lexical similarity
   provably fails here (a Jaccard pass missed the real LBO duplicate and returned the two inverse
   beta formulas at 1.00 as a false positive; **dedup must be semantic**).
2. **Spec 2 — eager coverage, self-healing, one-time backfill.** Extraction stops being
   demand-driven. Backfill all 166 pending AND re-extract the 124 ready cards on the new algorithm.
   **Take the window: only 5 `KlpState` rows exist today, so superseding every KLP costs almost
   nothing now and will not be cheap in a month.** A background claim loop keeps coverage at 100%
   permanently. **User's addition #2. Closes G2.**
3. **Spec 3 — self-rated confidence capture.** One-tap certainty before the answer is revealed,
   persisted on the answer row. Changes no formula. **Deliberately early: it is the only
   prerequisite that gets strictly more expensive the longer it waits.** Also improves diagnosis
   immediately and independently — wrong-and-certain is a misconception, wrong-and-guessing is a
   gap, and today they are the same row. **Closes G3. Prerequisite for Specs 5, 6, 7.**
4. **Spec 4 — staff view, roles, grant dashboard.** A real `User.role` plus a grant table replacing
   the `KLT_EDITORS` env var, so access is assignable from a dashboard rather than a redeploy.
   The view: KLPs with weights and posteriors, per-learner error tags, and **the concept ladder
   expanded to every generated topic rather than just the roots** (the user reports the `/concepts`
   list view shows only e.g. DCF and accounting, with no dropdown for generated sub-topics — fix
   that here). Owner-only first, teacher-shaped by construction. **User's addition #1. Closes G10.**
5. **Spec 5 — knowledge vs. expression, separated properly.** Generalise the pKnown check to every
   expression tag; stop summing the two axes into one `significance` via `DIM_WEIGHTS`. **This is
   the research week the user asked to be reminded to book** — now scoped, with real accumulated
   tags to design against. **Absorbs item 14. User's addition #3. Closes G6.**
6. **Spec 6 — mastery engine rework.** The week with expert analysis. Speed as a SECOND AXIS, not a
   multiplier (latency is untrusted by construction — a multiplier propagates noise into the
   knowledge estimate itself; model fluency separately, degrade to no-signal below 3 timed
   observations, gate `mastered` on both). KLP grain made authoritative with card mastery as a
   rollup. Calibration from Spec 3's data. Plus a test asserting every KLP-crediting
   `STUDY_SOURCES` member has an explicit `EVIDENCE_STRENGTH`. **Item 12. Closes G4, G5, G8.**
7. **Spec 7 — misconception library & adaptive follow-ups.** Curated, shareable, per-topic library,
   kept schema-distinct from the observed misconceptions `metrics/misconceptions.ts` derives, so a
   seeded entry is never mistaken for measured evidence. Follow-ups probe a specific `partial` KLP —
   a curated misconception is a high-quality corruption, which is exactly what a probe needs.
   **Needs the seed content the user is writing in a separate chat — poke them.** **Absorbs item
   11. User's addition #3. Closes G9.**

**Then:** backlog item 13 (error DAG) — unchanged, still behind Spec 7 since curated misconceptions
are its natural nodes. **Then** Stage 8 Spec 4 (plans + AI lessons), moved to the back on
2026-09-03. Note this leaves the Analysis tab's in-progress block (item 6g) pointing at lessons
that will not exist for a while — stub it honestly or repoint it.

</details>

---

<details>
<summary>The superseded 2026-08-20 build order, kept for the record</summary>

**Build order for what remains, decided with the user 2026-08-20 — the numbers do NOT sort into it:**

1. ~~**Item 8 — open the doors**~~ **FULLY DONE.** Built and agent-gated 2026-08-21; the two human gates (real Resend delivery, Vercel Firewall) were reported PASSED by the user on 2026-08-24, and **`CREDENTIALS_SIGNUP_ENABLED` is now ON** — set via a deployed env var, not in `.env`. Nothing outstanding.
2. **Item 9 — surfacing missed KLPs / weak topics.** **BUILT 2026-08-24** as the KLT topic layer (`specs/2026-08-24-klt-topic-layer-design.md`). Two verification steps owed — see its entry. Next action after those is item 7.
3. **Item 7 — Spec 4**, plan setup + readiness + lesson generation. The biggest item; its lesson half now has its first design decision (see item 7's "LESSON OUTPUT TYPES").
4. ~~**Item 6c — sharing & discovery.**~~ **BUILT 2026-08-27** as public sets, fork & discovery. Live gate owed. Collaborators deliberately cut.
5. ~~**Item 6f — app shell.**~~ **BUILT 2026-08-28.** Left rail, profile menu, settings split, avatar, feedback. Live gate owed.
6. ~~**Item 6g — set views & Atlas.**~~ **BUILT 2026-08-28.** Study / Knowledge / Analysis with mastery shading. Live gate owed. **This completes the two-part UI request made on 2026-08-27. Next action is item 7 (Spec 4)**, whose lesson half is now also the thing the Analysis tab's in-progress block points at.

</details>

**Items 10-14 are a BACKLOG, not part of that order** — see "Backlog" at the bottom of the queue. They were requested on 2026-08-28 and none of them is next. Two need something from the user before they can start: **item 11** needs seed misconception content written in a separate chat and pasted in, and **item 14** is a research week the user asked to be reminded to book. **Item 12** (mastery rework) is the one the user said they want to spend a week on with expert analysis, and its entry already carries the audit of what exists today.

---

## The queue

### 1. ✅ Set visibility — DONE (2026-08-09)

Spec: `specs/2026-08-08-set-visibility-design.md` · Plan: `plans/2026-08-08-set-visibility.md`
Branch `spec3b-tunable-scoring`, ~10 commits, **not merged**. Pushed to `origin`.

Sets are private by default, owner-togglable to link-shareable. Closed 10 read-by-id exposures. Verified live against the dev server and the real DB, not just in tests.

### 2. ✅ Deletion & forgetting — DONE (2026-08-12), live-verified

Spec: `specs/2026-08-10-deletion-and-forgetting-design.md` · Plan: `plans/2026-08-10-deletion-and-forgetting.md`
Ledger: `.superpowers/sdd/2026-08-10-deletion-and-forgetting/progress.md`
Branch `spec3b-tunable-scoring` (same branch as item 1), **not merged**. Pushed to `origin`.

Forget now drops the **evidence**, not just the estimate, and a reset quiz is erased outright rather than kept as a scored receipt. All six verbs — `deleteStudyEvent`, `forgetCard`, `forgetSet`, `resetQuizAttempt`, `resetQuizAnswer`, `resetUserMemory` — route through one module: a pure planner (`src/lib/memory/erase.ts`) plus a transactional executor (`src/lib/memory/erase-execute.ts`) that snapshots, deletes, then replays `CardProgress` and `KlpState` from what survives. Both defects the spec found are fixed: `StudySession` was missing from the account reset, and `QuizAttempt.score` no longer goes stale on partial deletion.

**Task 11 live verification: checkpoints ①–④ ALL PASSED against the real database on 2026-08-12.** Method: full snapshot + predictions recorded **in advance**, then one action, then measure. Every prediction hit.
- **①** erase one answer → `answers −1`, **`events −1` (the FK cascade proven — no application code deletes that row)**, `attempt.score 77→65` recomputed via `overallQuizScore`, `session.itemCount 3→2` (stored planned count minus deletions, confirming the I-1 ruling).
- **②** erase the last two → the attempt **and** its session deleted outright, not left as a scored husk (the I-3 fix).
- **③a** forget a card with quiz history → **`klpStates −3`**, the behaviour change the whole spec exists for: those posteriors sat at `pKnown 0.871` and would previously have survived forever, beyond the backfill's reach. Two *different* attempts re-scored in one operation (96→95, 83→82); a `matching` answer erased via the card scope; the card's `CardKlp` definitions survived — you forget your history with a card, not the card.
- **③b** forget a starred, never-studied card → `CardProgress` row deleted unconditionally. That is **C-1** from Task 5's review, the one defect no mocked test could reach.
- `scripts/check-memory-integrity.ts` (run after each) asserts `KlpState.observations === count(surviving AnswerKlpResult)` for every row — a posterior still carrying a deleted answer reads `evidence + 1`. Clean throughout.

- **④** account reset → every memory count **0**, including `sessions` (Task 7's fix; pre-fix all 21 would have survived as husks). Content untouched: 78 cards, 152 KLPs, 7 categories, 2 credentials, 152 content blocks. The reset erases history, not the library.

**Unverified on purpose:** N-1 (set scope deleting `ConfidenceEvent` by `card: { setId }`, reaching cards whose *only* memory is a legacy confidence row). The corpus could not discriminate it — every card carrying `ConfidenceEvent` rows also had answers, so pre- and post-fix code behaved identically. Not worth manufacturing, since nothing derives from `ConfidenceEvent`. **Do not assume it was tested.**

**Two bugs Task 11 found that the entire mocked suite could not** — this is the argument for keeping live verification as a gate: the `$queryRaw`/`void` advisory-lock failure (trap 8 below), which had also broken quiz submission outright, and "Forget this card" being effectively unreachable in the UI (fixed `f4236d9`; clicking a term in the activity feed now scopes to that card).

**Known and deliberate:** matching-mode answers render through `MatchingReview`, which has no per-answer card, so they get no per-question erase control even on the permalink. Erasing them via the card or set scope works, as ③a confirmed.

### 2b. ✅ Empty quiz attempts — **DONE 2026-08-12, live-verified.**

Spec: `specs/2026-08-12-empty-quiz-attempts-design.md` · Plan: `plans/2026-08-12-empty-quiz-attempts.md`
Commits `31b1a09` (Tasks 1, 2, 4, 5) and `3811797` (Tasks 3, 6 + the in-flight guard), branch `spec3b-tunable-scoring`, **not merged**.

Tests **1021 → 1083** (96 files), `tsc` clean, lint **186 → 185** problems.

An attempt with no `QuizAnswer` rows no longer counts as history. `ANSWERED_ATTEMPT_WHERE` (`src/lib/quiz/history.ts`) hides it at the two read paths that surface it; submitting a quiz with nothing answered discards it outright through the existing `executeErasure({ kind: 'attempt' })`; and `rescoreSetAttempts` stops a card deletion from stranding a score whose evidence is gone.

**The open question from the deferral is resolved:** a card deletion **nulls the score**, it does not delete the attempt. Erasing memory is a request to destroy data; editing a set is not — and the cascaded population is reached by *another user's* edit.

**Live gate PASSED 2026-08-12** (run by the user; GitHub OAuth puts signed-in pages out of reach from an agent session — trap 6). Verified in the browser against the real database: a partly-answered quiz (2 of 5) survives and its results page shows exactly the answered questions; a blank submit shows "Quiz Skipped" and leaves nothing on `/profile`; an abandoned quiz never appears; deleting a tested card re-scores the attempt, and deleting every tested card nulls the score and drops it off `/profile`.

**One thing the gate could NOT reach, and why it matters less than it looks.** The intended check was "force an AI failure mid-quiz, confirm you get the results screen and not 'Quiz Skipped'" — the scenario `discardSkippedQuizAttempt`'s condition 1 exists for. It is **unreachable by disabling credentials**: `src/app/sets/[id]/quiz/page.tsx:28-31` gates the whole quiz page on *any* enabled credential, before mode selection, so you never reach a short-answer question. Reproducing it needs a credential that is enabled but broken — `saveCredential` does **not** verify keys (that is `testCredential`'s separate job), so a deliberately bogus key can be saved as the only enabled credential. Not run, because the 2-of-5 result already demonstrates `answeredCount()` returns non-zero from real React state and the discard refuses on it; the residual question is only whether a *grading failure* wipes that state before submit, and `answeredCount` never observes the server's response.

**Two findings worth more than the code:**
- The regression guards the plan named for the `updateSet` transaction conversion (`tests/cards/*`) are pure unit tests of helpers `updateSet` *calls* — they **cannot** detect a transaction-shape regression, and would have passed had the ordering been broken outright. Same failure mode as trap 8.
- Restructuring `handleSubmitQuiz` nearly added a `finishStudySession` call on the grading-crash path, because the old shared `try` already skipped it. Caught by mutation testing, not by review.

<details>
<summary>The pre-build analysis, kept for the reasoning (populations, why deferred creation was rejected)</summary>

Found during Task 11 live verification. **User's decision:** an un-answered quiz is a typo, not history — it should not appear at all.

Two distinct populations, and the obvious rule only covers one:
- **11 attempts, no answers and no score** — never answered. `startQuizAttempt` writes the row before any answer exists. "Don't create until first answer" fixes these.
- **5 attempts, no answers but a REAL score** (100, 99, 50…), all dated 2026-07-05 — these *did* have answers. The cards were deleted later, `QuizAnswer.cardId` cascaded, and the attempt kept a score for evidence that is gone. Deferred creation would not have prevented one of them.

So the rule is **zero answers ⇒ not history, scored or not.** Note the second population is the *same* invariant violation this deletion work exists to prevent — a derived number outliving its evidence — reached through the card-delete path rather than a forget verb. `scripts/check-memory-integrity.ts` already detects it (check 4).

**The design, as far as it got 2026-08-12** (brainstormed, no spec written — resume from here rather than from scratch):

- **Filter, don't delete.** One `ANSWERED_ATTEMPT_WHERE = { answers: { some: {} } }` in a new `src/lib/quiz/history.ts`, spread into exactly **two** reads: `getUserStats` (`src/actions/user.ts:42`) and the `repeatBonus` attempt window (`src/lib/metrics/read.ts:113`).
- **The risk is INVERTED from `readableSetWhere`** — do not spread this one everywhere. The other four `quizAttempt` readers (in-flight lookups in `quiz.ts`/`quiz-matching.ts`, the print page, `erase-execute`) must NOT filter: an in-flight attempt has zero answers until the first submit, so over-applying breaks the first question of every quiz. Forgetting it shows a husk; over-applying takes quizzing down.
- Safe to apply in `metrics/read.ts`: every error tag reaches an attempt via `quizAnswer.attemptId`, so any attempt a tag references has ≥1 answer by construction.
- **Re-score on card delete, cross-user.** `updateSet` deletes cards with a plain `prisma.card.deleteMany` (`src/actions/sets.ts:293` — the only card-delete path found) and nothing recomputes the affected `QuizAttempt.score`. Recompute **every attempt on the set** rather than snapshotting affected ones first: the snapshot version needs ids captured before the cascade destroys the link, which makes ordering load-bearing and loses a concurrently-submitted answer; recomputing from ground truth is race-*tolerant*, since a concurrent submit derives the same score itself. No `userId` filter — sets are link-shareable and `startQuizAttempt` is readability-scoped, so the owner's edit strands **other learners'** scores. No privacy cost: each score comes only from that user's own surviving answers.
- **Reuse, don't reimplement.** `planErasure` already has this exact rule at `src/lib/memory/erase.ts:380-410`. Extract it as `storedScore(answers)` into `src/lib/quiz/scoring.ts` (where `overallQuizScore` lives) and have both callers use it — the round-because-the-column-is-`Int` decision is currently duplicated in `quiz.ts` too.
- Must write `null`. `quiz.ts:571` and `:750` both guard `if (newScore !== null)`, which is precisely how an attempt keeps a score after losing all its evidence.
- **Out of scope, decided:** no cleanup sweep (the 2026-08-12 account reset already removed all 16), no change to empty `StudySession` rows (nothing lists them — `studySession.findMany` appears only in `erase-execute`), and card deletion does not become an erasure scope (`KlpState` already cascades correctly via `CardKlp → Card`, so the replay would be a no-op).
- **Left open** when deferred: whether a card deletion that empties an attempt should *delete* it, matching `planErasure:384` ("would otherwise linger in the activity feed as a ghost quiz"), or merely null the score and let the filter hide it. Argument for keeping them different is intent — erasing memory is a request to destroy data; editing a set is not, and deleting another learner's row costs a destructiveness budget the editor was never given.

**What was still broken** (all addressed by the build above; kept because the populations are the reasoning):
- **Abandoned quizzes** — `startQuizAttempt` writes the row before any answer exists; closing the tab left it on `/profile` permanently. Now hidden by the read filter; **the rows still accumulate**, deliberately — no reliable client signal exists to delete them on.
- **Cascaded evidence** — the `updateSet` path above. Now re-scored.
- **Printable tests** are a third population, zero-answer *by design* (`/sets/[id]/print` reads the attempt), which is why "defer `QuizAttempt` creation until the first answer" was rejected outright — it would break print.

It *looked* fixed at the time only because the 2026-08-12 account reset emptied the table.

</details>

### 3. ✅ Spec 3B — tunable scoring — **DONE 2026-08-13, live-verified**

All 10 tasks, one commit each (`c980cfa` … `8ccceea`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1083 → 1181** (100 files), `tsc` clean, lint **185** (unchanged).

`LearnerTuning` holds a strategy plus two sparse, Zod-validated override blobs; `getUserTuning`
resolves them into a complete band table and a complete threshold set. `computeArticulation`,
`shapeTopicProfile` and `rankCandidates` all take the thresholds as a parameter. `getLearnerMetrics`
threads the learner's bands, thresholds and strategy and returns a ranked KLP candidate list
(**still rendered nowhere** — 3C's job). The quiz results screen derives severity, significance and
repeatBonus at read time. Three panels on `/settings/ai`, each sending only its own field.

**Everything is mutation-tested.** 40+ mutants introduced and confirmed to redden. Three guards were
found to be incapable of failing and were rewritten before being trusted:
- the targeting purity test used ids already in alphabetical order, so an in-place sort was a no-op;
- the read-API strategy test used a fixture every strategy ranked identically;
- the new `loadAnsweredAttemptIds` guard matched the *import* rather than the call, so a file could
  import the helper and query around it.

**Three design defects were caught in the spec revision and never built.** See the spec's §0 and
§3.4.1: the unfiltered attempt window, the structurally-always-zero repeatBonus, and the
read-modify-write panel clobber.

**Two things the plan got wrong about the code**, both corrected in place:
- `export { X } from '…'` creates no local binding, and `articulation.ts` reads both constants as
  defaults — it must import and re-export.
- Widening `RawCategoryRow` with `weight`/`cardId` forces every `toTopicRows` fixture to carry
  fields the function ignores. Prisma's inferred row type already carries them; the extra fields
  ride along structurally.

**One structural change the plan did not anticipate:** the attempt-window query moved into
`src/lib/quiz/history.ts` as `loadAnsweredAttemptIds`. Item 2b's guard forbids
`ANSWERED_ATTEMPT_WHERE` in `src/actions/quiz.ts` — correctly, since its in-flight lookups must
never filter — and Task 7 needs that exact filtered window on the results screen. The query moved
to the one file allowed to hold it rather than the guard being loosened to admit `quiz.ts`.

**LIVE GATE PASSED 2026-08-13** (run by the user in the browser; verified from the database side
with `npm run tuning:check`, a new read-only script that calls the real `getLearnerMetrics` —
necessary because two of this spec's effects render nowhere until 3C).

- **Panels persist.** The stored row ended up as `bands: {too_terse:[1,2]}`,
  `thresholds: {minObservations: 1, articulationMinPKnown: 0.8}`, `strategy: balanced` — three
  fields written by three different panels, coexisting. That is the **discriminating** case for
  partial saves: an earlier snapshot with `bands: {}` could not tell the correct design from the
  write-all-three one, because both produce that row. The user separately confirmed the settings
  survived a quiz.
- **The observation floor demonstrably works.** With the floor at 1, the topic carrying the one
  studied card went `null (below floor)` → **0.131**, and its two KLPs went `sufficient: false`
  → `true`, sorting to ranks 0 and 1 above all 24 sub-threshold candidates.
- **The ranking arithmetic reconciles.** Scores 0.312 (weight 5) and 0.196 (weight 3) reproduce
  `balanced` by hand from pKnown 0.131 and readiness 0.5 — so the floor, the strategy, the KLP
  weight and the topic's readiness are all genuinely feeding the order rather than merely
  appearing in it.

**Two preconditions the gate discovered, both non-obvious and worth knowing before judging this
feature "empty":**
1. A card must be **both categorized and have live KLPs** to be rankable at all. At first run the
   library had 68 KLP-bearing cards and 4 categorized cards with **zero overlap**, so the ranked
   list would have stayed empty however much the user studied — indistinguishable from a broken
   feature. `tuning:check` now reports this coverage explicitly.
2. Categorizing a card **retroactively** pulls existing `KlpState` evidence into its topic —
   posteriors are keyed by KLP id, so no re-quizzing is needed.

**Left in a test state on purpose** (the user's call to revert or keep): `minObservations` 1,
`articulationMinPKnown` 0.8, a `too_terse` band override, and a `test-category` category.

### 4. ✅ Spec 3C — learner dashboard & study scope — **BUILT 2026-08-14. LIVE GATE PASSED 2026-08-17.**

All 12 tasks + Task 4B, eight commits (`aa979da` … `fd4e670`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1181 → 1286** (105 files), `tsc` clean, lint **185** (unchanged).

`/profile/learner` exists and is the first production caller of `getLearnerMetrics`. A fourth `LearnerTuning` blob holds the saved study scope, with a fourth `/settings/ai` panel and a quiz-setup prefill. Both Spec 3 §14 prompt-block defects are closed.

**Verified live, headless:** Task 4B took the ranked list from **28 to 152 candidates** on the real library — 124 uncategorized KLPs that targeting could not previously see. `npm run tuning:check` now reports coverage from the same helper the page uses, and prints the diagnosis the dashboard would render.

**Everything mutation-tested — 48 mutants, all killed.** Five of them only died after the *test* was fixed:
- a `parseStudyScope` spread copied the array **references**, so one caller mutated the shared module constant. Caught by its own "returns a fresh object" test failing an unrelated assertion.
- a `Uncategorized` mutant that only flipped `checked` rather than removing the option — invisible to every assertion.
- a fixed 600-char topic reserve in `capBlock` that could be set to **zero** with no test noticing; removed rather than kept as a magic number.
- a capBlock sweep that sampled one card-section size where the boundary happened not to bite (now sweeps 31).
- an assertion for the `By topic:` header, which survives while the line beneath it is dropped.

**Two type-level facts worth keeping:** `StoredStudyScope` must be a **type alias, not an interface** — TS infers an implicit index signature for aliases only, and Prisma's `InputJsonValue` requires one, so an interface needs a cast that defeats validating the blob. And making `studyScope` **required** on `shapeTuning`'s input is what made `tsc` name all three `select` clauses that needed it; optional would have compiled clean and handed `undefined` to the parser, which degrades silently to an empty scope — the setting would appear to save and then not exist.

**GATE PASSED 2026-08-17**, run by the user in one session (trap 6 — no signed-in page is reachable from an agent session). Checked: the four-panel partial-save proof, the saved-scope notice and "Show everything", the all-stale widening notice, the quiz prefill in and out of scope, and the empty-state copy quoting a floor of 1.

<details>
<summary>Superseded: the in-progress entry</summary>

Spec: `specs/2026-08-05-spec3c-learner-dashboard-design.md` — revised 2026-08-13 against shipped 3B, and **widened**: it now also carries a **saved study scope** setting (its §6), added at the user's request. §5 widened again 2026-08-14 to **four** empty causes.
Plan: `plans/2026-08-14-stage8-spec3c-learner-dashboard.md` — 12 tasks + Task 4B.

**Task 4B added 2026-08-14: uncategorized KLPs enter targeting.** Candidates walk `CardCategory` → card → live KLP, so a card with no category is in no topic and therefore in no candidate list, even though `KlpState` holds a real posterior for it. Only `readiness` is topic-derived, and `articulationGap` already treats null as "no articulation problem" — so the topic is load-bearing for the *query shape*, not the scoring. Uncategorized KLPs now rank; they do **not** get a topic-mastery row (a grab-bag is not a concept). This turns the 68-vs-4 empty dashboard from a thing to explain into a thing that works.

The dashboard is the **first production caller of `getLearnerMetrics`**. It renders `ranked` in the order received — 3B already applied the learner's strategy, so a component that re-sorts is a defect, and a test asserts the DOM follows a reordered fixture.

**Saved study scope** (§6): a fourth panel on `/settings/ai`, a fourth sparse blob (`studyScope`) on the existing `LearnerTuning` row, riding the partial `saveTuning` that 3B built. Two checkbox groups — sets and categories. **Decided with the user:** it scopes the dashboard default and the ranked list, and **prefills** quiz setup's category selection, overridable; it is **not** an enforced filter, and it **never** touches what is recorded. Sets store ids, categories store `normalizedName` (a `CardCategory` row is set-scoped, so ids would mean one set's "accounting" only).

**Must also close both Spec 3 §14 follow-ups** — still open, re-verified 2026-08-13:
- `profileToPromptBlock`'s callers hardcode `topics: []` (`src/lib/ai/context.ts:155`, `src/actions/training-plan.ts:34`), so topic-grain data reaches **no prompt**.
- `capBlock` truncates the topic section **first**, because the uncapped card section is concatenated ahead of it.

**Fix both together or neither** — closing the first alone silently drops the topic signal the moment an active learner's card section fills `MAX_PROFILE_CHARS`. Shipping a dashboard that shows topics while every prompt still sees `topics: []` would say plainly that the dashboard and the AI are looking at different learners.

**Four empty causes, not one** (§5), two of which the 3B gate produced and which read as a broken page: no history at all; evidence below the learner's floor; **no card that is both categorized and has live KLPs** (the real library had 68 KLP-bearing cards and 4 categorized cards with zero overlap, which yields an empty dashboard however much the learner studies); and a valid-but-narrow saved scope. The last two must not be merged — both are "nothing is categorized", but the remedies are opposite (categorize vs. widen). Also worth telling the learner: categorizing an already-studied card works retroactively.

**Do not hardcode 3 as the evidence floor** anywhere in the copy — it is `MetricThresholds.minObservations` per learner since 3B, and a learner who set it to 1 would be told they need evidence they already have.

</details>

### 5. ✅ Profile & sets UI overhaul — **BUILT 2026-08-14. LIVE GATE PASSED 2026-08-17.**

Plan: `plans/2026-08-14-profile-and-sets-ui-overhaul.md` (written from an audit — every task closes a named, checkable gap, not a taste call).
Commits `70d5f35`, `17b31f7`, `6e103f5`, branch `spec3b-tunable-scoring`, **not merged**.
Tests **1286 → 1311** (108 files), `tsc` clean, lint **185 → 178** — the 7 dead imports on the set detail page.

**Profile area.** Three sibling pages had no navigation between them (Spec 3C created that by adding the third) and the parent was titled *"Your Learning Memory"* while a child was *"Memory History"*. Now one `ProfileNav` tab strip on all three — **Overview / Learner Profile / Memory History** — with **exact-match** `aria-current`; a `startsWith` test would mark Overview current on every child route. `/profile`'s "Performance by Mode" panel was **removed, not restyled**: a flat average score per quiz type beside a BKT posterior asks the reader to reconcile two numbers answering different questions. Attempt *counts* stayed — activity facts, not judgements. The full-route spinner is gone; header and nav render before the stats, so a learner waiting on `getUserStats` can still navigate.

**Sets surfaces.** `SetCard` now shows a **Private/Shared badge** (visibility shipped in item 1 and appeared nowhere in the list), confidence, studied-of-total, a due badge, and last-studied in place of created. `loadSetStudySummaries` is one query for the page, shared with the set detail header so the two cannot disagree. The nested `<Button>` inside the card `<Link>` is gone — invalid HTML and a duplicate tab stop.

**A convention bug caught before it shipped:** the first implementation treated a **null `dueAt` as NOT due**. `getDueCards` (`src/lib/memory/schedule.ts:185`) does the opposite — `OR: [{ dueAt: null }, { dueAt: { lte: now } }]` — and the schema comment says so. Null means never scheduled, which is a reason to review. Diverging would have made the sets list report fewer due cards than Review mode then offers, with nothing to tell the learner which surface was lying.

**Mutation testing, 11 mutants, 10 killed and one deleted.** The null-average ternary (`count === 0 ? null : …`) turned out to be **unreachable** — a bucket only exists because a row created it — so it could be flipped to `? 0` with no test noticing. The branch was removed rather than kept; the real guarantee is that an unstudied set gets **no entry in the map at all**, which the test now pins. Same call as the 600-char reserve in Spec 3C Task 12.

**Also worth knowing:** two component tests failed on **timezone**, not logic — `new Date('...T00:00:00.000Z')` formats to the previous day west of Greenwich. Date fixtures compared against `format` output must use local-time constructors (`new Date(2026, 6, 1)`).

**GATE PASSED 2026-08-17** (trap 6): the nav appears on all three profile pages and marks the right tab; `/profile` renders header and nav before stats; `/sets` shows visibility on every card.

> **PARTLY SUPERSEDED by item 6b (2026-08-16).** The rest of this gate — "study state on a studied
> set, and neither a 0% nor a due count on an unstudied one" — **cannot be checked any more**: 6b
> removed confidence, studied-count and the due badge from `SetCard` outright at the user's request.
> The `SetCard` tests now pin their ABSENCE. Only the visibility badge and the last-studied date
> remain from this item's sets work.

### 6. ✅ Design system & scope redesign — **BUILT 2026-08-15. LIVE GATE PASSED 2026-08-16.**

Spec: `specs/2026-08-15-design-system-and-scope-redesign-design.md` (audit first, design second).
Five waves, one commit each (`20c865f` … `e80e88b`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1311 → 1340** (108 → 112 files), `tsc` clean, lint **178 → 176**.

Triggered by the user's report that "all the filters under profile is way too complicated", widened
at their request to the whole app's visual language. **Do this before Spec 4** — Spec 4 adds a third
scope picker (`inputScope`), and building it on the old model would have duplicated the mess again.

**The root cause of "it doesn't look professional" was in the tokens.** Every value in `globals.css`
was `oklch(L 0 0)` — zero chroma, including all five `--chart-*`; the only chromatic token was
`--destructive`. That absence is why **149** raw Tailwind palette values had accumulated across
`src/`. Now: one ink-indigo accent, a **sequential** `--know-0..4` ramp (mastery is an ordered
quantity, not a category), an ordinal `--severity-*` scale on a distinct hue axis, five real chart
hues, and Fraunces / IBM Plex Sans / IBM Plex Mono replacing Inter doing all three jobs.

**Dark mode was fully written and unreachable** — `.dark` was complete, nothing ever applied the
class, and the 7 files hardcoding `bg-gray-50` would have rendered broken if it were switched on.
Now real, with a navbar toggle placed outside the auth branch.

**Four chip implementations became one** (`SelectableChip`). Selection is an accent fill everywhere,
never the category's own colour: two of the four used `${color}20` with that colour as the *text*,
which a reachable dark mode turns unreadable. Identity survives as the dot; a check mark means
selection is never colour alone.

**The scope filter is one collapsed line.** The Card `<select>` is deleted (disabled unless exactly
one set was selected, explained only in a `title`); `source` stopped being scope and the "By mode"
chips *became* the control they used to sit uselessly beneath; the saved-scope notice, the "Show
everything" button and the chip panel folded into one line. `ProfileNav` now carries scope across
tabs — it was silently discarded before, though both pages parse the same `HistoryScope`.
`StudyScopePanel` lost the checkbox whose only extra state was invalid, deleting the block logic.

**One confirmed functional bug fixed:** Print Test built `?modes=&side=&count=` only while the print
page typed exactly those keys and read every card — so Starred/Failed/Categories were silently
dropped. Both halves fixed, the page now running the *same* `filterQuizCards` the quiz runs.

**Four findings worth more than the diff** are in the spec's §7 — including a third
guard-that-could-not-fail, and the card chip still being hideable despite the design saying it must
not be.

**LIVE GATE PASSED 2026-08-16** (run by the user — trap 6). The three load-bearing checks all
worked: **dark mode**, **Print Test with filters**, and the **`/settings/ai` panel saves**. Those
three were ranked risky for three different reasons — ~150 token substitutions are invisible to the
suite (a wrong-but-valid token compiles and passes), the print page half is a server component with
no test coverage in this repo, and the settings panel is the only one that **writes to the
database**, where Spec 3B's partial-save contract could break with no mock noticing. The three
cheap checks (scope line opening, scope surviving a tab change, by-mode chips) were **not separately
confirmed** — all are unit-tested with killed mutants and inert-if-broken. Recorded as unconfirmed
rather than assumed. Detail in the spec's §8.

### 6b. ✅ UI polish — set page, edit visibility, memory history table — **BUILT 2026-08-16. LIVE GATE PASSED 2026-08-17.**

No spec — a direct list of user-reported changes after living with item 6. Branch `spec3b-tunable-scoring`, **not merged**.
Tests **1340 → 1372** (112 → 114 files), `tsc` clean, `next build` clean, lint **176** (unchanged).

**Set surfaces.** Category chips came off the flashcard carousel (the filter bar above is the one
place category is a *control*), as did "Click card to flip" — and the flip target became a real
`<button>`, since that text was the only thing announcing an affordance a `<div onClick>` offered to
mouse users alone. `VisibilityToggle` is **deleted**; visibility is now a dropdown at the top of
`/sets/[id]/edit` (`VisibilityMenu`), and the activity tiles moved up into the block it vacated,
made small and given one shared surface instead of three chart hues. Confidence, studied-count and
the due badge are gone from both the set page and `SetCard`.

**Memory History.** "Showing" → "Filter by:", and the by-mode chip row under the stat tiles was
**removed, not restyled** — it was a second filter surface sitting below the numbers it filtered.
Its dimension became a third `MultiSelect` in the scope line beside sets and categories, which
required `HistoryScope.source` (single) → **`sources` (list)**; "how did I do on the two written
modes?" was previously unaskable. The feed is now a table (card / set / type / date / accuracy /
confidence) and a row's primary click opens `/profile/activity/<sessionId>` instead of narrowing the
page to that card — the old click produced a filtered copy of the list you were already reading.

**Four things worth more than the diff:**
- **The URL key did not change.** `sources` still serializes to `?source=`, comma-joined, so
  `ProfileNav`'s `SCOPE_PARAM_KEYS` needed no edit and single-value URLs written by the old version
  still parse. A test pins that.
- **`bySource` had to stop being counted under its own filter.** It is the picker's option list, so
  under the full scope, selecting Multiple Choice drove every other option to 0 — reading as those
  activities having been deleted, on the exact interaction that reveals the counts. Now counted with
  the source dimension removed and the others kept. This one had **no guard until one was written**;
  it was the only mutant of five that survived.
- **Moving the visibility control broke "Copy link" silently.** It used `window.location.href`,
  which on `/sets/<id>/edit` copies an edit URL the recipient cannot open. Rebuilt from `setId`.
- **The card-scope affordance had to be preserved deliberately.** Clicking a term was the ONLY route
  into card scope, which is the only route to "Forget this card" — already lost once (`f4236d9`).
  Reassigning the row click to the permalink would have lost it again, so it survives as its own
  always-visible button (never hover-only: that would also put it out of reach on touch).

**Five mutants introduced, five killed** (after the facet guard was written): truthy-`score` in
`outcomeText` swallowing a real 0%, an unconditional permalink linking `/profile/activity/null`,
the activity picker rendering on the learner dashboard (where filtering a knowledge model by answer
mode halves every posterior), `sources` dropped from `isConsolidated`, and the facet count above.

**GATE PASSED 2026-08-17** (trap 6): every surface here is signed-in only. Checked: the edit-page
visibility dropdown **persists and Copy link yields `/sets/<id>` not `/sets/<id>/edit`**; the
activity picker filters the feed and its option counts **do not collapse** when one is selected;
a feed row opens the right activity, and a row with no session renders unlinked; and the set page
shows tiles where the visibility panel was, with no confidence or studied numbers anywhere.

### 6d. ✅ Account page & the learning/account naming split — **BUILT 2026-08-17. LIVE GATE PASSED 2026-08-17.**

No spec — a direct user request. Branch `spec3b-tunable-scoring`, **not merged**.
Tests **1372 → 1404** (114 → 116 files), `tsc` clean, `next build` clean, lint **176** (unchanged).
**Migration `20260817000000_user_handle_and_contact` is APPLIED to the dev database**, verified
by a follow-up `migrate diff` reporting an empty migration.

`/account` exists: handle, account email (read-only), contact email, email-updates opt-in,
theme, and a sign-in section. The three `/profile/*` pages are now the **Learning** section —
navbar link, `/profile` `<h1>` and the `ProfileNav` landmark all renamed, with cross-links
both ways. This is **step 1 of item 6c's build order**: `User.handle` + `normalizedHandle`
ship here, so the sharing work starts at step 2.

**Two of the six requested items were deliberately NOT built, each for a stated reason** —
both decisions taken with the user:
- **Language** — the app has no i18n whatsoever (no library, no catalogue, every string a
  literal). A selector with one entry is a promise it cannot keep.
- **Password** — half of credentials auth, not a settings field. It ships with the login page
  or not at all. See the `wants-credentials-login` memory; note it would also close **trap 6**,
  since an agent could then sign in and run its own live gates.

**Three design points worth keeping:**
- **`contactEmail` is a separate column from `email`.** `email` is identity and the future
  password-reset address, so editing it needs a verification round trip it does not have —
  making it editable would be an account-takeover vector. A contact address cannot recover an
  account, so it is safe to edit freely. That split is what makes "add your email" buildable
  today.
- **One action per field**, not one `saveAccount(partial)`. The structural version of the
  `/settings/ai` partial-save contract — a clobber is unrepresentable here rather than merely
  tested for.
- **Handle collisions are resolved by the P2002 constraint violation, not a pre-flight SELECT.**
  A check-then-write is a TOCTOU bug, and the collision is ordinary use (two people want the
  same name), not an edge case.

**A dead reservation the tests caught:** `me` was in `RESERVED_HANDLES` but is 2 characters, so
`too_short` returns before the reserved check ever runs — protection that could not fire.
Removed, and an invariant test now pins that every reserved entry would otherwise be a *valid*
handle, which is what makes the "every reserved name is rejected as reserved" test a real claim.
Same call as the unreachable ternary in item 5 and the 600-char reserve in Spec 3C.

**Three mutants introduced, three killed:** writing `handle` without `normalizedHandle`
(leaving the uniqueness key null for that row), treating any database error as "already taken",
and comparing the reserved list case-sensitively.

**Deferred deliberately:** the routes are still `/profile/*`. Renaming them to `/learning/*`
touches **23 call sites** including `revalidatePath` strings and the memory-scope query params;
it wants its own commit and its own verification, not a ride-along.

**GATE PASSED 2026-08-17** (trap 6): a handle set and persisted; a reserved one
(`admin`) and a taken one; save and then **clear** a contact email; toggle email updates and
reload; confirm the theme choice matches the navbar toggle; confirm the navbar shows both
**Learning** and **Account**.

### 6f. ✅ Study candidates say what they are — **BUILT 2026-08-17.**

No spec — a direct user request after the gate run. Branch `spec3b-tunable-scoring`.
Tests **1404 → 1412**, `tsc` clean, `next build` clean, lint **176** (unchanged).

**`/profile/learner`'s study list rendered the literal words "Key point" for every row.**
`StudyNextRow` has always accepted `text`, `term` and `topicName`, and the page populated only
`topicName` — so the fallback in `CandidateRow` was the entire list. On a library where most
cards are uncategorized (Task 4B put 124 such KLPs into targeting) that is a page of identical
rows reading "Key point / Uncategorized".

Fixed by widening the two loaders' selects — `CardKlp.text` and `Card.term` — and gathering the
labels in the **same walk** that already builds `klpWeights`/`klpCardIds`, so no extra query.
Exposed as `LearnerMetrics.candidateLabels`, a `klpId → { text, term }` map kept **beside**
`ranked` rather than folded into it: `targeting.ts` scores, and a scoring module should not carry
prose it never reads. The page merges labels exactly where it already merged `topicName`.

**Two behaviour changes beyond the labels:**
- **The sub-threshold group is now ordered by `observations`, not by score.** Below the floor,
  `score` is largely a function of the BKT prior — most candidates are tied at it — so ordering
  by score there ranks noise and presents it with a measured recommendation's authority.
  Evidence is the one thing that genuinely differs, and "closest to being measurable" is the
  useful order. Ties fall back to score, then to input order (`Array.sort` is stable). The rule
  is scoped to the sub-threshold group: applying it above the floor would override the learner's
  chosen strategy with a proxy for "how much have I answered this".
- **The answer count renders on every row**, measured or not — it is the sub-threshold sort key,
  and an order with its key hidden is not readable as an order. **`pKnown` stays gated on
  `sufficient`**: "50% known" beside a single answer states a confidence the evidence cannot
  support, which is the floor's whole purpose. Zero renders as "No answers yet", not "0 answers",
  which on this list reads as a score rather than a state.

**Five mutants introduced, five killed** — the evidence ordering (twice: single-strategy and
all-strategy), the count hidden on unmeasured rows, and the proposition replaced by the literal
fallback. Before these tests, **none of the three behaviours had any coverage**: the first full
run after the change passed untouched.

### 6e. ✅ Credentials auth — **BUILT 2026-08-18/19. LIVE GATE PASSED 2026-08-19 — the first live gate in this project run by an agent, not handed to the human. Closes trap 6.**

Design + task order: `specs/2026-08-17-credentials-auth-design.md`. Plan: `plans/2026-08-18-credentials-auth.md`. Ledger: `.superpowers/sdd/2026-08-18-credentials-auth/progress.md`. Task 10 report: `.superpowers/sdd/2026-08-18-credentials-auth/task-10-report.md`.
22 commits (`fdb6c42` … `2d50cca`), branch `spec3b-tunable-scoring`, **not merged**.
Tests **1412 → 1522** (116 → 127 files), `tsc` clean, `next build` clean, lint **176 → 175** (131 errors, 44 warnings — one below the baseline this queue has tracked since item 6b).

**The final whole-feature review found one thing eleven task reviews could not, and it is the argument for running one.** Three separate strings told a password-only account it had GitHub: `/account` named GitHub as the sign-in method *and* as the source of the account email, and the password panel said GitHub was "the only way back in" — for an account Auth.js will refuse with `OAuthAccountNotLinked`. With no password reset, that last one is the difference between "keep this safe" and "you have a fallback". None of it was wrong when written; the app simply used to have exactly one way in, and the copy stated that as fact. It fell between tasks because every task's own diff was correct. Closed in `2d50cca` by deriving `hasGithub` the same way `hasPassword` is derived — selected, never returned raw — and gating the copy on it.

Sign up and sign in with a username-or-email plus password, alongside GitHub OAuth. Chosen over item 6c and item 7 because a public directory is for strangers and a stranger cannot sign up today, and because it closes trap 6. **Two facts made it smaller than it looked:** `session: { strategy: "jwt" }` was already set in `src/auth.ts`, and `User.handle`/`normalizedHandle` from item 6d meant the username half needed no new validation. **One fact made it dangerous:** `src/middleware.ts` imports `auth.config.ts` on the **edge runtime**, so the Credentials provider had to live in `src/auth.ts` only — enforced by a guard that walks the transitive import graph, not a string search.

**Sign-up sits behind `CREDENTIALS_SIGNUP_ENABLED`, off by default — the user's call, confirmed live on 2026-08-18/19.** The design's recommendation (public sign-up with no password reset carries more risk than the trap-6 win justifies) became the shipped behaviour. Sign-in is **never** gated — that is the entire point, since sign-in is what closes trap 6. **Includes `scripts/seed-dev-user.ts`** (Task 9), the piece that actually ends the human-gate bottleneck: it upserts `dev_user` / `dev@localhost.test` and refuses to run against a production `DATABASE_URL`.

**Three real defects found during build, none of them anticipated on paper:**
- **Task 7 shipped a Critical: the callback-URL open redirect was bypassable**, and closing it took three review rounds. `raw.startsWith('/') && !raw.startsWith('//')` validated a string the WHATWG URL parser then rewrites (folding backslashes, stripping control characters), so `?callbackUrl=/\evil.com` passed the guard and resolved off-origin through both `router.push` and `@auth/core`'s default redirect callback. Round 2 closed every reported payload but left a dot-segment class (`/..//evil.com`) that still resolved off-origin; round 3 parses the callback against one sentinel and validates the *output* against a different one, and a ~700,000-input fuzz across 11 attack classes then found zero escapes.
- **Task 4's edge-safety guard had a gap that would have hidden its own defeat.** The import-graph walk missed `await import(...)` dynamic imports and matched forbidden subpaths by exact string only, so `@prisma/client/edge` slipped straight through a check written to catch `@prisma/client`. Fixed by extracting `parseImports`/`isForbidden` as pure functions with their own tests.
- **Task 8's password-change action passed all nine of its tests while hashing the wrong field.** `hashPassword`/`verifyPassword` were mocked and no test inspected their *arguments*, so a mutant that called `hashPassword(input.current)` — locking the account to the OLD password on every change — was indistinguishable from correct. The seventh could-not-fail guard this plan produced.

**One design point worth keeping, because Task 10's gate depended on it:** revocation was traced end to end during Task 4's review and genuinely works. `jwtCallback`'s no-user branch returns the token unchanged on a `sessionVersion` match and `null` on mismatch, with **no healing path** — `sv` is only re-stamped at a fresh sign-in. But **the RSC `auth()` path discards the clearing `Set-Cookie` header** (`next-auth` `json()`s the response before returning it), so the cookie can outlive the session it names; eviction happens only on `/api/auth/session`, API routes and middleware. Recorded as Ruling R8 specifically so Task 10 would assert *denied access*, not a vanished cookie.

**LIVE GATE, run 2026-08-19 against `npm run dev` (secrets passed to the process — `.env` still carries neither) and the real dev database:**
1. **Suite/types/build/lint** — 127 files / 1517 tests passed, `tsc --noEmit` silent, `next build` compiled clean, lint **175** (131 errors, 44 warnings). (The final review's fix wave later took this to **1522**; the gate itself ran at 1517.)
2. **Handle sign-in** — `dev_user` + password → `/sets`, navbar shows Learning / Account / Sign out. **This is the trap-6 close.**
3. **Email sign-in** — `dev@localhost.test` + the same password → identical result, proving the either-identifier lookup runs against the real database, not a mock.
4. **Failure message is identical for both misses** — a wrong password on the real account and a fully unknown identifier both rendered the exact string `Email or password is incorrect.`, byte for byte. No enumeration oracle.
5. **Protected-route round trip** — signed out, `/sets/<id>/quiz` → redirected to `/login?callbackUrl=%2Fsets%2F<id>%2Fquiz`; signing in landed on the quiz page itself, not `/sets`. (`dev_user` started with zero sets; one was created through the UI to get a real id to redirect to.)
6. **The flag gates sign-up, not sign-in** — restarted the server without `CREDENTIALS_SIGNUP_ENABLED`: `/signup` 404s, `/login` shows no "Create an account" link, and signing in with the existing password still worked.
7. **Revocation denies access, exactly as Ruling R8 predicted** — changed the password at `/account`; the very next request to `/account` itself bounced to `/login?callbackUrl=%2Faccount`, and a fresh request to `/sets` rendered the signed-out "Sign in to see your sets" state. Denied access without a vanished cookie — the RSC-discards-`Set-Cookie` behaviour Task 4 flagged, observed live rather than assumed. Signed in with the new password to confirm it worked, then ran `npm run seed:dev-user` to restore the original password and confirmed that signs in too.

**Two things this gate could not run, and why — owed to the human:**
- **GitHub OAuth.** `.env` has no `GITHUB_ID`/`GITHUB_SECRET`. Clicking "Continue with GitHub" produced no server-side request at all (confirmed against the dev server log) — the provider is unreachable, not merely untested.
- **The `OAuthAccountNotLinked` copy** (Task 7) needs a real GitHub account whose email matches an existing password account — not producible from this environment.

### 6c. ✅ Public sets, fork & discovery — **BUILT 2026-08-27. LIVE GATE OWED.**

Design: `specs/2026-08-27-public-sets-and-discovery-design.md` (supersedes the 2026-08-17
6c design for execution; that document stays authoritative for **collaborators**, its §2,
which is still unbuilt and was deliberately cut).
Plan: `plans/2026-08-27-public-sets-and-discovery.md`. 14 tasks in 4 waves, commit range
`59b44e6..b0a9b06`.

**What shipped:** `public` as a third visibility (`private | link | public`), `/browse` with
cursor pagination and composed search, `SetView` + a view-keyed "Jump back in", **fork**
with real blob duplication and viewer-scoped attribution, a real homepage (`/` no longer
redirects), report + operator unlist, and Home / Browse / Library navigation. Plus the
**"Instrument" chassis** — the Phase 0 token, type-scale and primitive work the visual
revamp builds on.

**New baselines (this branch, 2026-08-27):**
- **Tests:** 184 files / **2241 passing** (was 175 / 2142 before this item — note the
  previously recorded 153 / 1790 was already stale)
- **`tsc --noEmit`:** clean · **`next build`:** clean · **`npm run lint`:** **175 problems** — unchanged

**Five things worth knowing before touching this:**
1. **`readableSetWhere` uses `in`, not a second `OR`.** The naive extension would have made
   its SIGNED-OUT branch an `OR` too, doubling the replace-my-`OR` hazard at exactly the
   moment `/browse` arrived as the first call site with an `OR` of its own. Every read with
   its own predicate composes through `composeSetWhere`.
2. **A guard in the enforcement suite could not fail.** `directory.ts` documents the
   predicate at length, so a raw `includes()` matched the DOC COMMENT while the code did
   something else. Every assertion there now runs against a comment-stripped copy. Second
   time this shape has appeared in this repo.
3. **The fork test's blob mock ignored its options argument**, so `access: 'public'` — which
   would make every forked asset world-readable and route it around `/api/assets/[id]` —
   left all 11 tests green. I wrote that exact bug on the first pass and only mutation
   testing caught it.
4. **The plan contained a command that would have wiped the dev database:**
   `prisma migrate diff --shadow-database-url "$DATABASE_URL"`. `migrate diff` RESETS the
   shadow database. It failed safe only because Prisma 7 removed the flag.
5. **Fork is bounded by asset COUNT, not just bytes** (`FORK_MAX_ASSETS = 200`), and its
   writes are BATCHED. An interactive `$transaction` with sequential awaits would have hit
   Prisma's 5s default long before `FORK_MAX_CARDS` fired.

**OWED — the live gate (design §16), not agent-runnable here.** Nine steps, of which step 8
matters most: *directory search for a PRIVATE set's exact title must return nothing* — that
is the widened-`OR` defect, live. Also owed: a human read on whether the Instrument chassis
actually looks less generic. No test covers that, and it is the whole point of Phase 0.

**Still unbuilt from the original 6c:** collaborators / "Editable by" (6c §2), ownership
transfer, `/{handle}` creator pages.

---

### 6f. ✅ App shell, navigation & settings — **BUILT 2026-08-28. LIVE GATE OWED.**

Spec: `specs/2026-08-28-app-shell-design.md` · Plan: `plans/2026-08-28-app-shell.md`
Branch `spec3b-tunable-scoring`, 5 commits (`2d66302` … `86c9d18`), **not merged**.

The first half of what the owner asked for on 2026-08-27 ("revamp the entire UI"). Home /
Browse / Library left the navbar for a persistent 240px left rail with a live Recents list;
the top-right avatar opens a menu holding Settings / Learning / AI settings / Other settings
/ Help. `Navbar.tsx` is deleted.

**New baselines (this branch, 2026-08-28):**
- **Tests:** 190 files / **2335 passing** (from 184 / 2241)
- **`tsc --noEmit`:** clean · **`next build`:** clean · **`npm run lint`:** **175** (unchanged)

**Five things worth knowing before touching this:**

1. **The route group is the whole design.** `src/app/(app)/` holds everything that gets the
   shell; the five study activities (`quiz`, `quiz/print`, `match`, `review`, `print`) and
   every auth page sit OUTSIDE it and render bare. A timed game with a nav column beside it
   invites you to leave, and the print views must be chrome-free. `tests/shell/route-structure.test.ts`
   enforces the split **and** fails on any page classified as neither — the ENFORCED_PATHS
   shape, applied to routing.
2. **A layout bug had to be fixed first, and it is why this touched every page.** Root
   `layout.tsx` applied `max-w-6xl mx-auto px-4` and then all 17 pages applied their own on
   top: centered inside centered, `px-4` twice. Invisible while both centered on the same
   axis; a fixed rail is what exposes it. The shell layout owns the measure exactly once and
   the root owns none. **Pages must not re-center themselves** — a narrow measure is
   `max-w-2xl` with NO `mx-auto`, because left-aligned against the rail is the correct edge.
3. **`User.avatarUrl` is a new column and must not be collapsed into `User.image`.** The
   Auth.js adapter owns `image` and rewrites it from the GitHub profile on every OAuth
   sign-in, so a photo stored there silently reverts. Precedence lives in `resolveAvatar`.
4. **Blob `access` deliberately differs by call site, and is now asserted in BOTH
   directions.** Avatars are public (they sit beside published sets; a private blob adds a
   proxy hop and buys no privacy); card assets and fork copies stay private. Asserting one
   side only leaves the other free to move, and moving the fork side is a silent auth bypass
   — the bug actually written here on 2026-08-27.
5. **Feedback persists before it mails.** `send.ts` must never throw and therefore swallows
   delivery failures, and `RESEND_API_KEY` is absent in development — so email-only delivery
   loses the message by default, not by accident. `Feedback.delivered` records what happened.

**Deliberately NOT done, with reasons:** only 3 of the 13 `shadow-*` utilities were removed.
The other 10 are on genuinely floating layers (popover, node inspector, canvas toolbar,
active tab) where elevation is what says "above the page"; the spec's "remove elevation" line
assumed all 13 were decoration and was wrong.

**OWED — the live gate (spec §13), not agent-runnable here** (`.env` has only
`DATABASE_URL`, so `auth()` throws `MissingSecret`). Ten steps. The two that matter most:
**step 7** — upload an avatar, sign out, sign in *with GitHub*, and confirm the picture
survives (the exact failure `User.image` would have caused); and **step 9** — submit feedback
with `RESEND_API_KEY` unset and confirm the row exists with `delivered: false` while the body
prints to the server log.

**Next: Spec C — set views + Atlas.** Study / Knowledge / Analysis tabs on the set page, the
concept tree moving into Knowledge, and the spatial Atlas surfaces. Decisions already taken
with the user are in the memory note `set-views-and-atlas-owed`; do not re-litigate them.

---

### 6g. ✅ Set views & Atlas — **BUILT 2026-08-28. LIVE GATE OWED.**

Spec: `specs/2026-08-28-set-views-and-atlas-design.md` · Plan:
`plans/2026-08-28-set-views-and-atlas.md`
Branch `spec3b-tunable-scoring`, 2 commits (`b42c5dd`, `2521b3c`), **not merged**.

The second half of the 2026-08-27 request. The set page is now Study / Knowledge / Analysis
via a `(views)` route group; Knowledge shades the concept canvas by mastery and offers a
Map | List toggle; Analysis ships with real retention, misconceptions and pace, plus one
in-progress block for the error taxonomy.

**New baselines (this branch, 2026-08-28):**
- **Tests:** 195 files / **2422 passing** (from 190 / 2335)
- **`tsc`:** clean · **`next build`:** clean · **`npm run lint`:** **175** (unchanged)
- **No migration.** Every number comes from data that already existed.

**Three decisions revised from the design conversation, and why:**

1. **`/sets/[id]/concepts` was NOT redirected into Knowledge.** The owner asked on
   2026-08-28 to keep the full editor at its own route. Knowledge embeds the canvas
   read-only; the tree is still authored there. `ConceptCanvas`'s new `shades` prop is
   **optional** precisely so that page renders exactly as before.
2. **Knowledge has a Map | List toggle.** The list is not a fallback — it takes
   `TopicMasteryRow[]` and imports nothing from KLT, because it must **outlive the concept
   tree** when KLP-inherent topics arrive beside user categories (CLAUDE.md, 2026-08-14).
   Typing it against `SetKltNode` would have guaranteed a rewrite.
3. **Analysis ships real, not stubbed.** `getLearnerMetrics({ scope: { setIds: [id] } })`
   already returns misconceptions, a forgetting curve and pace outliers for one set, and
   `RetentionPanel`/`MisconceptionList` already render them. Stubbing would have hidden
   working analysis behind a placeholder.

**Four things worth knowing before touching this:**

1. **`shadeForKnowledge(null)` is `'unknown'`, never `'weak'`.** The fifth place this rule
   is stated. `knowledge ?? 0` paints every untouched concept in the alarm colour, so a
   fresh set renders as a wall of red and the learner learns to ignore the shading. A
   MEASURED zero is still `weak`.
2. **Shades are named, not just coloured.** A fill-only shade is unreadable to anyone who
   cannot distinguish the hues, and "no evidence vs bad evidence" is not a colour.
3. **The `(views)` group is what keeps `edit` and `concepts` out of the tab strip.** A
   `layout.tsx` at `sets/[id]` would wrap both; a test asserts none exists.
4. **A page's query does not inherit its layout's guard.** All three view files apply
   `readableSetWhere` themselves and all are on `ENFORCED_PATHS`.

**OWED — the live gate (spec §11), nine steps.** The two that matter: **step 5** — a
concept with no answered KLPs must render hatched, not in the weak colour; and **step 7** —
signed out on a public set, both tabs render with an unshaded map and no crash.

**A regression 6f introduced and 6g caught, worth knowing because the class recurs.**
When the scoring panels moved from `/settings/ai` to `/settings/study`, five deep links and
one `revalidatePath` were left pointing at the old page — "Change your study scope",
"Adjust your evidence floor", the targeting-strategy link, the default-scope link, and
`saveTuning`s revalidation. The 6f commit message asserted every link still landed correctly;
that was reached by **counting** the links rather than reading what each one promised.
**Nothing failed** — `/settings/ai` still renders, so every link produced a real settings
page, just not the one holding the named control.
`tests/settings/deep-links.test.ts` now pins each link to the page rendering the panel it
names, and `src/middleware.ts` matches `/settings/:path*` so a future split cannot leave the
new half unprotected.

---

### 6c-old. ⬜ Sharing, collaboration & discovery — **SUPERSEDED, see 6c above.**

Design: `specs/2026-08-17-sharing-collaboration-and-discovery-design.md`. No plan, no code.

Requested by the user while reviewing 6b. Four interlocking features: **collaborators**
("Editable by"), **fork** ("make my own copy"), **public visibility + a browsable directory**
crediting a handle, and a **real homepage** (Recents / For you / Your sets) in place of the
current redirect to `/sets`.

They all widen `src/lib/sets/visibility.ts` — the module that exists because a security pass
found ten read-by-id exposures — which is why this was designed before any code.

**Three decisions taken with the user 2026-08-17:** a fork is the forker's outright (they may
publish it themselves, with carried attribution); "For you" ranks by the learner's weak
categories via `getLearnerMetrics`; and creators are credited by a **separate handle**, never
by `User.name`, which is the OAuth provider's real-name field.

**Seven defects killed on paper** — see the design's §9. The two worth knowing before touching
this: a fork that *shares* a `CardAsset` makes `/api/assets/[id]` **non-deterministic**, because
it resolves permission through `contentBlocks[0].card.set` with `take: 1` and a shared asset now
has blocks in two sets; and rendering fork attribution from the live FK **leaks the title of a
set the author just made private**. Both forced real design changes (copy the blob; denormalize
the credit and link it only when the viewer can read the source).

**Weakest part, deliberately built last:** cross-user category matching for "For you" is a
string match wearing a concept's clothing — `CLAUDE.md`'s 2026-08-14 note already records that
user categories are often *format* labels ("label the image", "vocabulary"), so one account's
`vocabulary` is Spanish and another's is finance. Mitigations in §7; do not let it write to the
learner model.

Build order is the design's §11: handles → `public` → directory → fork → homepage →
collaborators → "For you". Steps 1–3 are one unit; collaborators and "For you" each want their
own spec.

### 7. ⬜ Spec 4 — plan setup & readiness dashboard — **DESIGNED 2026-08-14, NOT STARTED.**

Belongs to Stage 8 Spec 4 (action plan & AI lessons). Designed with the user on 2026-08-14 and captured here so it survives; **no spec doc, no plan, no code.**

**The gap.** `TrainingPlanPanel` is one button at the bottom of the quiz page that calls `generateTrainingPlan(setId)` blind — no scope, no preconditions, no idea whether the profile it is about to send is worth anything. Quiz setup exists; plan setup does not.

**Shape.** Its own route, two states. *Setup*: scope pickers (prefilled from the saved study scope, overridable per plan) + readiness readout + generate. *Generated*: the plan, with setup collapsed to a one-line summary bar and a "Change" affordance that re-expands it.

**Readiness readout — five components, and the aggregation rule is the design:**

| Component | Reads | Why |
| --- | --- | --- |
| Breadth | in-scope cards with live KLPs / cards in scope | no KLPs, nothing to target |
| Depth | KLPs clearing **the learner's** floor / KLPs with any evidence | the one the 3B gate showed dominates |
| Recency | share of evidence in the last N days | a posterior from 3-month-old answers describes someone who no longer exists |
| Mode balance | evidence weighted by mode | Spec 2a already prices this — SA .95 / MC .75 / TF .50. An all-TF corpus carries half the evidentiary value per answer and nothing currently says so |
| Extraction | cards with `klpStatus: 'pending'` | distinguishes **wait** from **do something** |

**The verdict is the MINIMUM of the components, never the average.** Averaging lets breadth mask zero depth — exactly the state the library was in at the 3B gate (plenty of KLPs, none measured), which an average would have called "moderate". Three bands (thin/usable/solid), **never a percentage**: a number invites comparisons it cannot support and hides which part is thin. Each band names what would move it up — the component that produced the minimum. Computed in TypeScript, never asked of the AI, same rule as significance and mastery.

**Error states reuse Spec 3C's `diagnoseEmptyState`** (`src/lib/metrics/coverage.ts`) — the same four causes, plus a fifth: extraction pending. This is why `coverage.ts` is built as shared substrate in 3C rather than dashboard-private; two implementations would drift into disagreeing about whether the learner has enough data.

**Per-category table** — cards / with KLPs / measured / answers / last studied / verdict, per category plus Uncategorized. The honest half of the feature: it shows *where* the data is thin instead of averaging it away, which is what lets the learner deselect a category or go extract KLPs for it.

**Two decisions the user accepted:**
- **Regeneration is explicit, never automatic on a settings change.** Changing scope updates the readiness readout live (pure local computation) and surfaces a "Regenerate with these settings" button. A plan that silently reshuffles under the learner destroys the thing that makes it a plan, and it spends an AI call per toggle.
- **Store the inputs on the plan row** — `inputScope`, `inputCoverage`, and the thresholds in force. Cheap, and it is the difference between a plan artifact and an auditable recommendation: the plan can say what it was built from, and "your data has changed a lot since this plan" becomes computable.

**LESSON OUTPUT TYPES — decided with the user 2026-08-20.** The readiness/setup half above was designed 2026-08-14; the *lesson generation* half had no design at all, and this is the first decision taken on it. A lesson may carry:
- **Curated links to existing media** — the AI recommends video or reading that already exists (YouTube and similar) against a named weak KLP.
- **Media the learner already has** — the Stage 5 `CardAsset`/Vercel Blob work is reused, so a lesson can surface an image or video already attached to a card rather than inventing one.

The rule the user set is **"use existing media, if it exists"** — v1 curates and reuses, it does not synthesize. Two consequences to design around when this is specced: a curated link **rots** (the video is deleted or made private), so a lesson must degrade to its text without breaking, and a recommended link is an **unverified third-party claim** — the AI is asserting relevance to a KLP it cannot watch. Neither is a reason not to build it; both are reasons the lesson's own explanation must stand alone.

**FUTURE BET, explicitly not v1 — generated video/audio.** Synthesizing narrated audio or video from a lesson. Recorded here at the user's request so it is not lost. It is gated on **Stage 4 (voice), which is unbuilt**: TTS is the same capability the voice-interview stage needs, so building it here first would either duplicate that work or pre-empt its design. It also carries per-minute generation cost against the user's own provider keys, plus rendering and storage nobody has sized. Revisit after Stage 4, not before.

### 8. ✅ Open the doors — password reset + invite codes — **BUILT 2026-08-20/21. LIVE GATE PASSED 2026-08-21 (agent-runnable half).**

Design: `docs/superpowers/specs/2026-08-20-open-the-doors-design.md`. Plan: `docs/superpowers/plans/2026-08-20-open-the-doors.md`. 12 tasks, commit range `8cb51dd..fb8a851`.

Not descended from any spec — it came out of reviewing item 6e with the user on 2026-08-20. **Chosen by the user over Spec 4 and over 6c.**

**Password reset and invite codes shipped as ONE item, not two**, per the original reasoning: reset without a cap means uncontrolled growth, invite codes without reset means handing someone a code to an account they can permanently lose. Together they are what makes `CREDENTIALS_SIGNUP_ENABLED=true` a decision the user can actually take — the flag itself did **not** flip as part of this work; that stays a deliberate human call (§8 of the design).

**What shipped:** `UserToken` (purpose-bound `sha256(purpose + ':' + raw)` hash, single-use, atomic consume) and `InviteCode` (Crockford Base32, `maxUses`/`usesRemaining`, expiry, `--revoke`) tables; `src/lib/mail/` (raw `fetch` to Resend, no `resend` package, console-transport fallback when `RESEND_API_KEY` is absent); `/signup` now requires an invite code and redemption is atomic with account creation; `/signup/check-email`, `/verify/[token]`, `/forgot`, `/reset/[token]`; the sign-in gate refuses an unverified address; `savePassword`/reset both bump `User.sessionVersion` and invalidate sibling tokens; `scripts/mint-invite.ts` / `npm run invite`.

**New baselines (this branch, 2026-08-21, after item 8):**
- **Tests:** 140 files / **1655 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`next build`:** clean
- **`npm run lint`:** **175 problems** (131 errors, 44 warnings) — unchanged from the item 6e baseline. Do not fix unrelated ones.

**Live gate (spec §12, steps 1-8, run by an agent against a local dev server with `CREDENTIALS_SIGNUP_ENABLED=true` set on the process only, no `.env` change, `RESEND_API_KEY` unset so links print to the server log):**

| # | Step | Observed result |
| --- | --- | --- |
| 1 | Mint `--uses 1` code, sign up with it | Signed up with `72EPZ-WPAA8`; redirected to `/signup/check-email`; verification link printed to server log |
| 2 | Sign in before verifying | Refused: "Your email address isn't verified yet. Check your inbox for the link, or send another below." |
| 3 | Follow verify link | Redirected to `/login?verified=1` ("Your email is verified. Sign in below."); sign-in then succeeded, landing on `/sets` |
| 4 | Reuse the same verify link | Rejected: "That link didn't work. Verification links expire after 24 hours and can only be used once." |
| 5 | Sign up again with the now-exhausted code | After a second signup exhausted `72EPZ-WPAA8` (2 of 2 used), a third attempt was refused: "That invite code isn't valid, has expired, or has been used up." |
| 5b | P2002 rollback: fresh `--uses 1` code, duplicate email, then same code + fresh email | Duplicate attempt (`dev@localhost.test`) refused: "Those details can't be used. Try something different, or sign in instead." — invite stayed at 0 of 1 used (verified via `npm run invite -- --list`), i.e. the failed transaction did **not** burn the invite. Retried with the same code and a fresh email → succeeded, and the invite then correctly showed 1 of 1 used. |
| 6 | `/forgot` for a real account vs. `nobody@example.invalid` | Byte-identical rendered text for both: "If that account exists, we've sent a link to its email address." Server log confirmed a reset mail was queued only for the real account. |
| 7 | Follow reset link, set new password | Reset succeeded; a tab with an active session for that account, refreshed after the reset, showed "Sign in to see your sets" — the old session was dead on the next request |
| 8 | Reuse the reset link | Rejected: "That link didn't work. Reset links expire after an hour and can only be used once." |

All nine steps (1 through 8, plus 5b) passed as designed — no deviations found in the live gate itself. The dev server was stopped afterward and `npm run seed:dev-user` restored the seeded account; sign-in with it was re-verified.

**Human gates still owed (spec §12, steps 9-10 — not producible from an agent session):**
1. **A real Resend delivery** — `RESEND_API_KEY` set against a verified sending domain, a message arriving in a real inbox, and its link working against the deployed origin.
2. **The Vercel Firewall rules** (runbook below) configured in the dashboard, and a burst of logins actually throttled.

**§14 known limits, carried verbatim:**
- A mail failure is silent to the user. `send.ts` swallows to protect the `after()` callback, so a user whose mail bounced sees "check your inbox" and nothing arrives. There is no bounce handling and no delivery dashboard in-app. Resend's own dashboard is the only place to see it.
- No account deletion, still. Invite codes cap how many accounts *are created*, not how many exist. A pool that has been fully redeemed cannot be reclaimed.
- `invitedByCodeId` is `SetNull`, so deleting an `InviteCode` erases the audit trail for accounts that used it. Prefer `--revoke`, which preserves the row.
- 50 bits of code entropy assumes the Firewall rule exists. Without §10's `POST /signup` limit, a determined attacker with a botnet has a materially better chance than the number suggests.
- The stale comment in `credentials.ts` ("unrecoverable with no password reset", justifying no password-policy check on sign-in) becomes half-false once this ships. The *behaviour* should not change — rejecting a legacy password at sign-in is still bad — but the comment needs rewording so the next reader does not act on a premise that no longer holds. **Closed:** Task 10 already reworded it; Task 12 re-verified with `grep -rniE "no password reset|no way back into this account|once password reset exists" src/` → clean.
- No admin UI. Minting, listing, and revoking are terminal-only. Revisit when handing out codes is frequent enough to be annoying, not before.

**Vercel Firewall rules — operator action, owed to the human. No code, no test.**

| Path | Limit | Why this path |
| --- | --- | --- |
| `POST /api/auth/callback/credentials` | 10/min/IP | The ~250ms bcrypt burner. CPU amplification as well as credential stuffing — and by design the unknown-account path costs the same, so an attacker does not even need real addresses. |
| `POST /signup` | 5/min/IP | Also the invite-code brute-force surface. 50 bits of code entropy assumes this rule exists. |
| `POST /forgot` | 5/min/IP | Mail-send amplification; someone else pays for the sends. |
| `POST /reset/*` | 10/min/IP | Token brute force. |
| `POST /login` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /verify/*` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /signup/check-email` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |

Server Actions dispatch on a `Next-Action` header and an action ID, not on the path, so a crafted
POST can invoke any action from any route. Path rules bound the browser flow only — pair them with
a broad `POST /*` limit if the invite pool is the thing being protected. **Verify this against
Vercel's current Server Actions dispatch behaviour before relying on it.**

**Per-account lockout is deliberately NOT built.** A hard lockout is itself an attack — anyone
who knows an address can lock its owner out on purpose, and there is no support desk to undo it.
Revisit only on evidence of real credential stuffing.

### 9. 🟡 Surfacing missed KLPs and weak topics — **BUILT 2026-08-24 as the KLT topic layer. SECOND ITERATION DESIGNED 2026-08-25 (concept tree), NOT BUILT.**

**Next action: `specs/2026-08-25-klt-concept-tree-design.md`.** The 3-rung ladder shipped and
generated cleanly, but the user wants 6-10 levels, and the first real run proved why that cannot
work as stored: `balance sheet` occupies rank 1, 2 AND 3 simultaneously depending on which card
produced it, because each key point's ladder is proposed independently. The tree design makes
depth a property of the concept (`Klt.parentKltId`), links each key point to its LEAF only, and
turns per-level mastery into a subtree query — zero extra AI calls, which answers the user's
token-cost concern. It supersedes §10 of the 2026-08-24 spec and takes the concept-graph bet
`CLAUDE.md` deferred.

**PHASE 1 BUILT 2026-08-25** — plan `plans/2026-08-25-klt-concept-tree-phase1.md`, 10 tasks,
19 commits `88d575b..646e259`, executed subagent-driven with a review + fix loop per task.

**New baselines:** 160 test files / **1888 passing**; `tsc` clean; `next build` clean; lint **175**
(exactly the prior baseline); zero schema drift.

**Live regeneration result — BETTER than spec §12.1 predicted.** It forecast the model collapsing to
3-4 rungs; the real run produced a six-level tree over 69 cards:
`depths 0:2 1:9 2:27 3:28 4:16 5:9`, 91 concepts, 243 links, 153/153 labelled, 2 roots
(`finance`, `biology` — subjects correctly separated), only 2 nodes over the branching threshold,
25% singleton leaves. **Zero structural invariant violations. `KlpState` byte-identical before and
after**, verifying §6 against Postgres rather than mocks. Real paths:
`finance > accounting > financial statements > balance sheet > assets > restricted cash`.

**Dashboard today shows ONE row** — `displayDepth` resolves to 0 because no topic clears the
observation floor (5 answers, all with 1 observation, floor 3). Designed behaviour on a thin corpus.
Readiness reads 0.58 on the root, which is the Task 7 fix working; knowledge reads "not measured".
`depreciation` landed under `income statement`, not `cash flow statement` — §12.6's single-parent
limit, surfacing on the first real run exactly as the user's own example predicted.

**DEFERRED-MINOR TRIAGE (16 findings across 10 tasks). None blocks merge.**
1. *Worth fixing soon (2).* `loadKltRows` does an unconditional full-table `Klt.findMany` per metrics
   read — so the `ancestorIds` GIN index Task 1 fought to declare is **currently unused**, and the
   read scales with the whole install rather than one learner's scope. Harmless at 91 concepts,
   real later. And `tests/klt/prompt.test.ts` still imports the deprecated `MAX_KLTS_PER_KLP` alias,
   which passes only because the alias equals the real constant.
2. *Coverage gaps, defensible (10).* Ten are "no test for X" at integration seams: the depth-selection
   wiring in `read.ts`, a superseded descendant link folding into an ancestor, a KLP shared under one
   ancestor via two paths, a cycle sitting above the examined row, and similar. **The pattern matters
   more than any one:** pure functions on this branch are heavily covered and every guard is
   mutation-verified, but the seams between them are not.
3. *Cosmetic / already resolved (4).* A migration rewritten on an unmerged branch; a doc comment that
   forward-referenced `invariants.ts` (resolved once Task 3 landed); `KltNodeRow` duplicating
   `TreeNodeRow`'s fields; and the placement schema not enforcing "last path element == concept",
   which `resolvePlacementPath` enforces instead.

**Gate NOT completed:** the final whole-branch review agent died at a monthly spend limit before
writing its report. The load-bearing checks were run by the controller directly instead: the KLT code
never references `klpState`/`answerKlpResult`, the sole `CardKlp` write is `data: { label }` (no
supersede, no delete), no test rebuilds a schema, and no Phase 2/3 module leaked in. A broad
cross-task review is still owed.

**PHASE 2 BUILT 2026-08-25** — plan `plans/2026-08-25-klt-concept-tree-phase2.md`, 5 tasks,
9 commits `646e259..b2da863`. Run subagent-driven with reviews BATCHED at the end rather than per
task, at the user's request to limit spend — one combined cross-task + final review instead of ten.

**New baselines:** 165 test files / **1949 passing**; `tsc` clean; `next build` clean; lint **175**
(baseline); zero schema drift — Phase 2 adds no columns.

**What shipped:** `KLT_EDITORS` allowlist; four gated mutations (re-parent, rename, merge, delete)
reusing Phase 1's `computeSubtreeUpdates`/`wouldCycle` rather than reimplementing them; AI skeleton
suggestion that writes nothing until the user accepts; and the editor screen at `/concepts`.

**Live-verified:** `/concepts` returns **404 for a signed-in NON-editor when `KLT_EDITORS` is unset**
and 200 when allowlisted — the load-bearing check, since a gate that opens on missing config is not a
gate. Tree renders indented with per-row link/child counts; Delete is disabled with a visible reason
on a node with children. 91 concepts, 0 invariant violations, `KlpState` byte-identical.

**To use it (superseded 2026-09-03 by Spec 1):** at the time this shipped, set `KLT_EDITORS` to the
user id that owns your sets — NOT the seeded `dev_user`. `KLT_EDITORS` no longer exists; `/concepts`
is now gated by `requireAdmin` (`src/lib/staff/access.ts`). Grant yourself the admin role with
`npm run grant-role` instead.

**Two deliberate deviations from spec §5.1/§9:** "Move under" is a `<select>`, not drag-and-drop
(equivalent in function, keyboard-accessible, testable); and merge's confirm is an inline block rather
than the repo's `Dialog` primitive, because nothing in this suite exercises `Dialog` under jsdom yet.

**Deferred minors, none blocking:** `renameConcept`/`deleteConcept` each do a non-transactional
read-then-write, so a concurrent edit surfaces as a raw DB constraint error rather than a clean
`ActionResult`; and the six-field `KLT_ROW_SELECT` object is duplicated across three files (two of
them from Phase 1). `isKltEditor`'s empty-id guard is knowingly unreachable and kept as
belt-and-braces — recorded, not a finding.

**Phase 3** (refinement driven by branching factor, plus the two-direction AI semantic audits) remains
unbuilt. Stopping here is a legitimate outcome per spec §13 if the seeded tree proves good enough.

---

**PER-SET STRUCTURE BUILT 2026-08-26 — code complete, LIVE REBUILD AND COLUMN DROP STILL OWED.**
Spec `specs/2026-08-25-klt-per-set-structure-design.md`, plan
`plans/2026-08-25-klt-per-set-structure.md`, 6 tasks, commits `22403cb..2070194`, subagent-driven
with reviews **batched at the end** (the owner asked for that on spend grounds — it worked: the
single whole-branch review found three must-fixes that per-task reviews would have missed, because
all three only exist across task boundaries).

**Why it changed again:** the owner wants any SET OWNER to edit their own tree, reached from that
set, so permissions can later be shared per set. A single global tree editable by every owner is not
safe — one person re-parenting `financial statements` moves every other learner's mastery. Measured
on the live corpus first: **0 concepts shared by more than one set, 0 by more than one user**, which
is what made the split nearly free. `Klt` stays a globally-unique concept REGISTRY (that is what a
future leaderboard aggregates on); a new `SetKltNode` holds `parentKltId`/`depth`/`ancestorIds` per
(set, concept). **`SetKltNode.parentKltId` is a `Klt` id and carries NO foreign key** — an FK would
point at `Klt` and wrongly permit a parent with no node in this set; `checkTreeInvariants`' new
`parent_not_in_set` kind is the only enforcement.

**What shipped:** two editors over one table — `/sets/[id]/concepts` (owner-gated) and `/concepts`
(`KLT_EDITORS` at the time, spans every set, picks a set first — `KLT_EDITORS` was replaced by the
admin role on 2026-09-03, Spec 1; `/concepts` is now gated by `requireAdmin`). **Every edit affects exactly one set, admin
included** — the admin view differs in what it can REACH, never in what an edit DOES. Plus
`createConcept` (manual base nodes — the half of "seed the top" that had never existed; only the AI
could create a node before), a "Place under…" control on unplaced concepts, an empty-structure panel
offering manual / AI / preset side by side, and `KltPreset` (reusable skeletons stored as concept
NAMES, not ids, so a preset applies to a set whose concepts do not exist yet; never auto-applied).

**New baselines (this branch, 2026-08-26):** 170 test files / **2026 passing** (from 1950); `tsc`
clean; `next build` clean; lint **175** (the standing ceiling, unchanged). One known, accepted schema
drift line: the `ancestorIds` GIN index is hand-added in migration SQL and not declared in
`schema.prisma` — same pattern as `Klt`'s own. Re-check after the drop that no NEW line appears.

**CANVAS REDESIGN BUILT 2026-08-27 (`ee1bcb7`) — the editor is now a drawing, not a list.**

The owner's verdict on the shipped editor was "too plain and complex", with a concrete picture:
"an actual coding tree/binary tree that you can traverse", nodes customizable, and the concepts as
"a list on the side that i can then drag/drop to other places". They chose the top-down tidy tree
over a left-to-right one and over an organic neural-web layout.

**The complexity was structural, not cosmetic.** The old editor rendered four `<select>`s and a text
input on EVERY row — a twenty-concept tree meant a hundred controls competing for attention. The fix
is not styling; it is that the per-node controls now exist ONCE, in an inspector addressing whichever
node is selected. Anything that re-adds per-row controls re-creates the original complaint.

**What shipped:**
- `src/lib/klt/layout.ts` — pure layout (leaves take consecutive slots, parents centre over their
  children). Deliberately separate from `tree.ts`: that module owns what the tree MEANS and its bugs
  corrupt mastery; this one owns what it LOOKS like and its bugs misdraw a picture.
- `src/lib/klt/drag.ts` — `evaluateDrop`, the ONE decision point for every re-parent however
  triggered. Highlight and drop call the same function, so a target that lights up cannot then
  refuse on release.
- **The confirm threshold changed:** a move of one node applies immediately with Undo in the toast;
  a move carrying descendants still confirms and states the count. Confirming a single-node drag is
  what makes drag-and-drop feel broken; the blast-radius warning stays where it earns its keep.
- `SetKltNode.color`/`icon` (migration `20260827000000_klt_node_style`, additive, both nullable).
  Palette KEYS, never raw values — a stored hex ignores the theme and cannot be re-themed without a
  data migration. Null colour inherits from the NEAREST coloured ancestor. The key lists live in
  `src/lib/klt/node-style.ts` (plain module) so the ACTION can validate against the same list the
  picker renders from; `src/components/klt/node-style.ts` is the presentation half, and a test pins
  that the two cannot drift.
- Side panel with unplaced on top, all concepts below, both drag sources. **Every drag has a button
  equivalent** — HTML5 drag-and-drop is unreachable by keyboard, so a drag-only canvas is a canvas
  some people cannot use at all. The "Place" button's target follows the canvas selection rather
  than adding a second parent picker.

**Guards mutation-tested** (each removed, its named test watched go red, restored): the confirm
threshold, the already-that-parent refusal, parent-centring, and — most importantly — `setNodeStyle`
against `tests/actions/klt-gated-exports-guard.test.ts`, which correctly flagged it the moment its
`requireSetKltAccess` call was removed.

**A fake that lied, found and fixed:** `nodeUpdate` in `tests/actions/klt-tree.test.ts` assigned
`depth`/`ancestorIds` unconditionally. Harmless while every caller was a move — and it would have
written `undefined` over a node's depth the first time a caller updated only a colour. It now honours
Prisma's "undefined leaves the field alone" for every field.

**Two React-specific traps this hit.** (1) `document.querySelectorAll('svg path')` counts lucide
GLYPHS as tree edges — scope edge assertions to `[data-testid="concept-edges"]`. (2) A capitalised
binding assigned from a call at a component's top level (`const Icon = iconFor(x)`) trips the
compiler lint as "component created during render"; inside a `.map` callback it does not. Use
`createElement(iconFor(x), {...})`.

**New baselines (2026-08-27):** 173 test files / **2088 passing** (from 170/2026); `tsc` clean;
`next build` clean; lint **175** — the standing ceiling, unchanged.

**NOT yet seen rendered by anyone.** The jsdom suite covers behaviour, not layout; nobody has looked
at the canvas in a browser. That check is owed before this is called done.

**SHARED VIEWING + LINKED CARDS BUILT 2026-08-27 — the tree became readable, and each concept now
says what is filed under it.**

Two owner requests, both additive. The first was posed as "even owners of the sets can see the
concept tree (not edit)", which is worth recording because the premise was wrong and the fix was
not what the words asked for: **owners already had full edit access** (`requireSetKltAccess` admits
the owner with no allowlist, and the set page carried a Concepts button). The people actually
locked out were **non-owner viewers of a link-shared set** — no button, and a 404 on the URL.
Confirmed with the owner before building rather than guessing.

**The read/write split.** `src/lib/klt/access.ts` gained `requireSetKltView` beside the untouched
`requireSetKltAccess`. The file's existing comment — "NOT `readableSetWhere`… editing its hierarchy
is not a read" — still stands and the new helper is its other half: reading the hierarchy IS a read,
so it resolves through `readableSetWhere`, the same fragment the set page uses. A signed-out visitor
holding the link is admitted deliberately: they can already read every card the tree organizes, so
refusing here would hide the map while handing over the territory. `canEdit` is computed by the
SAME rule the write gate applies and is a UI hint only — **every write still calls
`requireSetKltAccess` itself.** Exactly two exports moved to the read gate: `listConceptTree` and
the new `listConceptCards`.

**The guard had to be taught, carefully.** `tests/actions/klt-gated-exports-guard.test.ts` correctly
failed on both new read paths. Adding `requireSetKltView` to `GATE_PATTERNS` would have been the
easy fix and the wrong one — it would silently accept a WRITE action switched to the read gate to
"fix" a 404, which is the exact bug class the guard exists for. Instead the read gate counts as a
gate only for exports named in a new `READ_GATE_ALLOWLIST`. Mutation-verified: pointing
`createConcept` at `requireSetKltView` makes the guard fail **by name**.

**Read-only rendering.** `canEdit` threads from the page through `ConceptTree` into the canvas, side
panel and inspector, defaulting to `false` so an omitted prop never grants editing (same posture as
`isAdmin`). A viewer gets the canvas, pan/zoom/collapse, filter, the All concepts and Unplaced lists,
and the linked-cards panel. Nodes are not `draggable` and drops are refused, so no gesture appears to
work and then fails at the server. `listPresets` is not called at all — it is owner-gated and would
only produce a toast that tells the viewer nothing.

**Linked cards.** `listConceptCards(setId, kltId)` walks `Klt ← KlpTopic → CardKlp → Card`, filtered
by `klp.card.setId` (concepts are GLOBAL vocabulary — without it a shared name pulls in another
owner's cards) and `supersededAt: null` (the panel answers what a card tests NOW, not what it used
to). Descendants come from **this set's** `SetKltNode.ancestorIds`, never the deprecated global
`Klt.ancestorIds`. Direct links list first; descendants sit behind a `+N under child concepts`
expander, each row naming the child concept it really came from. A card tagged directly is never
also counted as a descendant, or the expander would overstate every time.

**`NodeInspector` became the node DETAIL panel** rather than gaining a second competing panel: cards
section always, edit sections only under `canEdit`. `TermsList` cards gained `id="card-<id>"` so the
panel's rows can link into the set.

**Guards mutation-tested** (each broken, its named test watched go red, restored): the canvas
`draggable={canEdit}` (4 red), the read/write split with `createConcept` on the read gate (2 red),
the descendant-subtree filter, the direct/descendant de-duplication, and the export guard's read
allowlist.

**New baselines (2026-08-27):** 174 test files / **2128 passing** (from 173/2088); `tsc` clean;
`next build` clean; lint **175** — the standing ceiling, unchanged.

**Still not seen rendered by anyone** — same caveat as the canvas redesign above. The jsdom suite
covers behaviour, not layout.

**Expand/contract, deliberately.** Task 1 as planned dropped `Klt.parentKltId`/`depth`/`ancestorIds`
immediately, which breaks every file later tasks had not yet migrated and leaves `tsc` and the suite
red across four tasks — every intermediate task unverifiable. Task 1 is additive; **the drop is still
owed** and is ordered AFTER a verified rebuild, never before (dropping first leaves a window with no
structure in either place).

**STILL OWED — the owner must run these; they spend AI credits and write live data:**
1. `npm run verify:klt:baseline` (read-only, hashes every `KlpState` row)
2. `npm run backfill:klts -- --direct --force` — the only step that writes and spends credits
3. `npm run verify:klt` — exits 0 only if `KlpState` is IDENTICAL, invariants are clean per set, and
   every set with linked concepts has structure
4. Live gate: `/sets/[id]/concepts` renders for the owner and 404s for a stranger; `/concepts` 404s
   for a signed-in non-admin (superseded 2026-09-03 — `KLT_EDITORS` no longer exists, the gate is
   now `requireAdmin`); **a re-parent in set A leaves set B untouched — the load-bearing check
   of this whole change**; mastery unchanged after an edit
5. The contraction migration dropping the three deprecated `Klt` columns + the `KltTree` relation

**The defect worth remembering.** `applyPaths` and `loadSetTree` were exported from `'use server'`
modules purely so another module could import them — and **in Next.js every export of a `'use server'`
file is a callable RPC endpoint**, so `applyPaths` was an ungated structural WRITE into any `setId`.
Every ACTION was correctly gated; the hole came from a refactor for code reuse. Both now live in
`src/lib/klt/structure.ts` (a plain module) and a mutation-verified guard test asserts every export
of the four KLT action modules is gated or type-only.

**Test-quality note for whoever runs the next plan here: FOUR tests that could not fail were found in
this one** — three during implementation (fixture data coincidentally satisfying the assertion, twice;
an adjacent redundant check masking the gate under test, once) and two more at review (both asserting
"the resolved setId, not the raw argument" while the mock made them equal). Watching a mutation go red
is the process; a report claiming it went red is not evidence.

**Deliberate metrics decision made during the fix pass:** a set with no structure now contributes
nothing to topic-grain readiness. Before, its answers entered a shared concept's denominator while the
numerator could never reach them, understating readiness. This matches the existing precedent that
unplaced work drives TARGETING but not TOPIC MASTERY — flagged to the owner as a decision, not a
silent change.

**Also deferred here, not lost:** the **My Sets / Sets navigation split** the owner raised alongside
this (a place to EDIT your own sets, separate from a place to browse and quiz on anyone's). It is an
app-wide IA change overlapping item 6c's public directory, and should be designed WITH 6c.

**Built in THREE phases, each with its own plan** (spec §13): (1) substrate — schema, generation,
invariants, rollup, minimal display; (2) editor + seeding — the tree UI behind `KLT_EDITORS`, with
both user-authored and AI-suggested skeletons; (3) refinement + semantic audits. Stopping after
phase 2 is a legitimate outcome.

**The constraint that shapes the whole design (spec §12.1): the model collapses middle rungs.**
Asked to place `depreciation add-back` it returns four rungs, not eight — skipping `technicals`,
`financial statements`, `operating activities`, `non-cash charges`. An earlier draft of the spec
made exactly that mistake by hand and the user caught it. Hence seeding the top and refining the
middle, rather than prompting harder for depth.

Design: `specs/2026-08-24-klt-topic-layer-design.md`. Plan: `plans/2026-08-24-klt-topic-layer.md`. 14 tasks, commit range `7015788..HEAD`. **Both open questions below are now answered** — kept for the reasoning that produced them.

**New baselines (this branch, 2026-08-24, after item 9):**
- **Tests:** 153 files / **1790 passing** (was 140 / 1655) — excluding `cursor-agents`
- **`tsc --noEmit`:** clean · **`next build`:** clean · **`npm run lint`:** **175 problems** — unchanged from the item 8 baseline
- **Schema drift:** zero (`migrate diff` reports an empty migration)

**VERIFIED LIVE, against the real database — the guarantee this whole item hangs on.** The
summarization pass ran over all 69 KLP-bearing cards and afterwards
`supersededKlps=0`, `klpStates=5` (unchanged), `liveKlps=153` (unchanged). §6 holds in
Postgres, not just in mocks. Both safety guards were also mutation-tested: making the writer
set `supersededAt` turns 4 tests red, and removing the `isOwner` check turns the stranger-card
test red.

**TWO STEPS STILL OWED, both blocked on secrets an agent cannot supply:**
1. **The vocabulary has never been generated. ROOT CAUSE FOUND 2026-08-24:
   `GOOGLE_KEY_ENCRYPTION_SECRET` in local `.env` is a 22-character passphrase, not a base64
   32-byte key.** Every attempt dies with "must be exactly 32 bytes when decoded from base64"
   (`src/lib/security/api-key.ts:19`), so no credential decrypts and the backfill
   marked all 69 cards `kltStatus: 'failed'` with "All 2 AI attempts failed". That is the
   CORRECT classification (attempts were made, so not `skipped`), but it means **zero `Klt` rows
   and zero labels exist**. **Do not simply generate a new secret** — the stored credentials were
   encrypted with a DIFFERENT, valid secret (almost certainly the one in Vercel's env vars).
   Copy that exact value in; generating a fresh one strands all three `AiCredential` rows
   permanently and they must be deleted and re-entered. `.env.example` documents the format:
   `openssl rand -base64 32`, 44 characters, and the §9.4 fragmentation risk is entirely unmeasured. Re-run
   `npm run backfill:klts` with the secret present, then inspect the resulting topic list by
   hand before trusting topic mastery. The script warns on its own if topics exceed 60% of cards.
2. **The panel has never been seen with data.** `/profile/learner` loads clean (200, no runtime
   error, `getLearnerDashboard` 2.7s), but the seeded `dev_user` owns no cards, so
   `diagnoseEmptyState`'s blocking `no_klps` branch renders instead of the panel. The library
   with 68 cards belongs to a different account. Component tests cover the panel's rendering
   (9 tests incl. expand, label fallback, null-never-zero); what is unverified is the panel
   **on the page, with real rows**.

**DEFECT FOUND AND FIXED 2026-08-24, after the build.** The user reported "the KLTs are
outputting the same things as the KLPs". Investigation showed they were NOT seeing KLT output at
all — `Klt=0`, `KlpTopic=0`, `labelledKlps=0`, so every surface was falling back through
`label ?? text` to the raw proposition. But it surfaced a real asymmetry: **topic names were
validated in TypeScript and labels were not.** A model that echoes the proposition back as its
`label` would have persisted, making the row read exactly as it did before the layer existed —
the whole feature silently doing nothing. `parseKltLabel` now drops anything over 8 words / 60
chars (never truncates), label and topics fail independently, the prompt interpolates the
enforced caps so it cannot drift from them, and the backfill warns when label yield is under 50%.
Guard mutation-tested: removing the caps turns 5 tests red. Baselines after the fix: **153 files
/ 1790 passing**, lint still 175.

**One thing found and fixed during implementation, worth knowing.** `summarizeKltsForCards` was
first written into `src/actions/klt.ts`. Exported from a `'use server'` file it became a
client-callable RPC endpoint **taking a `userId` as its first argument** — owner-scoped
internally by `readableSetWhere`, but with no business being reachable at all. It now lives in
`src/lib/klt/summarize.ts`; the action keeps only the retry. **`extractKlpsForCards` has the
identical shape and is still exported from `src/actions/klp.ts`** — same latent issue, not
touched here because it is out of this item's scope. Worth a follow-up.

**Also:** `server-only` is now a declared dependency and scripts that reach `generateJson` must
pass `--conditions=react-server` (see `backfill:klts`). Next resolves that condition internally;
plain `tsx` does not, so without it the import throws "cannot be imported from a Client
Component".

**Scope grew in design.** The request ("display missed KLPs/topics better") could not be met by a UI change alone: measured against the live corpus on 2026-08-24, KLPs run a **median of 16 words** (153 live rows, 69 cards), because a KLP is a *proposition* — the thing a distractor is corrupted from and a short answer is graded against. It cannot be shortened without breaking MC/TF generation. So the spec adds grains **above** it instead: a global `Klt` concept node and a short `CardKlp.label`, filled by an `after()`-triggered AI pass that mirrors KLP extraction.

**The rule that matters most (spec §6):** the KLT pass may never delete or supersede a `CardKlp` row. `AnswerKlpResult.klp` is `onDelete: Cascade`, and `KlpState` keys on `klpId` — superseding would silently reset every learner's mastery, invisibly to `tsc` and to any test that only checks the label landed. Guards are mutation-tested.

The user's words: "a better way of displaying the KLPs that they missed and/or topics (depending on what they flagged)."

**What already exists, so this is a rework and not a greenfield build** — three surfaces that each hold part of the answer and none of which is "here is what you got wrong, and here is what to do about it":
- the quiz results screen shows per-answer error analysis (Spec 2b);
- `/profile/learner` shows topic mastery plus the ranked study list (Spec 3C, with item 6f making the rows say what they actually are instead of the literal words "Key point");
- `/profile/memory` shows the raw event feed.

**Open question 1 — ANSWERED: "flagged" means what they got WRONG**, not starred cards and not authored categories. Original framing: Starred cards, the categories the learner authored, or both. These are different data paths: starring is `CardProgress.starred`, categories are `CardCategory`, and Spec 3C's saved study scope already filters by category.

**Open question 2 — ANSWERED: a new panel at the top of `/profile/learner`**, with `TopicMastery`/`StudyNext`/`RetentionPanel` untouched below it. Original framing: That page already owns roughly this job. The user has only ever seen it against a very thin corpus (6 quiz answers on the whole account), so it is genuinely unclear whether it is *insufficient* or merely *unpopulated* — and those have opposite remedies. Spec 3C's `diagnoseEmptyState` exists precisely because "nothing here" has four different causes.

**Sequencing note:** this makes item 7 better rather than competing with it — a plan needs somewhere to point when it says "you are weak here." Worth doing before Spec 4's lesson generation, not after.

---

## Backlog — requested by the user 2026-08-28. Not designed, not specced, not ordered into the build above.

These five came in as one message and are recorded here so nothing is lost. **None of them is
next** — item 7 (Spec 4) still is. They are written up in the queue rather than in a memory file
because two of them (10 and 12) contradict assumptions currently baked into shipped code, and a
future session needs to read that before it starts building on those assumptions.

Two carry an obligation to the user rather than to the code, and both are easy to lose:
- **Item 11** needs the user to open a **separate chat**, have general misconception content
  written there, and paste it back in as seed data. Poke them for it when that item starts.
- **Item 14** is explicitly a *research week*, not a build. Remind the user to book it.

### 10. ⬜ "Type of question" — an automatic AI-assigned label axis

**The ask, in the user's words:** "an automatic AI-based labelling system similar to categories
called 'type of question' (conceptual, calculation, model, explanation, brainteaser, free-form,
etc.)".

**This is the fix for a limit CLAUDE.md already records.** The "Known limit of that decision,
raised 2026-08-14" paragraph under Stage 8 says a user-authored `CardCategory` is often a **format
or modality** ("label the image", "talking", "vocabulary") rather than a subject, and that
categories and concepts are two axes the current model collapses into one. Item 9 built the
*concept* axis (`Klt` / `SetKltNode`). **This item builds the third axis: question form.** Once it
exists, format-shaped categories have somewhere honest to live, and `CardCategory` can go back to
being whatever the learner finds useful without corrupting mastery.

**What already exists and must not be duplicated:**
- `CardCategory` — set-scoped, user-authored, `@@unique([setId, normalizedName])`, colored chips,
  filters every study mode through `filterCardsByCategories`.
- `Klt` — global concept nodes, `normalizedName` unique install-wide, per-set structure in
  `SetKltNode`, filled by an `after()`-triggered AI pass that mirrors KLP extraction.
- `CardKlp.kind` — **already a question-shaped closed enum** (`definition | mechanism | causal |
  condition | quantitative | contrast | example`), AI-assigned at extraction, at KLP grain. This is
  the closest existing thing and the first question the design must answer: is "type of question" a
  **closed vocabulary at KLP grain that generalizes `kind`**, or a **new label at card grain**? Two
  overlapping enums describing the same distinction is the drift class this repo keeps flagging.

**Design questions, none answered:**
- **Closed vocabulary or open?** Spec 2's ruling on error types applies verbatim: open-ended tags
  fragment into synonyms and cannot aggregate. If mastery is ever to be reported *per question
  type* — "fine on conceptual, weak on calculation", which is obviously the point — the vocabulary
  must be closed and versioned, and renaming a value strands persisted rows.
- **Grain.** A card can carry KLPs of different types. Card-grain is cheaper and matches the
  category-chip UI; KLP-grain is what the metrics substrate actually consumes.
- **Overridable?** Categories are authored; KLTs are AI-assigned with a user editor at `/concepts`.
  Follow the KLT precedent (AI assigns, user corrects) rather than inventing a third interaction
  model.
- **Does it feed targeting, or only filtering?** Filtering is cheap and safe. Feeding it into
  `rankCandidates` means a new term in `scoreFor` and belongs with item 12, not before it.
- Extraction must be self-healing on a status column the way `Card.klpStatus` is, and the KLT
  spec's §6 rule applies unchanged: **the pass may never delete or supersede a `CardKlp` row** —
  `KlpState` keys on `klpId`, so superseding silently resets every learner's mastery.

### 11. ⬜ Misconception library — curated, per-topic, user-editable, shareable

**The ask:** "misconception library for each topic (finance technicals, etc.) that is also
updatable per user and also shareable (and can be used as a template) + a separate view not for
sharing flashcards but the customizable stuff (misconception library, concept tree, etc.). have it
operate similar to the concept tree (but as a list view). have some that are general and poke me to
ask you in a separate chat for that and to copy it in."

**Critically: this is NOT the misconceptions that exist today.** `src/lib/metrics/misconceptions.ts`
derives misconceptions **deterministically from the learner's own `conflation` error tags** —
promoted at 2 occurrences across 2 sessions, retired after 30 days or 3 clean answers, evidence a
verbatim learner quote that is never regenerated. That is *observed* and *personal*. This item is a
*curated, authored catalogue of misconceptions known to exist in a domain*, attached to topics,
useful before the learner has ever made the mistake. The two must stay distinguishable in the
schema and in the UI, or a seeded library entry becomes indistinguishable from measured evidence —
the same failure Spec 2a refuses when it rules that degradation must never fabricate a tag.

**Design questions:**
- **What does an entry attach to?** `Klt` is the obvious anchor (global, one node per concept,
  already the topic axis). Attaching to a *KLP* would make it per-card and unshareable.
- **The share/template model has a precedent to follow, not invent:** `KltPreset` already stores
  root-first paths of concept **names, not ids**, precisely so a preset survives being applied to a
  set whose concepts do not exist yet. A shareable misconception library needs the same
  name-keyed-not-id-keyed property for the same reason.
- **"A separate view for the customizable stuff."** Today `/concepts` (admin-gated via
  `requireAdmin`, `KLT_EDITORS` having been replaced 2026-09-03 by Spec 1) owns
  the concept tree and set sharing owns flashcards; there is no home for "the things I have tuned".
  This view would hold the concept tree, the misconception library, and plausibly `LearnerTuning`
  and the saved study scope. Requested as a **list view**, not the drag-and-drop canvas.
- **Seeded general content** — the user will supply finance-technicals content from a separate
  chat. Decide before then whether seeds are `KltPreset`-style global rows or a per-user fork on
  import. Forking is safer (an edited seed must not mutate everyone's copy) and matches how public
  sets fork today (item 6c).
- **Does a library entry become a distractor source?** Spec 1 generates distractors by corrupting
  one named KLP with one named corruption and persists that provenance. A curated misconception is
  exactly a high-quality corruption. Tempting, and out of scope for v1 — but the schema should not
  make it impossible.

### 12. ⬜ Rework the mastery engine — speed and confidence multipliers

**The ask:** "speed multiplier & confidence multiplier — tell me how they are currently being
implemented in calculations of mastery and how the mastery engine/formula works. i want to spend a
week just re-working & perfecting that with expert analysis from you."

**AUDITED 2026-08-28. Two headline findings, before any design starts:**

1. **There is no speed multiplier. Latency multiplies nothing, anywhere.** `latencyMs` is
   normalized by `src/lib/memory/latency.ts` (anything over 10 minutes becomes `null`, because
   per-item timing is measured client-side and is untrusted), persisted per answer, and read by
   **exactly one consumer**: `paceIndex` / `paceOutliers` in `src/lib/metrics/pace.ts`, which
   produces a *separately displayed* list of "correct but slow" cards on the learner dashboard. It
   does not enter `masteryScore`, `nextConfidence`, `stepBkt`, `nextDueAt`, `rankCandidates`, or
   `computeSignificance`. `pace.ts`'s own doc comment says *"This is what separates 'correct' from
   'actually known': a card answered right at 2.4x baseline is not mastered"* — and then the
   codebase scores that card identically to one answered instantly. The insight is written down and
   not priced in. **That gap is the strongest single argument for this item.**

2. **There is one confidence multiplier and it only affects scheduling.** `confidenceScale` in
   `src/lib/memory/schedule.ts` maps confidence 1-10 linearly onto **0.5x - 1.5x** and multiplies
   the spaced-repetition interval. Confidence never enters `masteryScore` and never enters BKT.
   Elsewhere it acts as a **gate, not a multiplier**: `masteryBucket` requires mastery >= 80 **and**
   confidence >= 8 for `mastered`; mastery >= 60 **or** confidence >= 7 for `solid`; >= 4 for
   `shaky`.

**The engine as built — there is no single formula. There are four estimators at two grains, and
they never reconcile:**

| # | Quantity | Where | Formula |
| --- | --- | --- | --- |
| 1 | `CardProgress.confidence` 1-10 | `nextConfidence`, `memory/scoring.ts` | Incremental counter, starts at 5. Binary modes +/-1. Graded SA on the 1-10 rubric: `>=8` -> +1, `7` -> 0, `5-6` -> -1, `<=4` -> **-2**. Clamped 1-10. |
| 2 | `CardProgress.mastery` 0-100 | `masteryScore`, `memory/scoring.ts` | Recency-weighted mean correctness over the last **10** events, weight `0.8^i` (i=0 newest). `eventCorrectness` prefers `score/100` over the boolean `correct`, so graded nuance survives. `null` when nothing is scorable. |
| 3 | `KlpState.pKnown` | `stepBkt`, `metrics/bkt.ts` | BKT. Prior **.25**, learn **.1**, slip **.1**, `guess = 1 - EVIDENCE_STRENGTH[mode]` (SA .05 / MC .25 / TF .50). Mixing weight is `STATUS_CREDIT` (passed 1 / partial .5 / failed 0) **only** — the stored `credit` float is deliberately never read here, since it already folds in the mode discount and applying it twice creates a fixed point below 1. |
| 4 | Topic mastery | `metrics/read.ts` + `klt-rollup.ts` | Aggregate of member KLPs' `pKnown`, gated by the learner's `minObservations` floor. |

**Complete inventory of multiplicative terms in the system**, so the rework knows what it is
touching: `MASTERY_DECAY 0.8^i` (recency); `confidenceScale 0.5-1.5` (scheduling only);
`STAR_BOOST 1.15` and `DIM_WEIGHTS` (accuracy 1.0 / clarity 0.8 / conciseness 0.7) in
`errors/significance.ts`; `EVIDENCE_STRENGTH` SA .95 / MC .75 / TF .50 (enters BKT as a guess rate,
not as a weight); `weight / 5` KLP centrality in `rankCandidates`'s `weakness` term; `GROWTH_RATE 2`
with `MAX_INTERVAL_DAYS 60` in scheduling.

**Three structural problems to start the week from — these are design gaps, not bugs:**
- **The card grain and the KLP grain never talk.** `masteryBucket` reads confidence + mastery;
  `rankCandidates` reads pKnown + weight + readiness + dueAt. Two knowledge estimates for the same
  card can disagree, and nothing reconciles or even surfaces the disagreement.
- **"Confidence" is not confidence.** It is an outcome-derived counter, not a self-report. Nothing
  captures what the learner *thought* they knew at answer time, so **calibration — the gap between
  believed and actual knowledge, arguably the most useful signal in interview prep — is not
  computable today.** Capturing a self-rating at answer time is a cheap data-capture change that
  must land before any calibration metric can be designed.
- **Speed is untrusted by construction.** The 10-minute cap exists because a learner who walks away
  produces a 40-minute answer. Any speed multiplier must degrade to "no signal" rather than to a
  default, and `paceIndex` already establishes the right shape: mode-scoped, a ratio to the
  learner's *own* baseline (never a cross-mode absolute), `null` below `MIN_TIMED_OBSERVATIONS = 3`,
  and the baseline drawn from an **unscoped** population even when the view is scoped.

**Anything retuned here must recompute cleanly.** Spec 2a persists significance *components*
alongside the computed value precisely so the formula can be retuned and history recomputed, and
`computeSignificance` returns its inputs for the same reason. A mastery rework that introduces a
term with no persisted input silently makes every historical row un-recomputable. Note also that
`CardProgress` is **incremental**, with `recomputeCardProgress` the only replay path.

### 13. ⬜ Error DAG — what you missed, and what the AI predicts it leads to

**The ask:** "build a DAG (directed acyclic graph) that will later serve as the base for them
visualizing/understanding what they missed and what mistakes the AI predicts it'll lead to."

**Not the concept tree.** `Klt` / `SetKltNode` is a strict **tree** (6 levels, `depth` invariant
tested, `parentKltId` with `onDelete: Restrict`) expressing *containment* — WACC sits under
valuation. This is a different edge type: **consequence / prerequisite** — "misunderstanding X will
make you get Y wrong" — which is many-to-many and therefore genuinely a DAG. Do not try to make one
structure carry both; the containment invariants (single parent, denormalized ancestor closure) are
exactly what a consequence graph must not have.

**What already exists as seed data, and this is the interesting part:** `AnswerErrorTag` carries
`klpId` **and `secondaryKlpId`** for `conflation` errors — an *observed, evidenced* edge between two
KLPs, already accumulating, already deterministic, already promoted and retired by
`metrics/misconceptions.ts`. The measured half of this graph is being collected today. The
predictive half — "what it will lead to" — is the new bet.

**The load-bearing design question:** an AI-predicted edge and an observed edge are **not the same
kind of claim**, and the feature is worthless if they are drawn identically. Same rule as item 11
and as Spec 2a's refusal to fabricate tags: a predicted consequence is a hypothesis that has not
happened yet, and rendering it beside "you actually conflated these twice" makes the evidence
unreadable. Edge provenance (observed / predicted / curated) has to be first-class in the schema,
not a render-time flag.

**Cycle prevention is a real problem, not a formality.** An AI asked "what does misunderstanding X
lead to?" will happily produce X -> Y and Y -> X across two calls. Acyclicity must be enforced on
write — the KLT tree already needed `src/lib/klt/invariants.ts` for a strictly easier invariant.

**Sequencing:** item 11's curated misconceptions are natural *nodes* in this graph, and item 10's
question types are a plausible edge filter. Building 13 before 11 means building it on KLPs alone,
which works but is thinner.

### 14. ⬜ Separate writing signals from learning signals in short answer

**The ask:** "separating writing signals from learning signals in short answer response questions
& analysis (need to do that a bit later — remind me also to spend a week just going over possible
ways of doing that and diving deep into the question)."

**This is a research week the user has explicitly asked to be reminded to book. Remind them.** It
is not a build item and should not be turned into one prematurely.

**Where the codebase already half-draws this line, imperfectly:** `docs/ai/error-taxonomy.md`'s
three dimensions are `accuracy`, `clarity`, `conciseness`, weighted 1.0 / 0.8 / 0.7 in
`DIM_WEIGHTS`. Accuracy is a learning signal; clarity and conciseness are writing signals — and all
three are already **summed into one `significance` number**, which is precisely the conflation the
user wants undone. `computeArticulation` (`metrics/articulation.ts`) goes further and computes a
signed `verbosityIndex` (over-talk minus under-talk) plus a `readiness` score, which are pure
articulation measures kept separate from `pKnown`. So the separation exists at the articulation
layer and is **collapsed again** at the significance layer.

**The question that makes it a week and not an afternoon:** the two signals are not independent.
CLAUDE.md's own grading note observes that a wrong answer can score well on clarity (clearly
admitting "I don't know"), and the inverse — a learner who knows the material but writes badly — is
indistinguishable from partial knowledge *in text*, which is the only channel a short answer has.
Stage 4's spoken answers add delivery metrics but do not resolve it. Worth reading
`docs/ai/error-taxonomy.md`'s `clarity` / `conciseness` type lists and `OVER_TALK_TYPES` before the
session, since that vocabulary is closed and already persisted.

## Where deferred issues are recorded

Never in memory — always in a spec's own section.

| Spec | Section | Status |
| --- | --- | --- |
| `2026-08-03-answer-analysis-capture-design.md` (2a) | "Known drift risks, deliberately out of scope" | **All 3 resolved.** Two fixed 2026-08-08; the third (reset ↔ quiz history) was already true in code. |
| `2026-08-04-answer-analysis-display-design.md` (2b) | "Explicitly NOT fixed" | **Resolved** — `startQuizAttempt` ownership, closed by the visibility work. |
| `2026-08-05-metrics-substrate-learner-profile-design.md` (Spec 3) | **§14 follow-ups** | **BOTH CLOSED 2026-08-14** by Spec 3C Task 12. |
| `2026-08-10-deletion-and-forgetting-design.md` | **§8 "Answers should not be resubmittable at all"** | **OPEN — decided 2026-08-10, not built.** Re-answering a graded question isn't evidence of knowledge, but every metric downstream treats it as though it were. The legitimate case (a missed high-weight KLP in short answer) is an AI-generated **follow-up question** with its own provenance — a different quiz type and UI, not a second pass. Remove the `replace` path in `createAnswerWithAnalysis` when that lands. |
| `CLAUDE.md` | Future Considerations | Forget: **pruned 2026-08-11** (item 2 built). Visibility: still carries the stale pre-fix paragraph — **delete it when this branch merges**, as its own note says. |

---

## Findings from the 2026-08-08/09 session

### Fixed

| Finding | Where | Commit |
| --- | --- | --- |
| `rebuildState`'s doc comment told the next reader a Spec 3B band edit needs a posterior replay. False since spec §3.3 was corrected — bands never reach BKT. Would have been read as an instruction. | `src/lib/metrics/cache.ts:32` | `00f0aef` |
| `StudySource` re-listed as two literal `z.enum([...])` arrays, so adding a mode type-checked everywhere then failed at **runtime** on `SessionInsight` parsing. Now derives from `STUDY_SOURCES`. | `src/lib/memory/scoring.ts`, `insight.ts` | `356b51d` |
| `Card.klpStatus`'s four literals scattered across 2 actions, a component and a Prisma comment, with no shared constant. Worst in `KlpEditor`, which renders retry/skipped affordances off `status === '...'` — a typo fails by showing nothing. | `src/lib/cards/klp-status.ts` (new) | `6680820` |
| `card-autocomplete.ts` fetched **any** set by id with no owner check and fed every card into an AI prompt. Previously unrecorded anywhere. Tightened to owner-only. | `src/actions/card-autocomplete.ts` | `fae943e` |
| `print/page.tsx` fetched a `QuizAttempt` by id checking only `attempt.setId`, so any signed-in user could print another learner's attempt (their `selectedCardIds` + generated options). Same class Spec 2b fixed twice and missed here. | `src/app/sets/[id]/print/page.tsx` | `78d58e0` |
| `profile.ts` fetched a set **title** from a URL-controlled scope with no check — anyone could pull another user's set title into their profile block. Found by the plan's own final-verification grep. | `src/lib/memory/profile.ts:420` | `92102b6` |
| Spec + plan both claimed `/match` is readable signed-out. It is not — middleware gates it — and matching *is* studying, so it shouldn't be. | docs + `match/page.tsx` comment | (doc commit) |
| `StudySession` was missing from `RESET_MEMORY_MODELS`; both `sessionId` FKs are `SetNull`, so a full account reset left every session row standing as an empty husk. | `src/lib/memory/erase.ts` | `6ff0a1d` |
| A quiz resubmit stepped confidence twice — the superseded answer's `StudyEvent` survived the replace, and `CardProgress` is incremental. | `src/actions/quiz.ts` | `c570d8a` |
| Quizzing a **starred** card silently unstarred it: the resubmit replay ran on every submission, and a starred-but-unstudied card replays over zero events → `recomputeCardProgress` returns null → the row is deleted and recreated with `starred: false`. | `src/actions/quiz.ts` | `c570d8a` |
| `/profile/activity/[id]` rendered a full quiz permalink that **nothing in the app linked to**. | `src/app/profile/page.tsx` | `b911ae4` |

### Still open — not bugs, but know them

- ~~`getLearnerMetrics` has zero production callers~~ — **CLOSED 2026-08-14.** `/profile/learner` and `safeProfileBlock` both call it now (Spec 3C).
- ~~Spec 3 §14's two prompt-block defects~~ — **CLOSED 2026-08-14** by Spec 3C Task 12.
- **`MIN_OBSERVATIONS = 3` hides every knowledge number.** Live DB has 19 answers, 1 user, every KLP seen exactly once, so **zero topics report non-null knowledge** and the signed verbosity index cannot go negative. Nothing is broken — the corpus is thin. **Do not seed synthetic study data**: the posterior is incremental and not self-correcting, so fabricated evidence does not cleanly come back out. Spec 3B makes the floor tunable, which is the real fix.

---

## Environment gotchas (will waste your time otherwise)

1. **`.env` contains only `DATABASE_URL`.** No `NEXTAUTH_SECRET`, so `auth()` throws `MissingSecret` and the app is broken locally — pages 500 or misbehave in confusing ways. For local verification, pass one to the dev process rather than editing the file:
   ```bash
   NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
   ```
   **CLAUDE.md's security note is stale** — it says `.env` holds live `GOOGLE_API_KEY` and `RESEND_API_KEY`. It no longer does.

2. **`cursor-agents/` is a separate git repo** cloned into the project root on 2026-08-09. It has its own `.git` and `package.json` and depends on an uninstalled `@cursor/sdk`. Because `tsconfig.json` includes `**/*.ts` and excludes only `node_modules`, it **breaks `tsc` and `vitest` for this project**:
   - `npx tsc --noEmit` → 1 error, entirely from `cursor-agents`
   - `npx vitest run` → 993 tests, 7 failing, all in `cursor-agents`

   Verify this project alone with:
   ```bash
   npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
   npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
   ```
   Left untouched deliberately — it is not part of this project. If it stays, it wants a `tsconfig`/`vitest` exclude.

3. **Windows:** `pkill` does not stop the Next dev server. Use `taskkill /PID <pid> /F` after finding it with `netstat -ano | grep :3001`.

4. **`tsx` scripts must live inside the project** (e.g. `scripts/`) or module resolution fails, and they need a `main()` wrapper — top-level `await` breaks under the CJS output format.

5. **`prisma migrate dev` is unusable from an agent shell** — it needs a TTY and has no non-interactive override (unlike `migrate deploy`). Either the human runs it, or generate the SQL and apply it yourself:
   ```bash
   npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```
   then write it to `prisma/migrations/<timestamp>_<name>/migration.sql` and `npx prisma migrate deploy`. Re-run the diff afterwards — "This is an empty migration" means zero residual drift. Note `--from-schema-datasource` was **removed** in this Prisma version; the flag is now `--from-config-datasource` (a `prisma.config.ts` exists).

6. **CLOSED 2026-08-19 by item 6e (credentials auth) — a signed-in session IS now reachable from an agent session.** This trap is no longer true as originally written below, and reading the old text would wrongly hand a future agent's own live gates to the human. Run:
   ```bash
   NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
   npm run seed:dev-user
   ```
   then sign in at `/login` with the seeded `dev_user` (or `dev@localhost.test`) credentials — either identifier resolves against the real database. `seed:dev-user` refuses to run against a production `DATABASE_URL`, and re-running it is safe (upsert). This is how item 6e's own live gate ran end to end with no human in the loop — the first gate in this project an agent ran itself.

   **Still true, and still a real hole: GitHub OAuth specifically remains unreachable.** `.env` has no `GITHUB_ID`/`GITHUB_SECRET`; clicking "Continue with GitHub" produces no server-side request at all (confirmed against the dev server log), not merely a failed one. So the `OAuthAccountNotLinked` copy check (Task 7 of the credentials-auth plan) is still owed to the human — it needs a real GitHub account whose email collides with an existing password account, which nothing in this environment can produce. Any plan step that specifically needs OAuth (as opposed to any signed-in page) still goes to the human as an explicit gate.

7. **A client component that gains a server-action import breaks every jsdom test that renders it.** A `'use server'` module pulls `next-auth` into the browser environment and the test file dies at load with `Cannot find module next/server` — before any test runs, so the failure looks unrelated to the change. Mock the action module (see `tests/components/QuizSummary.test.tsx`).

8. **A raw statement whose result you never read must use `$executeRaw`, never `$queryRaw`.** `$queryRaw` deserializes result columns, and the Neon driver adapter throws `P2010 / UnsupportedNativeDataType — Failed to deserialize column of type 'void'` on a `void`-returning function. This broke `pg_advisory_xact_lock` in `lockKlpStates` for three days (shipped `81e2d1f`, fixed `1bcbc74`), taking down **quiz answer submission** as well as every erasure verb, because both call it inside the write transaction. **No mocked test can catch this** — a fake deserializes nothing, and the four fake tx clients answering `$queryRaw` are exactly what made the suite green over a broken statement. `SELECT id ... FOR UPDATE` (match-session, quiz-matching) is fine: `id` is a real column.

9. **Component tests must call `afterEach(cleanup)` themselves.** `vitest.config.ts` has no `globals: true`, so RTL never registers its auto-cleanup and one test's DOM bleeds into the next — a second `render` makes `getByRole` throw on multiple matches. Also: each `*.test.tsx` needs `// @vitest-environment jsdom` as its literal first line.

---

## Baselines (branch `spec3b-tunable-scoring`, 2026-08-21, after item 8)

- **Tests:** 140 files / **1655 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`next build`:** clean
- **`npm run lint`:** **175 problems** (131 errors, 44 warnings) — unchanged from the item 6e baseline; all pre-existing. Compare against this; do not fix unrelated ones. (187 on 2026-08-09 → 186 after the deletion work → 185 after 2b, unchanged by Spec 3B and 3C → 178 after item 5 removed 7 dead imports → 176 after item 6 removed four `as any` casts, unchanged by items 6b, 6d, 6f and 8 → 175 after item 6e.)
- Branch is **not merged**. `origin` carries item 6e's work as of 2026-08-20 (through `f5c4615`), pushed manually; item 8 (through `fb8a851` plus this doc commit) has **not yet been pushed** — `git status -sb` showed `ahead 24` of `origin/spec3b-tunable-scoring` at the time this was written. Check `git status -sb` before believing the remote is current.
- **There is NO auto-push hook**, despite what this file assumed for several items — `.git/hooks/` contains nothing but samples. Every earlier entry that says "a commit hook pushes automatically, so `origin` tracks HEAD" was wrong.


---

## Insight generation & learning plans — specified by the user 2026-09-03

**Recorded at the end of the queue at the user's request.** This is the payoff layer: it is why the
KLP engine, the edges and the verdict labels are shaped the way they are. Spec 9.

### The method: pair parts of the history together

A single verdict says what happened once. An insight comes from holding two records of the *same*
knowledge side by side and reading the **difference**. The user's list, with what each needs —
**this list is explicitly incomplete and a fuller one is owed**:

| Pairing | Reading | Needs |
| --- | --- | --- |
| **Recognition vs production** (MC + short answer, same KLP) | right MC / weak SA → **expression or schema**; wrong on both → **content** | **NOTHING — computable today** |
| **Compute vs explain** | strong `quantitative` / weak `mechanism` → procedural only | nothing new; `CardKlp.kind` exists and is read by no metric |
| **Node vs edge** ("what is X" vs "what happens to X if Y changes") | high node / low edge → **connectivity** | Spec 3 relation probes |
| **In-scope vs out-of-scope** | right in-scope / wrong out → **boundary failure** | Spec 3 `applies_within` |
| **Familiar vs novel framing** | right textbook / wrong novel → **transfer** | a framing axis on items; `analogous_to` |

**Two findings worth acting on:**
- **Recognition vs production needs no new capture at all.** `AnswerKlpResult` already stores `mode`
  and `klpId` on every row, so grouping one KLP's verdicts by mode is a query against data that has
  been accumulating this whole time. Nothing computes it. **The cheapest real insight available.**
  The user calls this the pairing that "collapses your biggest ambiguity."
- **Node vs edge is the single biggest instrument gap.** In the user's words: *"You cannot detect
  connectivity without relational items — this is probably your single biggest instrument gap right
  now."* Nothing in the system currently asks a question whose answer is a *link*; every question
  tests a node. Connectivity is not hard to detect today, it is **impossible**. This is the
  justification for Spec 3.

Each pairing is a **hypothesis about what a difference means** and needs checking against real
learner data before its reading is trusted.

### Diagnoses — the output of insight, the input to a plan

`gap` · `misconception` · `brittleness` · `conflation` · `boundary` · `connectivity` · `transfer` ·
`expression` · `template_anchoring`

**`template_anchoring` comes free from the authoring pipeline.** Step 3 already requires writing a
*memorized-template* wrong answer as a test fixture — and that artifact is exactly the near-miss
that punishes a rehearsed response. The instrument is manufactured while proving the KLPs
discriminate, the same way the relation prune manufactures its own probe.

**`expression` is not computable until the deferred communication work lands.**

### Learning plans — match the intervention to the failure

**Do not emit a topic list.** Emit, per item: **the specific claim being repaired** (a klpId, not a
topic), **a task type matched to the diagnosis**, and **a verification item**. 20-40 minutes,
ending in something testable.

| Diagnosis | Intervention |
| --- | --- |
| Gap | Instruction, then spaced retrieval |
| Misconception | **Confrontation.** Re-explaining does not work. Make the person state their belief, then show it predicting something false: **elicit → predict → contradict → reconcile** |
| Brittleness | Same concept, many surface forms, spaced |
| Transfer | Contrast cases, novel contexts, "what's the same and what's different" |
| Expression | Structural templates and rewriting, **not** more content |
| Conflation | Side-by-side discrimination drills — **never study the two separately** |
| Boundary | Edge cases and counterexamples specifically |
| Template anchoring | Near-miss questions that punish the rehearsed answer |

**Three rows actively contradict what a generic study plan would do**, which is the whole argument
for diagnosing first: a misconception gets *worse* under re-explanation (the learner assimilates the
explanation into the belief they already hold); a conflation studied one side at a time reinforces
itself; and brittleness needs no more explanation at all, only the same thing in unfamiliar clothes.
