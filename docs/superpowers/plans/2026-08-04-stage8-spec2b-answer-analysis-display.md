# Stage 8 Spec 2b — Answer Analysis (Display) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render the `AnswerKlpResult`/`AnswerErrorTag` rows Spec 2a has been writing since its migration, but that nothing reads yet — per-answer, on the results page, plus a same-session rollup. No new AI call, no new write, no new schema.

**Architecture:** `getQuizAttemptSummary` gains two relations to its existing `answers` include. A new pure function (`rollupSessionAnalysis`) aggregates the fetched rows client-side-shaped data with no query of its own. `QuizSummary.tsx` gains a KLP checklist + error-tag badges per answer card, a degradation note for non-`analyzed` statuses, and a new rollup card in the Overall Analysis tab shown for every mode.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (Postgres/Neon), Vitest 4, Testing Library (component tests).

**Spec:** `docs/superpowers/specs/2026-08-04-answer-analysis-display-design.md`
**Frozen reference:** `docs/ai/error-taxonomy.md`
**Builds on:** Spec 2a (`docs/superpowers/specs/2026-08-03-answer-analysis-capture-design.md`), fully implemented.

## Global Constraints

- Test runner is **Vitest**: `npm test` (single run). Config `vitest.config.ts`, `environment: 'node'`, alias `@` → `./src`.
- Tests live in `tests/<area>/<name>.test.ts`, mirroring `src/`.
- **Pure logic goes in `src/lib/`, never in a component or an action.** Standing repo convention — matches Spec 2a's `buildAnalysisWrites`.
- **This spec writes nothing.** No `prisma.*.create`/`update`/`upsert` appears anywhere in this plan. If a task seems to need a write, that's a sign it belongs to a different spec.
- **`analysisWarnings` is never rendered.** Spec 2a's design doc is explicit that it's developer telemetry, not learner-facing.
- **A degraded `analysisStatus` (`no_provenance` | `no_klps` | `failed`) must never render as "clean."** This is the one invariant that would silently defeat the entire point of Spec 2a if it regressed here.
- **A legacy answer (`analysisStatus: null`, predates Spec 2a's migration) renders exactly as it does today.** No new UI for a row that has no analysis to show.
- Commit after every task. Never commit `.env`.

---

## File Structure

**Created:**
- `src/lib/analysis/rollup.ts` — `rollupSessionAnalysis` (pure)
- `src/lib/errors/labels.ts` — human-readable labels for dimension/type strings (pure)
- `tests/analysis/rollup.test.ts`, `tests/errors/labels.test.ts`
- `tests/actions/quiz-summary-analysis.test.ts` — `getQuizAttemptSummary`'s new include
- `tests/setup/jest-dom.ts` — `@testing-library/jest-dom/vitest` matchers, wired via `setupFiles`
- `tests/components/QuizSummary.test.tsx` — this repo's first component test; establishes the RTL/jsdom pattern

**Modified:**
- `src/actions/quiz.ts` — `getQuizAttemptSummary`'s `answers` include gains `klpResults` and `errorTags`
- `src/components/quiz/QuizSummary.tsx` — per-answer KLP checklist + error-tag badges + degradation note; new rollup card in the Overall Analysis tab
- `vitest.config.ts` — adds `setupFiles` for jest-dom matchers (DOM environment itself is opted into per-file, see Task 4)
- `package.json` — new dev dependencies: `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`

**Not built:** anything that writes (no new tags, no re-scoring), anything cross-attempt (Spec 3), anything actionable on a tag (Spec 4).

---

### Task 1: `rollupSessionAnalysis`

**Files:**
- Create: `src/lib/analysis/rollup.ts`
- Test: `tests/analysis/rollup.test.ts`

**Interfaces:**
- Consumes: `Dimension` from `@/lib/errors/taxonomy`; `KlpStatus` from `@/lib/errors/klp-credit`
- Produces: `SessionRollup`, `rollupSessionAnalysis(answers): SessionRollup`

**Why a pure function:** every decision — what counts toward `analyzedCount`, how ties break, how many `struggledKlps` to keep — is arithmetic over already-fetched data. Isolating it means the aggregation is tested without touching Prisma or React, matching the precedent `buildAnalysisWrites` set in Spec 2a.

- [x] **Step 1: Write the failing test**

Create `tests/analysis/rollup.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rollupSessionAnalysis } from '@/lib/analysis/rollup'

// Shape mirrors what getQuizAttemptSummary's extended include will return:
// each answer carries its own analysisStatus, klpResults (with klp.text),
// and errorTags (with klp.text). Only the fields the rollup reads are here.
function answer(overrides: Partial<Parameters<typeof rollupSessionAnalysis>[0][number]>) {
  return {
    analysisStatus: 'analyzed',
    klpResults: [],
    errorTags: [],
    ...overrides,
  }
}

describe('rollupSessionAnalysis', () => {
  it('counts every non-legacy answer toward totalCount, only analyzed ones toward analyzedCount', () => {
    const r = rollupSessionAnalysis([
      answer({ analysisStatus: 'analyzed' }),
      answer({ analysisStatus: 'no_provenance' }),
      answer({ analysisStatus: 'no_klps' }),
      answer({ analysisStatus: null as any }), // legacy, pre-Spec-2a — excluded, see next test
    ])
    expect(r.totalCount).toBe(3)
    expect(r.analyzedCount).toBe(1)
  })

  it('excludes null (legacy) rows from totalCount entirely', () => {
    // A null predates analysis EXISTING, not a case where it was attempted
    // and failed. Counting it as "not analyzed out of N" overstates how much
    // of a real, post-spec session went unanalyzed.
    const r = rollupSessionAnalysis([
      answer({ analysisStatus: 'analyzed' }),
      answer({ analysisStatus: null as any }),
    ])
    expect(r.totalCount).toBe(1)
    expect(r.analyzedCount).toBe(1)
  })

  it('only aggregates errors from analyzed answers', () => {
    const r = rollupSessionAnalysis([
      answer({
        analysisStatus: 'no_provenance',
        errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 9 }],
      }),
    ])
    expect(r.errorsByDimension.accuracy).toBe(0)
    expect(r.errorsByType).toEqual([])
  })

  it('tallies errorsByDimension across analyzed answers', () => {
    const r = rollupSessionAnalysis([
      answer({ errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
      answer({ errorTags: [{ dimension: 'clarity', type: 'hedging', klpId: null, significance: 3 }] }),
    ])
    expect(r.errorsByDimension).toEqual({ accuracy: 2, clarity: 1, conciseness: 0 })
  })

  it('sorts errorsByType by count desc, ties broken by total significance', () => {
    const r = rollupSessionAnalysis([
      answer({ errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 9 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
      answer({ errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-b', significance: 2 }] }),
    ])
    expect(r.errorsByType[0]).toMatchObject({ type: 'factual_error', count: 2 })
    expect(r.errorsByType[1]).toMatchObject({ type: 'inversion', count: 1 })
  })

  it('groups struggledKlps by klpId across DIFFERENT answers, not per-question', () => {
    const r = rollupSessionAnalysis([
      answer({ klpResults: [{ klpId: 'klp-a', status: 'failed' }], errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5 }] }),
      answer({ klpResults: [{ klpId: 'klp-a', status: 'failed' }], errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-a', significance: 3 }] }),
      answer({ klpResults: [{ klpId: 'klp-b', status: 'passed' }] }),
    ])
    expect(r.struggledKlps).toHaveLength(1)
    expect(r.struggledKlps[0]).toMatchObject({ klpId: 'klp-a', failCount: 2, totalSignificance: 8 })
  })

  it('does not count a passed or partial KLP result as a struggle', () => {
    const r = rollupSessionAnalysis([
      answer({ klpResults: [{ klpId: 'klp-a', status: 'passed' }] }),
      answer({ klpResults: [{ klpId: 'klp-b', status: 'partial' }] }),
    ])
    expect(r.struggledKlps).toEqual([])
  })

  it('caps struggledKlps at 5, keeping the highest failCount', () => {
    const answers = Array.from({ length: 7 }, (_, i) =>
      answer({ klpResults: [{ klpId: `klp-${i}`, status: 'failed' }] }),
    )
    const r = rollupSessionAnalysis(answers)
    expect(r.struggledKlps).toHaveLength(5)
  })

  it('handles an empty session', () => {
    const r = rollupSessionAnalysis([])
    expect(r).toEqual({
      analyzedCount: 0, totalCount: 0,
      errorsByDimension: { accuracy: 0, clarity: 0, conciseness: 0 },
      errorsByType: [], struggledKlps: [],
    })
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/analysis/rollup.test.ts`
Expected: FAIL — cannot resolve `@/lib/analysis/rollup`.

- [x] **Step 3: Implement**

Create `src/lib/analysis/rollup.ts`:

```ts
import { DIMENSIONS, type Dimension } from '@/lib/errors/taxonomy'
import type { KlpStatus } from '@/lib/errors/klp-credit'
import type { AnalysisOutcome } from './persist'

const MAX_STRUGGLED_KLPS = 5

export interface RollupKlpResult {
  klpId: string
  status: KlpStatus
}

export interface RollupErrorTag {
  dimension: Dimension
  type: string
  klpId: string | null
  significance: number
}

export interface RollupAnswer {
  analysisStatus: AnalysisOutcome | null
  klpResults: RollupKlpResult[]
  errorTags: RollupErrorTag[]
}

export interface SessionRollup {
  analyzedCount: number
  totalCount: number
  errorsByDimension: Record<Dimension, number>
  errorsByType: { type: string; dimension: Dimension; count: number }[]
  struggledKlps: { klpId: string; failCount: number; totalSignificance: number }[]
}

/**
 * Same-session tally of what Spec 2a already captured. No AI call, no query —
 * pure arithmetic over rows the caller already fetched.
 *
 * Deliberately NOT a mastery score, a BKT update, or anything cross-attempt —
 * that's Spec 3, which needs a real corpus and per-KLP history this function
 * never sees. This only describes the one session on screen.
 */
export function rollupSessionAnalysis(answers: RollupAnswer[]): SessionRollup {
  // A null analysisStatus predates Spec 2a's migration entirely — it is not
  // "attempted and failed," so it is excluded from totalCount, not just from
  // analyzedCount. Counting it would overstate how much of a real, post-spec
  // session went unanalyzed.
  const counted = answers.filter((a) => a.analysisStatus !== null)
  const analyzed = counted.filter((a) => a.analysisStatus === 'analyzed')

  const errorsByDimension: Record<Dimension, number> = {
    accuracy: 0, clarity: 0, conciseness: 0,
  }
  const typeCounts = new Map<string, { dimension: Dimension; count: number; significance: number }>()
  const klpStruggles = new Map<string, { failCount: number; totalSignificance: number }>()

  for (const a of analyzed) {
    for (const tag of a.errorTags) {
      errorsByDimension[tag.dimension]++
      const key = tag.type
      const entry = typeCounts.get(key) ?? { dimension: tag.dimension, count: 0, significance: 0 }
      entry.count++
      entry.significance += tag.significance
      typeCounts.set(key, entry)

      if (tag.klpId) {
        const s = klpStruggles.get(tag.klpId) ?? { failCount: 0, totalSignificance: 0 }
        s.totalSignificance += tag.significance
        klpStruggles.set(tag.klpId, s)
      }
    }

    for (const r of a.klpResults) {
      if (r.status !== 'failed') continue
      const s = klpStruggles.get(r.klpId) ?? { failCount: 0, totalSignificance: 0 }
      s.failCount++
      klpStruggles.set(r.klpId, s)
    }
  }

  const errorsByType = [...typeCounts.entries()]
    .map(([type, v]) => ({ type, dimension: v.dimension, count: v.count, _sig: v.significance }))
    .sort((a, b) => b.count - a.count || b._sig - a._sig)
    .map(({ type, dimension, count }) => ({ type, dimension, count }))

  const struggledKlps = [...klpStruggles.entries()]
    .filter(([, v]) => v.failCount > 0)
    .map(([klpId, v]) => ({ klpId, failCount: v.failCount, totalSignificance: v.totalSignificance }))
    .sort((a, b) => b.failCount - a.failCount || b.totalSignificance - a.totalSignificance)
    .slice(0, MAX_STRUGGLED_KLPS)

  return {
    analyzedCount: analyzed.length,
    totalCount: counted.length,
    errorsByDimension,
    errorsByType,
    struggledKlps,
  }
}
```

Note: `struggledKlps` in the test fixtures above omits `text` — the pure function only knows ids. §Task 4 below joins `text` back in the component from the same `klpResults`/`errorTags` the caller already has, since the rollup function has no reason to carry display strings.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/analysis/rollup.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/analysis/rollup.ts tests/analysis/rollup.test.ts
git commit -m "feat(analysis): add the pure same-session analysis rollup"
```

---

### Task 2: Human-readable labels

**Files:**
- Create: `src/lib/errors/labels.ts`
- Test: `tests/errors/labels.test.ts`

**Interfaces:**
- Consumes: `ACCURACY_TYPES`, `CLARITY_TYPES`, `CONCISENESS_TYPES` from `@/lib/errors/taxonomy`
- Produces: `labelForErrorType(type: string): string`, `labelForKlpStatus(status: KlpStatus): string`

**Why:** `factual_error` and `unsupported_leap` are good persisted identifiers and bad UI copy. One lookup table avoids the humanization logic (or worse, ad-hoc string replaces) getting duplicated per call site — same reasoning as `taxonomy.ts` itself.

- [x] **Step 1: Write the failing test**

Create `tests/errors/labels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'
import { KLP_STATUSES } from '@/lib/errors/klp-credit'
import { labelForErrorType, labelForKlpStatus } from '@/lib/errors/labels'

describe('labelForErrorType', () => {
  it('has a label for every type in every dimension', () => {
    for (const t of [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]) {
      const label = labelForErrorType(t)
      expect(label.length).toBeGreaterThan(0)
      expect(label).not.toContain('_') // humanized, not the raw snake_case
    }
  })

  it('falls back to a de-slugged version of an unrecognized type rather than throwing', () => {
    // Defence in depth: the vocabulary can grow; a missing label entry should
    // degrade gracefully, not crash the results page.
    expect(() => labelForErrorType('some_new_type')).not.toThrow()
    expect(labelForErrorType('some_new_type')).not.toContain('_')
  })
})

describe('labelForKlpStatus', () => {
  it('has a label for every status', () => {
    for (const s of KLP_STATUSES) {
      expect(labelForKlpStatus(s).length).toBeGreaterThan(0)
    }
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/errors/labels.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/labels`.

- [x] **Step 3: Implement**

Create `src/lib/errors/labels.ts`:

```ts
import type { KlpStatus } from './klp-credit'

const ERROR_TYPE_LABELS: Record<string, string> = {
  omission: 'Omission', incomplete: 'Incomplete', conflation: 'Conflation',
  inversion: 'Inversion', misapplication: 'Misapplication',
  factual_error: 'Factual error', overgeneralization: 'Overgeneralization',
  unsupported_leap: 'Unsupported leap', fabrication: 'Fabrication',
  disorganized: 'Disorganized', no_thesis: 'No clear thesis',
  ambiguous_referent: 'Ambiguous referent', undefined_jargon: 'Undefined jargon',
  hedging: 'Hedging', incoherent_syntax: 'Incoherent syntax',
  rambling: 'Rambling', padding: 'Padding', redundancy: 'Redundancy',
  over_qualification: 'Over-qualification', kitchen_sink: 'Kitchen sink',
  too_terse: 'Too terse',
}

/** De-slugs an unrecognized type rather than throwing — the vocabulary can grow. */
function deSlug(s: string): string {
  const words = s.split('_')
  return words.map((w, i) => (i === 0 ? w[0]?.toUpperCase() + w.slice(1) : w)).join(' ')
}

export function labelForErrorType(type: string): string {
  return ERROR_TYPE_LABELS[type] ?? deSlug(type)
}

const KLP_STATUS_LABELS: Record<KlpStatus, string> = {
  passed: 'Covered', partial: 'Partially covered', failed: 'Missed',
}

export function labelForKlpStatus(status: KlpStatus): string {
  return KLP_STATUS_LABELS[status]
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/errors/labels.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/errors/labels.ts tests/errors/labels.test.ts
git commit -m "feat(errors): add human-readable labels for error types and KLP status"
```

---

### Task 3: Extend `getQuizAttemptSummary`'s include

**Files:**
- Modify: `src/actions/quiz.ts` (`getQuizAttemptSummary`, `:1065`)
- Test: `tests/actions/quiz-summary-analysis.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `attempt.answers[].klpResults`, `attempt.answers[].errorTags`, each with their `klp`/`secondaryKlp` text joined in

- [x] **Step 1: Write the failing test**

Create `tests/actions/quiz-summary-analysis.test.ts` following the `vi.hoisted()` + `vi.mock()` pattern in `tests/actions/analysis-mc-tf.test.ts` (mock `@/auth`, `@/lib/db`):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  attemptFindUnique: vi.fn(),
  optionCacheFindMany: vi.fn(),
}))

vi.mock('@/auth', () => ({ auth: h.auth }))
vi.mock('@/lib/db', () => ({
  prisma: {
    quizAttempt: { findUnique: h.attemptFindUnique },
    quizOptionCache: { findMany: h.optionCacheFindMany },
  },
}))

import { getQuizAttemptSummary } from '@/actions/quiz'

const OWNER = 'user-owner'

beforeEach(() => {
  vi.clearAllMocks()
  h.auth.mockResolvedValue({ user: { id: OWNER } })
  h.optionCacheFindMany.mockResolvedValue([])
})

describe('getQuizAttemptSummary — analysis include', () => {
  it('fetches klpResults and errorTags with their KLP text joined in', async () => {
    h.attemptFindUnique.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null,
      answers: [{
        id: 'ans1', mode: 'multiple-choice', analysisStatus: 'analyzed',
        klpResults: [{ klpId: 'klp-a', status: 'failed', credit: 0, klp: { text: 'EBITDA excludes interest', kind: 'definition' } }],
        errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 7, klp: { text: 'EBITDA excludes interest', kind: 'definition' }, secondaryKlp: null }],
        card: { contentBlocks: [] },
      }],
    })

    const result = await getQuizAttemptSummary('a1')

    expect(result.success).toBe(true)
    if (!result.success) throw new Error(result.error)
    expect(result.data.attempt.answers[0].klpResults[0].klp.text).toBe('EBITDA excludes interest')
    expect(result.data.attempt.answers[0].errorTags[0].dimension).toBe('accuracy')

    // Regression guard on the actual query shape, not just the mocked return.
    const includeArg = h.attemptFindUnique.mock.calls[0][0].include.answers.include
    expect(includeArg).toHaveProperty('klpResults')
    expect(includeArg).toHaveProperty('errorTags')
  })

  it('does not throw when an error tag has a null klp (deleted card, or a whole-answer tag)', async () => {
    h.attemptFindUnique.mockResolvedValue({
      id: 'a1', userId: OWNER, session: null,
      answers: [{
        id: 'ans1', mode: 'short-answer', analysisStatus: 'analyzed',
        klpResults: [],
        errorTags: [{ dimension: 'conciseness', type: 'rambling', klpId: null, significance: 3, klp: null, secondaryKlp: null }],
        card: { contentBlocks: [] },
      }],
    })

    const result = await getQuizAttemptSummary('a1')
    expect(result.success).toBe(true)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/actions/quiz-summary-analysis.test.ts`
Expected: FAIL — `includeArg` has no `klpResults`/`errorTags` keys.

- [x] **Step 3: Implement**

In `src/actions/quiz.ts`, extend `getQuizAttemptSummary`'s `answers.include`:

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

No other change to the function — the rest of `getQuizAttemptSummary` (MC option cache resolution, insight parsing) is untouched.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/actions/quiz-summary-analysis.test.ts`
Expected: PASS.

- [x] **Step 5: Verify no regression**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/actions/quiz.ts tests/actions/quiz-summary-analysis.test.ts
git commit -m "feat(quiz): fetch klpResults and errorTags in the attempt summary"
```

---

### Task 4: Per-answer display in `QuizSummary.tsx`

**Files:**
- Modify: `src/components/quiz/QuizSummary.tsx`
- Test: `tests/components/QuizSummary.test.tsx` (create if absent)

**Interfaces:**
- Consumes: Tasks 1, 2 (labels only, not rollup — rollup is Task 5), the extended `answer.klpResults`/`answer.errorTags` from Task 3
- Produces: a KLP checklist + error-tag badge row on each per-answer `Card` in the Individual Review tab; a degradation note for non-`analyzed` statuses

**Design (spec §2, §4):**
- `passed`/`partial`/`failed` KLP rows render as a small checklist using `labelForKlpStatus` and the KLP's `text` — never an id.
- Error tags render as badges: dimension sets color family, `labelForErrorType(type)` is the text, `quote` (if present) renders below using the same `ExpandableText` pattern already used for matching answers.
- `significance` is NOT shown as a raw number — used only to order multiple tags on one answer (already sorted server-side is fine, or sort client-side by significance desc).
- Zero tags on `analysisStatus: 'analyzed'` → render nothing extra (clean answer).
- `no_provenance` / `no_klps` / `failed` → one muted line per spec §4's table. Use a shared small component, e.g. `AnalysisDegradedNote({ status })`, so the three cases can't drift into three different copy styles.
- `analysisStatus: null` (legacy) → render nothing extra, identical to today.

- [x] **Step 1: Write the failing test**

Create or extend `tests/components/QuizSummary.test.tsx`. **This repo had no RTL/jsdom setup at all before this task** — resolved by installing `@testing-library/react`, `@testing-library/jest-dom`, and `jsdom` as dev dependencies, adding `setupFiles: ['./tests/setup/jest-dom.ts']` to `vitest.config.ts`, and opting each `.test.tsx` file into a DOM environment individually via a `// @vitest-environment jsdom` docblock as its **first line** — Vitest 4 does not honor `environmentMatchGlobs` the way prior majors did (confirmed empirically: config-level `environmentMatchGlobs` still threw `document is not defined`), so the per-file docblock is the only mechanism that actually works here.

**Also:** this repo's `vitest.config.ts` has no `test.globals: true`, which is what RTL's automatic `afterEach(cleanup)` normally hooks into. Without an explicit `afterEach(cleanup)` in the test file, one test's rendered DOM bleeds into the next test's queries — a real failure this plan's authoring run hit (a stale "no_provenance" note from a prior test showed up in a later test asserting nothing should render). Every component test file needs its own explicit `afterEach(cleanup)`.

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QuizSummary } from '@/components/quiz/QuizSummary'

afterEach(cleanup)

vi.mock('@/actions/quiz', () => ({
  getQuizAttemptSummary: vi.fn(),
}))
import { getQuizAttemptSummary } from '@/actions/quiz'

function baseAnswer(overrides: Record<string, unknown>) {
  return {
    id: 'ans1', mode: 'multiple-choice', isCorrect: false,
    correctAnswer: 'B', selectedOption: 'A', options: ['A', 'B'],
    card: { term: 'Q', contentBlocks: [] },
    klpResults: [], errorTags: [], analysisStatus: 'analyzed',
    ...overrides,
  }
}

describe('QuizSummary — analysis display', () => {
  it('renders a KLP checklist entry using the KLP text, not an id', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({
            klpResults: [{ klpId: 'klp-a', status: 'failed', klp: { text: 'EBITDA excludes interest expense' } }],
          })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/EBITDA excludes interest expense/))
    expect(screen.queryByText('klp-a')).not.toBeInTheDocument()
  })

  it('renders an error tag with a humanized label, not the raw type string', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({
            errorTags: [{ dimension: 'accuracy', type: 'factual_error', klpId: 'klp-a', significance: 5, klp: { text: 'x' } }],
          })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/Factual error/))
    expect(screen.queryByText('factual_error')).not.toBeInTheDocument()
  })

  it('shows a degraded note for no_provenance, not silence', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({ analysisStatus: 'no_provenance' })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText(/wasn't available/i))
  })

  it('renders nothing extra for a legacy answer with analysisStatus null', async () => {
    (getQuizAttemptSummary as any).mockResolvedValue({
      success: true,
      data: {
        attempt: {
          mode: 'multiple-choice',
          answers: [baseAnswer({ analysisStatus: null })],
        },
        insight: null,
      },
    })

    render(<QuizSummary setId="s1" attemptId="a1" />)
    await waitFor(() => screen.getByText('Q')) // the card renders
    expect(screen.queryByText(/wasn't available/i)).not.toBeInTheDocument()
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/QuizSummary.test.tsx`
Expected: FAIL — no KLP checklist or tag badges render yet.

- [x] **Step 3: Implement**

In `src/components/quiz/QuizSummary.tsx`:

1. Import `labelForErrorType`, `labelForKlpStatus` from `@/lib/errors/labels`.
2. Add a small `AnalysisDegradedNote({ status }: { status: string })` component rendering the muted copy from spec §4's table (`no_provenance` / `no_klps` / `failed`; return `null` for `'analyzed'` or `null`).
3. Add a `KlpChecklist({ results }: { results: any[] })` component: one row per result, icon + `labelForKlpStatus(status)` + the KLP's `text`. Return `null` for an empty array.
4. Add an `ErrorTagBadges({ tags }: { tags: any[] })` component: sort by `significance` desc, render a `Badge` per tag colored by `dimension`, `labelForErrorType(type)` as the label, `quote` (if present) below via `ExpandableText`. Return `null` for an empty array.
5. In the per-answer `Card` in the Individual Review tab (`:234-301`), after the existing mode-specific result block and before the `grade`/`feedback` block, render:
   ```tsx
   <AnalysisDegradedNote status={answer.analysisStatus} />
   <KlpChecklist results={answer.klpResults ?? []} />
   <ErrorTagBadges tags={answer.errorTags ?? []} />
   ```
   All three already no-op (render `null`) on empty/absent data, so this is safe for legacy answers without touching the existing conditional tree around them.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/QuizSummary.test.tsx`
Expected: PASS.

- [x] **Step 5: Verify no regression**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — existing `QuizSummary` behavior (MC option grid, SA grade factors, matching review) is unchanged; this task is additive.

- [x] **Step 6: Commit**

```bash
git add src/components/quiz/QuizSummary.tsx tests/components/QuizSummary.test.tsx
git commit -m "feat(quiz): render per-answer KLP checklist and error tags on results"
```

---

### Task 5: Session rollup card

**Files:**
- Modify: `src/components/quiz/QuizSummary.tsx`
- Test: `tests/components/QuizSummary.test.tsx` (extend)

**Interfaces:**
- Consumes: Task 1's `rollupSessionAnalysis`, Task 2's labels
- Produces: a new card in the `summary` `TabsContent`, shown for every mode, placed below `SessionInsightView` when that's present

**Design (spec §3):** call `rollupSessionAnalysis(attempt.answers)` once, near the top of the component (same place `groupedAnswers` is already computed). Render:
- "N of M questions analyzed" (the honesty line — always shown, even when N === M, so its absence is never itself a signal)
- Error breakdown by dimension (only dimensions with count > 0)
- Top struggled KLPs (join `text` back in from the answers' own `klpResults`/`errorTags` — the rollup only returns ids)
- If `analyzedCount === 0`: render nothing beyond the "N of M" line — an empty breakdown with headers and no content reads as broken, not clean.

- [x] **Step 1: Write the failing test**

Extend `tests/components/QuizSummary.test.tsx`. **`TabsContent` in this repo's `src/components/ui/tabs.tsx` returns `null` while inactive** — a custom implementation, not Radix, so there's no CSS-hidden fallback to query against — and the default tab is `"review"`. Every rollup test must click "Overall Analysis" first:

```tsx
async function switchToOverallAnalysis() {
  await waitFor(() => screen.getByText('Overall Analysis'))
  fireEvent.click(screen.getByText('Overall Analysis'))
}

it('shows the session rollup for a NON-short-answer attempt (unlike SessionInsightView, not gated to short-answer)', async () => {
  (getQuizAttemptSummary as any).mockResolvedValue({
    success: true,
    data: {
      attempt: {
        mode: 'multiple-choice',
        answers: [
          baseAnswer({ errorTags: [{ dimension: 'accuracy', type: 'inversion', klpId: 'klp-a', significance: 5, klp: { text: 'X' } }] }),
          baseAnswer({ id: 'ans2', analysisStatus: 'no_provenance' }),
        ],
      },
      insight: null,
    },
  })

  render(<QuizSummary setId="s1" attemptId="a1" />)
  await switchToOverallAnalysis()
  await waitFor(() => screen.getByText(/1 of 2 questions analyzed/i))
})

it('does not render an empty breakdown when analyzedCount is 0', async () => {
  (getQuizAttemptSummary as any).mockResolvedValue({
    success: true,
    data: {
      attempt: {
        mode: 'multiple-choice',
        answers: [baseAnswer({ analysisStatus: 'no_klps' })],
      },
      insight: null,
    },
  })

  render(<QuizSummary setId="s1" attemptId="a1" />)
  await switchToOverallAnalysis()
  await waitFor(() => screen.getByText(/0 of 1 questions analyzed/i))
  expect(screen.queryByText(/Accuracy/)).not.toBeInTheDocument()
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/components/QuizSummary.test.tsx -t "rollup"`
Expected: FAIL — no rollup card exists yet.

- [x] **Step 3: Implement**

In `src/components/quiz/QuizSummary.tsx`, near the existing `groupedAnswers` computation:

```tsx
const rollup = rollupSessionAnalysis(attempt.answers.map((a: any) => ({
  analysisStatus: a.analysisStatus,
  klpResults: a.klpResults ?? [],
  errorTags: a.errorTags ?? [],
})));

// Join display text back in — the pure rollup only carries ids.
const klpTextById = new Map<string, string>();
for (const a of attempt.answers) {
  for (const r of a.klpResults ?? []) if (r.klp?.text) klpTextById.set(r.klpId, r.klp.text);
  for (const t of a.errorTags ?? []) if (t.klp?.text && t.klpId) klpTextById.set(t.klpId, t.klp.text);
}
```

Add a `SessionRollupCard({ rollup, klpTextById }: {...})` component rendered inside the `summary` `TabsContent`, **unconditionally** (not gated by `attempt.mode === 'short-answer'` the way `SessionInsightView` is) — placed below the existing `SessionInsightView` block when that renders, or as the only analysis content otherwise:
- Always: `"{analyzedCount} of {totalCount} questions analyzed"`.
- If `analyzedCount > 0`: a row per dimension in `errorsByDimension` with `count > 0` (skip zero-count dimensions rather than listing all three every time); a short list of `struggledKlps` using `klpTextById.get(klpId)` for display text (fall back to omitting the entry if the id somehow isn't in the map rather than rendering a raw id).
- If `analyzedCount === 0`: nothing further.

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/components/QuizSummary.test.tsx`
Expected: PASS.

- [x] **Step 5: Verify no regression**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/quiz/QuizSummary.tsx tests/components/QuizSummary.test.tsx
git commit -m "feat(quiz): add the same-session analysis rollup to results"
```

---

## Done when

- `getQuizAttemptSummary` returns `klpResults` and `errorTags` for every answer, with KLP text joined in.
- Every analyzed MC/TF/SA answer on the results page shows which KLPs it hit or missed and what kind of error it made, where one exists — previously true only in the database, never on screen.
- A `no_provenance`/`no_klps`/`failed` answer visibly says analysis wasn't available, rather than looking clean.
- A legacy (pre-Spec-2a) answer renders identically to today — zero regression.
- The Overall Analysis tab shows a same-session rollup for every quiz mode, not just short-answer, sitting alongside — not replacing — the existing `SessionInsightView`.
- Nothing here writes to the database or calls `generateJson`. Everything is a read and a render.
