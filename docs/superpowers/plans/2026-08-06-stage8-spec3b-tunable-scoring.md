# Stage 8 Spec 3B — User-tunable scoring & targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand the learner the knobs Spec 3 shipped with fixed defaults — editable severity bands, three editable metric thresholds, and a selectable study-targeting strategy — and make every surface reflect a retune.

**Architecture:** One `LearnerTuning` row per user holds two versioned, Zod-validated override blobs (bands, thresholds) plus a strategy key. Overrides are sparse and merge over the shipped defaults in pure functions. Targeting strategies are pure ranking functions over KLP candidates; the setting only selects one. Because severity, significance, readiness and the observation floor are all applied at **read time**, saving new tuning requires no recomputation and no replay — but every surface must derive, so the quiz results screen migrates off its stored values.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16 App Router, React 19, Vitest 4, Zod 4, shadcn/base-ui.

**Spec:** `docs/superpowers/specs/2026-08-05-spec3b-tunable-scoring-and-targeting-design.md`

**Depends on:** Spec 3 (merged to main as PR #11) **and the Spec 3 hardening pass** (`docs/superpowers/plans/2026-08-07-spec3-hardening.md`, landed 2026-08-08 on this branch) — that pass fixed ten defects in the numbers this plan tunes, including three criticals in the knowledge posterior. Do not build on the pre-hardening numbers.

---

## Revision note — patched 2026-08-12

The spec was revised on 2026-08-12 (see its §0) after three build items landed on
this branch. Five things in this plan were wrong as a result and are corrected in
place. **If you are executing from a cached copy, discard it.**

1. **Task 7's attempt query must filter zero-answer attempts.** Queue item 2b
   added `ANSWERED_ATTEMPT_WHERE` and applied it to `read.ts`'s `repeatBonus`
   attempt window. The plan's Task 7 queried `{ userId }` unfiltered — a
   different population, therefore different attempt indices, therefore a
   different `repeatBonus` on the results screen than on the dashboard. That is
   the exact disagreement §3.4 exists to prevent, and the old Task 7 test
   *pinned* the wrong predicate. Corrected in Task 7, spec §3.4.1(a).
2. **Task 7 must derive over a repeat-window CONTEXT, not one attempt.**
   `deriveTagScores` builds `seen` only from the tags it is given and looks
   strictly backward, so deriving over a single attempt makes `repeatBonus`
   **structurally always 0** on the results screen. Every single-attempt fixture
   passes anyway. Corrected in Task 7, spec §3.4.1(b).
3. **`saveTuning` takes partial input.** Three panels writing one row with
   read-modify-write reverts each other in ordinary use ("change a threshold,
   change a band, save both"). Absent field now means "leave unchanged". This
   deletes the "send the other two panels' values" instruction from Tasks 4,
   8, 9 and 10. Spec §5.
4. **`prisma migrate dev` is unusable from an agent shell** (BUILD-QUEUE trap 5 —
   it needs a TTY). Task 1 now uses the `migrate diff` + `migrate deploy` route.
5. **Baselines were stale**: 815 tests / 187 lint → **1083 tests / 96 files /
   185 lint**, measured 2026-08-12. Bare `npx vitest run` and `npx tsc --noEmit`
   are also wrong here — `cursor-agents/` in the project root breaks both
   (trap 2). Every command below carries the excludes.

Also note, from the spec's §0: **the live database now holds zero study
history**, so the plan's headline demonstration (lower the floor, watch
knowledge appear) cannot be run until the user studies again, and no
signed-in page is reachable from an agent session (trap 6) — every by-hand step
below is a **human gate**.

## Revision note — rewritten 2026-08-08

This plan was first written 2026-08-06, **before** the hardening pass. It has been
rewritten against the post-hardening code. If you are holding a cached copy of the
older version, discard it. What changed, and why each change matters:

1. **Three knobs, not one.** `MIN_OBSERVATIONS` is now tunable and threaded through
   **all three** of its consumers, and `ARTICULATION_MIN_PKNOWN` /
   `READINESS_WEIGHT_PER_ANSWER` join it. Both of the latter carry an in-code comment
   saying they "will become user-tunable"; this is that spec.
2. **`getUserTuning` moved out of the action file.** The old plan put it in
   `src/actions/learner-tuning.ts` and had `src/lib/metrics/read.ts` import it. That is
   the exact dependency direction `read.ts:314-317` already refuses in a comment
   ("that file is a `'use server'` action module, the wrong dependency direction for a
   lib module to reach into"). Tuning now lives in `src/lib/tuning/`.
3. **`toStoredTags` gained a required `cardId`.** The old Task 6 fixtures passed
   `quizAnswer: { attemptId }` only. They will not compile. Corrected throughout.
4. **A partial band table is not a band table.** `resolveSeverity` does
   `input.bands ?? DEFAULT_BANDS` — a *replacement*, not a merge — so any type missing
   from a partial table silently resolves to `FALLBACK_BAND` `[1, 3]` instead of its
   default. Every `bands` argument crossing a module boundary in this plan is a
   **fully-resolved** table from `resolveBands`. The old plan's tests modelled the
   opposite and would have taught the pattern.
5. **Live vs superseded KLPs.** `toTopicRows` now splits `klpIds` (live) from
   `supersededKlpIds` (retired by a card edit). Targeting candidates are built from
   **live ids only** — a superseded proposition belongs to an older version of the card
   and must never be handed back as something to study.
6. **A DB-mocking precedent now exists.** The old plan asserted there was none and
   exempted the action bodies from tests on that basis. `tests/actions/quiz-summary-analysis.test.ts`
   establishes the `vi.hoisted()` + `vi.mock('@/lib/db')` pattern, so Task 7 tests the
   real action rather than only a pure shaper.
7. **Stale doc comment already fixed.** `src/lib/metrics/cache.ts` used to name "a Spec
   3B band edit" as a reason to replay the posterior. It was corrected on this branch
   (commit `00f0aef`) before this rewrite, because it contradicted the Global Constraint
   below and would have been read as an instruction.
8. **Lint baseline corrected** from "~171" to the measured 187.

### Known limit, accepted deliberately: Task 6 wires into a function nobody calls

`getLearnerMetrics` (`src/lib/metrics/read.ts:44`) has **zero production callers** — only
`tests/metrics/read-populations.test.ts`. This was checked on 2026-08-08; an earlier note
claiming the hardening pass gave it a caller was wrong.

So after this plan ships, the **observable** effects of a retune are:

- the settings panels persist and reload (Tasks 8-10),
- the quiz results screen re-scores history (Task 7).

The **ranked candidate list Task 6 produces is not rendered anywhere** until Spec 3C
builds the dashboard. Task 6 is still worth doing here — 3C should consume a tested,
tuning-aware read API rather than grow one — but do not describe targeting as
"shipped" on the strength of this plan. Related and still open, from Spec 3 §14: all
callers of `profileToPromptBlock` hardcode `topics: []` (`src/lib/ai/context.ts:155`,
`src/actions/training-plan.ts:34`), so topic-grain data reaches no prompt either, and
`capBlock` truncates the topic section first because the uncapped card section is
concatenated ahead of it. Both are 3C's to close, and closing the first without the
second silently drops the topic signal.

---

## Global Constraints

- Test runner is Vitest 4. **`cursor-agents/` in the project root breaks bare `vitest`/`tsc`** (BUILD-QUEUE trap 2), so the full suite is
  `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` (~13s, measured **1083 tests / 96 files** on 2026-08-12) and the type check is
  `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`. Single file: `npx vitest run <path>`.
- Tests import via the `@/` alias and live under `tests/<area>/`.
- Pure modules must not import `@/lib/db`. DB shells import it **dynamically** (`await import('@/lib/db')`), as `src/lib/memory/profile.ts:344` does.
- **A lib module must never import from `src/actions/*`.** Those are `'use server'` modules; the dependency runs the other way. This is why Task 4 splits the pure schema, the DB shell, and the actions into three files.
- **Bands and thresholds never feed BKT.** `stepBkt` reads `status` and `mode` only. Nothing in this plan may trigger a knowledge replay on a tuning save. An earlier draft of the spec said otherwise and was corrected in §3.3; `src/lib/metrics/cache.ts` used to repeat the error and was corrected in commit `00f0aef`. If you find yourself adding an `after()` call or a background job to a save path, stop — you are rebuilding the mistake.
- **Every `bands` value crossing a function boundary is a FULLY RESOLVED table** (all ~21 types present), produced by `resolveBands`. `resolveSeverity` replaces rather than merges, so a partial table silently downgrades every unlisted type to `FALLBACK_BAND` `[1, 3]`.
- Band values are integers in 1-5 with `floor <= ceiling`. Invalid input is **rejected, not clamped** — silently clamping lets a user believe they set something they did not.
- Overrides are **sparse**: only edited keys are stored, so untouched ones keep tracking future default changes.
- A corrupt stored blob falls back to defaults rather than throwing, matching `SESSION_INSIGHT_VERSION`'s precedent in `src/lib/memory/insight.ts:6`. A corrupt **save** is rejected with an error — a save is an explicit user act.
- Server actions live in `src/actions/*.ts` with `'use server'` and return `ActionResult<T>` from `@/types/action` (`{ success: true; data: T } | { success: false; error: string; detail?: ErrorDetail }`). A `'use server'` module may export **only async functions** — no constants, no sync helpers. This is why `ANALYSIS_VERSION` lives in `persist.ts` and `RESET_MEMORY_MODELS` in `reset.ts`.
- Migrations must be additive. Never accept a database reset; never pass `--force-reset` or `--accept-data-loss`. Return BLOCKED if a migration is anything else.
- Run the type check (`npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`) as well as the suite. Vitest does not type-check.
- `npm run lint` baseline before this plan: **185 problems (133 errors, 52 warnings)**, measured 2026-08-12. Compare against that; do not fix unrelated pre-existing ones. (187 on 2026-08-09 → 186 after the deletion work → 185 after item 2b.)
- **Sub-agents do not check lint unless told.** If this plan is executed in parallel, say so explicitly per task — a `Record<string, any>` added to satisfy `tsc` is three `no-explicit-any` errors, and it hides real fields from the type checker.
- Commit after every task. Do not skip hooks.

---

## File Structure

**Create:**
- `src/lib/tuning/schema.ts` — pure. Versions, Zod schemas, sparse parse + merge for both blobs, strategy vocabulary, `shapeTuning`. Depends on `@/lib/errors/bands`, `@/lib/errors/taxonomy`, `@/lib/metrics/bkt`, `@/lib/metrics/articulation` for defaults only. (Task 2)
- `src/lib/tuning/store.ts` — DB shell. `getUserTuning(userId)` returns a fully-resolved table + thresholds + strategy. Dynamic `@/lib/db` import. (Task 4)
- `src/actions/learner-tuning.ts` — `'use server'`. `loadTuning` / `saveTuning`. (Task 4)
- `src/lib/metrics/targeting.ts` — candidate types + four ranking functions + candidate assembler. (Task 5)
- `src/components/settings/SeverityBandPanel.tsx` (Task 8)
- `src/components/settings/TargetingStrategyPanel.tsx` (Task 9)
- `src/components/settings/MetricThresholdPanel.tsx` (Task 10)

**Modify:**
- `prisma/schema.prisma` — `LearnerTuning` model + `User` back-relation (Task 1)
- `src/lib/metrics/articulation.ts` — hand two constants to `tuning/schema.ts` and re-export them (Task 2); accept thresholds (Task 3)
- `src/lib/memory/topic-profile.ts` — accept and forward thresholds (Task 3)
- `src/lib/metrics/read.ts` — resolve the user's tuning; assemble, rank, return candidates (Task 6)
- `src/actions/quiz.ts` — derive tag scores in `getQuizAttemptSummary` (Task 7)
- `src/app/settings/ai/page.tsx` — mount the three panels (Tasks 8, 9, 10)

**Tests created:** `tests/tuning/schema.test.ts`, `tests/tuning/store.test.ts`, `tests/metrics/targeting.test.ts`.
**Tests extended:** `tests/metrics/articulation.test.ts`, `tests/memory/topic-profile.test.ts`, `tests/metrics/read-populations.test.ts`, `tests/actions/quiz-summary-analysis.test.ts`.

**Rationale for `src/lib/tuning/` as a new directory:** bands belong to `lib/errors`, thresholds to `lib/metrics`. A module holding both fits under neither, and filing it under one would make the other an upward import. The three-file split (pure / DB shell / action) is the same shape `profile.ts` + its callers already use.

---

### Task 1: LearnerTuning model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing
- Produces: `prisma.learnerTuning` with `userId` (PK), `strategy: String`, `bands: Json?`, `thresholds: Json?`, `version: Int`, `updatedAt`

- [ ] **Step 1: Add the model**

Add to `prisma/schema.prisma`:

```prisma
/// Stage 8 Spec 3B: per-user scoring and targeting preferences.
///
/// Two Json blobs rather than relational tables. Spec 2a argued the opposite
/// for AnswerKlpResult/AnswerErrorTag — "a JSON blob can't be indexed or FK'd,
/// and Spec 3 aggregates these hardest" — and that reasoning genuinely does not
/// transfer: tuning is never aggregated across users, joined, or filtered on.
/// It is read wholesale for exactly one user at the start of a computation.
/// The applicable precedent is SESSION_INSIGHT_VERSION (lib/memory/insight.ts):
/// a versioned blob readers parse with a schema and fall back on.
///
/// Both blobs are SPARSE — only edited keys are stored, so a user who retunes
/// one type does not freeze the other twenty against future default changes.
///
/// `strategy` is a column, not part of a blob, because it is a closed
/// vocabulary that ranking reads on every request and an invalid value must be
/// caught at parse time rather than ranked with.
model LearnerTuning {
  userId     String   @id
  strategy   String   @default("balanced")
  bands      Json?
  thresholds Json?
  version    Int      @default(1)
  updatedAt  DateTime @updatedAt
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Add the back-relation to `model User`, beside the existing `klpStates KlpState[]` line:

```prisma
  learnerTuning    LearnerTuning?
```

- [ ] **Step 2: Migrate**

**`prisma migrate dev` needs a TTY and has no non-interactive override** (BUILD-QUEUE trap 5), so it cannot be run from an agent shell. Generate the SQL and apply it:

```bash
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Write the output to `prisma/migrations/<timestamp>_add_learner_tuning/migration.sql`, then `npx prisma migrate deploy`, then **re-run the diff** — "This is an empty migration" means zero residual drift.

Expected SQL: one additive `CREATE TABLE "LearnerTuning"` plus its FK. If the diff contains a `DROP` of anything, STOP and return BLOCKED — never pass `--force-reset` or `--accept-data-loss`. Note `--from-schema-datasource` was removed in this Prisma version; the flag is `--from-config-datasource` (a `prisma.config.ts` exists).

- [ ] **Step 3: Verify the client**

Run: `npx prisma generate && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: clean; `prisma.learnerTuning` exists on the generated client.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(spec3b): add the LearnerTuning model"
```

---

### Task 2: Tuning schema — versions, sparse overrides, merge

**Files:**
- Create: `src/lib/tuning/schema.ts`
- Modify: `src/lib/metrics/articulation.ts` (move two constants out, re-export them back — see Step 3)
- Test: `tests/tuning/schema.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_BANDS`, `BandTable`, `SeverityBand` from `@/lib/errors/bands`; `ACCURACY_TYPES`, `CLARITY_TYPES`, `CONCISENESS_TYPES` from `@/lib/errors/taxonomy`; `MIN_OBSERVATIONS` from `@/lib/metrics/bkt`
- Produces:
  - `TUNING_VERSION = 1`
  - `BandOverridesSchema`, `type BandOverrides = Record<string, SeverityBand>`, `parseBandOverrides(raw: unknown): BandOverrides`, `resolveBands(overrides: BandOverrides): BandTable`
  - `interface MetricThresholds { minObservations: number; articulationMinPKnown: number; readinessWeightPerAnswer: number }`
  - `DEFAULT_THRESHOLDS: MetricThresholds`, `ThresholdOverridesSchema`, `type ThresholdOverrides = Partial<MetricThresholds>`, `parseThresholds(raw: unknown): ThresholdOverrides`, `resolveThresholds(overrides: ThresholdOverrides): MetricThresholds`
  - `STRATEGY_KEYS`, `type StrategyKey`, `parseStrategy(raw: unknown): StrategyKey`
  - `interface TuningRow { strategy: StrategyKey; bandOverrides: BandOverrides; thresholdOverrides: ThresholdOverrides }`, `shapeTuning(row: { strategy: string; bands: unknown; thresholds: unknown } | null): TuningRow`

- [ ] **Step 1: Write the failing test**

```ts
// tests/tuning/schema.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseBandOverrides, resolveBands,
  parseThresholds, resolveThresholds, DEFAULT_THRESHOLDS,
  parseStrategy, STRATEGY_KEYS, TUNING_VERSION, shapeTuning,
} from '@/lib/tuning/schema'
import { DEFAULT_BANDS } from '@/lib/errors/bands'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'
import { ARTICULATION_MIN_PKNOWN, READINESS_WEIGHT_PER_ANSWER } from '@/lib/metrics/articulation'

describe('parseBandOverrides', () => {
  it('accepts a sparse map of valid bands', () => {
    expect(parseBandOverrides({ inversion: [1, 4] })).toEqual({ inversion: [1, 4] })
  })

  it('returns an empty override map for null or undefined', () => {
    expect(parseBandOverrides(null)).toEqual({})
    expect(parseBandOverrides(undefined)).toEqual({})
  })

  it('falls back to no overrides on a corrupt blob rather than throwing', () => {
    expect(parseBandOverrides({ inversion: 'not a band' })).toEqual({})
    expect(parseBandOverrides('garbage')).toEqual({})
  })

  it('rejects an inverted band rather than clamping it', () => {
    expect(parseBandOverrides({ inversion: [4, 2] })).toEqual({})
  })

  it('rejects out-of-range values rather than clamping them', () => {
    expect(parseBandOverrides({ inversion: [0, 4] })).toEqual({})
    expect(parseBandOverrides({ inversion: [1, 6] })).toEqual({})
  })

  it('rejects non-integer values', () => {
    expect(parseBandOverrides({ inversion: [1.5, 4] })).toEqual({})
  })

  it('rejects a type outside the closed vocabularies', () => {
    expect(parseBandOverrides({ not_a_real_type: [1, 4] })).toEqual({})
  })
})

describe('resolveBands', () => {
  it('returns the defaults untouched with no overrides', () => {
    expect(resolveBands({})).toEqual(DEFAULT_BANDS)
  })

  it('overrides only the named type and leaves every other default intact', () => {
    const resolved = resolveBands({ inversion: [1, 2] })
    expect(resolved.inversion).toEqual([1, 2])
    expect(resolved.conflation).toEqual(DEFAULT_BANDS.conflation)
  })

  it('always returns a FULL table — a partial one silently downgrades every unlisted type', () => {
    // resolveSeverity does `bands ?? DEFAULT_BANDS`, a replacement not a merge,
    // so any type missing here resolves to FALLBACK_BAND [1,3] instead of its
    // default. This assertion is the guard against handing one out.
    expect(Object.keys(resolveBands({ inversion: [1, 2] })).sort())
      .toEqual(Object.keys(DEFAULT_BANDS).sort())
  })

  it('does not mutate DEFAULT_BANDS', () => {
    const before = DEFAULT_BANDS.inversion
    resolveBands({ inversion: [1, 2] })
    expect(DEFAULT_BANDS.inversion).toBe(before)
  })
})

describe('DEFAULT_THRESHOLDS', () => {
  it('is DERIVED from the shipped constants, never a second copy of the numbers', () => {
    // Same rule guessRate() follows against EVIDENCE_STRENGTH: writing 3 / 0.6 /
    // 12 here a second time is the persisted-value-in-two-places drift class.
    expect(DEFAULT_THRESHOLDS.minObservations).toBe(MIN_OBSERVATIONS)
    expect(DEFAULT_THRESHOLDS.articulationMinPKnown).toBe(ARTICULATION_MIN_PKNOWN)
    expect(DEFAULT_THRESHOLDS.readinessWeightPerAnswer).toBe(READINESS_WEIGHT_PER_ANSWER)
  })
})

describe('parseThresholds', () => {
  it('accepts a sparse map', () => {
    expect(parseThresholds({ minObservations: 1 })).toEqual({ minObservations: 1 })
  })

  it('returns an empty map for null or a corrupt blob', () => {
    expect(parseThresholds(null)).toEqual({})
    expect(parseThresholds({ minObservations: 'many' })).toEqual({})
    expect(parseThresholds('garbage')).toEqual({})
  })

  it('rejects minObservations below 1 — zero observations is not evidence', () => {
    expect(parseThresholds({ minObservations: 0 })).toEqual({})
    expect(parseThresholds({ minObservations: 2.5 })).toEqual({})
  })

  it('rejects an articulation pKnown outside 0-1', () => {
    expect(parseThresholds({ articulationMinPKnown: 1.5 })).toEqual({})
    expect(parseThresholds({ articulationMinPKnown: -0.1 })).toEqual({})
  })

  it('rejects a readiness weight of zero — readiness divides by it', () => {
    expect(parseThresholds({ readinessWeightPerAnswer: 0 })).toEqual({})
    expect(parseThresholds({ readinessWeightPerAnswer: -3 })).toEqual({})
  })

  it('rejects an unknown key', () => {
    expect(parseThresholds({ minObservations: 1, bogus: 4 })).toEqual({})
  })
})

describe('resolveThresholds', () => {
  it('fills every unset key from the defaults', () => {
    const resolved = resolveThresholds({ minObservations: 1 })
    expect(resolved.minObservations).toBe(1)
    expect(resolved.articulationMinPKnown).toBe(DEFAULT_THRESHOLDS.articulationMinPKnown)
    expect(resolved.readinessWeightPerAnswer).toBe(DEFAULT_THRESHOLDS.readinessWeightPerAnswer)
  })

  it('returns the defaults untouched with no overrides', () => {
    expect(resolveThresholds({})).toEqual(DEFAULT_THRESHOLDS)
  })
})

describe('parseStrategy', () => {
  it('accepts every documented key', () => {
    for (const key of STRATEGY_KEYS) expect(parseStrategy(key)).toBe(key)
  })

  it('falls back to balanced on an unknown or missing value', () => {
    expect(parseStrategy('nonsense')).toBe('balanced')
    expect(parseStrategy(null)).toBe('balanced')
  })

  it('pins the current tuning version', () => {
    expect(TUNING_VERSION).toBe(1)
  })
})

describe('shapeTuning', () => {
  it('returns balanced with no overrides when the user has no row', () => {
    expect(shapeTuning(null)).toEqual({
      strategy: 'balanced', bandOverrides: {}, thresholdOverrides: {},
    })
  })

  it('reads a stored strategy and both override blobs', () => {
    const shaped = shapeTuning({
      strategy: 'polish_near_ready',
      bands: { inversion: [1, 3] },
      thresholds: { minObservations: 1 },
    })
    expect(shaped.strategy).toBe('polish_near_ready')
    expect(shaped.bandOverrides).toEqual({ inversion: [1, 3] })
    expect(shaped.thresholdOverrides).toEqual({ minObservations: 1 })
  })

  it('falls back to balanced on an unrecognised stored strategy', () => {
    expect(shapeTuning({ strategy: 'retired_key', bands: null, thresholds: null }).strategy)
      .toBe('balanced')
  })

  it('drops one corrupt blob without touching the other', () => {
    const shaped = shapeTuning({
      strategy: 'follow_forgetting',
      bands: { inversion: [9, 9] },
      thresholds: { minObservations: 1 },
    })
    expect(shaped.strategy).toBe('follow_forgetting')
    expect(shaped.bandOverrides).toEqual({})
    expect(shaped.thresholdOverrides).toEqual({ minObservations: 1 })
  })

  it('keeps overrides sparse — it never returns the full default table', () => {
    const shaped = shapeTuning({ strategy: 'balanced', bands: { inversion: [1, 3] }, thresholds: null })
    expect(Object.keys(shaped.bandOverrides)).toEqual(['inversion'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tuning/schema.test.ts`
Expected: FAIL — cannot resolve `@/lib/tuning/schema`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/tuning/schema.ts
import { z } from 'zod'
import { DEFAULT_BANDS, type BandTable, type SeverityBand } from '@/lib/errors/bands'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'

/** Bump when either stored blob's shape changes incompatibly. */
export const TUNING_VERSION = 1

const KNOWN_TYPES = new Set<string>([
  ...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES,
])

/**
 * A band is two integers in 1-5 with floor <= ceiling. Violations are REJECTED,
 * never clamped: silently clamping lets a user believe they set something they
 * did not, and the panel would show their input while scoring used another.
 */
const BandSchema = z
  .tuple([z.number().int().min(1).max(5), z.number().int().min(1).max(5)])
  .refine(([floor, ceiling]) => floor <= ceiling, {
    message: 'floor must not exceed ceiling',
  })

export const BandOverridesSchema = z.record(
  z.string().refine((t) => KNOWN_TYPES.has(t), { message: 'unknown error type' }),
  BandSchema,
)

export type BandOverrides = Record<string, SeverityBand>

/**
 * Parse a STORED blob. A corrupt or partially invalid blob yields NO overrides
 * rather than throwing — a bad settings row must not make the app unusable,
 * matching how `SESSION_INSIGHT_VERSION` blobs are read. A corrupt SAVE is a
 * different case and is rejected loudly; see `saveTuning`.
 */
export function parseBandOverrides(raw: unknown): BandOverrides {
  if (raw === null || raw === undefined) return {}
  const parsed = BandOverridesSchema.safeParse(raw)
  return parsed.success ? (parsed.data as BandOverrides) : {}
}

/**
 * Merge sparse overrides over the shipped defaults.
 *
 * ALWAYS returns a full table. `resolveSeverity` does `bands ?? DEFAULT_BANDS`
 * — a replacement, not a merge — so handing it a partial table silently
 * downgrades every unlisted type to FALLBACK_BAND [1,3]. Every band value
 * crossing a module boundary in Spec 3B comes from here.
 *
 * Sparse on purpose at the STORAGE layer: a user who retunes one type keeps
 * tracking future default changes for every other type. Returns a fresh object
 * — never mutates DEFAULT_BANDS, which is module-level shared state.
 */
export function resolveBands(overrides: BandOverrides): BandTable {
  return { ...DEFAULT_BANDS, ...overrides }
}

/**
 * The numeric thresholds a learner may retune.
 *
 * These are not cosmetic. `minObservations` decides how much evidence counts as
 * "enough to have an opinion" — a judgement about the learner's situation (an
 * interview next week justifies acting on thinner evidence than one six months
 * out), not a universal constant. The other two carry in-code comments saying
 * they want tuning once real tag volume exists; this is that.
 */
export interface MetricThresholds {
  /** Below this many observations, no caller may call a KLP weak or strong. */
  minObservations: number
  /** pKnown at or above which a `too_terse` tag is an expression gap, not a knowledge gap. */
  articulationMinPKnown: number
  /** Average per-answer expression weight at which readiness reaches 0. */
  readinessWeightPerAnswer: number
}

/**
 * A `too_terse` tag only counts as an ARTICULATION problem at or above this
 * pKnown. Below it, brevity is far more likely to mean the learner does not
 * know the material — and booking that as an expression gap would route them
 * to short-answer drilling when they need the concept, misdiagnosing exactly
 * the case this metric exists to separate.
 *
 * Defined HERE rather than in `articulation.ts` (which re-exports it) only to
 * break an import cycle: `articulation.ts` must import `MetricThresholds` from
 * this module, so this module cannot import its constants back.
 */
export const ARTICULATION_MIN_PKNOWN = 0.6

/**
 * Average per-answer expression-error weight at which readiness reaches 0.
 * Roughly two significant expression tags on every answer. Same cycle-breaking
 * note as above.
 */
export const READINESS_WEIGHT_PER_ANSWER = 12

/**
 * DERIVED from the shipped constants, never a second copy of the numbers —
 * the same rule `guessRate` follows against `EVIDENCE_STRENGTH`. A test pins
 * the equality so a change to either side is a build failure rather than a
 * silent divergence between "the default" and "the constant".
 */
export const DEFAULT_THRESHOLDS: MetricThresholds = {
  minObservations: MIN_OBSERVATIONS,
  articulationMinPKnown: ARTICULATION_MIN_PKNOWN,
  readinessWeightPerAnswer: READINESS_WEIGHT_PER_ANSWER,
}

/**
 * Bounds are correctness, not taste:
 * - `minObservations` below 1 would let a KLP with zero evidence report a
 *   posterior indistinguishable from a measured one.
 * - `readinessWeightPerAnswer` is a DIVISOR in `computeArticulation`; zero or
 *   negative produces Infinity or an inverted metric.
 * `.strict()` rejects unknown keys so a typo is an error rather than a
 * silently-ignored setting the panel still displays.
 */
export const ThresholdOverridesSchema = z
  .object({
    minObservations: z.number().int().min(1).max(50).optional(),
    articulationMinPKnown: z.number().min(0).max(1).optional(),
    readinessWeightPerAnswer: z.number().positive().max(100).optional(),
  })
  .strict()

export type ThresholdOverrides = z.infer<typeof ThresholdOverridesSchema>

/** Parse a STORED blob; corrupt yields no overrides rather than throwing. */
export function parseThresholds(raw: unknown): ThresholdOverrides {
  if (raw === null || raw === undefined) return {}
  const parsed = ThresholdOverridesSchema.safeParse(raw)
  if (!parsed.success) return {}
  // Strip explicit undefineds so `{}` deep-equals `{}` and callers can count keys.
  return Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  ) as ThresholdOverrides
}

/** Fill every unset key from the defaults. Always returns a complete set. */
export function resolveThresholds(overrides: ThresholdOverrides): MetricThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides }
}

