# Stage 8 Spec 3C — Learner dashboard (`/profile/learner`)

**Date:** 2026-08-05
**Status:** design, pending review
**Depends on:** Spec 3 (metrics substrate & learner profile)
**Sibling:** Spec 3B (user-tunable scoring & targeting)

---

## 1. Scope

Spec 3 builds a model of the learner that only prompts can see. Spec 3C shows it
to the learner: what they are struggling with, on which topics, and why.

Split out of Spec 3 because everything there is pure functions and persistence,
while this cannot start until they exist. Keeping them together would delay a
working substrate behind UI work.

**This spec adds no aggregation logic.** Every number comes from Spec 3 §10's
read API, which accepts a `HistoryScope`. Components render; they do not filter
or compute. Aggregation that leaks into a component is untestable and drifts
from the prompt-facing path, which is the thing that must never happen — the
dashboard and the AI must be looking at the same learner.

---

## 2. Scoping

The page follows `/profile/memory` exactly (`src/app/profile/memory/page.tsx`):
a single `HistoryScope` narrows the feed, the stat tiles, and the filter options
together, empty scope is the consolidated view, and scope is URL-synced.

Reusing it rather than inventing a second mechanism matters because the scoped
memory history already solved the hard part — categories present across sets by
grouping per-set `CardCategory` rows on `normalizedName`, which is the same key
Spec 3's topic profile uses. A second scoping implementation would drift, and
the two pages would disagree about what "valuation" contains.

---

## 3. Sections

**Topic mastery.** The two axes Spec 3 §6 keeps separate, kept separate here:
knowledge (`pKnown` rolled up from KLPs) against articulation (SA readiness).
Presenting them on one grid is the point — a topic high on both is done, high
knowledge and low articulation is short-answer practice, low on both is a
lesson. Collapsing them into a single "mastery %" would destroy exactly the
distinction the substrate exists to draw. Topics carry their category colour
from `CATEGORY_PALETTE`.

**Verbosity calibration.** Per topic, the signed index from Spec 3 §6.2 as a
diverging bar: over-talking one way, under-talking the other, calibrated at
centre. Topics where `too_terse` was excluded for low `pKnown` (§6.3) are
labelled as knowledge gaps rather than shown as neutral — a topic with no
articulation signal *because the learner does not know it* is not the same as a
topic that is well calibrated.

**Weak KLPs.** The specific propositions being missed, with the verbatim
evidence quotes captured on their tags, respecting the 3-observation floor.
This is the most actionable view on the page: not "you are weak on WACC" but
the exact sub-claim being got wrong, in the learner's own words.

**Active misconceptions.** Promoted conflation pairs from Spec 3 §4, each with
its stored label and `evidence_snippet`. Retirement state is visible so a
learner can see one decaying.

**Retention and pace.** The forgetting curve's bucketed recall, what is due, and
pace outliers — cards answered correctly but far above the learner's own
baseline in that mode, which is the "correct but not fluent" signal.

---

## 4. Empty and insufficient states

Every Spec 3 metric returns `null` below its observation threshold rather than a
low-confidence number, and the UI must preserve that distinction: **"not enough
data yet" is not zero.** Rendering a null as 0% would tell a learner they know
nothing about a topic they have simply not been quizzed on — the exact failure
the null-not-a-number rule exists to prevent.

Each section states what it needs (e.g. "3 answers on this point") rather than
rendering blank, so the page is legible to a new user rather than looking
broken.

---

## 5. Relationship to Spec 3B

If 3B has shipped, the dashboard reads the user's selected targeting strategy to
order the topic and KLP lists, and links to the settings panel from the ordering
control. If it has not, the default ordering is used. Spec 3C does not depend on
3B and the two can land in either order.

---

## 6. Testing

Rendering tests over fixture read-API payloads: null metrics render their
insufficient-data state rather than a zero, scope changes are reflected in the
URL and survive reload, and topic colours match their categories. No aggregation
is tested here, because none lives here — that coverage belongs to Spec 3's pure
modules.

---

## 7. Deferred

Trend-over-time charts (mastery per topic across weeks) need a time series the
substrate does not yet retain — Spec 3 stores current posteriors, not their
history. Worth revisiting if the closed loop makes trajectory more interesting
than position.
