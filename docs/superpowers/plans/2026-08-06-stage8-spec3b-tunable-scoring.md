# Stage 8 Spec 3B — User-tunable scoring & targeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hand the learner the knobs Spec 3 shipped with fixed defaults — editable severity bands and a selectable study-targeting strategy — and make every surface reflect a retune.

**Architecture:** One `LearnerTuning` row per user holds a versioned, Zod-validated band-override blob plus a strategy key. Overrides are sparse and merge over `DEFAULT_BANDS` in a pure function. Targeting strategies are pure ranking functions over KLP candidates; the setting only selects one. Because severity and significance are already derived at read time, **saving new bands requires no recomputation** — but every surface must derive, so the quiz results screen migrates off its stored values.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16 App Router, React 19, Vitest, Zod, shadcn/base-ui.

**Spec:** `docs/superpowers/specs/2026-08-05-spec3b-tunable-scoring-and-targeting-design.md`
**Depends on:** Spec 3 (merged to main as PR #11)

## Global Constraints

- Test runner is Vitest. Full suite: `npx vitest run` (~7s). Single file: `npx vitest run <path>`.
- Tests import via the `@/` alias and live under `tests/<area>/`.
- Pure modules must not import `@/lib/db`. DB shells import it **dynamically** (`await import('@/lib/db')`), as `src/lib/memory/profile.ts` does.
- **Bands never feed BKT.** `stepBkt` reads `status` and `mode` only. Nothing in this plan may trigger a knowledge replay on a band save — that was an error in an earlier draft of the spec, corrected in §3.3.
- Band values are integers in 1-5 with `floor <= ceiling`. Invalid input is **rejected, not clamped** — silently clamping lets a user believe they set something they did not.
- Overrides are **sparse**: only edited types are stored, so untouched types keep tracking future default changes.
- A corrupt tuning blob falls back to defaults rather than throwing, matching `SESSION_INSIGHT_VERSION`'s precedent in `src/lib/memory/insight.ts`.
- Server actions live in `src/actions/*.ts` with `'use server'` and return `ActionResult<T>` from `@/types/action`, matching `src/actions/ai-credentials.ts`.
- Migrations must be additive. Never accept a database reset; never pass `--force-reset` or `--accept-data-loss`. Return BLOCKED if a migration is anything else.
- Run `npx tsc --noEmit` as well as the suite. Vitest does not type-check.
- Commit after every task. Do not skip hooks.

---

## File Structure

**Create:**
- `src/lib/errors/tuning.ts` — versioned band-override schema + sparse merge (Task 2)
- `src/actions/learner-tuning.ts` — load/save actions + server-side reader (Task 3)
- `src/lib/metrics/targeting.ts` — candidate type + the four ranking functions (Task 4)
- `src/components/settings/SeverityBandPanel.tsx` (Task 7)
- `src/components/settings/TargetingStrategyPanel.tsx` (Task 8)

**Modify:**
- `prisma/schema.prisma` — `LearnerTuning` model (Task 1)
- `src/lib/metrics/read.ts` — resolve the user's bands and strategy (Task 5)
- `src/actions/quiz.ts` — derive tag scores in the attempt summary (Task 6)
- `src/components/quiz/QuizSummary.tsx` — consume derived values (Task 6)
- `src/app/settings/ai/page.tsx` — mount both panels (Tasks 7, 8)

---

### Task 1: LearnerTuning model

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: nothing
- Produces: `LearnerTuning` with `userId` (PK), `strategy: String`, `bands: Json?`, `version: Int`, `updatedAt`

- [ ] **Step 1: Add the model**

```prisma
/// Stage 8 Spec 3B: per-user scoring and targeting preferences.
///
/// `bands` is a versioned, Zod-validated blob rather than a relational table.
/// Spec 2a argued the opposite for AnswerKlpResult/AnswerErrorTag — "a JSON
/// blob can't be indexed or FK'd" — and that reasoning genuinely does not
/// transfer: bands are never aggregated across users, joined, or filtered on.
/// They are read wholesale for exactly one user at the start of a computation.
/// The applicable precedent is SESSION_INSIGHT_VERSION (lib/memory/insight.ts):
/// a versioned blob readers parse with a schema and fall back on.
///
/// Overrides are SPARSE — only edited types are stored, so a user who retunes
/// one type does not freeze the other twenty against future default changes.
model LearnerTuning {
  userId    String   @id
  strategy  String   @default("balanced")
  bands     Json?
  version   Int      @default(1)
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Add the back-relation `learnerTuning LearnerTuning?` to `model User`.

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name add_learner_tuning`
Expected: one additive `CREATE TABLE`, no reset prompt. If drift is reported, STOP and return BLOCKED.

- [ ] **Step 3: Verify the client**

Run: `npx tsc --noEmit`
Expected: clean; `prisma.learnerTuning` exists.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(spec3b): add the LearnerTuning model"
```

---

### Task 2: Band-override schema and sparse merge

**Files:**
- Create: `src/lib/errors/tuning.ts`
- Test: `tests/errors/tuning.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_BANDS`, `BandTable`, `SeverityBand` from `@/lib/errors/bands`; `ACCURACY_TYPES`, `CLARITY_TYPES`, `CONCISENESS_TYPES` from `@/lib/errors/taxonomy`
- Produces: `TUNING_VERSION = 1`, `BandOverridesSchema`, `type BandOverrides`, `parseBandOverrides(raw: unknown): BandOverrides`, `resolveBands(overrides: BandOverrides): BandTable`, `STRATEGY_KEYS`, `type StrategyKey`, `parseStrategy(raw: unknown): StrategyKey`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/tuning.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseBandOverrides, resolveBands, parseStrategy, STRATEGY_KEYS, TUNING_VERSION,
} from '@/lib/errors/tuning'
import { DEFAULT_BANDS } from '@/lib/errors/bands'

describe('parseBandOverrides', () => {
  it('accepts a sparse map of valid bands', () => {
    const parsed = parseBandOverrides({ inversion: [1, 4] })
    expect(parsed).toEqual({ inversion: [1, 4] })
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
    expect(Object.keys(resolved).length).toBe(Object.keys(DEFAULT_BANDS).length)
  })

  it('does not mutate DEFAULT_BANDS', () => {
    const before = DEFAULT_BANDS.inversion
    resolveBands({ inversion: [1, 2] })
    expect(DEFAULT_BANDS.inversion).toBe(before)
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/tuning.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/tuning`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/errors/tuning.ts
import { z } from 'zod'
import { DEFAULT_BANDS, type BandTable, type SeverityBand } from '@/lib/errors/bands'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'

/** Bump when the stored blob's shape changes incompatibly. */
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
 * Parse a stored blob. A corrupt or partially invalid blob yields NO overrides
 * rather than throwing — a bad settings row must not make the app unusable,
 * matching how `SESSION_INSIGHT_VERSION` blobs are read.
 */
export function parseBandOverrides(raw: unknown): BandOverrides {
  if (raw === null || raw === undefined) return {}
  const parsed = BandOverridesSchema.safeParse(raw)
  return parsed.success ? (parsed.data as BandOverrides) : {}
}

/**
 * Merge sparse overrides over the shipped defaults.
 *
 * Sparse on purpose: a user who retunes one type keeps tracking future default
 * changes for every other type. Returns a fresh object — never mutates
 * DEFAULT_BANDS, which is module-level shared state.
 */
export function resolveBands(overrides: BandOverrides): BandTable {
  return { ...DEFAULT_BANDS, ...overrides }
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/tuning.test.ts`
Expected: PASS.

- [ ] **Step 5: Mutation check**

Introduce each mutation, run the test file, confirm at least one test FAILS, then revert:
- (a) `parseBandOverrides` clamps out-of-range values instead of rejecting the blob
- (b) `resolveBands` spreads overrides first and defaults second (defaults win)
- (c) the `floor <= ceiling` refinement is dropped
- (d) `parseStrategy` returns the raw value instead of falling back
- (e) `resolveBands` mutates and returns `DEFAULT_BANDS`

If any survives, add an assertion that kills it and re-verify. Report all five.

- [ ] **Step 6: Commit**

```bash
git add src/lib/errors/tuning.ts tests/errors/tuning.test.ts
git commit -m "feat(spec3b): add versioned band overrides with sparse merge"
```

---

### Task 3: Tuning persistence

**Files:**
- Create: `src/actions/learner-tuning.ts`
- Test: `tests/actions/learner-tuning.test.ts`

**Interfaces:**
- Consumes: Task 2's `parseBandOverrides`, `resolveBands`, `parseStrategy`, `BandOverridesSchema`, `TUNING_VERSION`; `ActionResult` from `@/types/action`
- Produces: `interface TuningRow { strategy: StrategyKey; overrides: BandOverrides }`, `shapeTuning(row: { strategy: string; bands: unknown } | null): TuningRow` (pure), `loadTuning(): Promise<ActionResult<TuningRow>>`, `saveTuning(input: { strategy: string; overrides: unknown }): Promise<ActionResult<TuningRow>>`, `getUserTuning(userId: string): Promise<{ bands: BandTable; strategy: StrategyKey }>`

- [ ] **Step 1: Write the failing test**

Only the pure shaper is unit-tested; the action bodies are thin DB shells, following `src/lib/memory/profile.ts:322-331`'s precedent.

```ts
// tests/actions/learner-tuning.test.ts
import { describe, it, expect } from 'vitest'
import { shapeTuning } from '@/actions/learner-tuning'
import { DEFAULT_BANDS } from '@/lib/errors/bands'

describe('shapeTuning', () => {
  it('returns balanced with no overrides when the user has no row', () => {
    expect(shapeTuning(null)).toEqual({ strategy: 'balanced', overrides: {} })
  })

  it('reads a stored strategy and overrides', () => {
    const shaped = shapeTuning({ strategy: 'polish_near_ready', bands: { inversion: [1, 3] } })
    expect(shaped.strategy).toBe('polish_near_ready')
    expect(shaped.overrides).toEqual({ inversion: [1, 3] })
  })

  it('falls back to balanced on an unrecognised stored strategy', () => {
    expect(shapeTuning({ strategy: 'retired_key', bands: null }).strategy).toBe('balanced')
  })

  it('drops a corrupt blob without throwing, leaving the strategy intact', () => {
    const shaped = shapeTuning({ strategy: 'follow_forgetting', bands: { inversion: [9, 9] } })
    expect(shaped.strategy).toBe('follow_forgetting')
    expect(shaped.overrides).toEqual({})
  })

  it('never returns the full default table as overrides — overrides stay sparse', () => {
    const shaped = shapeTuning({ strategy: 'balanced', bands: { inversion: [1, 3] } })
    expect(Object.keys(shaped.overrides)).toEqual(['inversion'])
    expect(Object.keys(shaped.overrides).length).toBeLessThan(Object.keys(DEFAULT_BANDS).length)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/learner-tuning.test.ts`
Expected: FAIL — cannot resolve `@/actions/learner-tuning`.

- [ ] **Step 3: Write the implementation**

```ts
// src/actions/learner-tuning.ts
'use server'

import { auth } from '@/auth'
import type { ActionResult } from '@/types/action'
import type { BandTable } from '@/lib/errors/bands'
import {
  BandOverridesSchema, parseBandOverrides, parseStrategy, resolveBands,
  TUNING_VERSION, type BandOverrides, type StrategyKey,
} from '@/lib/errors/tuning'

export interface TuningRow {
  strategy: StrategyKey
  overrides: BandOverrides
}

/** Pure: everything the actions decide happens here so it can be tested. */
export function shapeTuning(row: { strategy: string; bands: unknown } | null): TuningRow {
  if (!row) return { strategy: 'balanced', overrides: {} }
  return { strategy: parseStrategy(row.strategy), overrides: parseBandOverrides(row.bands) }
}

export async function loadTuning(): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }

  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId: session.user.id },
    select: { strategy: true, bands: true },
  })
  return { success: true, data: shapeTuning(row) }
}

export async function saveTuning(input: {
  strategy: string
  overrides: unknown
}): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }

  // Reject rather than salvage: a save is an explicit user act, so invalid
  // input must surface as an error instead of being silently discarded the way
  // a corrupt STORED blob is.
  const parsed = BandOverridesSchema.safeParse(input.overrides ?? {})
  if (!parsed.success) {
    return { success: false, error: 'Each band must be two whole numbers from 1 to 5, with the first no larger than the second.' }
  }
  const strategy = parseStrategy(input.strategy)

  const { prisma } = await import('@/lib/db')
  await prisma.learnerTuning.upsert({
    where: { userId: session.user.id },
    create: {
      userId: session.user.id,
      strategy,
      bands: parsed.data,
      version: TUNING_VERSION,
    },
    update: { strategy, bands: parsed.data, version: TUNING_VERSION },
  })

  return { success: true, data: { strategy, overrides: parsed.data as BandOverrides } }
}