export const STRATEGY_KEYS = [
  'shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced',
] as const
export type StrategyKey = (typeof STRATEGY_KEYS)[number]

/**
 * `balanced` is the default because a learner who has never opened settings
 * must not be silently enrolled in an aggressive strategy.
 */
export function parseStrategy(raw: unknown): StrategyKey {
  return STRATEGY_KEYS.includes(raw as StrategyKey) ? (raw as StrategyKey) : 'balanced'
}

export interface TuningRow {
  strategy: StrategyKey
  bandOverrides: BandOverrides
  thresholdOverrides: ThresholdOverrides
}

/**
 * Pure: every decision the load/save actions make happens here so it is tested
 * without a database. Each field degrades INDEPENDENTLY — one corrupt blob must
 * not discard a perfectly good strategy or the other blob.
 */
export function shapeTuning(
  row: { strategy: string; bands: unknown; thresholds: unknown } | null,
): TuningRow {
  if (!row) return { strategy: 'balanced', bandOverrides: {}, thresholdOverrides: {} }
  return {
    strategy: parseStrategy(row.strategy),
    bandOverrides: parseBandOverrides(row.bands),
    thresholdOverrides: parseThresholds(row.thresholds),
  }
}
```

- [ ] **Step 4: Point `articulation.ts` at the moved constants**

`ARTICULATION_MIN_PKNOWN` and `READINESS_WEIGHT_PER_ANSWER` now live in
`schema.ts`. In `src/lib/metrics/articulation.ts`, **delete both `const`
declarations** (their doc comments moved with them, verbatim) and replace them with
a re-export so every existing importer keeps working unchanged:

```ts
// Defined in the tuning module so `DEFAULT_THRESHOLDS` can derive from them
// without an import cycle — Task 3 makes this file import `MetricThresholds`
// from there. Re-exported so existing importers need no change.
export { ARTICULATION_MIN_PKNOWN, READINESS_WEIGHT_PER_ANSWER } from '@/lib/tuning/schema'
```

Do this in **this** task, not Task 3: it is this module's own dependency problem,
and leaving it until Task 3 means Task 2 ships an import that Task 3 must delete.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/tuning/schema.test.ts tests/metrics/articulation.test.ts && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: all PASS — the re-export keeps `articulation.ts`'s existing behaviour and its
existing test file byte-identical.

If Zod 4's `z.record` rejects a `.refine`d key schema at the type level, replace `BandOverridesSchema` with:

```ts
export const BandOverridesSchema = z
  .record(z.string(), BandSchema)
  .refine((rec) => Object.keys(rec).every((k) => KNOWN_TYPES.has(k)), {
    message: 'unknown error type',
  })
