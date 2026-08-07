# Stage 8 Spec 3B — User-tunable scoring & targeting

**Date:** 2026-08-05
**Status:** design, pending review
**Depends on:** Spec 3 (metrics substrate & learner profile)
**Sibling:** Spec 3C (learner dashboard)

---

## 1. Scope

Spec 3 ships the scoring model with fixed defaults. Spec 3B hands the knobs to
the learner:

- **Severity bands** — the `[floor, ceiling]` per error type from Spec 3 §2
  become editable.
- **Targeting strategy** — the ordering Spec 3 §6.4 deliberately declined to
  pick becomes a selectable option.
- **Read-time derivation on the quiz results screen** (§3.4), so a retune
  re-scores every surface rather than only the dashboard. Added 2026-08-06;
  without it the two views disagree the moment a band is edited.

Both live under **AI settings** (`src/app/settings/ai/`), as the user directed.
Worth noting for later: the bands govern TypeScript-computed scoring rather than
AI behaviour, so if that route ever narrows to strict credential management,
these move rather than being deleted.

The animating principle, stated by the user: ranking and weighting decisions
belong to the learner, not baked into a metric's definition. A metric that
hardcodes one ordering silently makes that call for everyone.

---

## 2. Data model

One row per user:

```
model LearnerTuning {
  userId    String   @id
  strategy  String            // targeting strategy key
  bands     Json?             // versioned, Zod-validated band overrides
  version   Int               // bump when the blob shape changes
  updatedAt DateTime @updatedAt
}
```

**Bands as a validated JSON blob, not a relational table.** Spec 2a argued the
opposite for `AnswerKlpResult`/`AnswerErrorTag` — "a JSON blob can't be indexed
or FK'd, and Spec 3 aggregates these hardest" — and that reasoning genuinely
does not transfer. Bands are never aggregated across users, never joined, never
filtered on. They are read wholesale for exactly one user at the start of a
computation. The applicable precedent is `SESSION_INSIGHT_VERSION`
(`src/lib/memory/insight.ts:7`): a versioned blob that readers parse with a Zod
schema and fall back to regenerating rather than rendering stale.

Overrides are **sparse** — only edited types are stored, and Spec 3's defaults
fill the rest. A user who retunes one type does not freeze the other twenty
against future default improvements.

`strategy` is a column rather than part of the blob because it is a closed
vocabulary that the dashboard also reads, and an invalid value must fail loudly.

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
true/false scoring too.** MC/TF answers carry magnitude 10 and therefore resolve
to the ceiling (Spec 3 §2.3). A user retuning `inversion`'s ceiling to soften
short-answer grading will also change every MC and TF inversion they have ever
picked. This is non-obvious and needs surfacing at the point of edit, not in a
help page.

### 3.3 Saving triggers NOTHING — and that is the design working

**Corrected 2026-08-06, after implementation.** An earlier draft of this
section claimed a band change staled the materialized per-KLP knowledge cache
and required a full replay. That was wrong, and it contradicted Spec 3's own
architecture.

BKT reads `AnswerKlpResult.status` and `.mode` and nothing else — deliberately,
since collapsing the mode discount into the update is what creates a hard
ceiling on `pKnown`. Bands never touch it. What bands *do* affect is
severity → significance → the verbosity index and readiness, and every one of
those is derived at read time from stored inputs.

So saving new bands requires **no recomputation, no replay, and no background
job**. The next read simply produces different numbers. This is precisely the
payoff Spec 3 §3.2 was built for; a replay here would be expensive work
achieving nothing.

The only obligation is that every surface reading these values derives them —
see §3.4.

### 3.4 Every surface must derive, or two screens will disagree

At the end of Spec 3, exactly one caller derived severity and significance at
read time: the learner-metrics read API. The quiz results screen still read the
values **stored on the row when the answer was graded** —
`QuizSummary.tsx` sorts tags by the stored `significance`, and
`rollupSessionAnalysis` sums it.

Left alone, that means the first band retune makes the same error show one
number on the results page and a different one on the dashboard, with nothing
on either screen explaining the discrepancy. Worse, the stored value silently
reflects whichever bands happened to be active on the day it was graded.

**Spec 3B therefore also migrates the Spec 2b display to read-time
derivation** — the per-answer badges and the session rollup both. One number
everywhere, and a retune visibly re-scores history, which is the entire point
of exposing the knob.

The stored `severity`/`significance` columns keep their narrowed role: a
fallback for legacy rows that predate `magnitude`.

---

## 4. Targeting strategies

Each strategy is a **pure ranking function** over Spec 3's metrics, and the
setting selects one. Every function ranks the same candidate set and returns the
same shape, so adding a strategy never touches a call site.

**The candidate is a KLP**, carrying its own metrics: `pKnown`, `observations`,
the topic it rolls up to, that topic's readiness and verbosity index, and the
card's due state. A KLP is the finest actionable unit — it is what a focus quiz
targets and what Spec 4's action plan will schedule — and topic-level ordering
is derivable by aggregating candidates, while the reverse is not. Candidates
below `MIN_OBSERVATIONS` rank last under every strategy: an unmeasured
proposition is not evidence of weakness, and `polish_near_ready` in particular
must not promote a KLP whose high `pKnown` rests on one lucky answer.

| Key | Ranks by | For |
| --- | --- | --- |
| `shore_up_weaknesses` | low `pKnown`, weighted by KLP relevance | Early prep, broad gaps |
| `polish_near_ready` | high `pKnown` × low SA readiness — the articulation residual | Interview imminent |
| `follow_forgetting` | due and overdue first, by predicted recall | Maintenance |
| `balanced` | normalized blend of the three | Default |

`polish_near_ready` is the one the Spec 3 articulation work exists to enable:
it targets material the learner knows but expresses poorly. `balanced` is the
default because a learner who has never opened settings should not be silently
enrolled in an aggressive strategy.

The strategy affects **ordering only** — never which data is recorded, and
never the metrics themselves. A learner switching strategies sees the same
underlying profile ranked differently, not a different profile.

---

## 5. Testing

- Band validation rejects inverted and out-of-range input rather than clamping.
- Sparse overrides merge correctly over defaults; an absent type resolves to the
  shipped default, and a cleared blob restores every default.
- A blob failing Zod validation falls back to defaults rather than throwing —
  matching the `SESSION_INSIGHT_VERSION` precedent, since a corrupt settings row
  must not make the app unusable.
- Each targeting strategy is a pure function tested against fixture metrics, with
  its documented intent asserted (e.g. `polish_near_ready` ranks a
  high-`pKnown`/low-articulation KLP above a low-`pKnown` one).
- Changing a band and replaying produces the same significance values as
  computing from scratch under those bands — the cache and the pure path must
  not diverge.

---

## 6. Deferred

Per-topic band overrides (harsher on accounting than on vocabulary) are a
plausible extension but not requested; the schema tolerates it, since the blob
is versioned.
