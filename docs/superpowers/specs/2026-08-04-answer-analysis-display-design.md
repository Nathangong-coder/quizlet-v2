# Stage 8 Spec 2b — Answer Analysis (Display)

**Date:** 2026-08-04
**Status:** design draft
**Frozen reference:** `docs/ai/error-taxonomy.md` (approved, do not re-litigate)
**Depends on:** Spec 2a (`docs/superpowers/specs/2026-08-03-answer-analysis-capture-design.md`), fully implemented — see `docs/superpowers/plans/2026-08-03-stage8-spec2a-answer-analysis-capture.md`

---

## Why this exists

Spec 2a ships **invisibly**: every quiz answer since its migration writes `AnswerKlpResult` and `AnswerErrorTag` rows, but nothing reads them. `getQuizAttemptSummary` (`src/actions/quiz.ts:1065`) — the query behind the results page — doesn't fetch either table. A learner who gets a multiple-choice question wrong today sees which option was correct and nothing else; the row recording *which specific misunderstanding* they revealed sits in the database unread.

This spec is the read path: fetch what 2a wrote, render it per-answer, and roll it up across the one session that just happened. It adds no schema, no AI call, no new write. Everything here is a query and a view over data that already exists.

---

## Scope

**In:**
- Extend `getQuizAttemptSummary` to fetch `klpResults` and `errorTags` per answer, with the KLP text needed to render them.
- Per-answer tag rendering in `QuizSummary.tsx`'s Individual Review tab, for all three analyzed modes (MC, TF, SA).
- A pure, same-session rollup — aggregate errors by dimension/type and by KLP across the attempt's own answers — surfaced as a new section in the Overall Analysis tab, for every mode (not gated to short-answer the way `SessionInsightView` is today).
- Explicit UI handling for `analysisStatus !== 'analyzed'` and for legacy (`null`) rows, so "nothing to show" reads as "not analyzed," never as "clean."

**Out:**
- Cross-*attempt* aggregation, mastery, BKT, forgetting curves, misconception promotion — Spec 3. This rollup is scoped to the one session on screen; it has no memory of yesterday.
- Anything actionable — "add this to my training plan," dismissing a tag, editing significance — Spec 4.
- Replacing or restructuring `SessionInsightView` (the existing free-text AI summary tab). Confirmed out of scope for this pass: it stays exactly as it is, and the new rollup sits alongside it. Revisiting that boundary is a later call, once there's a real corpus of both to compare.
- Any new `generateJson` call. The AI's job ended when Spec 2a captured its judgment; this spec only reads and formats.

---

## §1 — Read path

### `getQuizAttemptSummary`'s include

Today:

```ts
answers: {
  include: {
    card: { include: { contentBlocks: { orderBy: { position: 'asc' } } } },
  },
},
```

Extended:

```ts
answers: {
  include: {
    card: { include: { contentBlocks: { orderBy: { position: 'asc' } } } },
    klpResults: {
      include: { klp: { select: { text: true, kind: true } } },
    },
    errorTags: {
      include: {
        klp: { select: { text: true, kind: true } },
        secondaryKlp: { select: { text: true, kind: true } },
      },
    },
  },
},
```

Both relations are small — `AnswerKlpResult` is capped at one row per targeted/tested KLP, `AnswerErrorTag` at `MAX_TAGS_PER_ANSWER` (4) — so this is a bounded join per answer, not an N+1 risk.

### The nullable `klp` reference

`AnswerErrorTag.klp` is `onDelete: SetNull` (Spec 2a §1: the tag survives a hard-deleted card because the learner's error still happened). A tag with `klpId: null` — either a whole-answer tag that never had a target, or a card deleted since — renders with generic language ("this answer" rather than the KLP's text) instead of crashing on a missing relation. `AnswerKlpResult.klp` has no such case: that relation is a real (non-nullable) FK with `onDelete: Cascade`, so a `klpResults` row is only ever fetched alongside a live `CardKlp`.

### `analysisWarnings` stays server-side