```

The unknown-key test above pins the behaviour either way; do not change the test to accommodate the implementation.

- [ ] **Step 6: Mutation check**

Introduce each mutation, run the test file, confirm at least one test FAILS, then revert:
- (a) `parseBandOverrides` clamps out-of-range values instead of rejecting the blob
- (b) `resolveBands` spreads overrides first and defaults second (defaults win)
- (c) the `floor <= ceiling` refinement is dropped
- (d) `parseStrategy` returns the raw value instead of falling back
- (e) `resolveBands` mutates and returns `DEFAULT_BANDS`
- (f) `DEFAULT_THRESHOLDS.minObservations` is hardcoded to `3` instead of referencing `MIN_OBSERVATIONS`, and `MIN_OBSERVATIONS` is then changed to `4`
- (g) `ThresholdOverridesSchema` allows `readinessWeightPerAnswer: 0`

Report all seven. If any survives, add an assertion that kills it and re-verify.

- [ ] **Step 7: Commit**

```bash
git add src/lib/tuning/schema.ts src/lib/metrics/articulation.ts tests/tuning/schema.test.ts
git commit -m "feat(spec3b): add versioned band and threshold overrides with sparse merge"
```

---

### Task 3: Thread thresholds through the pure metric functions

Spec §4's observation floor and §1's "ranking and weighting decisions belong to the
learner". This task makes the three thresholds *parameters* rather than imports. It comes
before targeting so targeting consumes the same `MetricThresholds` type.

**Why the parameter is optional here, when `analyzedAnswersByTopic` was made required:**
that field had **no defensible default** — deriving it from tags was actively wrong, so
forcing the caller to decide was the point. Thresholds do have one: the shipped
constants, which reproduce today's behaviour exactly. An optional parameter with a
correct default is the right call. The risk it carries — a call site silently keeping
the defaults — is killed by Task 6's Step 4 assertion that `getLearnerMetrics` actually
threads the user's value down, not by making 31 existing test call sites pass a constant.

**Files:**
- Modify: `src/lib/metrics/articulation.ts`
- Modify: `src/lib/memory/topic-profile.ts`
- Test: `tests/metrics/articulation.test.ts` (extend)
- Test: `tests/memory/topic-profile.test.ts` (extend)

**Interfaces:**
- Consumes: `MetricThresholds`, `DEFAULT_THRESHOLDS` from `@/lib/tuning/schema` (Task 2)
- Produces: `ArticulationInput.thresholds?: MetricThresholds`; `ShapeTopicProfileInput.thresholds?: MetricThresholds`

- [ ] **Step 1: Write the failing tests**

Append to `tests/metrics/articulation.test.ts` (add
`import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'` at the top):

```ts
describe('tunable thresholds (Spec 3B)', () => {
  const terseTag = {
    attemptId: 'att1', cardId: 'c1', dimension: 'conciseness' as const,
    type: 'too_terse', klpId: 'k1', relevance: 3, starred: false,
    magnitude: 5, storedSeverity: 3, storedSignificance: 5,
    mode: 'quiz-sa' as const, createdAt: new Date('2026-08-06T00:00:00Z'),
    severity: 3, repeatBonus: 0, significance: 5, isLegacy: false,
  }

  it('books terseness as a knowledge gap when the KLP is below the observation floor', () => {
    const out = computeArticulation({
      tags: [terseTag],
      knowledge: { k1: { pKnown: 0.9, observations: 2 } },
      analyzedAnswers: 1,
    })
    expect(out.knowledgeGapTerseness).toBe(1)
    expect(out.verbosityIndex).toBe(0)
  })

  it('LOWERING minObservations makes that same tag count as an expression gap', () => {
    // The whole point of the knob: at the shipped floor of 3 this learner's
    // single observation is invisible; at 1 it is provisional evidence.
    const out = computeArticulation({
      tags: [terseTag],
      knowledge: { k1: { pKnown: 0.9, observations: 2 } },
      analyzedAnswers: 1,
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledgeGapTerseness).toBe(0)
    expect(out.verbosityIndex).toBe(-5)
  })

  it('RAISING articulationMinPKnown reclassifies an expression gap as a knowledge gap', () => {
    const base = { tags: [terseTag], knowledge: { k1: { pKnown: 0.7, observations: 5 } }, analyzedAnswers: 1 }
    expect(computeArticulation(base).verbosityIndex).toBe(-5)
    expect(
      computeArticulation({ ...base, thresholds: { ...DEFAULT_THRESHOLDS, articulationMinPKnown: 0.8 } })
        .knowledgeGapTerseness,
    ).toBe(1)
  })

  it('LOWERING readinessWeightPerAnswer makes the same errors read as less ready', () => {
    const base = {
      tags: [{ ...terseTag, dimension: 'clarity' as const, type: 'no_thesis', klpId: null }],
      knowledge: {},
      analyzedAnswers: 1,
    }
    const shipped = computeArticulation(base).readiness!
    const strict = computeArticulation({
      ...base, thresholds: { ...DEFAULT_THRESHOLDS, readinessWeightPerAnswer: 6 },
    }).readiness!
    expect(strict).toBeLessThan(shipped)
  })

  it('omitting thresholds reproduces the shipped constants exactly', () => {
    const base = { tags: [terseTag], knowledge: { k1: { pKnown: 0.9, observations: 5 } }, analyzedAnswers: 2 }
    expect(computeArticulation(base)).toEqual(
      computeArticulation({ ...base, thresholds: DEFAULT_THRESHOLDS }),
    )
  })
})
```

Append to `tests/memory/topic-profile.test.ts` (add the same import):