/**
 * Server-side reader for the metric paths. Returns a fully resolved band table
 * so callers never merge defaults themselves — two call sites merging
 * independently is how they drift.
 */
export async function getUserTuning(
  userId: string,
): Promise<{ bands: BandTable; strategy: StrategyKey }> {
  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId },
    select: { strategy: true, bands: true },
  })
  const shaped = shapeTuning(row)
  return { bands: resolveBands(shaped.overrides), strategy: shaped.strategy }
}
```

- [ ] **Step 4: Run test and type-check**

Run: `npx vitest run tests/actions/learner-tuning.test.ts && npx tsc --noEmit`
Expected: both PASS. If `'use server'` rejects the non-async `shapeTuning` export at build time, move `shapeTuning` to `src/lib/errors/tuning.ts` and re-export nothing from the action file — a `'use server'` module may only export async functions, which is why `ANALYSIS_VERSION` lives in `persist.ts` rather than its action.

- [ ] **Step 5: Commit**

```bash
git add src/actions/learner-tuning.ts tests/actions/learner-tuning.test.ts
git commit -m "feat(spec3b): persist per-user tuning with validated overrides"
```

---

### Task 4: Targeting strategies

**Files:**
- Create: `src/lib/metrics/targeting.ts`
- Test: `tests/metrics/targeting.test.ts`

**Interfaces:**
- Consumes: `MIN_OBSERVATIONS` from `@/lib/metrics/bkt`; `StrategyKey` from `@/lib/errors/tuning`
- Produces: `interface RankCandidate`, `interface RankedCandidate`, `interface CandidateSource`, `OVERDUE_SATURATION_DAYS = 7`, `rankCandidates(candidates: RankCandidate[], strategy: StrategyKey, now?: Date): RankedCandidate[]`, `toRankCandidates(source: CandidateSource): RankCandidate[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/targeting.test.ts
import { describe, it, expect } from 'vitest'
import { rankCandidates } from '@/lib/metrics/targeting'
import type { RankCandidate } from '@/lib/metrics/targeting'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-06T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)

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

