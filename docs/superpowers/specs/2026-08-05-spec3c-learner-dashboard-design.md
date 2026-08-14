# Stage 8 Spec 3C — Learner dashboard (`/profile/learner`) & study scope

**Date:** 2026-08-05
**Revised:** 2026-08-13 — see §0. Spec 3B has now shipped and live-verified, which
changes what this spec can assume, and a **saved study scope** was added to its
scope at the user's request (§6).
**Status:** design, revised against the code as it stands on branch
`spec3b-tunable-scoring`. Not built — no plan yet.
**Depends on:** Spec 3 (metrics substrate) **and Spec 3B** (tunable scoring &
targeting, done 2026-08-13). The either-order note in the old §5 is obsolete:
3B landed first.

---

## 0. What changed since 2026-08-05

**Spec 3B shipped and was live-verified on 2026-08-13.** Five consequences for
this spec, each of which makes something in the original text wrong:

1. **`getLearnerMetrics` now returns `ranked`** — a KLP-grain candidate list,
   ordered by the learner's chosen strategy, each candidate carrying
   `sufficient: false` when it sits below their evidence floor. The old §5 said
   the dashboard "reads the user's selected targeting strategy to order the
   topic and KLP lists". It does not need to: the ordering already happened.
   **The dashboard renders `ranked`; it must not re-sort it.**
2. **The observation floor is no longer 3.** It is `MetricThresholds.minObservations`,
   per learner, editable at `/settings/ai`. Every place the old text said
   "the 3-observation floor" or "3 answers on this point" has to read the
   learner's actual value — hardcoding 3 in the empty-state copy would tell
   someone who set it to 1 that they need evidence they already have.
3. **The dashboard is the first production caller of `getLearnerMetrics`.** It
   had zero before (tests only). Whatever it renders is the first time these
   numbers are seen by anyone.
4. **`LearnerTuning` exists**, and `saveTuning` is **partial** — an absent field
   is left unchanged (Spec 3B §5). §6's new setting is a fourth field on that
   row and a fourth panel, and needs no change to the other three. That is the
   payoff of the partial-save decision, collected.
5. **The live gate found two preconditions that make this page look broken when
   it is working**, and §5 now requires the empty states to name them. See below.

**Still open, and this spec must close both** (Spec 3 §14, re-verified
2026-08-13): all `profileToPromptBlock` callers hardcode `topics: []`
(`src/lib/ai/context.ts:155`, `src/actions/training-plan.ts:34`), so topic-grain
data reaches no prompt; and `capBlock` truncates the topic section **first**,
because the uncapped card section is concatenated ahead of it. **Fix both or
neither** — closing the first alone silently drops the topic signal the moment
an active learner's card section fills `MAX_PROFILE_CHARS`.

---

## 1. Scope

Spec 3 builds a model of the learner that only prompts can see. Spec 3C shows it
to the learner: what they are struggling with, on which topics, and why. It also
adds the one control that decides **what the model is allowed to recommend** —
the saved study scope (§6).

Split out of Spec 3 because everything there is pure functions and persistence,
while this cannot start until they exist.

**This spec adds no aggregation logic.** Every number comes from Spec 3's read
API. Components render; they do not filter, sort, or compute. Aggregation that
leaks into a component is untestable and drifts from the prompt-facing path,
which is the thing that must never happen — the dashboard and the AI must be
looking at the same learner.

---

## 2. Scoping the view

The page follows `/profile/memory` exactly (`src/app/profile/memory/page.tsx`):
a single `HistoryScope` narrows the feed, the stat tiles, and the filter options
together, empty scope is the consolidated view, and scope is URL-synced.

Reusing it rather than inventing a second mechanism matters because the scoped
memory history already solved the hard part — categories present across sets by
grouping per-set `CardCategory` rows on `normalizedName`, which is the same key
Spec 3's topic profile uses. A second scoping implementation would drift, and
the two pages would disagree about what "valuation" contains.

**The saved study scope (§6) supplies this page's DEFAULT scope**, and an
explicit URL scope overrides it. A URL is a more specific instruction than a
setting; a shared or bookmarked link must show what it says. When the default is
in force the page states so, with a one-click "show everything" — a filtered
view the learner did not choose on this visit, and cannot see the reason for, is
the same failure as an empty state that looks broken.