```ts
describe('tunable observation floor (Spec 3B)', () => {
  const topic = {
    normalizedName: 'valuation', displayName: 'Valuation', color: null,
    klpIds: ['k1'], supersededKlpIds: [], cardIds: ['c1'],
  }

  it('reports null knowledge for a KLP below the shipped floor', () => {
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.8, observations: 1 } },
      tags: [],
      analyzedAnswersByTopic: {},
    })
    expect(out.knowledge).toBeNull()
  })

  it('reports that knowledge once the learner lowers the floor', () => {
    // This is the live-database case: 19 answers, every KLP seen exactly once,
    // so at the shipped floor of 3 zero topics report any knowledge at all.
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.8, observations: 1 } },
      tags: [],
      analyzedAnswersByTopic: {},
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledge).toBeCloseTo(0.8)
  })

  it('forwards thresholds down to computeArticulation, not just its own filter', () => {
    // A partial thread — honouring the floor for knowledge but not for
    // articulation — is the failure this asserts against.
    const [out] = shapeTopicProfile({
      topics: [topic],
      knowledge: { k1: { pKnown: 0.9, observations: 1 } },
      tags: [{
        attemptId: 'att1', cardId: 'c1', dimension: 'conciseness', type: 'too_terse',
        klpId: 'k1', relevance: 3, starred: false, magnitude: 5, storedSeverity: 3,
        storedSignificance: 5, mode: 'quiz-sa', createdAt: new Date('2026-08-06T00:00:00Z'),
        severity: 3, repeatBonus: 0, significance: 5, isLegacy: false,
      }],
      analyzedAnswersByTopic: { valuation: 1 },
      thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
    })
    expect(out.knowledgeGapTerseness).toBe(0)
    expect(out.verbosityIndex).toBe(-5)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/metrics/articulation.test.ts tests/memory/topic-profile.test.ts`
Expected: FAIL — `thresholds` is not a known property, and the lowered-floor cases still report the shipped behaviour.

- [ ] **Step 3: Accept thresholds in `computeArticulation`**

In `src/lib/metrics/articulation.ts`, replace the `MIN_OBSERVATIONS` import with the
tuning types and make the three constants defaults rather than the only values.
Keep exporting `ARTICULATION_MIN_PKNOWN` and `READINESS_WEIGHT_PER_ANSWER` — Task 2
derives `DEFAULT_THRESHOLDS` from them, and the panel shows them as "the shipped
default".

```ts
import type { DerivedTag } from '@/lib/errors/derive'
import { DEFAULT_THRESHOLDS, type MetricThresholds } from '@/lib/tuning/schema'
```

Add to `ArticulationInput`:

```ts
  /**
   * The learner's tuned thresholds. Optional, defaulting to the shipped
   * constants, so every existing caller is unchanged — but a caller that HAS a
   * user must pass theirs, or the knob is inert for that surface.
   */
  thresholds?: MetricThresholds
```

Inside `computeArticulation`, first line of the body:

```ts
  const { minObservations, articulationMinPKnown, readinessWeightPerAnswer } =
    input.thresholds ?? DEFAULT_THRESHOLDS
```

Then replace the two literal reads:

```ts
      const counts =
        k !== undefined && k.observations >= minObservations && k.pKnown >= articulationMinPKnown
```

```ts
    const weightPerAnswer = expressionWeight / input.analyzedAnswers
    readiness = Math.max(0, 1 - weightPerAnswer / readinessWeightPerAnswer)
```

Delete the now-unused `MIN_OBSERVATIONS` import from this file.

**Do not re-add local `const` declarations for `ARTICULATION_MIN_PKNOWN` or
`READINESS_WEIGHT_PER_ANSWER`.** Task 2 Step 4 moved their definitions into
`tuning/schema.ts` and left a re-export here, precisely so `articulation.ts` can import
`MetricThresholds` from that module without a cycle. Re-declaring them locally
reintroduces the cycle and gives `DEFAULT_THRESHOLDS` a second copy of the numbers to
drift from. `MIN_OBSERVATIONS` stays in `bkt.ts` — `bkt.ts` depends on nothing in
tuning, so there is no cycle to break there.

- [ ] **Step 4: Accept and forward thresholds in `shapeTopicProfile`**

In `src/lib/memory/topic-profile.ts`, add to `ShapeTopicProfileInput`:

```ts
  /**
   * The learner's tuned thresholds, forwarded to `computeArticulation` AND
   * applied to the knowledge filter below. Both, or the floor means one thing
   * for topic knowledge and another for terseness classification.
   */
  thresholds?: MetricThresholds
```

Inside `shapeTopicProfile`, before the `for` loop:

```ts
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS
```

Replace the knowledge filter:

```ts
    const scored = klpIds
      .map((id) => input.knowledge[id])
      .filter((k): k is KnowledgeRef => k !== undefined && k.observations >= thresholds.minObservations)
```

And pass them down:

```ts
    const articulation = computeArticulation({
      tags: input.tags.filter((t) =>
        t.klpId !== null
          ? attributableKlpSet.has(t.klpId)
          : t.cardId !== null && cardSet.has(t.cardId),
      ),
      knowledge: input.knowledge,
      analyzedAnswers: input.analyzedAnswersByTopic[key] ?? 0,
      thresholds,
    })
```

Update the `MIN_OBSERVATIONS` import to `import { DEFAULT_THRESHOLDS, type MetricThresholds } from '@/lib/tuning/schema'`, and update the `LearnerTopicProfile.knowledge` doc comment from "Mean pKnown across KLPs clearing MIN_OBSERVATIONS" to "…clearing the learner's observation floor (`MetricThresholds.minObservations`)".

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/metrics tests/memory && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: all PASS, including the ~31 pre-existing call sites that pass no `thresholds` — they must be byte-identical in behaviour.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/articulation.ts src/lib/memory/topic-profile.ts src/lib/tuning/schema.ts tests/metrics/articulation.test.ts tests/memory/topic-profile.test.ts
git commit -m "feat(spec3b): make the observation floor and articulation thresholds parameters"
```

---

### Task 4: Tuning persistence

**Files:**
- Create: `src/lib/tuning/store.ts`
- Create: `src/actions/learner-tuning.ts`
- Test: `tests/tuning/store.test.ts`

**Interfaces:**
- Consumes: Task 2's `shapeTuning`, `resolveBands`, `resolveThresholds`, `parseStrategy`, `BandOverridesSchema`, `ThresholdOverridesSchema`, `TUNING_VERSION`, `TuningRow`; `BandTable` from `@/lib/errors/bands`; `MetricThresholds`, `StrategyKey`; `ActionResult` from `@/types/action`
- Produces:
  - `interface ResolvedTuning { bands: BandTable; thresholds: MetricThresholds; strategy: StrategyKey }`
  - `getUserTuning(userId: string): Promise<ResolvedTuning>` (`src/lib/tuning/store.ts`)
  - `loadTuning(): Promise<ActionResult<TuningRow>>`, `saveTuning(input: { strategy?: string; bandOverrides?: unknown; thresholdOverrides?: unknown }): Promise<ActionResult<TuningRow>>` — **every field optional; absent means leave unchanged** (spec §5) (`src/actions/learner-tuning.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// tests/tuning/store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { DEFAULT_BANDS } from '@/lib/errors/bands'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

// Follows the vi.hoisted() + vi.mock('@/lib/db') pattern established by
// tests/actions/quiz-summary-analysis.test.ts.
const h = vi.hoisted(() => ({ findUnique: vi.fn() }))
vi.mock('@/lib/db', () => ({ prisma: { learnerTuning: { findUnique: h.findUnique } } }))

import { getUserTuning } from '@/lib/tuning/store'

beforeEach(() => vi.clearAllMocks())