describe('shore_up_weaknesses', () => {
  it('puts the least-known proposition first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'strong', pKnown: 0.9 }), cand({ klpId: 'weak', pKnown: 0.1 })],
      'shore_up_weaknesses', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('weak')
  })

  it('breaks ties toward the more central proposition', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'minor', pKnown: 0.2, weight: 1 }), cand({ klpId: 'central', pKnown: 0.2, weight: 5 })],
      'shore_up_weaknesses', NOW,
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
      'polish_near_ready', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('knows-cant-say')
  })

  it('ranks a known and well-expressed proposition below a known and poorly-expressed one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'done', pKnown: 0.9, readiness: 1 }),
        cand({ klpId: 'rough', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('rough')
  })

  it('treats unknown readiness as no articulation problem, not a severe one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'unmeasured', pKnown: 0.9, readiness: null }),
        cand({ klpId: 'measured-bad', pKnown: 0.9, readiness: 0.2 }),
      ],
      'polish_near_ready', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('measured-bad')
  })
})

describe('follow_forgetting', () => {
  it('puts the most overdue first', () => {
    const ranked = rankCandidates(
      [cand({ klpId: 'fresh', dueAt: daysAgo(0) }), cand({ klpId: 'stale', dueAt: daysAgo(10) })],
      'follow_forgetting', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('stale')
  })

  it('ranks a not-yet-due proposition below any overdue one', () => {
    const ranked = rankCandidates(
      [
        cand({ klpId: 'future', dueAt: new Date(NOW.getTime() + 86_400_000) }),
        cand({ klpId: 'overdue', dueAt: daysAgo(1) }),
      ],
      'follow_forgetting', NOW,
    )
    expect(idsInOrder(ranked)[0]).toBe('overdue')
  })
})

describe('the observation floor applies under every strategy', () => {
  it('ranks a sub-threshold candidate last even when its metrics look ideal', () => {
    for (const strategy of ['shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced'] as const) {
      const ranked = rankCandidates(
        [
          cand({ klpId: 'thin', pKnown: 0.01, observations: MIN_OBSERVATIONS - 1, weight: 5, dueAt: daysAgo(30), readiness: 0 }),
          cand({ klpId: 'measured', pKnown: 0.5, observations: MIN_OBSERVATIONS }),
        ],
        strategy, NOW,
      )
      expect(idsInOrder(ranked)[1], strategy).toBe('thin')
    }
  })

  it('marks sub-threshold candidates so a caller can label them', () => {
    const [only] = rankCandidates(
      [cand({ klpId: 'thin', observations: 1 })], 'balanced', NOW,
    )
    expect(only.sufficient).toBe(false)
  })
})

describe('shared contract', () => {
  it('returns every candidate under every strategy, never dropping any', () => {
    const input = [cand({ klpId: 'a' }), cand({ klpId: 'b' }), cand({ klpId: 'c' })]
    for (const strategy of ['shore_up_weaknesses', 'polish_near_ready', 'follow_forgetting', 'balanced'] as const) {
      expect(rankCandidates(input, strategy, NOW), strategy).toHaveLength(3)
    }
  })

  it('is a pure function — it does not reorder the caller\'s array', () => {
    const input = [cand({ klpId: 'a', pKnown: 0.9 }), cand({ klpId: 'b', pKnown: 0.1 })]
    rankCandidates(input, 'shore_up_weaknesses', NOW)
    expect(idsInOrder(input)).toEqual(['a', 'b'])
  })

  it('balanced differs from at least one single-axis strategy on the same input', () => {
    const input = [
      cand({ klpId: 'x', pKnown: 0.9, readiness: 0.1, dueAt: daysAgo(20) }),
      cand({ klpId: 'y', pKnown: 0.1, readiness: 1, dueAt: null }),
    ]
    const balanced = idsInOrder(rankCandidates(input, 'balanced', NOW))
    const shore = idsInOrder(rankCandidates(input, 'shore_up_weaknesses', NOW))
    expect(balanced).not.toEqual(shore)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/targeting.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/targeting`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/targeting.ts
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'
import type { StrategyKey } from '@/lib/errors/tuning'

/** Overdue-ness saturates here, so a year-late card does not dwarf everything. */
export const OVERDUE_SATURATION_DAYS = 7

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
  /** False when the candidate is below the observation floor. */
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
 * returns the same shape, so the setting only selects — it never changes what
 * is recorded or which data is considered.
 *
 * Candidates below MIN_OBSERVATIONS sort last under EVERY strategy: an
 * unmeasured proposition is not evidence of weakness, and `polish_near_ready`
 * in particular must not promote a KLP whose high pKnown rests on one lucky
 * answer.
 */
export function rankCandidates(
  candidates: RankCandidate[],
  strategy: StrategyKey,
  now: Date = new Date(),
): RankedCandidate[] {
  return candidates
    .map((c) => ({
      ...c,
      score: scoreFor(c, strategy, now),
      sufficient: c.observations >= MIN_OBSERVATIONS,
    }))
    .sort((a, b) => {
      if (a.sufficient !== b.sufficient) return a.sufficient ? -1 : 1
      return b.score - a.score
    })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/targeting.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the candidate assembler**

Task 5's shell must not build candidates itself — that is a transformation, and `read.ts` is queries and delegation only. Append this test to the same file:

```ts
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
    const k3 = toRankCandidates(base).find((c) => c.klpId === 'k3')!
    expect(k3.observations).toBe(0)
  })

  it('resolves due date through the KLP\'s card', () => {
    const out = toRankCandidates(base)
    expect(out.find((c) => c.klpId === 'k1')!.dueAt?.toISOString()).toBe('2026-08-01T00:00:00.000Z')
    expect(out.find((c) => c.klpId === 'k3')!.dueAt).toBeNull()
  })

  it('does not emit a KLP twice when two topics share it', () => {
    const shared = {
      ...base,
      topics: [
        { key: 'valuation', klpIds: ['k1'], readiness: 0.4 },
        { key: 'dcf', klpIds: ['k1'], readiness: 0.9 },
      ],
    }
    const out = toRankCandidates(shared)
    expect(out.filter((c) => c.klpId === 'k1')).toHaveLength(1)
  })
})
```

Then implement it in `src/lib/metrics/targeting.ts`:

```ts
import { BKT_PRIOR } from '@/lib/metrics/bkt'

export interface CandidateSource {
  topics: { key: string; klpIds: string[]; readiness: number | null }[]
  /** CardKlp.weight per KLP id. */
  klpWeights: Record<string, number>
  knowledge: Record<string, { pKnown: number; observations: number }>
  /** Which card each KLP belongs to, for resolving due state. */
  klpCardIds: Record<string, string>
  /** CardProgress.dueAt per card id. */
  dueByCard: Record<string, Date>
}

/** Neutral centrality for a KLP with no stored weight. */
const DEFAULT_WEIGHT = 3

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

Add `toRankCandidates` to the test file's import.

- [ ] **Step 6: Mutation check**

Introduce each, run the test file, confirm at least one test FAILS, then revert:
- (a) the observation floor is not applied (sort by score alone)
- (b) unknown readiness is treated as 0 (maximum articulation gap) instead of 1
- (c) `shore_up_weaknesses` ignores `weight`
- (d) sorting is ascending instead of descending
- (e) `rankCandidates` sorts the caller's array in place

Report all five. If any survives, add an assertion and re-verify.

- [ ] **Step 7: Commit**

```bash
git add src/lib/metrics/targeting.ts tests/metrics/targeting.test.ts
git commit -m "feat(spec3b): add pure targeting strategies over KLP candidates"
```

---

### Task 5: Apply the user's tuning in the read API

**Files:**
- Modify: `src/lib/metrics/read.ts`

**Interfaces:**
- Consumes: `getUserTuning` (Task 3); `rankCandidates`, `RankCandidate` (Task 4)
- Produces: `LearnerMetrics.ranked: RankedCandidate[]`; `getLearnerMetrics`'s `bands` parameter becomes optional-override-only

- [ ] **Step 1: Resolve tuning inside the shell**

`getLearnerMetrics` currently accepts `bands?: BandTable` and passes it to `deriveTagScores`. Change it to load the user's tuning when no explicit override is supplied:

```ts
  const tuning = await getUserTuning(userId)
  const effectiveBands = bands ?? tuning.bands
```

Use `effectiveBands` in the existing `deriveTagScores` call. Keep the `bands` parameter — it lets a caller preview a candidate table without saving, which the settings panel needs.

- [ ] **Step 2: Widen the queries `toRankCandidates` needs**

`toRankCandidates` (Task 4) needs four things the shell does not currently fetch. Add each as a query or a `select`, nothing more — the assembly itself is already a tested pure function.

1. **`CardKlp.weight`** — add `weight: true` beside `id: true` on the KLP relation inside `loadCategoryRows`.
2. **Which card each KLP belongs to** — the same relation already walks `assignments -> card -> klps`, so the card id is in hand; carry it out of `toTopicRows` as a `klpCardIds` map, or select `cardId` on the KLP.
3. **`CardProgress.dueAt`** — a new scoped query:

```ts
  const progressRows = await prisma.cardProgress.findMany({
    where: { userId, card: cardScopeWhere },
    select: { cardId: true, dueAt: true },
  })
```

Reuse the same card-scope fragment the other queries use; do not hand-roll a second filter.

4. **Topic readiness** — already produced by `shapeTopicProfile`; read it from the shaped topics rather than recomputing.

- [ ] **Step 3: Assemble, rank, and return**

```ts
  const candidates = toRankCandidates({
    topics: topicProfiles.map((t) => ({
      key: t.key,
      klpIds: klpIdsByTopic[t.key] ?? [],
      readiness: t.readiness,
    })),
    klpWeights,
    knowledge,
    klpCardIds,
    dueByCard: Object.fromEntries(
      progressRows
        .filter((p: { dueAt: Date | null }) => p.dueAt !== null)
        .map((p: { cardId: string; dueAt: Date }) => [p.cardId, p.dueAt]),
    ),
  })

  const ranked = rankCandidates(candidates, tuning.strategy, now)
```

Add `ranked: RankedCandidate[]` to the `LearnerMetrics` interface and include it in the returned object.

Every one of these is a query, a field rename, or a delegation. **If you find yourself writing a conditional or a threshold here, it belongs in `targeting.ts`** — that is the rule this file's exemption from unit tests rests on.

- [ ] **Step 4: Verify**

Run: `npx vitest run tests/metrics && npx vitest run tests/memory && npx tsc --noEmit`
Expected: all PASS.

Confirm by inspection that **no background job, `after()` call, or replay was added** on the tuning path. Bands do not feed BKT, so a band change requires no recomputation — see the Global Constraints.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/read.ts src/lib/metrics/targeting.ts tests/metrics/targeting.test.ts
git commit -m "feat(spec3b): apply the user's bands and strategy in the read API"
```

---

### Task 6: Derive tag scores on the quiz results screen

Spec §3.4. Without this, the first retune makes the results page and the dashboard disagree about the same error.

**Files:**
- Modify: `src/actions/quiz.ts` (`getQuizAttemptSummary`)
- Modify: `src/components/quiz/QuizSummary.tsx`
- Test: `tests/actions/quiz-summary-analysis.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `toStoredTags`, `deriveTagScores` from `@/lib/errors/derive`; `getUserTuning` (Task 3)
- Produces: attempt-summary answers whose `errorTags` carry derived `severity` and `significance`

- [ ] **Step 1: Write the failing test**

Append to `tests/actions/quiz-summary-analysis.test.ts`:

```ts
describe('read-time derivation on the attempt summary (Spec 3B §3.4)', () => {
  it('returns a severity derived from the supplied bands, not the stored value', () => {
    // A tag stored with severity 5 under the default inversion band [2,5],
    // read back under a retuned band [1,2], must report 2 — not 5.
    const stored = toStoredTags([
      {
        dimension: 'accuracy', type: 'inversion', klpId: 'klp1',
        relevance: 3, starred: false, magnitude: 10, mode: 'quiz-sa',
        severity: 5, significance: 9, createdAt: new Date('2026-08-06T00:00:00Z'),
        quizAnswer: { attemptId: 'att1' },
      },
    ])
    const [derived] = deriveTagScores(stored, { inversion: [1, 2] }, ['att1'])
    expect(derived.severity).toBe(2)
    expect(derived.severity).not.toBe(5)
  })

  it('still falls back to the stored severity for a legacy row with no magnitude', () => {
    const stored = toStoredTags([
      {
        dimension: 'accuracy', type: 'inversion', klpId: 'klp1',
        relevance: 3, starred: false, magnitude: null, mode: null,
        severity: 4, significance: 7, createdAt: new Date('2026-08-06T00:00:00Z'),
        quizAnswer: { attemptId: 'att1' },
      },
    ])
    const [derived] = deriveTagScores(stored, { inversion: [1, 2] }, ['att1'])
    expect(derived.severity).toBe(4)
    expect(derived.isLegacy).toBe(true)
  })
})
```

Add the imports at the top of that file:

```ts
import { toStoredTags, deriveTagScores } from '@/lib/errors/derive'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/actions/quiz-summary-analysis.test.ts`
Expected: FAIL — the first case reports 5 until derivation is wired.

Note: if it passes immediately, the imports resolved but the assertion is trivially satisfied — check the fixture actually stores 5, not 2.

- [ ] **Step 3: Derive in the attempt summary**

In `getQuizAttemptSummary` (`src/actions/quiz.ts`), the answers' `errorTags` are returned straight from Prisma. Change it to:

1. Select the fields `toStoredTags` needs on each tag: `magnitude`, `mode`, `severity`, `significance`, `relevance`, `starred`, `dimension`, `type`, `klpId`, `createdAt`, plus the answer's `attemptId`.
2. Load the user's bands with `getUserTuning(userId)`.
3. Map the rows through `toStoredTags`, then `deriveTagScores(stored, bands, attemptOrder)` where `attemptOrder` is this user's attempt ids in chronological order — the same source `read.ts` uses. **Do not derive `attemptOrder` from the tags**; that is the bug Spec 3's own review found, where clean attempts become invisible and `repeatBonus` fires for an error fixed ten sittings ago.
4. Merge the derived `severity`/`significance` back onto each answer's tags before returning.

- [ ] **Step 4: Consume derived values in the component**

`QuizSummary.tsx:148` sorts by `t.significance`, and `rollupSessionAnalysis` sums `tag.significance`. Both now receive derived values, so **no component change is required** — verify that by reading the data path rather than assuming, and only edit if a stored field is read directly somewhere else.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/actions && npx vitest run tests/components && npx tsc --noEmit`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/quiz.ts src/components/quiz/QuizSummary.tsx tests/actions/quiz-summary-analysis.test.ts
git commit -m "feat(spec3b): derive tag scores on the quiz results screen"
```

---

### Task 7: Severity band panel

**Files:**
- Create: `src/components/settings/SeverityBandPanel.tsx`
- Modify: `src/app/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `loadTuning`, `saveTuning` (Task 3); `DEFAULT_BANDS` (`@/lib/errors/bands`); `ACCURACY_TYPES`/`CLARITY_TYPES`/`CONCISENESS_TYPES` (`@/lib/errors/taxonomy`); `labelForErrorType` (`@/lib/errors/labels`)
- Produces: a mounted panel; no exports consumed by later tasks

- [ ] **Step 1: Build the panel**

Follow `src/components/settings/CredentialList.tsx`'s structure — a client component calling the server actions, with `sonner` toasts for success and failure.

Requirements:
- Group types by dimension (accuracy, clarity, conciseness), using the labels from `@/lib/errors/labels` rather than raw keys.
- Each row shows the current band, **the shipped default alongside it**, and a per-type reset. A global reset clears every override.
- Validation mirrors the server: integers 1-5, floor ≤ ceiling. Rejected, not clamped — show the error and leave the input as typed.

- [ ] **Step 2: State the two consequences in the UI**

Both are required by spec §3.2 and neither is discoverable:

- **Editing a band re-scores history.** Severity and significance are derived at read time, so retuning changes what past answers scored. That is intended — the reason to open this panel is "inversions are overweighted *for me*" — but a proposition can move from weak to fine without the learner studying anything, and the panel must say so rather than letting the number quietly shift.
- **Editing one of five accuracy ceilings also changes multiple-choice and true/false scoring.** Those answers carry maximum magnitude and resolve to the ceiling. Someone softening `inversion` to fix short-answer grading will also rescore every MC and TF inversion they have ever answered. Surface this **at the point of edit** on `conflation`, `inversion`, `misapplication`, `overgeneralization`, and `factual_error` — not in a help page.

- [ ] **Step 3: Mount it**

Add `<SeverityBandPanel />` to `src/app/settings/ai/page.tsx` below `<TaskRoutingPanel />`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npx vitest run && npm run lint 2>&1 | tail -3`
Expected: type-check and suite pass; no NEW lint problems (the repo has ~171 pre-existing — compare, do not fix unrelated ones).

Then run the app (`npm run dev`), open `/settings/ai`, and confirm by hand: a band edit saves and reloads; an inverted band is rejected with a readable message; a reset restores the default; the two consequence warnings are visible.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/SeverityBandPanel.tsx src/app/settings/ai/page.tsx
git commit -m "feat(spec3b): add the severity band settings panel"
```

---

### Task 8: Targeting strategy selector

**Files:**
- Create: `src/components/settings/TargetingStrategyPanel.tsx`
- Modify: `src/app/settings/ai/page.tsx`

**Interfaces:**
- Consumes: `loadTuning`, `saveTuning` (Task 3); `STRATEGY_KEYS` (`@/lib/errors/tuning`)
- Produces: a mounted panel

- [ ] **Step 1: Build the selector**

A client component with one choice per strategy, each with a one-line description of who it is for:

| Key | Label | Description |
| --- | --- | --- |
| `shore_up_weaknesses` | Shore up weaknesses | Targets what you know least, weighted by how central it is. Best when the interview is still some way off. |
| `polish_near_ready` | Polish what's nearly ready | Targets material you know but express poorly. Best when the interview is close. |
| `follow_forgetting` | Follow the forgetting curve | Targets what is due or overdue for review. Best for maintenance. |
| `balanced` | Balanced (default) | A blend of all three. |

State plainly that the strategy affects **ordering only** — never which data is recorded, and never the metrics themselves. A learner switching strategies sees the same profile ranked differently, not a different profile.

Saving must preserve the band overrides: `saveTuning` takes both fields, so read the current tuning and send the existing `overrides` alongside the new strategy, or the save will wipe them.

- [ ] **Step 2: Mount it**

Add `<TargetingStrategyPanel />` to `src/app/settings/ai/page.tsx`.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

By hand at `/settings/ai`: selecting a strategy persists across reload, and **changing the strategy does not clear a band override** — set an override first, then change the strategy, then confirm the override survives. That is the regression this step exists to prevent.

- [ ] **Step 4: Commit**

```bash
git add src/components/settings/TargetingStrategyPanel.tsx src/app/settings/ai/page.tsx
git commit -m "feat(spec3b): add the targeting strategy selector"
```

---

## Final verification

- [ ] `npx vitest run` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — no new problems versus the pre-branch baseline
- [ ] Retune a band, then confirm the SAME error shows the SAME severity on both `/profile/memory`-scoped metric reads and the quiz results screen. Disagreement means Task 6 is incomplete.
- [ ] Confirm no background job or replay is triggered by a band save — there must not be one.

## Spec coverage

| Spec section | Task |
| --- | --- |
| §2 data model, sparse overrides, blob rationale | 1, 2 |
| §3.1 panel, validation rejects not clamps | 2, 7 |
| §3.2 the two consequences stated in the UI | 7 |
| §3.3 saving triggers no recomputation | 5 (by omission — asserted in final verification) |
| §3.4 every surface derives | 6 |
| §4 strategies, KLP candidate, observation floor | 4, 5, 8 |
| §5 testing | every task |
| §6 deferred (per-topic overrides) | not implemented, by design |