---

## 3. Sections

**Topic mastery.** The two axes Spec 3 §6 keeps separate, kept separate here:
knowledge (`pKnown` rolled up from KLPs) against articulation (SA readiness).
Presenting them on one grid is the point — a topic high on both is done, high
knowledge and low articulation is short-answer practice, low on both is a
lesson. Collapsing them into a single "mastery %" would destroy exactly the
distinction the substrate exists to draw. Topics carry their category colour
from `CATEGORY_PALETTE`.

**What to study next.** `LearnerMetrics.ranked`, in the order it arrives. Each
row is a KLP — the proposition, its card, its topic — because "not WACC, but the
exact sub-claim you get wrong" is the most actionable thing this substrate
knows. Rows with `sufficient: false` are visually separated and labelled
unmeasured, never interleaved as if they were ranked on evidence: on a thin
corpus they are all tied at the prior, and presenting that tie as a ranking
invents a recommendation.

The ordering control names the active strategy and links to `/settings/ai`. It
does not re-implement ordering — changing strategy is a settings action, and the
next read returns a differently ordered list.

**Verbosity calibration.** Per topic, the signed index from Spec 3 §6.2 as a
diverging bar: over-talking one way, under-talking the other, calibrated at
centre. Topics where `too_terse` was excluded for low `pKnown` (§6.3) are
labelled as knowledge gaps rather than shown as neutral — a topic with no
articulation signal *because the learner does not know it* is not the same as a
topic that is well calibrated.

**Weak KLPs.** The specific propositions being missed, with the verbatim
evidence quotes captured on their tags, respecting the learner's evidence floor.

**Active misconceptions.** Promoted conflation pairs from Spec 3 §4, each with
its stored label and `evidence_snippet`. Retirement state is visible so a
learner can see one decaying.

**Retention and pace.** The forgetting curve's bucketed recall, what is due, and
pace outliers — cards answered correctly but far above the learner's own
baseline in that mode, which is the "correct but not fluent" signal.

---

## 4. Closing the prompt-block defects

Not a UI task, but it belongs here because this is the spec that makes topic
data visible, and shipping a dashboard that shows topics while every prompt
still sees `topics: []` would be the clearest possible statement that the
dashboard and the AI are looking at different learners.

Both Spec 3 §14 defects, together:
- callers pass the real topics instead of `[]`;
- `capBlock` reserves a character budget for the topic section rather than
  letting the uncapped card section consume the whole allowance first.

A test must assert a topic survives capping when the card section alone exceeds
`MAX_PROFILE_CHARS`. Without it the fix is untested for the only input that
motivated it.

---

## 5. Empty and insufficient states

Every Spec 3 metric returns `null` below its observation threshold rather than a
low-confidence number, and the UI must preserve that distinction: **"not enough
data yet" is not zero.** Rendering a null as 0% would tell a learner they know
nothing about a topic they have simply not been quizzed on.

Each section states what it needs **in terms of the learner's own floor** —
"needs 3 answers on this point, you have 1" reading from
`MetricThresholds.minObservations`, not from a literal 3 — and links to the
threshold setting, since lowering it is a legitimate response.

**Four distinct causes, and conflating them is the failure mode.** All four
render identically — a fully loaded page with a header and no rows underneath —
so the section must name which one it is. Three of the four are fixable in
seconds *once the learner knows which*, which is the entire argument for
spending copy on this. The 2026-08-13 live gate produced two of them, and both
were indistinguishable from a broken feature until diagnosed against the
database.

| Cause | What the learner must be told | Their fix |
| --- | --- | --- |
| No study history at all | "Take a quiz — nothing here can fill in until you do." | study |
| Evidence exists but sits below their floor | "3 KLPs measured, none has reached your 3-answer floor yet." | lower the floor |
| **No card is both categorized and has key points** | "None of your studied cards is in a category, so no topic can report anything." | categorize a card |
| **Saved study scope resolves, but nothing inside it qualifies** (§6) | "Your study scope is limited to *Valuation Deck*, and nothing in it is categorized yet." | widen the scope |