describe('getUserTuning', () => {
  it('returns fully-resolved defaults for a user with no row', async () => {
    h.findUnique.mockResolvedValue(null)
    const out = await getUserTuning('u1')
    expect(out.strategy).toBe('balanced')
    expect(out.bands).toEqual(DEFAULT_BANDS)
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS)
  })

  it('merges a sparse override into a COMPLETE band table', async () => {
    h.findUnique.mockResolvedValue({
      strategy: 'polish_near_ready', bands: { inversion: [1, 2] }, thresholds: { minObservations: 1 },
    })
    const out = await getUserTuning('u1')
    expect(out.bands.inversion).toEqual([1, 2])
    expect(out.bands.conflation).toEqual(DEFAULT_BANDS.conflation)
    // The guarantee callers depend on: never a partial table, because
    // resolveSeverity replaces rather than merges.
    expect(Object.keys(out.bands).sort()).toEqual(Object.keys(DEFAULT_BANDS).sort())
    expect(out.thresholds.minObservations).toBe(1)
    expect(out.thresholds.readinessWeightPerAnswer).toBe(DEFAULT_THRESHOLDS.readinessWeightPerAnswer)
    expect(out.strategy).toBe('polish_near_ready')
  })

  it('scopes the read to the requested user', async () => {
    h.findUnique.mockResolvedValue(null)
    await getUserTuning('u7')
    expect(h.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u7' } }),
    )
  })

  it('falls back to full defaults on a corrupt stored blob rather than throwing', async () => {
    h.findUnique.mockResolvedValue({ strategy: 'balanced', bands: 'garbage', thresholds: 'garbage' })
    const out = await getUserTuning('u1')
    expect(out.bands).toEqual(DEFAULT_BANDS)
    expect(out.thresholds).toEqual(DEFAULT_THRESHOLDS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tuning/store.test.ts`
Expected: FAIL — cannot resolve `@/lib/tuning/store`.

- [ ] **Step 3: Write the store**

```ts
// src/lib/tuning/store.ts
import type { BandTable } from '@/lib/errors/bands'
import {
  resolveBands, resolveThresholds, shapeTuning,
  type MetricThresholds, type StrategyKey,
} from '@/lib/tuning/schema'

export interface ResolvedTuning {
  /** ALWAYS a complete table — see `resolveBands`. */
  bands: BandTable
  thresholds: MetricThresholds
  strategy: StrategyKey
}

/**
 * Server-side reader for the metric paths.
 *
 * Lives in `lib/`, NOT in `src/actions/learner-tuning.ts`, because
 * `src/lib/metrics/read.ts` consumes it and a lib module must not import a
 * `'use server'` action module — the same rule `read.ts`'s own
 * `resolveCategoryIds` comment states about `src/actions/memory.ts`.
 *
 * Returns FULLY RESOLVED values so callers never merge defaults themselves:
 * two call sites merging independently is how they drift, and a half-merged
 * band table silently downgrades every unlisted type to FALLBACK_BAND.
 *
 * `prisma` is imported dynamically so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function getUserTuning(userId: string): Promise<ResolvedTuning> {
  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId },
    select: { strategy: true, bands: true, thresholds: true },
  })
  const shaped = shapeTuning(row)
  return {
    bands: resolveBands(shaped.bandOverrides),
    thresholds: resolveThresholds(shaped.thresholdOverrides),
    strategy: shaped.strategy,
  }
}
```

- [ ] **Step 4: Write the actions**

```ts
// src/actions/learner-tuning.ts
'use server'

import { auth } from '@/auth'
import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/types/action'
import {
  BandOverridesSchema, ThresholdOverridesSchema, parseStrategy, shapeTuning,
  TUNING_VERSION, type BandOverrides, type ThresholdOverrides, type TuningRow,
} from '@/lib/tuning/schema'

export async function loadTuning(): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }

  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId: session.user.id },
    select: { strategy: true, bands: true, thresholds: true },
  })
  return { success: true, data: shapeTuning(row) }
}

/**
 * PARTIAL by design (spec §5). An ABSENT field means "leave unchanged"; a
 * present one is written. Three panels edit this one row, and a
 * write-all-three action forces each panel to echo back values it read at
 * mount — so the ordinary sequence "change a threshold, change a band, save
 * both" reverts one of them. That bug is invisible to a single-panel test.
 *
 * `bandOverrides: {}` is NOT the same as absent: it is the global reset, and
 * it must stay expressible.
 */
export async function saveTuning(input: {
  strategy?: string
  bandOverrides?: unknown
  thresholdOverrides?: unknown
}): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }
  const userId = session.user.id

  // Reject rather than salvage: a save is an explicit user act, so invalid
  // input must surface as an error instead of being silently discarded the way
  // a corrupt STORED blob is.
  const data: {
    strategy?: string
    bands?: BandOverrides
    thresholds?: ThresholdOverrides
    version: number
  } = { version: TUNING_VERSION }

  if (input.bandOverrides !== undefined) {
    const bands = BandOverridesSchema.safeParse(input.bandOverrides)
    if (!bands.success) {
      return {
        success: false,
        error: 'Each band must be two whole numbers from 1 to 5, with the first no larger than the second.',
      }
    }
    data.bands = bands.data as BandOverrides
  }
  if (input.thresholdOverrides !== undefined) {
    const thresholds = ThresholdOverridesSchema.safeParse(input.thresholdOverrides)
    if (!thresholds.success) {
      return {
        success: false,
        error: 'Thresholds must be within range: evidence floor 1-50, articulation confidence 0-1, readiness weight above 0.',
      }
    }
    data.thresholds = thresholds.data as ThresholdOverrides
  }
  if (input.strategy !== undefined) data.strategy = parseStrategy(input.strategy)

  const { prisma } = await import('@/lib/db')
  // `create` needs the full row; `update` writes only the named fields, which
  // is what makes an absent field a no-op rather than a null.
  const row = await prisma.learnerTuning.upsert({
    where: { userId },
    create: {
      userId,
      strategy: data.strategy ?? 'balanced',
      bands: data.bands ?? {},
      thresholds: data.thresholds ?? {},
      version: TUNING_VERSION,
    },
    update: data,
    select: { strategy: true, bands: true, thresholds: true },
  })

  revalidatePath('/settings/ai')
  // Returned from the ROW, not from the input, so the caller sees what the
  // other panels' fields actually hold rather than the blanks it sent.
  return { success: true, data: shapeTuning(row) }
}
```

**Add to `tests/tuning/store.test.ts`** (mock `learnerTuning.upsert` alongside
`findUnique`) — this is the regression the partial shape exists to prevent:

- saving only `strategy` sends **no** `bands` key in the `update` payload;
- saving `bandOverrides: {}` **does** send `bands: {}` (the global reset survives);
- an invalid band is rejected and **nothing is written** (`upsert` not called).

Mutation-check it: make `saveTuning` always write all three fields and confirm the
first assertion reddens. Without that run, the guard is decoration.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/tuning && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: both PASS. If `'use server'` rejects any non-async export from
`src/actions/learner-tuning.ts`, the offending symbol belongs in `src/lib/tuning/schema.ts`
— that module already holds every constant and sync helper for exactly this reason.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tuning/store.ts src/actions/learner-tuning.ts tests/tuning/store.test.ts
git commit -m "feat(spec3b): persist per-user tuning with validated overrides"
```

---

### Task 5: Targeting strategies

**Files:**
- Create: `src/lib/metrics/targeting.ts`
- Test: `tests/metrics/targeting.test.ts`

**Interfaces:**
- Consumes: `BKT_PRIOR` from `@/lib/metrics/bkt`; `StrategyKey`, `MetricThresholds`, `DEFAULT_THRESHOLDS` from `@/lib/tuning/schema`
- Produces: `interface RankCandidate`, `interface RankedCandidate`, `interface CandidateSource`, `OVERDUE_SATURATION_DAYS = 7`, `DEFAULT_WEIGHT = 3`, `rankCandidates(candidates, strategy, opts?): RankedCandidate[]`, `toRankCandidates(source: CandidateSource): RankCandidate[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/targeting.test.ts
import { describe, it, expect } from 'vitest'
import { rankCandidates, toRankCandidates } from '@/lib/metrics/targeting'
import type { RankCandidate } from '@/lib/metrics/targeting'
import { DEFAULT_THRESHOLDS } from '@/lib/tuning/schema'

const NOW = new Date('2026-08-06T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)
const FLOOR = DEFAULT_THRESHOLDS.minObservations

const cand = (o: Partial<RankCandidate> & { klpId: string }): RankCandidate => ({
  topicKey: 'valuation',
  weight: 3,
  pKnown: 0.5,
  observations: 5,
  readiness: 0.5,
  dueAt: null,
  ...o,
})

const idsInOrder = (ranked: { klpId: string }[]) => ranked.map((r) => r.klpId)
const ALL_STRATEGIES = [
  'shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced',
] as const

describe('shore_up_weaknesses', () => {
  it('puts the least-known proposition first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'strong', pKnown: 0.9 }), cand({ klpId: 'weak', pKnown: 0.1 })],
      'shore_up_weaknesses', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('weak')
  })

  it('breaks ties toward the more central proposition', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'minor', pKnown: 0.2, weight: 1 }), cand({ klpId: 'central', pKnown: 0.2, weight: 5 })],
      'shore_up_weaknesses', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('central')
  })
})

describe('polish_near_ready', () => {
  it('puts known-but-poorly-expressed first, ahead of an unknown one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'unknown', pKnown: 0.1, readiness: 0.1 }),
        cand({ klpId: 'knows-cant-say', pKnown: 0.9, readiness: 0.1 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('knows-cant-say')
  })

  it('ranks a known and well-expressed proposition below a known and poorly-expressed one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'done', pKnown: 0.9, readiness: 1 }),
        cand({ klpId: 'rough', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('rough')
  })

  it('treats unknown readiness as no articulation problem, not a severe one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'unmeasured', pKnown: 0.9, readiness: null }),
        cand({ klpId: 'measured-bad', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('measured-bad')
  })
})

describe('follow_forgetting', () => {
  it('puts the most overdue first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'fresh', dueAt: daysAgo(0) }), cand({ klpId: 'stale', dueAt: daysAgo(10) })],
      'follow_forgetting', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('stale')
  })

  it('ranks a not-yet-due proposition below any overdue one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'future', dueAt: new Date(NOW.getTime() + 86_400_000) }),
        cand({ klpId: 'overdue', dueAt: daysAgo(1) }),
      ],
      'follow_forgetting', { now: NOW },
    )
    expect(idsInOrder(ranked)[0]).toBe('overdue')
  })
})

describe('the observation floor applies under every strategy', () => {
  it('ranks a sub-threshold candidate last even when its metrics look ideal', () => {
    for (const strategy of ALL_STRATEGIES) {
      const ranked = rankCandidates(
        [
          cand({ klpId: 'thin', pKnown: 0.01, observations: FLOOR - 1, weight: 5, dueAt: daysAgo(30), readiness: 0 }),
          cand({ klpId: 'measured', pKnown: 0.5, observations: FLOOR }),
        ],
        strategy, { now: NOW },
      )
      expect(idsInOrder(ranked)[1], strategy).toBe('thin')
    }
  })

  it('marks sub-threshold candidates so a caller can label them', () => {
    const [only] = rankCandidates([cand({ klpId: 'thin', observations: 1 })], 'balanced', { now: NOW })
    expect(only.sufficient).toBe(false)
  })

  it('honours a LOWERED floor from the learner, promoting a candidate the default demotes', () => {
    // Spec 3B's reason for exposing the knob: at the shipped floor of 3, a
    // corpus where every KLP has been seen once ranks everything as
    // insufficient, so the order carries no information at all.
    const input = [
      cand({ klpId: 'thin-and-weak', pKnown: 0.05, observations: 1 }),
      cand({ klpId: 'measured-and-fine', pKnown: 0.9, observations: FLOOR }),
    ]
    expect(idsInOrder(rankCandidates(input, 'shore_up_weaknesses', { now: NOW }))[0])
      .toBe('measured-and-fine')
    expect(
      idsInOrder(rankCandidates(input, 'shore_up_weaknesses', {
        now: NOW, thresholds: { ...DEFAULT_THRESHOLDS, minObservations: 1 },
      }))[0],
    ).toBe('thin-and-weak')
  })
})

describe('shared contract', () => {
  it('returns every candidate under every strategy, never dropping any', () => {
    const input = [cand({ klpId: 'a' }), cand({ klpId: 'b' }), cand({ klpId: 'c' })]
    for (const strategy of ALL_STRATEGIES) {
      expect(rankCandidates(input, strategy, { now: NOW }), strategy).toHaveLength(3)
    }
  })

  it('is a pure function — it does not reorder the caller\'s array', () => {
    const input = [cand({ klpId: 'a', pKnown: 0.9 }), cand({ klpId: 'b', pKnown: 0.1 })]
    rankCandidates(input, 'shore_up_weaknesses', { now: NOW })
    expect(idsInOrder(input)).toEqual(['a', 'b'])
  })

  it('balanced differs from at least one single-axis strategy on the same input', () => {
    const input = [
      cand({ klpId: 'x', pKnown: 0.9, readiness: 0.1, dueAt: daysAgo(20) }),
      cand({ klpId: 'y', pKnown: 0.1, readiness: 1, dueAt: null }),
    ]
    expect(idsInOrder(rankCandidates(input, 'balanced', { now: NOW })))
      .not.toEqual(idsInOrder(rankCandidates(input, 'shore_up_weaknesses', { now: NOW })))
  })
})

describe('toRankCandidates', () => {
  const base = {
    topics: [
      { key: 'valuation', klpIds: ['k1', 'k2'], readiness: 0.4 },
      { key: 'accounting', klpIds: ['k3'], readiness: null },
    ],
    klpWeights: { k1: 5, k2: 2, k3: 4 },
    knowledge: {
      k1: { pKnown: 0.8, observations: 6 },
      k2: { pKnown: 0.3, observations: 4 },
    },
    klpCardIds: { k1: 'cardA', k2: 'cardA', k3: 'cardB' },
    dueByCard: { cardA: new Date('2026-08-01T00:00:00Z') },
  }

  it('emits one candidate per KLP, carrying its topic\'s readiness', () => {
    const out = toRankCandidates(base)
    expect(out).toHaveLength(3)
    expect(out.find((c) => c.klpId === 'k1')!.readiness).toBe(0.4)
    expect(out.find((c) => c.klpId === 'k3')!.readiness).toBeNull()
  })

  it('defaults an unmeasured KLP to the prior with zero observations, not to omission', () => {
    // k3 has no knowledge entry. It must still appear — the observation floor
    // ranks it last, but dropping it would hide the KLP entirely.
    expect(toRankCandidates(base).find((c) => c.klpId === 'k3')!.observations).toBe(0)
  })

  it('resolves due date through the KLP\'s card', () => {
    const out = toRankCandidates(base)
    expect(out.find((c) => c.klpId === 'k1')!.dueAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(out.find((c) => c.klpId === 'k3')!.dueAt).toBeNull()
  })

  it('does not emit a KLP twice when two topics share it', () => {
    const out = toRankCandidates({
      ...base,
      topics: [
        { key: 'valuation', klpIds: ['k1'], readiness: 0.4 },
        { key: 'dcf', klpIds: ['k1'], readiness: 0.9 },
      ],
    })
    expect(out.filter((c) => c.klpId === 'k1')).toHaveLength(1)
  })

  it('gives a KLP with no stored weight the neutral centrality, not zero', () => {
    // Weight 0 would zero out shore_up_weaknesses' score and bury a
    // legitimately weak proposition behind every scored one.
    const out = toRankCandidates({ ...base, klpWeights: {} })
    expect(out.every((c) => c.weight === 3)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/targeting.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/targeting`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/targeting.ts
import { BKT_PRIOR } from '@/lib/metrics/bkt'
import { DEFAULT_THRESHOLDS, type MetricThresholds, type StrategyKey } from '@/lib/tuning/schema'

/** Overdue-ness saturates here, so a year-late card does not dwarf everything. */
export const OVERDUE_SATURATION_DAYS = 7

/** Neutral centrality for a KLP with no stored weight. */
export const DEFAULT_WEIGHT = 3

/**
 * One rankable unit: a key learning point with its metrics attached.
 *
 * The KLP is the candidate rather than the card or the topic because it is the
 * finest actionable unit — what a focus quiz targets and what Spec 4 will
 * schedule. Topic ordering is derivable by aggregating candidates; the reverse
 * is not.
 */
export interface RankCandidate {
  klpId: string
  topicKey: string
  /** CardKlp.weight, 1-5: how central this point is to its card. */
  weight: number
  pKnown: number
  observations: number
  /** The topic's short-answer readiness, or null when unmeasured. */
  readiness: number | null
  dueAt: Date | null
}

export interface RankedCandidate extends RankCandidate {
  score: number
  /** False when the candidate is below the learner's observation floor. */
  sufficient: boolean
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function overdueness(dueAt: Date | null, now: Date): number {
  if (dueAt === null) return 0
  const days = (now.getTime() - dueAt.getTime()) / 86_400_000
  return clamp01(days / OVERDUE_SATURATION_DAYS)
}

/**
 * Unknown readiness is treated as NO articulation problem (1), not a severe
 * one. Ranking an unmeasured point as maximally rough would fill the list with
 * propositions we have simply never tested in short answer.
 */
function articulationGap(readiness: number | null): number {
  return 1 - (readiness ?? 1)
}

function scoreFor(c: RankCandidate, strategy: StrategyKey, now: Date): number {
  const weakness = (1 - c.pKnown) * (c.weight / 5)
  const polish = c.pKnown * articulationGap(c.readiness)
  const forgetting = overdueness(c.dueAt, now)

  switch (strategy) {
    case 'shore_up_weaknesses':
      return weakness
    case 'polish_near_ready':
      return polish
    case 'follow_forgetting':
      return forgetting
    case 'balanced':
      return (weakness + polish + forgetting) / 3
  }
}

/**
 * Rank candidates under one strategy. Every strategy ranks the same set and
 * returns the same shape, so the setting only SELECTS — it never changes what
 * is recorded or which data is considered.
 *
 * Candidates below the learner's observation floor sort last under EVERY
 * strategy: an unmeasured proposition is not evidence of weakness, and
 * `polish_near_ready` in particular must not promote a KLP whose high pKnown
 * rests on one lucky answer. The floor is the LEARNER'S, not a constant —
 * on a thin corpus every candidate is sub-threshold and the order carries no
 * information until they lower it.
 */
export function rankCandidates(
  candidates: RankCandidate[],
  strategy: StrategyKey,
  opts: { now?: Date; thresholds?: MetricThresholds } = {},
): RankedCandidate[] {
  const now = opts.now ?? new Date()
  const { minObservations } = opts.thresholds ?? DEFAULT_THRESHOLDS

  return candidates
    .map((c) => ({
      ...c,
      score: scoreFor(c, strategy, now),
      sufficient: c.observations >= minObservations,
    }))
    .sort((a, b) => {
      if (a.sufficient !== b.sufficient) return a.sufficient ? -1 : 1
      return b.score - a.score
    })
}

export interface CandidateSource {
  /**
   * LIVE KLP ids per topic. Never `supersededKlpIds` — a retired KLP belongs to
   * an older version of the card, and handing it back as something to study
   * would target text the learner can no longer see.
   */
  topics: { key: string; klpIds: string[]; readiness: number | null }[]
  /** CardKlp.weight per KLP id. */
  klpWeights: Record<string, number>
  knowledge: Record<string, { pKnown: number; observations: number }>
  /** Which card each KLP belongs to, for resolving due state. */
  klpCardIds: Record<string, string>
  /** CardProgress.dueAt per card id. */
  dueByCard: Record<string, Date>
}

/**
 * Flatten topics into one candidate per KLP.
 *
 * A KLP appearing under two topics is emitted ONCE — the first topic wins —
 * because a duplicate would occupy two slots in a ranked list and be studied
 * twice. A KLP with no knowledge entry is still emitted, at the prior with
 * zero observations: the floor ranks it last, but dropping it would hide the
 * proposition entirely rather than marking it unmeasured.
 */
export function toRankCandidates(source: CandidateSource): RankCandidate[] {
  const seen = new Set<string>()
  const out: RankCandidate[] = []

  for (const topic of source.topics) {
    for (const klpId of topic.klpIds) {
      if (seen.has(klpId)) continue
      seen.add(klpId)

      const known = source.knowledge[klpId]
      const cardId = source.klpCardIds[klpId]

      out.push({
        klpId,
        topicKey: topic.key,
        weight: source.klpWeights[klpId] ?? DEFAULT_WEIGHT,
        pKnown: known?.pKnown ?? BKT_PRIOR,
        observations: known?.observations ?? 0,
        readiness: topic.readiness,
        dueAt: (cardId ? source.dueByCard[cardId] : undefined) ?? null,
      })
    }
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/targeting.test.ts && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: both PASS.

- [ ] **Step 5: Mutation check**

Introduce each, run the test file, confirm at least one test FAILS, then revert:
- (a) the observation floor is not applied (sort by score alone)
- (b) `rankCandidates` reads `DEFAULT_THRESHOLDS.minObservations` and ignores `opts.thresholds`
- (c) unknown readiness is treated as 0 (maximum articulation gap) instead of 1
- (d) `shore_up_weaknesses` ignores `weight`
- (e) sorting is ascending instead of descending
- (f) `rankCandidates` sorts the caller's array in place
- (g) `toRankCandidates` uses `?? 0` instead of `?? DEFAULT_WEIGHT`

Report all seven. If any survives, add an assertion and re-verify.

- [ ] **Step 6: Commit**

```bash
git add src/lib/metrics/targeting.ts tests/metrics/targeting.test.ts
git commit -m "feat(spec3b): add pure targeting strategies over KLP candidates"
```

---

### Task 6: Apply the user's tuning in the read API

**Read the "Known limit" note in the Revision section before starting.** `getLearnerMetrics`
has no production callers; this task makes it tuning-aware for Spec 3C to consume. Build
it correctly, then say so honestly in the commit message.

**Files:**
- Modify: `src/lib/metrics/read.ts`
- Test: `tests/metrics/read-populations.test.ts` (extend)

**Interfaces:**
- Consumes: `getUserTuning` (Task 4); `rankCandidates`, `toRankCandidates`, `RankedCandidate` (Task 5); `buildCardScopeWhere` from `@/lib/memory/scope` (already exported by the hardening pass)
- Produces: `LearnerMetrics.ranked: RankedCandidate[]`; `getLearnerMetrics`'s `bands` parameter narrows to an explicit preview override

- [ ] **Step 1: Write the failing test**

Append to `tests/metrics/read-populations.test.ts`. Match that file's existing
`vi.hoisted()` mock shape — add `learnerTuning: { findUnique: h.tuningFindUnique }` and
`cardProgress: { findMany: h.cardProgressFindMany }` to the mocked `prisma` object,
declare `tuningFindUnique`, `cardProgressFindMany` and `klpStateFindMany` in the
`vi.hoisted()` block, and default them in `beforeEach` (`tuningFindUnique` → `null`,
`cardProgressFindMany` → `[]`). The `cardCategory.findMany` mock must return one
category whose assignments include a live KLP `k1`/`k2` and a superseded one
`k-retired` (`supersededAt` non-null), so the live-only assertion has something to
catch. Add to the imports:

```ts
import { resolveBands } from '@/lib/tuning/schema'
```

```ts
describe('tuning is threaded all the way down (Spec 3B)', () => {
  it('reads the signed-in user\'s tuning row, scoped to them', async () => {
    await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(h.tuningFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' } }),
    )
  })

  it('applies the user\'s observation floor to topic knowledge', async () => {
    // One KLP, one observation. At the shipped floor of 3 this reports null;
    // the user has lowered it to 1, so it must report a number. If this fails,
    // `thresholds` stopped being forwarded into shapeTopicProfile.
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: null, thresholds: { minObservations: 1 },
    })
    h.klpStateFindMany.mockResolvedValue([{ klpId: 'k1', pKnown: 0.8, observations: 1 }])

    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.profile.topics[0].knowledge).toBeCloseTo(0.8)
  })

  it('ranks candidates under the user\'s stored strategy', async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'shore_up_weaknesses', bands: null, thresholds: { minObservations: 1 },
    })
    h.klpStateFindMany.mockResolvedValue([
      { klpId: 'k1', pKnown: 0.9, observations: 5 },
      { klpId: 'k2', pKnown: 0.1, observations: 5 },
    ])

    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.ranked.map((r) => r.klpId)[0]).toBe('k2')
  })

  it('builds candidates from LIVE klp ids only — a superseded KLP is not a study target', async () => {
    const out = await getLearnerMetrics({ userId: 'u1', scope: EMPTY_SCOPE })
    expect(out.ranked.map((r) => r.klpId)).not.toContain('k-retired')
  })

  it('lets an explicit bands argument override the stored one, for settings preview', async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [5, 5] }, thresholds: null,
    })
    // A caller-supplied table must win, so the panel can show "what would this
    // look like" without writing to the database first.
    const out = await getLearnerMetrics({
      userId: 'u1', scope: EMPTY_SCOPE, bands: resolveBands({ inversion: [1, 1] }),
    })
    expect(out).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/read-populations.test.ts`
Expected: FAIL — `learnerTuning` is not on the mocked client, and `out.ranked` is undefined.

- [ ] **Step 3: Resolve tuning inside the shell**

At the top of `getLearnerMetrics`, after the dynamic prisma import:

```ts
  // The learner's own knobs. `bands` stays a parameter so the settings panel
  // can PREVIEW a candidate table without saving — an explicit argument wins
  // over the stored one. It must be a FULLY RESOLVED table (resolveBands):
  // resolveSeverity replaces rather than merges, so a partial table silently
  // downgrades every unlisted type to FALLBACK_BAND.
  const tuning = await getUserTuning(userId)
  const effectiveBands = bands ?? tuning.bands
```

Use `effectiveBands` in the existing `deriveTagScores(...)` call, and pass
`thresholds: tuning.thresholds` into the existing `shapeTopicProfile({ ... })` call.

Update the `bands` parameter's doc to say it is a preview override, not the primary path.

- [ ] **Step 4: Widen the queries `toRankCandidates` needs**

Four things the shell does not currently fetch. Add each as a query or a `select`,
nothing more — the assembly itself is already a tested pure function.

1. **`CardKlp.weight` and `cardId`** — in `loadCategoryRows`, widen the KLP select from
   `{ id: true, supersededAt: true }` to `{ id: true, supersededAt: true, weight: true, cardId: true }`.
   Keep `supersededAt` — the hardening pass added it, and `toTopicRows` splits on it.

2. **Carry weights and card ids out** — build them in the shell from the same rows
   `toTopicRows` consumes, so there is one query, not two:

```ts
  const categoryRows = await loadCategoryRows(prisma, userId, scope)
  const topics = toTopicRows(categoryRows)

  const klpWeights: Record<string, number> = {}
  const klpCardIds: Record<string, string> = {}
  for (const c of categoryRows) {
    for (const a of c.assignments) {
      for (const k of a.card.klps) {
        klpWeights[k.id] = k.weight
        klpCardIds[k.id] = a.card.id
      }
    }
  }
```

   Widen `RawCategoryRow` in `src/lib/memory/topic-profile.ts` to match:
   `assignments: { card: { id: string; klps: { id: string; supersededAt: Date | null; weight: number; cardId: string }[] } }[]`.
   `toTopicRows` itself is unchanged — it reads only `id` and `supersededAt`.

3. **`CardProgress.dueAt`** — a new scoped query, added to the existing `Promise.all`:

```ts
    prisma.cardProgress.findMany({
      where: { userId, ...cardProgressScope },
      select: { cardId: true, dueAt: true },
    }),
```

   where `cardProgressScope` is built **before** the `Promise.all` using the exported
   helper, not a hand-rolled second filter:

```ts
  // `buildCardScopeWhere` (exported by the hardening pass for exactly this kind
  // of reuse) rather than a second filter written here that can drift from the
  // one every other query uses. CardProgress has its own scalar `cardId`, which
  // is the narrowest scope and subsumes set/category — the same branching
  // `buildStudyEventWhere` and `buildLearnerProfile` both apply.
  const cardProgressScope: Record<string, unknown> = {}
  if (scope.cardId) {
    cardProgressScope.cardId = scope.cardId
  } else {
    const card = buildCardScopeWhere(scope, categoryIds)
    if (Object.keys(card).length > 0) cardProgressScope.card = card
  }
```

4. **Topic readiness** — already produced by `shapeTopicProfile`; read it from the
   shaped topics rather than recomputing.

- [ ] **Step 5: Assemble, rank, and return**

`shapeTopicProfile` returns `LearnerTopicProfile[]` keyed by `key`, but the live KLP ids
live on the `TopicRow[]` that fed it. Build the map from `topics`, grouping by
`normalizedName` the same way `shapeTopicProfile` does:

```ts
  const shapedTopics = shapeTopicProfile({
    topics, knowledge, tags: derived, analyzedAnswersByTopic,
    thresholds: tuning.thresholds,
  })

  // LIVE ids only. `supersededKlpIds` exists for TAG ATTRIBUTION — a historical
  // tag names the version that was asked — and must never become a study
  // target: that KLP describes a version of the card the learner cannot see.
  const liveKlpIdsByTopic: Record<string, string[]> = {}
  for (const t of topics) {
    ;(liveKlpIdsByTopic[t.normalizedName] ??= []).push(...t.klpIds)
  }

  const ranked = rankCandidates(
    toRankCandidates({
      topics: shapedTopics.map((t) => ({
        key: t.key,
        klpIds: [...new Set(liveKlpIdsByTopic[t.key] ?? [])],
        readiness: t.readiness,
      })),
      klpWeights,
      knowledge,
      klpCardIds,
      dueByCard: Object.fromEntries(
        progressRows
          .filter((p): p is { cardId: string; dueAt: Date } => p.dueAt !== null)
          .map((p) => [p.cardId, p.dueAt]),
      ),
    }),
    tuning.strategy,
    { now, thresholds: tuning.thresholds },
  )
```

Add to the `LearnerMetrics` interface:

```ts
  /**
   * KLP-grain study candidates under the learner's chosen strategy, best first.
   * Sub-threshold candidates are present but sort last and carry
   * `sufficient: false` — see `rankCandidates`.
   *
   * NOT RENDERED ANYWHERE YET. Spec 3C's dashboard is the intended consumer;
   * until it exists this is a tested API with no UI behind it.
   */
  ranked: RankedCandidate[]
```

and include `ranked` in the returned object, plus `shapedTopics` in place of the
inline `shapeTopicProfile(...)` call inside `composeLearnerProfile`.

Every one of these is a query, a field widening, or a delegation. **If you find yourself
writing a conditional or a threshold here, it belongs in `targeting.ts`** — that is the
rule this file's exemption from unit tests rests on.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/metrics tests/memory && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: all PASS.

Confirm by inspection that **no background job, `after()` call, or replay was added** on
the tuning path. Bands and thresholds do not feed BKT, so a tuning change requires no
recomputation — see the Global Constraints and `src/lib/metrics/cache.ts`'s corrected
comment.

- [ ] **Step 7: Commit**

```bash
git add src/lib/metrics/read.ts src/lib/memory/topic-profile.ts tests/metrics/read-populations.test.ts
git commit -m "feat(spec3b): apply the user's bands, thresholds and strategy in the read API"
```

---

### Task 7: Derive tag scores on the quiz results screen

Spec §3.4. Without this, the first retune makes the results page and the dashboard
disagree about the same error, with nothing on either screen explaining the discrepancy.
This is the **only user-visible re-scoring surface this plan ships** — see the Revision
note.

**Files:**
- Modify: `src/actions/quiz.ts` (`getQuizAttemptSummary`, around `:1268-1356`)
- Test: `tests/actions/quiz-summary-analysis.test.ts` (extend)
- Read (probably unmodified): `src/components/quiz/QuizSummary.tsx`

**Interfaces:**
- Consumes: `toStoredTags`, `deriveTagScores`, `REPEAT_WINDOW_ATTEMPTS` from `@/lib/errors/derive`; `ANSWERED_ATTEMPT_WHERE` from `@/lib/quiz/history`; `getUserTuning` from `@/lib/tuning/store` (Task 4)
- Produces: attempt-summary answers whose `errorTags` carry derived `severity`, `significance` and `repeatBonus`

- [ ] **Step 1: Write the failing test**

Append to `tests/actions/quiz-summary-analysis.test.ts`. Add
`learnerTuning: { findUnique: h.tuningFindUnique }` and
`quizAttempt: { findFirst: h.attemptFindFirst, findMany: h.attemptFindMany }` to the
existing `vi.mock('@/lib/db')` block, and default both new mocks in `beforeEach`.

```ts
describe('read-time derivation on the attempt summary (Spec 3B §3.4)', () => {
  const answerWith = (tag: Record<string, unknown>) => ({
    id: 'ans1', mode: 'short-answer', cardId: 'c1', analysisStatus: 'analyzed',
    card: { contentBlocks: [] }, klpResults: [],
    errorTags: [{
      dimension: 'accuracy', type: 'inversion', klpId: 'klp1', secondaryKlpId: null,
      relevance: 3, starred: false, magnitude: 10, mode: 'quiz-sa',
      severity: 5, significance: 9, quote: null,
      createdAt: new Date('2026-08-06T00:00:00Z'),
      klp: { text: 'a point', kind: 'fact' }, secondaryKlp: null,
      ...tag,
    }],
  })

  it('reports a severity derived from the user\'s bands, not the value stored at grading time', async () => {
    // Stored severity 5 under the default inversion band [2,5]. The user has
    // retuned inversion to [1,2], so the same answer must now read 2.
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [1, 2] }, thresholds: null,
    })
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    expect(res.success).toBe(true)
    const [derivedTag] = (res as { data: any }).data.attempt.answers[0].errorTags
    expect(derivedTag.severity).toBe(2)
    expect(derivedTag.significance).toBeLessThan(9)
  })

  it('still falls back to the stored severity for a legacy row with no magnitude', async () => {
    h.tuningFindUnique.mockResolvedValue({
      strategy: 'balanced', bands: { inversion: [1, 2] }, thresholds: null,
    })
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null,
      answers: [answerWith({ magnitude: null, mode: null, severity: 4 })],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    const [derivedTag] = (res as { data: any }).data.attempt.answers[0].errorTags
    expect(derivedTag.severity).toBe(4)
  })

  it('preserves the joined klp text the badge renderer reads', async () => {
    // The merge must add fields, never replace the tag object wholesale —
    // `klp.text` comes from the include and is not on the derived shape.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }])

    const res = await getQuizAttemptSummary('a1')
    const [derivedTag] = (res as { data: any }).data.attempt.answers[0].errorTags
    expect(derivedTag.klp.text).toBe('a point')
    expect(derivedTag.dimension).toBe('accuracy')
  })

  it('draws the repeat window from the user\'s REAL ANSWERED attempt sequence', async () => {
    // Two requirements in one assertion, spec §3.4.1(a):
    //  - unscoped and chronological: deriving the order from the tags makes
    //    CLEAN attempts invisible, so an error repeated after ten flawless
    //    sittings still scores "+1, they keep doing this";
    //  - ANSWERED_ATTEMPT_WHERE: `src/lib/metrics/read.ts:122` filters
    //    zero-answer attempts out of this exact window, and abandoned attempts
    //    still accumulate in the table (item 2b filters rather than deletes).
    //    An unfiltered query here gives the SAME attempt a different index and
    //    therefore a different repeatBonus than the dashboard computes.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a9', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([])

    await getQuizAttemptSummary('a9')
    expect(h.attemptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: OWNER, ...ANSWERED_ATTEMPT_WHERE },
        orderBy: { createdAt: 'asc' },
      }),
    )
  })

  it('awards a repeat bonus for an error the learner made in a PRIOR attempt', async () => {
    // Spec §3.4.1(b). deriveTagScores builds `seen` only from the tags it is
    // given and looks STRICTLY backward, so deriving over one attempt's tags
    // makes repeatBonus structurally always 0 — the code runs, every
    // single-attempt fixture passes, and the number is wrong for exactly the
    // learner the bonus describes. This fixture is the only kind that can fail.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a2', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue([{ id: 'a1' }, { id: 'a2' }])
    // The same (type, klpId) in the immediately preceding attempt.
    h.errorTagFindMany.mockResolvedValue([{
      dimension: 'accuracy', type: 'inversion', klpId: 'klp1', secondaryKlpId: null,
      relevance: 3, starred: false, magnitude: 10, mode: 'quiz-sa',
      severity: 5, significance: 9, quote: null,
      createdAt: new Date('2026-08-05T00:00:00Z'),
      quizAnswer: { attemptId: 'a1', cardId: 'c1' },
    }])

    const res = await getQuizAttemptSummary('a2')
    const [derivedTag] = (res as { data: any }).data.attempt.answers[0].errorTags
    expect(derivedTag.repeatBonus).toBe(1)
  })

  it('scopes the repeat context to the window, the user, and analyzed answers', async () => {
    // Bounded by REPEAT_WINDOW_ATTEMPTS because that is exactly how far back
    // the bonus looks; `analysisStatus: 'analyzed'` because that is the
    // population `read.ts`'s tag query uses, and a context drawn from a wider
    // one reintroduces the divergence from the other side.
    h.tuningFindUnique.mockResolvedValue(null)
    h.attemptFindFirst.mockResolvedValue({
      id: 'a5', userId: OWNER, session: null, answers: [answerWith({})],
    })
    h.attemptFindMany.mockResolvedValue(
      ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id })),
    )

    await getQuizAttemptSummary('a5')
    const where = h.errorTagFindMany.mock.calls[0][0].where
    expect(where.quizAnswer.analysisStatus).toBe('analyzed')
    // a2, a3, a4 — the REPEAT_WINDOW_ATTEMPTS answered attempts before a5.
    // Not a1, and not a5 itself (its tags are already in hand).
    expect(where.quizAnswer.attemptId.in).toEqual(['a2', 'a3', 'a4'])
  })
})
```

Add `import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history'` to the test file, and
`answerErrorTag: { findMany: h.errorTagFindMany }` to the `vi.mock('@/lib/db')` block
(defaulting to `[]` in `beforeEach`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/quiz-summary-analysis.test.ts`
Expected: FAIL — the first case reports 5 until derivation is wired, and
`h.attemptFindMany` is never called.

- [ ] **Step 3: Derive in the attempt summary**

In `getQuizAttemptSummary`, after the existing MC-options block and before building the
return value:

```ts
    // Spec 3B §3.4: severity and significance are DERIVED here, not read from
    // the row. The stored columns reflect whichever bands were active on the
    // day the answer was graded; deriving means one number everywhere and a
    // retune visibly re-scores history, which is the point of the knob.
    const [tuning, attemptOrder] = await Promise.all([
      getUserTuning(session.user.id),
      // The learner's REAL attempt sequence — unscoped, chronological, and
      // ANSWERED-ONLY. Deriving it from the tags would make CLEAN attempts
      // invisible, so `repeatBonus` fires for an error fixed ten sittings ago.
      // `ANSWERED_ATTEMPT_WHERE` because `src/lib/metrics/read.ts:122` filters
      // this same window: an abandoned attempt left in the sequence here shifts
      // every index and makes the two screens disagree. Spec §3.4.1(a).
      prisma.quizAttempt.findMany({
        where: { userId: session.user.id, ...ANSWERED_ATTEMPT_WHERE },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }),
    ]);

    // The repeat-window CONTEXT. `deriveTagScores` builds its `seen` set only
    // from the tags handed to it and looks strictly backward, so deriving over
    // this attempt alone makes `repeatBonus` structurally always 0 — spec
    // §3.4.1(b). REPEAT_WINDOW_ATTEMPTS positions back is exactly as far as the
    // bonus can see, so a wider query would be waste and a narrower one wrong.
    // `analysisStatus: 'analyzed'` matches the dashboard's tag population; an
    // answer can carry tags under `no_klps`/`no_provenance` and `read.ts`
    // excludes those.
    const here = attemptOrder.findIndex((a) => a.id === attempt.id);
    const windowIds = (here === -1 ? attemptOrder : attemptOrder.slice(0, here))
      .slice(-REPEAT_WINDOW_ATTEMPTS)
      .map((a) => a.id);

    const contextRows = windowIds.length === 0 ? [] : await prisma.answerErrorTag.findMany({
      where: {
        quizAnswer: {
          userId: session.user.id,
          attemptId: { in: windowIds },
          analysisStatus: 'analyzed',
        },
      },
      select: {
        dimension: true, type: true, klpId: true, relevance: true, starred: true,
        magnitude: true, mode: true, severity: true, significance: true,
        createdAt: true,
        quizAnswer: { select: { attemptId: true, cardId: true } },
      },
    });

    // One derivation across the whole attempt plus its context, not one per
    // answer: repeatBonus is a cross-tag judgement and must see every tag at
    // once. The context tags are then discarded — only this attempt's are read
    // back out.
    const flatTags = attempt.answers.flatMap((a: any) =>
      (a.errorTags ?? []).map((t: any) => ({
        ...t,
        quizAnswer: { attemptId: attempt.id, cardId: a.cardId },
      })),
    );
    const derived = deriveTagScores(
      toStoredTags([...contextRows, ...flatTags] as any),
      tuning.bands,
      attemptOrder.map((a) => a.id),
    );

    // NOT keyed positionally: deriveTagScores re-sorts chronologically and the
    // array now also holds context tags from other attempts, so index alignment
    // with `flatTags` is not safe. `attemptId` is part of the key for the same
    // reason — without it a context tag could shadow one of this attempt's.
    const derivedByKey = new Map(
      derived.map((d) => [
        `${d.attemptId}::${d.cardId}::${d.type}::${d.klpId ?? 'whole'}::${d.createdAt.getTime()}`,
        d,
      ]),
    );

    attempt.answers = attempt.answers.map((a: any) => ({
      ...a,
      errorTags: (a.errorTags ?? []).map((t: any) => {
        const d = derivedByKey.get(
          `${attempt.id}::${a.cardId}::${t.type}::${t.klpId ?? 'whole'}::${new Date(t.createdAt).getTime()}`,
        );
        // Spread the ORIGINAL row first so the joined `klp`/`secondaryKlp`
        // objects survive; overlay only the derived numbers. `repeatBonus` is
        // carried too — it is what lets a badge explain WHY a significance is
        // higher than the base, and the test asserts it directly rather than
        // inferring it from an arithmetic difference.
        return d
          ? { ...t, severity: d.severity, significance: d.significance, repeatBonus: d.repeatBonus }
          : t;
      }),
    }));
```

Add the imports at the top of `src/actions/quiz.ts`:

```ts
import { toStoredTags, deriveTagScores, REPEAT_WINDOW_ATTEMPTS } from '@/lib/errors/derive';
import { ANSWERED_ATTEMPT_WHERE } from '@/lib/quiz/history';
import { getUserTuning } from '@/lib/tuning/store';
```

- [ ] **Step 4: Confirm the component needs no change**

`QuizSummary.tsx:157` sorts by `t.significance` and `rollupSessionAnalysis` sums
`tag.significance` (`src/lib/analysis/rollup.ts`). Both now receive derived values via
the same objects, so **no component change should be required**. Verify that by reading
the data path — `QuizSummary` → `ErrorTagBadges` → `t.significance`, and
`rollupSessionAnalysis(attempt.answers)` → `RollupErrorTag.significance` — and only edit
if some other site reads a stored field directly.

If a component test does need touching: trap 7 — a client component that gains a
server-action import kills every jsdom test that renders it (`next-auth` in the browser
env, failing at load before any test runs). Mock the action module, as
`tests/components/QuizSummary.test.tsx` already does. Trap 9 — `// @vitest-environment jsdom`
must be the literal first line, and the file must call `afterEach(cleanup)` itself.

- [ ] **Step 5: Mutation check**

Introduce each, run `tests/actions/quiz-summary-analysis.test.ts`, confirm a test FAILS,
then revert. Three of these are the defects this task exists to prevent, and each is a
shape that a single-attempt fixture passes happily:

- (a) drop `ANSWERED_ATTEMPT_WHERE` from the attempt-order query
- (b) drop the context query and derive over `flatTags` alone (repeatBonus → always 0)
- (c) widen the context window to every attempt instead of `REPEAT_WINDOW_ATTEMPTS`
- (d) drop `analysisStatus: 'analyzed'` from the context query
- (e) overlay the derived tag wholesale instead of spreading the original first
      (the joined `klp.text` disappears)

Report all five. If any survives, add an assertion that kills it and re-verify.

- [ ] **Step 6: Verify**

Run: `npx vitest run tests/actions tests/components --exclude "**/cursor-agents/**" && npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/actions/quiz.ts tests/actions/quiz-summary-analysis.test.ts
git commit -m "feat(spec3b): derive tag scores on the quiz results screen"
```

---

### Task 8: Severity band panel

**Files:**
- Create: `src/components/settings/SeverityBandPanel.tsx`
- Modify: `src/app/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `loadTuning`, `saveTuning` (Task 4); `DEFAULT_BANDS` (`@/lib/errors/bands`); `ACCURACY_TYPES`/`CLARITY_TYPES`/`CONCISENESS_TYPES` (`@/lib/errors/taxonomy`); `labelForErrorType` (`@/lib/errors/labels`)
- Produces: a mounted panel; no exports consumed by later tasks

- [ ] **Step 1: Build the panel**

Follow `src/components/settings/CredentialList.tsx`'s structure — a `'use client'`
component calling the server actions, with `sonner` toasts for success and failure.

Requirements:
- Group types by dimension (accuracy, clarity, conciseness), using `labelForErrorType`
  rather than raw keys.
- Each row shows the current band, **the shipped default alongside it**, and a per-type
  reset. A global reset clears every band override.
- Validation mirrors the server: integers 1-5, floor ≤ ceiling. Rejected, not clamped —
  show the error and leave the input as typed.
- **Send ONLY `bandOverrides`.** `saveTuning` is partial (spec §5) — an absent field is
  left unchanged — so this panel must not echo back the strategy or thresholds it read at
  mount. Echoing them is what reverts a sibling panel's save.

- [ ] **Step 2: State the two consequences in the UI**

Both are required by spec §3.2 and neither is discoverable:

- **Editing a band re-scores history.** Severity and significance are derived at read
  time, so retuning changes what past answers scored. That is intended — the reason to
  open this panel is "inversions are overweighted *for me*" — but a proposition can move
  from weak to fine without the learner studying anything, and the panel must say so
  rather than letting the number quietly shift.
- **Editing one of five accuracy ceilings also changes multiple-choice and true/false
  scoring.** Those answers carry `MC_TF_MAGNITUDE` (10) and resolve to the ceiling.
  Someone softening `inversion` to fix short-answer grading will also rescore every MC
  and TF inversion they have ever answered. Surface this **at the point of edit** on
  `conflation`, `inversion`, `misapplication`, `overgeneralization`, and `factual_error`
  — not in a help page.

Use this copy verbatim, so neither warning is left to improvisation. Panel-level, above
the groups:

> Changing a band re-scores your history. These numbers are worked out fresh every time
> a screen loads, not frozen when you answered — so a retune changes what past answers
> scored. That's deliberate: if inversions are overweighted *for you*, you want the fix
> applied to everything, not just to what you do next. But it does mean a topic can move
> from weak to fine without you having studied anything.

Inline, on each of the five pinned-ceiling types only:

> Also affects multiple choice and true/false. Those answers always resolve to this
> type's **upper** number, so changing it re-scores every multiple-choice and
> true/false {label} you've ever answered — not just your written ones.

where `{label}` is `labelForErrorType(type)`.

- [ ] **Step 3: Mount it**

Add `<SeverityBandPanel />` to `src/app/settings/ai/page.tsx` below `<TaskRoutingPanel />`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents" && npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**" && npm run lint 2>&1 | tail -3`
Expected: type-check and suite pass; **no new lint problems versus the 185-problem
baseline** — compare, do not fix unrelated ones.

**HUMAN GATE.** No signed-in page is reachable from an agent session (trap 6: GitHub
OAuth only, no `GITHUB_ID` in `.env`), so hand this to the user rather than attempting it:
run `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`, open `/settings/ai`, and
confirm a band edit saves and reloads; an inverted band is rejected with a readable
message; a reset restores the default; both consequence warnings are visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SeverityBandPanel.tsx src/app/settings/ai/page.tsx
git commit -m "feat(spec3b): add the severity band settings panel"
```

---

### Task 9: Targeting strategy selector

**Files:**
- Create: `src/components/settings/TargetingStrategyPanel.tsx`
- Modify: `src/app/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `loadTuning`, `saveTuning` (Task 4); `STRATEGY_KEYS` (`@/lib/tuning/schema`)
- Produces: a mounted panel

- [ ] **Step 1: Build the selector**

A `'use client'` component with one choice per strategy, each with a one-line description
of who it is for:

| Key | Label | Description |
| --- | --- | --- |
| `shore_up_weaknesses` | Shore up weaknesses | Targets what you know least, weighted by how central it is. Best when the interview is still some way off. |
| `polish_near_ready` | Polish what's nearly ready | Targets material you know but express poorly. Best when the interview is close. |
| `follow_forgetting` | Follow the forgetting curve | Targets what is due or overdue for review. Best for maintenance. |
| `balanced` | Balanced (default) | A blend of all three. |

State plainly that the strategy affects **ordering only** — never which data is recorded,
and never the metrics themselves. A learner switching strategies sees the same profile
ranked differently, not a different profile.

Also state, honestly, that **the ranking it controls is not yet displayed anywhere** —
the learner dashboard that consumes it is Spec 3C. A setting that appears to do nothing
is worse than one labelled as forthcoming.

**Send ONLY `strategy`.** `saveTuning` is partial (spec §5); an absent field is left
unchanged, so this panel neither knows nor echoes what the other two hold.

- [ ] **Step 2: Mount it**

Add `<TargetingStrategyPanel />` to `src/app/settings/ai/page.tsx`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents" && npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"`
Expected: PASS.

**HUMAN GATE** (trap 6) at `/settings/ai`: selecting a strategy persists across reload,
and **changing the strategy does not clear a band override** — set an override first,
then change the strategy, then reload and confirm the override survives. Partial saves
(spec §5) are what make this hold; the Task 4 unit test covers the payload, this covers
the round trip.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/TargetingStrategyPanel.tsx src/app/settings/ai/page.tsx
git commit -m "feat(spec3b): add the targeting strategy selector"
```

---

### Task 10: Metric threshold panel

**Files:**
- Create: `src/components/settings/MetricThresholdPanel.tsx`
- Modify: `src/app/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `loadTuning`, `saveTuning` (Task 4); `DEFAULT_THRESHOLDS` (`@/lib/tuning/schema`)
- Produces: a mounted panel

- [ ] **Step 1: Build the panel**

Three numeric fields, each showing its shipped default alongside the current value and a
per-field reset, following `SeverityBandPanel`'s structure from Task 8.

| Field | Label | Copy |
| --- | --- | --- |
| `minObservations` | Evidence before an opinion | How many times a point must be tested before we'll say whether you know it. Lower it to see provisional numbers sooner; raise it to wait for firmer evidence. Default 3. |
| `articulationMinPKnown` | Confidence before blaming expression | How well you must know a point before a short answer is treated as an expression problem rather than a knowledge gap. Default 0.6. |
| `readinessWeightPerAnswer` | Readiness strictness | The average per-answer error weight at which readiness reaches zero. Lower is stricter. Default 12. |

Validation mirrors the server exactly (`ThresholdOverridesSchema`): `minObservations` a
whole number 1-50; `articulationMinPKnown` between 0 and 1; `readinessWeightPerAnswer`
above 0 and at most 100. Rejected, not clamped.

**Say what lowering the evidence floor actually does**, at the point of edit: it does not
produce more evidence, it lowers the bar for acting on what exists. A knowledge figure
computed from one answer is a guess with a number attached. Frame the trade-off — an
interview next week justifies acting on thinner evidence than one six months out — rather
than presenting it as a "show more data" toggle.

**Send ONLY `thresholdOverrides`**, for the same reason Tasks 8 and 9 send only their own.

- [ ] **Step 2: Mount it**

Add `<MetricThresholdPanel />` to `src/app/settings/ai/page.tsx`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents" && npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**" && npm run lint 2>&1 | tail -3`
Expected: type-check and suite pass; no new lint problems versus the 185 baseline.

**HUMAN GATE** (trap 6) at `/settings/ai`: set `minObservations` to 1, save, reload, and
confirm it persists; enter 0 and confirm it is rejected with a readable message; reset
restores 3. Then the cross-panel invariant once more — set a band override AND a
threshold AND a strategy, reload, and check all three survived.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/MetricThresholdPanel.tsx src/app/settings/ai/page.tsx
git commit -m "feat(spec3b): add the metric threshold settings panel"
```

---

## Final verification

- [ ] `npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"` — full suite green (expect **>1083** tests; the baseline before this plan is 1083 / 96 files, measured 2026-08-12)
- [ ] `npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"` — clean
- [ ] `npm run lint` — no new problems versus the **185** baseline
- [ ] Retune a band, then confirm the SAME error shows the SAME severity **and the same significance** on an unscoped metric read and on the quiz results screen — including a tag that is a repeat within `REPEAT_WINDOW_ATTEMPTS`. Severity agreeing is not sufficient: it is pure in the tag, so it agrees even when `repeatBonus` does not. Disagreement means Task 7 is incomplete. (A *scoped* read may legitimately differ — spec §3.4.2.)
- [ ] Confirm **no** background job, `after()` call, or replay is triggered by any tuning save — there must not be one. Grep the diff for `after(`, `rebuildKlpStates`, and `backfill`.
- [ ] Confirm `LearnerTuning` was **not** added to `ERASABLE_MEMORY_MODELS`/`RESET_MEMORY_MODELS` — a preference is not memory (spec §2.3), and `tests/memory/erase-coverage.test.ts` should still pass untouched.

**Human gates — hand these to the user** (trap 6; and per spec §0 the live database
currently holds **zero** study history, so the last one is blocked until they have
quizzed again. Do not substitute seeded data):

- [ ] Set all three knob types, reload `/settings/ai`, and confirm none of the three panels wiped another's values.
- [ ] Lower `minObservations` to 1 against the real database and confirm topic knowledge renders where it previously read null. That is the concrete payoff, and it needs at least one KLP carrying an observation to be visible at all.

## Deliberately NOT in this plan

- **A UI for `ranked`.** Spec 3C's dashboard. Task 6 builds the API; nothing renders it.
- **Wiring `topics` into `profileToPromptBlock`.** All callers still hardcode `topics: []` (Spec 3 §14). Fixing it also requires giving the topic section a reserved character budget, since `capBlock` truncates it first — do both or neither, in 3C.
- **Per-topic band overrides** (harsher on accounting than on vocabulary). Spec §7 defers them; the versioned blob tolerates the addition.
- **Recomputing history on save.** There is nothing to recompute. See the Global Constraints.
- **Seeding synthetic study data** to make the thin corpus look populated. The posterior is incremental and not self-correcting, so fabricated evidence does not cleanly come back out.

## Spec coverage

| Spec section | Task |
| --- | --- |
| §2 data model, sparse overrides, blob rationale | 1, 2 |
| §3.1 panel, validation rejects not clamps | 2, 8 |
| §3.2 the two consequences stated in the UI | 8 |
| §2.3 tuning is a preference, not memory — absent from the erasure models | 1 (by omission — asserted in final verification) |
| §3.3 saving triggers no recomputation | 6 (by omission — asserted in final verification) |
| §3.4 every surface derives | 7 |
| §3.4.1 same attempt population + repeat-window context | 7 |
| §3.5 the three metric thresholds | 2, 3, 10 |
| §4 strategies, live-KLP candidate, observation floor | 3, 5, 6, 9 |
| §5 partial saves | 4, 8, 9, 10 |
| §6 testing, mutation checks, human gates | every task |
| §7 deferred (per-topic overrides, unscoped `repeatBonus` in the dashboard, Spec 3 §14) | not implemented, by design |