Spec 2a is explicit that `analysisWarnings` is developer telemetry ("not for Spec 3, which reads `analysisStatus` only") — reasons like `unresolved_klp_ref` or `dimension_cap` are debugging signal, not learner-facing content. This spec does not surface it anywhere in the UI. If a future debug view wants it, that's a separate, explicitly-scoped addition.

---

## §2 — Per-answer display

Extends the existing per-answer `Card` in `QuizSummary.tsx`'s Individual Review tab (`src/components/quiz/QuizSummary.tsx:234-301`). New content is additive — nothing existing (the MC option grid, the SA grade factors, the feedback text) changes shape.

### KLP results — "what this question was actually testing"

Rendered as a small checklist, one line per `AnswerKlpResult`, using the KLP's `text` (never its id) and `status`:

- `passed` — a check, muted/neutral tone (this is routine evidence, not an achievement; MC/TF credit it at 0.75/0.50, not 1.0, and the UI shouldn't claim more confidence than the data does)
- `partial` — a dash/half-mark
- `failed` — an X, in the same red family the existing wrong-answer styling already uses

For MC/TF, this is genuinely new information: today a wrong MC answer shows the correct option and nothing else. The checklist adds "you were tested on inversion of KLP X" even though the question only surfaces one distractor.

For SA, this **replaces nothing** — the existing clarity/conciseness/correctness `GradeFactor` cards stay. The KLP checklist is a new block, because "was the answer clear" and "did the answer cover proposition X" are different axes the current UI conflates into three generic rubric scores.

### Error tags — "what kind of mistake"

Rendered as badges near the existing feedback/AI-summary block: `dimension` sets the badge color family (accuracy/clarity/conciseness — reuse `DIM_WEIGHTS`' implicit ranking, accuracy reads as the most serious), `type` is the label text (humanized: `factual_error` → "Factual error"), and `quote` (when present) renders as a short excerpt under the badge, styled the same as the existing `ExpandableText` quoting pattern already used for matching answers.

`significance` is **not** shown as a raw number on the per-answer card — a bare "7/10" next to a dimension badge invites over-interpretation of a single data point. It's used only to *order* multiple tags on the same answer (most significant first) and to decide which KLP the rollup (§3) treats as the sharper miss when a tie needs breaking.

### Zero tags, explicitly

An answer with `analysisStatus: 'analyzed'` and empty `klpResults`/`errorTags` is a genuinely clean answer — nothing renders beyond what's there today. This is the case that must not be confused with the next section.

---

## §3 — Session rollup

A new pure function, `src/lib/analysis/rollup.ts`, `rollupSessionAnalysis(answers): SessionRollup` — no AI call, no query of its own, operates on the same `answers` array `getQuizAttemptSummary` already fetched.

```ts
export interface SessionRollup {
  analyzedCount: number
  totalCount: number
  errorsByDimension: Record<Dimension, number>
  errorsByType: { type: string; dimension: Dimension; count: number }[]  // sorted desc, ties broken by total significance
  struggledKlps: { klpId: string; text: string; failCount: number; totalSignificance: number }[]  // sorted desc, top 5
}
```

**`analyzedCount` / `totalCount` is the honesty check.** Spec 2a's whole reason for `analysisStatus` is that a rate calculated over *all* answers silently over- or under-states a learner's actual error rate when some fraction couldn't be analyzed. This rollup surfaces that directly — "8 of 10 questions analyzed" — rather than quietly computing `errorsByDimension` over a partial, unlabeled sample. Only answers with `analysisStatus === 'analyzed'` contribute to `errorsByDimension`/`errorsByType`/`struggledKlps`; the other statuses (`no_provenance`, `no_klps`, `failed`, legacy `null`) count toward `totalCount` but not `analyzedCount` or any of the aggregates.

**`struggledKlps` groups by `klpId` across every answer in the session**, not per-question — a card tested twice in one quiz (unlikely today, but the function shouldn't assume otherwise) contributes to the same bucket. `failCount` counts `AnswerKlpResult.status === 'failed'` rows; `totalSignificance` sums the `AnswerErrorTag.significance` of tags targeting that KLP, giving a tiebreaker that isn't just a raw count.

**Explicit non-goals**, stated so nobody mistakes this for Spec 3 arriving early: no mastery percentage, no BKT, no forgetting curve, no `repeatBonus` (that requires reading *other* sessions — this function never queries). It is a same-session tally, nothing more. The name is deliberately `rollupSessionAnalysis`, not `learnerProfile` or `masteryReport`.

### Placement

A new card in the Overall Analysis tab (`QuizSummary.tsx`'s `summary` `TabsContent`), shown for **every mode** — unlike `SessionInsightView`, which stays gated to `attempt.mode === 'short-answer'` exactly as it is today. Order: `SessionInsightView` (when present) first, since it's the richer AI-authored narrative; the structured rollup card below it. For non-short-answer attempts, the rollup card is the only thing in that tab besides the existing "Quiz Complete!" summary — filling a tab that currently has nothing but a score restatement for MC/TF/matching quizzes.

---

## §4 — Degradation UI

| `analysisStatus` | Per-answer UI | Rollup contribution |
| --- | --- | --- |
| `analyzed`, zero rows | Nothing extra rendered — a clean answer | Counts toward `analyzedCount`, contributes zero to error aggregates |
| `analyzed`, some rows | KLP checklist + tag badges (§2) | Full contribution |
| `no_provenance` | A muted one-line note: "Detailed analysis wasn't available for this question." | Counts toward `totalCount` only |
| `no_klps` | A muted one-line note: "This card's key points haven't been generated yet." | Counts toward `totalCount` only |
| `failed` | A muted one-line note: "Analysis failed for this answer." (Currently unreachable per Spec 2a's own recorded gap — included for when that's fixed, not dead code today: the UI must not silently show nothing for a status the schema already declares.) | Counts toward `totalCount` only |
| `null` (pre-Spec-2a legacy row) | Nothing extra rendered — same as today, no regression | Excluded from `totalCount` entirely (a rollup mixing pre- and post-spec answers in one attempt is not a real scenario post-migration, but the function should not miscount a null as "not analyzed out of N" when it predates analysis existing at all) |

The three degraded-but-non-null statuses share one visual treatment (muted, informational, non-alarming) — the point is only to prevent "no tags" reading as "nothing wrong," not to alarm the learner about a system limitation they can't act on.

---

## §5 — Testing

Pure and unit-testable without a database:

| Module | Responsibility |
| --- | --- |
| `rollupSessionAnalysis` | Aggregation math, the `analyzedCount`/`totalCount` split, sort/tiebreak order, empty-input behavior |

Integration cases (mocked `@/lib/db`, following `tests/actions/analysis-mc-tf.test.ts`'s pattern):

1. **`getQuizAttemptSummary` includes `klpResults` and `errorTags`** with their `klp`/`secondaryKlp` text — a regression guard against the include silently reverting to today's shape.
2. **A `no_provenance` answer contributes to `totalCount` but not `analyzedCount`** — the one invariant this whole spec exists to preserve on the display side, mirroring Spec 2a's write-side invariant.
3. **A tag with `klpId: null` (whole-answer tag, or a hard-deleted card) renders without throwing** — pins the nullable-relation handling in §1.
4. **`struggledKlps` groups two failures on the same KLP from different answers into one bucket**, not two.

Component-level: a snapshot or RTL test on `QuizSummary.tsx` asserting the KLP checklist and error badges render for a fixture MC/TF/SA answer each, and that a legacy answer with no `analysisStatus` renders identically to today (no regression for pre-2a history).

---

## Open questions carried into implementation

- **Humanizing error-type strings** (`factual_error` → "Factual error", `unsupported_leap` → "Unsupported leap") needs a lookup table somewhere — either inline in the display component or a shared `src/lib/errors/labels.ts`. Small, but worth deciding once rather than ad-hoc per call site.
- **Icon/color choices** for pass/partial/fail and per-dimension badges aren't pinned here — left to implementation to match the existing design system (`src/components/ui/badge.tsx` variants), not dictated by this doc.
- Whether the rollup card should be collapsible/collapsed-by-default on a long multi-mode quiz is a UX call better made against a real screenshot than in prose here.