Distinguishing the last two matters: both are "nothing is categorized", but one
is about the whole library and one is about the slice the learner chose, and the
remedies are opposite — categorize versus widen. A single merged message would
send half of them to the wrong fix. Note the fourth is **not** the stale-scope
case (§6.4), which has already widened by the time this renders and says so
separately; here the scope is entirely valid, just narrow.

The third is the one nobody predicts. Candidates are assembled category → card →
live KLP, so a library whose KLP-bearing cards and categorized cards do not
overlap produces an empty dashboard **however much the learner studies**. At the
gate the real library had 68 KLP-bearing cards and 4 categorized cards with zero
overlap. A page that renders blank in that situation is indistinguishable from
one that is broken, and the learner has no way to discover the cause.

Worth stating in the copy, because it is not obvious and it is cheap: adding a
category to an already-studied card works **retroactively** — posteriors are
keyed by KLP id, so the evidence is already there and the topic lights up
without re-quizzing.

---

## 6. Saved study scope (new, 2026-08-13)

### 6.1 What it is

A fourth panel under **AI settings**, beside study targeting: *which sets and
which categories the app should be working on right now.* Two independent
toggles, each revealing a checkbox list when enabled:

```
[x] Only test certain sets
    [x] Accounting Interview Prep     [ ] Valuation Deck
[x] Only test certain categories
    [x] accounting  [x] statements    [ ] image  [ ] Uncategorized
```

Unchecked means everything. The learner is prepping for one interview; the app
should stop recommending the other four decks without them deleting anything.

### 6.2 What it affects — and the line it must not cross

Decided with the user 2026-08-13, from three candidate readings:

- **The dashboard's default scope** (§2).
- **The ranked "what to study" list** — the recommendation set narrows.
- **Quiz setup's initial category selection**, as a **prefill the learner can
  override**, not a constraint.

**It never affects what is RECORDED.** Same rule as the targeting strategy: this
selects and orders what is *offered*, and touches no write path. A scope that
filtered the memory write path would silently discard evidence the learner
generated, and — unlike a bad ordering — that is not recoverable by changing the
setting back.

**Prefill, not enforcement, was chosen deliberately.** A hard filter would drop a
card the learner explicitly selected in quiz setup, which reads as a bug rather
than as a policy, and quiz setup already has a per-quiz category picker from
Stage 3.6 that would then be lying about what it controls. Prefill gets the
ergonomic win (stop re-picking the same filters) without a surprise.

### 6.3 Storage

A fourth sparse blob on the existing row, not a new table:

```prisma
studyScope Json?   // { setIds: string[], categoryKeys: string[] }
```

The same two dimensions as `HistoryScope`, deliberately — so the stored value
converts to a scope with no translation layer and no second vocabulary to drift.
`saveTuning` is already partial, so the new panel sends only `studyScope` and
the other three panels need no change.

**Sets are stored by id; categories by `normalizedName`.** Not symmetric, and
not an oversight: a `CardCategory` row is set-scoped, so "accounting" is three
different rows across three sets, and storing ids would make a scope that means
one set's accounting only. `normalizedName` is the key the scoped memory history
and Spec 3's topic profile already group on.

**Empty array means everything**, matching `EMPTY_SCOPE`. So the checkbox is
pure UI over the existing zero value, and there is no tri-state to persist.
"Checked with nothing selected" is not a savable state: it means "test nothing",
which is never a useful instruction, and it would produce an empty dashboard
indistinguishable from the broken-looking ones in §5. The panel blocks the save
and says so.

`UNCATEGORIZED_ID` is selectable, since it is a real bucket in
`filterCardsByCategories` and in `ScopeBar`.

### 6.4 Stale references, which are guaranteed

Sets get deleted; Stage 3.6 lets categories be renamed, merged and deleted. A
saved scope will therefore accumulate references to things that no longer exist,
and the resolution rule is a correctness decision, not a detail:

- Resolve stored ids and names against what currently exists.
- **Some survive** → scope by the survivors.
- **None survive** → fall back to unscoped, **and say so on the page.**

The fallback direction is the arguable half, so: an empty recommendation list is
indistinguishable from a broken feature — demonstrated twice in the 3B gate —
whereas a wider-than-intended list is visible, obviously wrong to the learner,
and one click from being fixed. Widening is recoverable and self-announcing;
silence is neither. The announcement is not optional; without it this is just a
setting that stopped working.

### 6.5 Quiz-setup prefill

`QuizSetup.categoryIds` holds **per-set category ids**, while the scope stores
cross-set normalized names, so the prefill is a resolve, not a copy: server-side,
`normalizedName → CardCategory.id` **restricted to the set being quizzed**,
following the existing `resolveCategoryIds` (`src/actions/memory.ts:43`). The
resolved ids become `QuizSetupScreen`'s initial `categoryIds`; every existing
toggle keeps working, and the learner can clear them.

Two cases the prefill must handle rather than ignore:
- **The set is outside the saved set scope.** Prefill nothing and show a
  one-line notice. Silently prefilling a set the learner excluded is confusing;
  silently blocking it would be enforcement, which §6.2 rejected.
- **No category in the scope exists in this set.** Prefill nothing — an empty
  prefill means "everything in this set", which is the current behaviour and the
  right default. Do **not** prefill an empty-but-active filter, which would
  select zero cards and produce a quiz with no questions.

---

## 7. Testing

Rendering tests over fixture read-API payloads:
- a null metric renders its insufficient-data state, never a zero;
- the insufficient-data copy reads the learner's floor, not a literal 3;
- `ranked` renders in the order received — a test that reorders the fixture and
  expects the DOM order to follow is the guard against a component re-sorting;
- sub-threshold candidates are labelled and separated, not interleaved;
- each of §5's four empty states renders its own message from the same empty
  payload plus the coverage counts — four fixtures differing only in the counts,
  asserting four different strings, since one merged message is the defect;
- scope changes are URL-synced and survive reload; the saved default applies
  only when the URL carries no scope;
- topic colours match their categories.

Study scope:
- the stored blob round-trips through the partial `saveTuning` without touching
  bands, thresholds, or strategy — the §5-of-3B invariant, extended to a fourth
  field;
- an all-stale scope resolves to unscoped **and sets the flag that renders the
  notice** (assert the flag, not just the widening — a silent widening is the
  defect);
- a partly-stale scope keeps its survivors;
- "checked with nothing selected" cannot be saved;
- the quiz prefill resolves names to the quizzed set's ids only, and prefills
  nothing when the set is out of scope.

**Mutation-test every guard.** Spec 3B found three assertions that could not
fail — a purity test whose fixture was already sorted, a strategy test whose
fixture every strategy ranked identically, and a source scan that matched an
import rather than a call. For each assertion that exists to catch a specific
defect, introduce that defect, confirm the test reddens, revert.
`scripts/mutcheck.py` automates the loop.

Two environment traps this page will hit (BUILD-QUEUE 7 and 9): a client
component that gains a server-action import kills every jsdom test that renders
it unless the action module is mocked; and component tests must call
`afterEach(cleanup)` themselves and carry `// @vitest-environment jsdom` as
their literal first line.

**A live gate is required, and it is the user's to run** — no signed-in page is
reachable from an agent session (trap 6). `npm run tuning:check` covers the
headless half: it prints what the read API would return, including the coverage
counts §5's third empty state depends on.

---

## 8. Deferred

- **Trend-over-time charts** (mastery per topic across weeks) need a time series
  the substrate does not retain — Spec 3 stores current posteriors, not their
  history. Worth revisiting if the closed loop makes trajectory more interesting
  than position.
- **Unscoped `repeatBonus` derivation** (Spec 3B §3.4.2). A scoped dashboard
  view derives `repeatBonus` over a scoped tag set, so an intervening repeat can
  be filtered out and the same tag reads one point lower than on the
  consolidated view. The unscoped value is canonical. Fixing it means deriving
  the bonus from an unscoped tag query inside `getLearnerMetrics`, the same fix
  its attempt query already applies one level up.
- **Study scope as an enforced filter**, and scoping Review/Matching by it. §6.2
  chose prefill; if the learner later wants "stop me studying off-plan", that is
  a different feature with a different consent story.
