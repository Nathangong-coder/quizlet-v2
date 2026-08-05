# Stage 8 Spec 2a — Answer Analysis (Capture) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-08-04): Done.** All 11 tasks were implemented and committed (see
`git log` for commit messages matching each task's suggested message
verbatim), but the checkboxes below were never checked off as work landed —
this was noticed and corrected retroactively, after independently verifying
every task's code and tests exist and match this plan, and after separately
arriving at Task 11's cascade-pinning test (§4.1 of the design doc) before
realizing it was already specified here. Nothing in this plan is outstanding.

**Goal:** Every quiz answer records which Key Learning Points it hit or missed, and what kind of error it made, as queryable relational rows — so Spec 3 can aggregate a real diagnostic profile instead of re-deriving one from prose.

**Architecture:** Two new tables (`AnswerKlpResult`, `AnswerErrorTag`) hang off `QuizAnswer` and cascade with it. Short answer gets its KLP results and error tags from the *existing* grading call — same prompt module, same transaction, no new AI cost. Multiple choice and true/false derive theirs with **zero AI calls**, by reading the distractor provenance Spec 1 already persists on `QuizQuestion`. Every number (significance, KLP credit, severity) is computed in TypeScript from pure functions; the AI supplies only categorical judgments and a 1-5 severity ordinal.

**Tech Stack:** Next.js 16 App Router, React 19, Prisma 7 (Postgres/Neon), Vercel AI SDK v7, Zod 4, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-03-answer-analysis-capture-design.md`
**Frozen reference:** `docs/ai/error-taxonomy.md` — the vocabularies and the significance formula are settled there; do not re-derive them.
**Builds on:** Spec 1 (`4816578..a0b5ac3`) — `CardKlp`, `QuizQuestion`, distractor provenance.

## Global Constraints

- Test runner is **Vitest**: `npm test` (single run). Config `vitest.config.ts`, `environment: 'node'`, alias `@` → `./src`.
- Tests live in `tests/<area>/<name>.test.ts`, mirroring `src/`.
- **Pure logic goes in `src/lib/`, never in an action.** Standing repo convention.
- **AI never computes a number.** It returns categorical judgments (`passed|partial|failed`) and one 1-5 severity ordinal. Every score, credit, and weight is computed in TypeScript.
- **The model must never see a raw cuid.** KLPs go to prompts as `ref` indices; ids are mapped back after.
- Server actions are tested by mocking `@/lib/db`, `@/lib/ai/generate`, and `@/auth` with `vi.hoisted()` + `vi.mock()`. Precedents: `tests/actions/klp.test.ts`, `tests/actions/quiz-options.test.ts`, `tests/actions/true-false.test.ts`.
- `AI_TASKS` are exactly `grade | plan | distractors | autocomplete`. Grading uses `'grade'`. Do not invent a task value.
- Every `generateJson` call passes a Zod schema and is validated before persisting.
- **Degradation never fabricates.** A missing target, an unknown type, an unresolvable ref — each drops that one tag and records why. Never a default.
- Commit after every task. Never commit `.env`.

---

## File Structure

**Created:**
- `src/lib/errors/taxonomy.ts` — the closed vocabularies + dimension weights
- `src/lib/errors/significance.ts` — `computeSignificance` (pure)
- `src/lib/errors/severity.ts` — `CORRUPTION_SEVERITY` + `severityFromCorruption` (pure)
- `src/lib/errors/klp-credit.ts` — `STATUS_CREDIT`, `EVIDENCE_STRENGTH`, `klpCredit` (pure)
- `src/lib/quiz/mode.ts` — `QUIZ_MODES`, `toStudySource` (pure)
- `src/lib/analysis/persist.ts` — `buildAnalysisWrites` (pure) + `writeAnalysis` (tx helper)
- `tests/errors/taxonomy.test.ts`, `tests/errors/significance.test.ts`, `tests/errors/severity.test.ts`, `tests/errors/klp-credit.test.ts`, `tests/quiz/mode.test.ts`, `tests/analysis/persist.test.ts`, `tests/actions/analysis-mc-tf.test.ts`, `tests/actions/analysis-short-answer.test.ts`

**Modified:**
- `prisma/schema.prisma` — `AnswerKlpResult`, `AnswerErrorTag`, `QuizAnswer` analysis columns
- `src/lib/ai/schemas.ts` — extend `ShortAnswerGradeSchema`
- `src/lib/ai/prompts/grade-short-answer.ts` — KLP + error-tag instructions, version bump
- `src/actions/quiz.ts` — analysis writes in `submitShortAnswer`, `submitMultipleChoiceAnswer`, `submitTrueFalseAnswer`
- `tests/ai/prompts.test.ts` — extend

**Not built:** the results UI and the session rollup are Spec 2b. Nothing in this plan renders a tag.

---

## A note on `submitShortAnswer`

`src/actions/quiz.ts:563-757` has **two near-duplicate paths** — text-only (`:608`) and multimodal (`:673`) — each with its own `generateJson` call, its own `quizAnswer.create`, its own `recordStudyEvent`, and its own score recompute. Neither runs in a transaction.

This plan does **not** refactor that duplication away. It adds the analysis write to both paths via one shared helper (Task 7), so the new logic exists once even though its two call sites do not. Collapsing the two paths is a real improvement but it is not this spec's job, and doing it here would put a risky refactor inside a data-capture change.

---

### Task 1: The vocabulary module and its subset invariant

**Files:**
- Create: `src/lib/errors/taxonomy.ts`
- Test: `tests/errors/taxonomy.test.ts`

**Interfaces:**
- Consumes: `CORRUPTIONS` from `@/lib/quiz/options`
- Produces: `ACCURACY_TYPES`, `CLARITY_TYPES`, `CONCISENESS_TYPES`, `DIMENSIONS`, `DIM_WEIGHTS`, `MAX_TAGS_PER_ANSWER`, `MAX_TAGS_PER_DIMENSION`; types `Dimension`, `ErrorType`; `typesForDimension(d)`; `validateTagType(dimension, type)`

- [x] **Step 1: Write the failing test**

Create `tests/errors/taxonomy.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CORRUPTIONS } from '@/lib/quiz/options'
import {
  ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES,
  DIMENSIONS, DIM_WEIGHTS, typesForDimension, validateTagType,
} from '@/lib/errors/taxonomy'

describe('the CORRUPTIONS subset invariant', () => {
  it('every corruption is a valid accuracy error type', () => {
    // MC/TF write a distractor's `corruption` DIRECTLY as an error `type`.
    // If these lists drift, those tags land on a type the taxonomy does not
    // know and NOTHING throws — `type` is a String column. This test turns a
    // silent data-corruption bug into a build failure.
    for (const c of CORRUPTIONS) {
      expect(ACCURACY_TYPES).toContain(c)
    }
  })

  it('is a STRICT subset — accuracy has types no corruption can express', () => {
    // omission/incomplete/unsupported_leap/fabrication describe what a learner
    // does, not recipes for building a wrong option. The asymmetry is the
    // design; asserting the reverse would force nonsense into CORRUPTIONS.
    const extras = ACCURACY_TYPES.filter((t) => !CORRUPTIONS.includes(t as never))
    expect(extras).toEqual([
      'omission', 'incomplete', 'unsupported_leap', 'fabrication',
    ])
  })
})

describe('vocabularies', () => {
  it('has no duplicate type across dimensions', () => {
    // A type appearing in two dimensions would make `validateTagType`
    // ambiguous and let the same string aggregate under two weights.
    const all = [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]
    expect(new Set(all).size).toBe(all.length)
  })

  it('weights every dimension, accuracy highest', () => {
    for (const d of DIMENSIONS) expect(DIM_WEIGHTS[d]).toBeGreaterThan(0)
    expect(DIM_WEIGHTS.accuracy).toBe(1.0)
    expect(DIM_WEIGHTS.clarity).toBe(0.8)
    expect(DIM_WEIGHTS.conciseness).toBe(0.7)
  })

  it('maps each dimension to its own vocabulary', () => {
    expect(typesForDimension('accuracy')).toEqual(ACCURACY_TYPES)
    expect(typesForDimension('clarity')).toEqual(CLARITY_TYPES)
    expect(typesForDimension('conciseness')).toEqual(CONCISENESS_TYPES)
  })
})

describe('validateTagType', () => {
  it('accepts a type belonging to its dimension', () => {
    expect(validateTagType('accuracy', 'inversion')).toBe(true)
    expect(validateTagType('conciseness', 'rambling')).toBe(true)
  })

  it('rejects a valid type paired with the WRONG dimension', () => {
    // The model can emit a real type under the wrong heading; that tag is
    // dropped rather than filed under a weight it was not judged against.
    expect(validateTagType('clarity', 'inversion')).toBe(false)
  })

  it('rejects a type in no vocabulary', () => {
    expect(validateTagType('accuracy', 'vibes')).toBe(false)
  })

  it('rejects an unknown dimension', () => {
    expect(validateTagType('delivery' as never, 'inversion')).toBe(false)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/errors/taxonomy.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/taxonomy`.

- [x] **Step 3: Implement**

Create `src/lib/errors/taxonomy.ts`:

```ts
/**
 * The closed error vocabularies from docs/ai/error-taxonomy.md §2.
 *
 * CLOSED is the whole point. A model left to free-form emits `rambling`,
 * `verbose`, `wordy`, `too long` and `unfocused` across five sessions — five
 * rows that should have been one, and the aggregate profile becomes noise.
 * Specificity belongs in the tag's TARGET (which KLP), never in its type.
 */

/** Content correctness. The richest dimension — most predictive signal. */
export const ACCURACY_TYPES = [
  'omission',            // KLP never mentioned
  'incomplete',          // named but not explained
  'conflation',          // described X using Y's content — carries secondaryKlpId
  'inversion',           // direction, sign, or causality reversed
  'misapplication',      // right concept, wrong context
  'factual_error',       // discrete wrong fact, number, or formula term
  'overgeneralization',  // "always"/"never" on a conditional
  'unsupported_leap',    // conclusion does not follow from stated steps
  'fabrication',         // invented mechanism or terminology
] as const

/** Can a listener follow it. */
export const CLARITY_TYPES = [
  'disorganized', 'no_thesis', 'ambiguous_referent',
  'undefined_jargon', 'hedging', 'incoherent_syntax',
] as const

/** Signal per word. Fails in BOTH directions — see `too_terse`. */
export const CONCISENESS_TYPES = [
  'rambling', 'padding', 'redundancy',
  'over_qualification', 'kitchen_sink', 'too_terse',
] as const

export const DIMENSIONS = ['accuracy', 'clarity', 'conciseness'] as const

export type Dimension = (typeof DIMENSIONS)[number]
export type AccuracyType = (typeof ACCURACY_TYPES)[number]
export type ErrorType =
  | AccuracyType
  | (typeof CLARITY_TYPES)[number]
  | (typeof CONCISENESS_TYPES)[number]

/**
 * Interview prep: being wrong is worse than being wordy. Named constants
 * rather than inlined so a different product can retune them, and so
 * significance can be recomputed from stored inputs.
 */
export const DIM_WEIGHTS: Record<Dimension, number> = {
  accuracy: 1.0,
  clarity: 0.8,
  conciseness: 0.7,
}

/** Caps force the model to RANK rather than enumerate. */
export const MAX_TAGS_PER_ANSWER = 4
export const MAX_TAGS_PER_DIMENSION = 2

const BY_DIMENSION: Record<Dimension, readonly string[]> = {
  accuracy: ACCURACY_TYPES,
  clarity: CLARITY_TYPES,
  conciseness: CONCISENESS_TYPES,
}

export function typesForDimension(dimension: Dimension): readonly string[] {
  return BY_DIMENSION[dimension] ?? []
}

/**
 * A type is only valid UNDER ITS OWN DIMENSION. A real type paired with the
 * wrong dimension is rejected: it would otherwise be weighted by a rubric it
 * was never judged against.
 */
export function validateTagType(dimension: Dimension, type: string): boolean {
  return typesForDimension(dimension).includes(type)
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/errors/taxonomy.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/errors/taxonomy.ts tests/errors/taxonomy.test.ts
git commit -m "feat(errors): add closed error vocabularies with the CORRUPTIONS subset test"
```

---

### Task 2: The quiz→memory mode bridge

**Files:**
- Create: `src/lib/quiz/mode.ts`
- Test: `tests/quiz/mode.test.ts`

**Interfaces:**
- Consumes: `StudySource` from `@/lib/memory/scoring`
- Produces: `QUIZ_MODES`, type `QuizMode`, `toStudySource(mode: QuizMode): StudySource`

**Why:** two vocabularies for the same concept are already persisted — `StudyEvent.source` uses `quiz-mc`, `QuizAnswer.mode` uses `multiple-choice`. Task 5's `klpCredit` is keyed by `StudySource` while the answer row carries the quiz form, so the conversion has to exist. Today it is inlined per call site; a fourth site converting differently yields `EVIDENCE_STRENGTH[undefined]` and a `NaN` credit, silently.

- [x] **Step 1: Write the failing test**

Create `tests/quiz/mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { QUIZ_MODES, toStudySource } from '@/lib/quiz/mode'

describe('toStudySource', () => {
  it('maps every quiz mode to a study source', () => {
    expect(toStudySource('multiple-choice')).toBe('quiz-mc')
    expect(toStudySource('short-answer')).toBe('quiz-sa')
    expect(toStudySource('true-false')).toBe('quiz-tf')
    expect(toStudySource('matching')).toBe('matching')
  })

  it('is TOTAL — no quiz mode maps to undefined', () => {
    // The mapping spans two persisted String vocabularies, so the type system
    // cannot catch a missing case. Adding a quiz mode without a study source
    // would produce EVIDENCE_STRENGTH[undefined] and a NaN credit, silently.
    for (const mode of QUIZ_MODES) {
      expect(toStudySource(mode)).toBeDefined()
    }
  })

  it('never returns a study source that is not quiz-originated', () => {
    // 'review' and 'lesson' are study sources with no quiz mode. If one ever
    // appeared here it would mean the mapping had been written backwards.
    const produced = QUIZ_MODES.map(toStudySource)
    expect(produced).not.toContain('review')
    expect(produced).not.toContain('lesson')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/quiz/mode.test.ts`
Expected: FAIL — cannot resolve `@/lib/quiz/mode`.

- [x] **Step 3: Implement**

Create `src/lib/quiz/mode.ts`:

```ts
import type { StudySource } from '@/lib/memory/scoring'

/**
 * Quiz modes as persisted on `QuizAnswer.mode` and `QuizQuestion.mode`.
 *
 * These are a DIFFERENT vocabulary from the memory layer's `StudySource`
 * (`StudyEvent.source`), and both are already in the database. This module is
 * the single bridge between them — previously the translation was inlined at
 * every call site, which is exactly how two string vocabularies drift.
 */
export const QUIZ_MODES = [
  'multiple-choice', 'short-answer', 'true-false', 'matching',
] as const

export type QuizMode = (typeof QUIZ_MODES)[number]

const TO_STUDY_SOURCE: Record<QuizMode, StudySource> = {
  'multiple-choice': 'quiz-mc',
  'short-answer': 'quiz-sa',
  'true-false': 'quiz-tf',
  matching: 'matching',
}

/** The memory layer's name for a quiz mode. Total over QUIZ_MODES. */
export function toStudySource(mode: QuizMode): StudySource {
  return TO_STUDY_SOURCE[mode]
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/quiz/mode.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/quiz/mode.ts tests/quiz/mode.test.ts
git commit -m "feat(quiz): add the single quiz-mode to study-source bridge"
```

---

### Task 3: `computeSignificance`

**Files:**
- Create: `src/lib/errors/significance.ts`
- Test: `tests/errors/significance.test.ts`

**Interfaces:**
- Consumes: `DIM_WEIGHTS`, `Dimension` (Task 1)
- Produces: `STAR_BOOST`, `SignificanceInput`, `SignificanceResult`, `computeSignificance(input): SignificanceResult`

**Formula** (`docs/ai/error-taxonomy.md` §3, frozen):

```
significance = clamp(round((0.55·relevance + 0.45·severity) × 2 × dimWeight × starBoost), 1, 10)
```

`repeatBonus` is **excluded** — it depends on later attempts that do not exist at write time. Spec 3 applies it at read.

- [x] **Step 1: Write the failing test**

Create `tests/errors/significance.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeSignificance, STAR_BOOST } from '@/lib/errors/significance'

const base = { relevance: 3, severity: 3, dimension: 'accuracy' as const, starred: false }

describe('computeSignificance', () => {
  it('computes the frozen formula', () => {
    // (0.55*5 + 0.45*5) * 2 * 1.0 * 1.0 = 10
    expect(computeSignificance({ ...base, relevance: 5, severity: 5 }).significance).toBe(10)
    // (0.55*1 + 0.45*1) * 2 * 1.0 * 1.0 = 2
    expect(computeSignificance({ ...base, relevance: 1, severity: 1 }).significance).toBe(2)
    // (0.55*3 + 0.45*3) * 2 = 6
    expect(computeSignificance(base).significance).toBe(6)
  })

  it('weights relevance above severity', () => {
    // Centrality to the question matters more than how bad the slip was — but
    // only just. The 0.55/0.45 split moves the raw score by at most
    // (0.55-0.45) * 4 * 2 = 0.8, which is LESS THAN ONE INTEGER STEP, so on
    // most inputs it vanishes in the rounding: r=5,s=1 gives 6.4 and r=1,s=5
    // gives 5.6, and both round to 6.
    //
    // It is asserted here on a starred card, where the 1.15 boost pushes the
    // pair across a rounding boundary (7.36 -> 7 versus 6.44 -> 6) and the
    // weighting becomes observable. Asserting it on the plain case would be
    // asserting something that is not reliably true.
    const highRelevance = computeSignificance({ ...base, relevance: 5, severity: 1, starred: true })
    const highSeverity = computeSignificance({ ...base, relevance: 1, severity: 5, starred: true })
    expect(highRelevance.significance).toBeGreaterThan(highSeverity.significance)
  })

  it('collapses the relevance/severity split when rounding swallows it', () => {
    // Documents the above as intended behaviour rather than a latent bug: at
    // 1-5 integer inputs the split is a tiebreaker, and the dimension weight
    // and star boost do the real separating.
    expect(computeSignificance({ ...base, relevance: 5, severity: 1 }).significance)
      .toBe(computeSignificance({ ...base, relevance: 1, severity: 5 }).significance)
  })

  it('scales down by dimension — accuracy outranks clarity outranks conciseness', () => {
    const acc = computeSignificance({ ...base, dimension: 'accuracy' }).significance
    const cla = computeSignificance({ ...base, dimension: 'clarity' }).significance
    const con = computeSignificance({ ...base, dimension: 'conciseness' }).significance
    expect(acc).toBeGreaterThan(cla)
    expect(cla).toBeGreaterThan(con)
  })

  it('boosts a starred card', () => {
    const plain = computeSignificance(base).significance
    const starred = computeSignificance({ ...base, starred: true }).significance
    expect(starred).toBeGreaterThan(plain)
    expect(STAR_BOOST).toBe(1.15)
  })

  it('clamps to 1-10 at both ends', () => {
    expect(computeSignificance({
      relevance: 5, severity: 5, dimension: 'accuracy', starred: true,
    }).significance).toBe(10)
    expect(computeSignificance({
      relevance: 1, severity: 1, dimension: 'conciseness', starred: false,
    }).significance).toBeGreaterThanOrEqual(1)
  })

  it('returns the INPUTS, not the derived constants', () => {
    // Storing dimWeight=1.0 does not let you recompute at 0.9; storing the
    // dimension does. So the result carries facts, and significance.
    const r = computeSignificance({ ...base, starred: true })
    expect(r).toEqual({
      relevance: 3, severity: 3, dimension: 'accuracy', starred: true,
      significance: expect.any(Number),
    })
    expect(r).not.toHaveProperty('dimWeight')
    expect(r).not.toHaveProperty('starBoost')
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/errors/significance.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/significance`.

- [x] **Step 3: Implement**

Create `src/lib/errors/significance.ts`:

```ts
import { DIM_WEIGHTS, type Dimension } from './taxonomy'

/** Multiplier for an error on a card the learner flagged as important. */
export const STAR_BOOST = 1.15

const RELEVANCE_WEIGHT = 0.55
const SEVERITY_WEIGHT = 0.45
const SCALE = 2

export interface SignificanceInput {
  /** CardKlp.weight as of this answer — how central the point is. */
  relevance: number
  /** 1-5, the AI's only numeric contribution. */
  severity: number
  dimension: Dimension
  /** CardProgress.starred at answer time. No progress row means false. */
  starred: boolean
}

export interface SignificanceResult extends SignificanceInput {
  significance: number
}

/**
 * How much this error should weigh in the learner's profile (1-10).
 *
 * `repeatBonus` from the taxonomy is deliberately NOT applied here: it depends
 * on whether the same (type, target) recurs in LATER attempts, which do not
 * exist at write time. Spec 3 adds it at read. Freezing it here would make a
 * tag's score depend on when it happened to be computed.
 *
 * Returns the inputs alongside the result so a stored row can be recomputed if
 * the constants are ever retuned. The derived constants (dimWeight, starBoost)
 * are deliberately NOT returned — they are outputs, and knowing a row used
 * dimWeight 1.0 tells you nothing when recomputing at 0.9.
 */
export function computeSignificance(input: SignificanceInput): SignificanceResult {
  const weighted =
    RELEVANCE_WEIGHT * input.relevance + SEVERITY_WEIGHT * input.severity
  const raw =
    weighted * SCALE * DIM_WEIGHTS[input.dimension] * (input.starred ? STAR_BOOST : 1)

  return { ...input, significance: Math.min(10, Math.max(1, Math.round(raw))) }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/errors/significance.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/errors/significance.ts tests/errors/significance.test.ts
git commit -m "feat(errors): compute significance in TS from stored inputs"
```

---

### Task 4: `severityFromCorruption`

**Files:**
- Create: `src/lib/errors/severity.ts`
- Test: `tests/errors/severity.test.ts`

**Interfaces:**
- Consumes: `Corruption` from `@/lib/quiz/options`; `StudySource` from `@/lib/memory/scoring`
- Produces: `CORRUPTION_SEVERITY`, `severityFromCorruption(corruption, mode): number`

- [x] **Step 1: Write the failing test**

Create `tests/errors/severity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CORRUPTIONS } from '@/lib/quiz/options'
import { CORRUPTION_SEVERITY, severityFromCorruption } from '@/lib/errors/severity'

describe('CORRUPTION_SEVERITY', () => {
  it('ranks every corruption within 1-5', () => {
    for (const c of CORRUPTIONS) {
      expect(CORRUPTION_SEVERITY[c]).toBeGreaterThanOrEqual(1)
      expect(CORRUPTION_SEVERITY[c]).toBeLessThanOrEqual(5)
    }
  })

  it('ranks a wrong mental model above a retrieval slip', () => {
    // conflation/inversion mean the concept is misfiled or backwards;
    // factual_error is forgetting a number. Not the same problem.
    expect(CORRUPTION_SEVERITY.conflation).toBe(5)
    expect(CORRUPTION_SEVERITY.inversion).toBe(5)
    expect(CORRUPTION_SEVERITY.factual_error).toBe(2)
    expect(CORRUPTION_SEVERITY.conflation).toBeGreaterThan(CORRUPTION_SEVERITY.factual_error)
  })
})

describe('severityFromCorruption', () => {
  it('uses the rank as-is for multiple choice', () => {
    expect(severityFromCorruption('conflation', 'quiz-mc')).toBe(5)
    expect(severityFromCorruption('factual_error', 'quiz-mc')).toBe(2)
  })

  it('subtracts one for true/false', () => {
    // Choosing among four named alternatives narrows down a learner's model
    // more than flipping one bit does. This is NOT a guess-rate adjustment:
    // guess rate discounts CORRECT answers (see klp-credit), not wrong ones.
    expect(severityFromCorruption('conflation', 'quiz-tf')).toBe(4)
    expect(severityFromCorruption('misapplication', 'quiz-tf')).toBe(3)
  })

  it('never drops below 1 on true/false', () => {
    expect(severityFromCorruption('factual_error', 'quiz-tf')).toBe(1)
  })

  it('is defined for every corruption in both modes', () => {
    for (const c of CORRUPTIONS) {
      expect(severityFromCorruption(c, 'quiz-mc')).toBeGreaterThanOrEqual(1)
      expect(severityFromCorruption(c, 'quiz-tf')).toBeGreaterThanOrEqual(1)
    }
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/errors/severity.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/severity`.

- [x] **Step 3: Implement**

Create `src/lib/errors/severity.ts`:

```ts
import type { Corruption } from '@/lib/quiz/options'
import type { StudySource } from '@/lib/memory/scoring'

/**
 * How deep a misunderstanding each corruption implies, 1-5.
 *
 * Ranked by what picking it reveals: a conflation or inversion means the
 * concept is misfiled or runs backwards in the learner's model, while a
 * factual_error is a retrieval slip on an otherwise-sound idea.
 */
export const CORRUPTION_SEVERITY: Record<Corruption, number> = {
  conflation: 5,
  inversion: 5,
  misapplication: 4,
  overgeneralization: 3,
  factual_error: 2,
}

/**
 * Severity for a wrong MC/TF pick — no AI call.
 *
 * True/false is docked one point: selecting one of four specific texts is a
 * deliberate choice among named alternatives, while true/false flips a single
 * bit, so the same corruption evidenced by an MC pick says more about THIS
 * learner's model.
 *
 * This is NOT a guess-rate adjustment. Guess rate discounts CORRECT answers,
 * because luck can produce them — that is `EVIDENCE_STRENGTH` in klp-credit.ts.
 * A wrong answer is not luck; the learner actively chose it.
 */
export function severityFromCorruption(
  corruption: Corruption,
  mode: StudySource,
): number {
  const rank = CORRUPTION_SEVERITY[corruption]
  const adjusted = mode === 'quiz-tf' ? rank - 1 : rank
  return Math.min(5, Math.max(1, adjusted))
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/errors/severity.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/errors/severity.ts tests/errors/severity.test.ts
git commit -m "feat(errors): rank corruption severity, docking true/false one point"
```

---

### Task 5: `klpCredit`

**Files:**
- Create: `src/lib/errors/klp-credit.ts`
- Test: `tests/errors/klp-credit.test.ts`

**Interfaces:**
- Consumes: `StudySource` from `@/lib/memory/scoring`
- Produces: `KLP_STATUSES`, type `KlpStatus`, `STATUS_CREDIT`, `EVIDENCE_STRENGTH`, `klpCredit(status, mode): number`

- [x] **Step 1: Write the failing test**

Create `tests/errors/klp-credit.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  KLP_STATUSES, STATUS_CREDIT, EVIDENCE_STRENGTH, klpCredit,
} from '@/lib/errors/klp-credit'

describe('klpCredit', () => {
  it('weights a correct answer by how much the mode proves', () => {
    // 1 - guessRate. Short answer is near-certain; true/false is a coin flip.
    expect(klpCredit('passed', 'quiz-sa')).toBeCloseTo(0.95)
    expect(klpCredit('passed', 'quiz-mc')).toBeCloseTo(0.75)
    expect(klpCredit('passed', 'quiz-tf')).toBeCloseTo(0.5)
  })

  it('halves a partial', () => {
    expect(klpCredit('partial', 'quiz-sa')).toBeCloseTo(0.475)
  })

  it('gives a FAILED status zero in EVERY mode', () => {
    // The one place mode weighting must NOT apply. Guess rate discounts a
    // correct answer because luck can produce one; a wrong answer is not luck,
    // so an easy mode does not make failing it less of a failure.
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      expect(klpCredit('failed', mode)).toBe(0)
    }
  })

  it('is defined for every status/mode pair', () => {
    for (const status of KLP_STATUSES) {
      for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
        const c = klpCredit(status, mode)
        expect(c).toBeGreaterThanOrEqual(0)
        expect(c).toBeLessThanOrEqual(1)
      }
    }
  })

  it('orders evidence strength SA > MC > TF', () => {
    expect(EVIDENCE_STRENGTH['quiz-sa']).toBeGreaterThan(EVIDENCE_STRENGTH['quiz-mc'])
    expect(EVIDENCE_STRENGTH['quiz-mc']).toBeGreaterThan(EVIDENCE_STRENGTH['quiz-tf'])
    expect(STATUS_CREDIT.passed).toBe(1)
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/errors/klp-credit.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/klp-credit`.

- [x] **Step 3: Implement**

Create `src/lib/errors/klp-credit.ts`:

```ts
import type { StudySource } from '@/lib/memory/scoring'

export const KLP_STATUSES = ['passed', 'partial', 'failed'] as const
export type KlpStatus = (typeof KLP_STATUSES)[number]

/** The categorical judgment, as a fraction. The AI supplies the category. */
export const STATUS_CREDIT: Record<KlpStatus, number> = {
  passed: 1,
  partial: 0.5,
  failed: 0,
}

/**
 * `1 - guessRate`: how much a CORRECT answer in this mode actually proves.
 * Four-option MC can be guessed 1-in-4; true/false is a coin flip.
 */
export const EVIDENCE_STRENGTH: Record<string, number> = {
  'quiz-sa': 0.95,
  'quiz-mc': 0.75,
  'quiz-tf': 0.5,
  matching: 0.75,
  review: 0.8,
  lesson: 0.8,
}

const DEFAULT_STRENGTH = 0.75

/**
 * Graded evidence that a learner holds one KLP, 0-1.
 *
 * The AI never emits this float. It returns `passed | partial | failed` —
 * what a model is actually reliable at — and the mapping plus the mode
 * weighting happen here. Asking a model for a 0-100 score yields values
 * bunched on round numbers: precision that reads as real and is not.
 *
 * A `failed` status is 0 in every mode. Mode weighting discounts CORRECT
 * answers, because an easy mode makes a correct answer weaker evidence. It
 * does not make a WRONG answer weaker evidence — the learner chose it.
 */
export function klpCredit(status: KlpStatus, mode: StudySource): number {
  const base = STATUS_CREDIT[status]
  if (base === 0) return 0
  return base * (EVIDENCE_STRENGTH[mode] ?? DEFAULT_STRENGTH)
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/errors/klp-credit.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/errors/klp-credit.ts tests/errors/klp-credit.test.ts
git commit -m "feat(errors): grade KLP credit by mode evidence strength"
```

---

### Task 6: Schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_answer_analysis/migration.sql`

**Interfaces:**
- Consumes: nothing
- Produces: models `AnswerKlpResult`, `AnswerErrorTag`; `QuizAnswer.analysisStatus`, `.analysisVersion`, `.analysisWarnings`

- [x] **Step 1: Add the two models**

Add to `prisma/schema.prisma` after `QuizAnswer`:

```prisma
/// Stage 8 Spec 2a: per-KLP outcome for one answer. Short answer writes one row
/// per KLP on the card; MC/TF write one per KLP the question targeted.
///
/// `status` is the AI's categorical judgment; `credit` is the continuous value
/// computed from it in TypeScript, weighted by what the mode's evidence is
/// worth. Both are stored: the categorical drives display, the float drives
/// Spec 3's math.
model AnswerKlpResult {
  id           String     @id @default(cuid())
  quizAnswerId String
  klpId        String
  status       String     // passed | partial | failed
  credit       Float      // 0-1, computed: status credit x evidence strength
  mode         String     // StudySource form: quiz-mc | quiz-sa | quiz-tf
  evidence     String?    @db.Text
  createdAt    DateTime   @default(now())
  quizAnswer   QuizAnswer @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
  klp          CardKlp    @relation(fields: [klpId], references: [id], onDelete: Cascade)

  @@unique([quizAnswerId, klpId])
  @@index([klpId, status])
  @@index([klpId, createdAt])
}

/// Stage 8 Spec 2a: one tagged error on one answer — the (dimension, type,
/// target) triple from docs/ai/error-taxonomy.md, plus the inputs that
/// produced its significance.
///
/// The inputs are stored, not the derived constants: knowing a row used
/// dimWeight 1.0 does not let you recompute it at 0.9, but knowing the
/// dimension does.
model AnswerErrorTag {
  id             String     @id @default(cuid())
  quizAnswerId   String
  dimension      String     // accuracy | clarity | conciseness
  type           String     // closed vocabulary per dimension
  klpId          String?    // null means the target is the whole answer
  secondaryKlpId String?    // conflation only: the concept confused WITH
  relevance      Int        // CardKlp.weight AS OF THIS ANSWER
  severity       Int        // 1-5, the AI's only numeric contribution
  starred        Boolean    // CardProgress.starred AT ANSWER TIME
  significance   Int        // computed; excludes repeatBonus
  quote          String?    @db.Text
  createdAt      DateTime   @default(now())
  quizAnswer     QuizAnswer @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
  klp            CardKlp?   @relation("ErrorTagKlp", fields: [klpId], references: [id], onDelete: SetNull)
  secondaryKlp   CardKlp?   @relation("ErrorTagSecondaryKlp", fields: [secondaryKlpId], references: [id], onDelete: SetNull)

  @@index([quizAnswerId])
  @@index([klpId, type])
  @@index([klpId, secondaryKlpId, type])
}
```

- [x] **Step 2: Add the columns and back-references**

In `model QuizAnswer`, add before `@@index`:

```prisma
  // Why this answer has the tags it has — or has none. A relational tag table
  // cannot distinguish "analyzed and clean" from "could not analyze": both are
  // zero rows. Spec 3's rate denominators filter on 'analyzed'.
  analysisStatus   String?  // analyzed | no_provenance | no_klps | failed
  analysisVersion  Int?     // which analysis contract produced these rows
  analysisWarnings Json?    // [{ reason, value }] — non-fatal losses
  klpResults       AnswerKlpResult[]
  errorTags        AnswerErrorTag[]
```

In `model CardKlp`, add:

```prisma
  answerResults      AnswerKlpResult[]
  errorTags          AnswerErrorTag[] @relation("ErrorTagKlp")
  secondaryErrorTags AnswerErrorTag[] @relation("ErrorTagSecondaryKlp")
```

- [x] **Step 3: Generate and apply the migration**

Run: `npx prisma migrate dev --name answer_analysis`
Expected: applies cleanly, `prisma generate` runs.

**If the database is unreachable**, generate the SQL with
`npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma --script`
and STOP — report that the migration is generated but unapplied. Do not improvise.

- [x] **Step 4: Verify the migration is purely additive**

Read the generated `migration.sql`. Expected: two `CREATE TABLE`, three `ALTER TABLE ... ADD COLUMN` on `QuizAnswer`, plus indexes and FKs. **Any `DROP` or `ALTER COLUMN ... TYPE` means something is wrong — stop and report.**

- [x] **Step 5: Confirm the suite still passes**

Run: `npm test && npx tsc --noEmit`
Expected: PASS — no test touches these columns yet.

- [x] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add AnswerKlpResult, AnswerErrorTag, and analysis columns"
```

---

### Task 7: The analysis write path

**Files:**
- Create: `src/lib/analysis/persist.ts`
- Test: `tests/analysis/persist.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, 5
- Produces: `AnalysisOutcome`, `KlpResultDraft`, `ErrorTagDraft`, `AnalysisWrites`; `buildAnalysisWrites(input): AnalysisWrites` (pure)

**Why a pure builder:** the decisions — which tags survive validation, what warnings to record, what each row's computed values are — are all pure. Isolating them means the branchy logic is tested without a database, and the action only performs the writes.

- [x] **Step 1: Write the failing test**

Create `tests/analysis/persist.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildAnalysisWrites } from '@/lib/analysis/persist'

const klps = [
  { id: 'klp-a', weight: 5 },
  { id: 'klp-b', weight: 3 },
]

const base = {
  mode: 'quiz-sa' as const,
  klps,
  starred: false,
  klpResults: [],
  errorTags: [],
}

describe('buildAnalysisWrites — KLP results', () => {
  it('resolves a ref to a real id and computes credit', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 0, status: 'passed', evidence: 'said it plainly' }],
    })
    expect(w.klpResults).toEqual([
      { klpId: 'klp-a', status: 'passed', credit: 0.95, mode: 'quiz-sa', evidence: 'said it plainly' },
    ])
  })

  it('drops a result whose ref does not resolve, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 7, status: 'failed' }],
    })
    expect(w.klpResults).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unresolved_klp_ref', value: '7' })
  })

  it('gives a failed status zero credit regardless of mode', () => {
    const w = buildAnalysisWrites({
      ...base, mode: 'quiz-tf',
      klpResults: [{ klpRef: 0, status: 'failed' }],
    })
    expect(w.klpResults[0].credit).toBe(0)
  })
})

describe('buildAnalysisWrites — error tags', () => {
  const tag = { dimension: 'accuracy' as const, type: 'inversion', klpRef: 0, severity: 4 }

  it('computes significance from the KLP weight, not the model', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [tag] })
    expect(w.errorTags).toHaveLength(1)
    expect(w.errorTags[0]).toMatchObject({
      dimension: 'accuracy', type: 'inversion', klpId: 'klp-a',
      relevance: 5, severity: 4, starred: false,
    })
    expect(w.errorTags[0].significance).toBeGreaterThan(0)
  })

  it('drops a tag whose type is not in its dimension, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ ...tag, dimension: 'clarity', type: 'inversion' }],
    })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'invalid_type_for_dimension', value: 'clarity/inversion' })
  })

  it('drops a tag with an unknown type, and warns', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [{ ...tag, type: 'vibes' }] })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unknown_type', value: 'vibes' })
  })

  it('keeps a whole-answer tag with no klpRef, using relevance 3', () => {
    // No KLP target means no stored weight to read; the midpoint is the only
    // defensible neutral, and it is recorded so it can be recomputed.
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'conciseness', type: 'rambling', severity: 3 }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: null, relevance: 3 })
  })

  it('caps tags per dimension, keeping the most severe', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [
        { dimension: 'accuracy', type: 'omission', klpRef: 0, severity: 2 },
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, severity: 5 },
        { dimension: 'accuracy', type: 'incomplete', klpRef: 1, severity: 4 },
      ],
    })
    expect(w.errorTags).toHaveLength(2)
    expect(w.errorTags.map((t) => t.severity)).toEqual([5, 4])
    expect(w.warnings).toContainEqual({ reason: 'dimension_cap', value: 'accuracy' })
  })

  it('carries secondaryKlpId for conflation', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'accuracy', type: 'conflation', klpRef: 0, secondaryKlpRef: 1, severity: 5 }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: 'klp-a', secondaryKlpId: 'klp-b' })
  })
})

describe('buildAnalysisWrites — status', () => {
  it('is analyzed when nothing was rejected', () => {
    expect(buildAnalysisWrites(base).status).toBe('analyzed')
  })

  it('stays analyzed when a tag was dropped — lossiness is a SEPARATE axis', () => {
    // "did we analyze" and "was the analysis lossy" are independent. Folding a
    // 'partial' status in would make "no_klps AND two tags rejected"
    // inexpressible.
    const w = buildAnalysisWrites({ ...base, errorTags: [{ dimension: 'accuracy', type: 'vibes', severity: 3 }] })
    expect(w.status).toBe('analyzed')
    expect(w.warnings.length).toBeGreaterThan(0)
  })

  it('is no_klps when the card has none', () => {
    const w = buildAnalysisWrites({ ...base, klps: [] })
    expect(w.status).toBe('no_klps')
    expect(w.klpResults).toEqual([])
  })
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/analysis/persist.test.ts`
Expected: FAIL — cannot resolve `@/lib/analysis/persist`.

- [x] **Step 3: Implement**

Create `src/lib/analysis/persist.ts`:

```ts
import type { StudySource } from '@/lib/memory/scoring'
import {
  DIMENSIONS, MAX_TAGS_PER_DIMENSION, validateTagType, type Dimension,
} from '@/lib/errors/taxonomy'
import { computeSignificance } from '@/lib/errors/significance'
import { klpCredit, type KlpStatus } from '@/lib/errors/klp-credit'

/** Why an answer has the analysis rows it has. */
export type AnalysisOutcome = 'analyzed' | 'no_provenance' | 'no_klps' | 'failed'

export interface KlpRef {
  id: string
  weight: number
}

export interface KlpResultDraft {
  klpRef: number
  status: KlpStatus
  evidence?: string
}

export interface ErrorTagDraft {
  dimension: Dimension
  type: string
  klpRef?: number
  secondaryKlpRef?: number
  severity: number
  quote?: string
}

export interface AnalysisWarning {
  reason: string
  value: string
}

export interface AnalysisWrites {
  status: AnalysisOutcome
  klpResults: {
    klpId: string
    status: KlpStatus
    credit: number
    mode: StudySource
    evidence?: string
  }[]
  errorTags: {
    dimension: Dimension
    type: string
    klpId: string | null
    secondaryKlpId: string | null
    relevance: number
    severity: number
    starred: boolean
    significance: number
    quote?: string
  }[]
  warnings: AnalysisWarning[]
}

/**
 * Relevance for a tag with no KLP target. The midpoint is the only defensible
 * neutral — there is no stored weight to read — and it is persisted like any
 * other input so it can be revisited.
 */
const WHOLE_ANSWER_RELEVANCE = 3

/**
 * Decides what analysis rows an answer produces. Pure: every rejection,
 * warning, and computed value is decided here so the action only writes.
 *
 * Every rejection path DROPS the offending item and records why. Nothing is
 * defaulted into existence: a fabricated tag is indistinguishable from a real
 * observation once written, and would let Spec 3 promote a misconception the
 * learner never had.
 */
export function buildAnalysisWrites(input: {
  mode: StudySource
  klps: KlpRef[]
  starred: boolean
  klpResults: KlpResultDraft[]
  errorTags: ErrorTagDraft[]
  /** Overrides the derived status, e.g. 'no_provenance' for a v1 cache row. */
  forcedStatus?: AnalysisOutcome
}): AnalysisWrites {
  const warnings: AnalysisWarning[] = []
  const resolve = (ref?: number): KlpRef | null =>
    typeof ref === 'number' ? input.klps[ref] ?? null : null

  const klpResults: AnalysisWrites['klpResults'] = []
  for (const r of input.klpResults) {
    const klp = resolve(r.klpRef)
    if (!klp) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(r.klpRef) })
      continue
    }
    klpResults.push({
      klpId: klp.id,
      status: r.status,
      credit: klpCredit(r.status, input.mode),
      mode: input.mode,
      evidence: r.evidence,
    })
  }

  const accepted: AnalysisWrites['errorTags'] = []
  for (const t of input.errorTags) {
    if (!DIMENSIONS.includes(t.dimension)) {
      warnings.push({ reason: 'unknown_dimension', value: String(t.dimension) })
      continue
    }
    if (!validateTagType(t.dimension, t.type)) {
      const known = DIMENSIONS.some((d) => validateTagType(d, t.type))
      warnings.push({
        reason: known ? 'invalid_type_for_dimension' : 'unknown_type',
        value: known ? `${t.dimension}/${t.type}` : t.type,
      })
      continue
    }

    const target = resolve(t.klpRef)
    if (t.klpRef !== undefined && !target) {
      warnings.push({ reason: 'unresolved_klp_ref', value: String(t.klpRef) })
      continue
    }
    const secondary = resolve(t.secondaryKlpRef)

    const sig = computeSignificance({
      relevance: target?.weight ?? WHOLE_ANSWER_RELEVANCE,
      severity: t.severity,
      dimension: t.dimension,
      starred: input.starred,
    })

    accepted.push({
      dimension: t.dimension,
      type: t.type,
      klpId: target?.id ?? null,
      secondaryKlpId: secondary?.id ?? null,
      relevance: sig.relevance,
      severity: sig.severity,
      starred: sig.starred,
      significance: sig.significance,
      quote: t.quote,
    })
  }

  // Cap per dimension, keeping the most severe. The model is asked to rank,
  // but the cap is enforced here rather than trusted to it.
  const errorTags: AnalysisWrites['errorTags'] = []
  for (const d of DIMENSIONS) {
    const inDim = accepted
      .filter((t) => t.dimension === d)
      .sort((a, b) => b.severity - a.severity)
    if (inDim.length > MAX_TAGS_PER_DIMENSION) {
      warnings.push({ reason: 'dimension_cap', value: d })
    }
    errorTags.push(...inDim.slice(0, MAX_TAGS_PER_DIMENSION))
  }

  const status: AnalysisOutcome =
    input.forcedStatus ?? (input.klps.length === 0 ? 'no_klps' : 'analyzed')

  return { status, klpResults, errorTags, warnings }
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/analysis/persist.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/analysis/persist.ts tests/analysis/persist.test.ts
git commit -m "feat(analysis): add the pure analysis-write builder"
```

---

### Task 8: Extend the grading schema and prompt

**Files:**
- Modify: `src/lib/ai/schemas.ts`, `src/lib/ai/prompts/grade-short-answer.ts`
- Test: `tests/ai/prompts.test.ts`

**Interfaces:**
- Consumes: Task 1's vocabularies
- Produces: `ShortAnswerGradeSchema` gains `klpResults` and `errorTags`; `GRADE_SHORT_ANSWER_PROMPT.version === 2`; `GradeShortAnswerBuildInput` gains `klps?: { ref: number; text: string; kind: string }[]`

**Behaviour:** with KLPs, the prompt asks for per-KLP outcomes and error tags. Without them, it emits today's rubric-only prompt **unchanged** — existing tests assert on that text and a keyless user depends on it.

- [x] **Step 1: Extend the schema**

In `src/lib/ai/schemas.ts`, add the import and extend:

```ts
import { DIMENSIONS, MAX_TAGS_PER_ANSWER } from '@/lib/errors/taxonomy';
import { KLP_STATUSES } from '@/lib/errors/klp-credit';
```

Add to the `ShortAnswerGradeSchema` object, after `suggestedImprovement`:

```ts
  /**
   * Per-KLP outcomes. `klpRef` is an index into the prompt's KLP list, never a
   * cuid. Optional so the no-KLP path parses today's shape unchanged.
   */
  klpResults: z.array(z.object({
    klpRef: z.number().int().min(0),
    status: z.enum(KLP_STATUSES),
    evidence: z.string().optional(),
  })).optional(),
  /**
   * `type` is z.string(), not an enum: it is validated against its OWN
   * dimension in TS (buildAnalysisWrites), which a flat enum cannot express.
   * `severity` is the AI's ONLY numeric contribution.
   */
  errorTags: z.array(z.object({
    dimension: z.enum(DIMENSIONS),
    type: z.string().min(1),
    klpRef: z.number().int().min(0).optional(),
    secondaryKlpRef: z.number().int().min(0).optional(),
    severity: z.number().int().min(1).max(5),
    quote: z.string().optional(),
  })).max(MAX_TAGS_PER_ANSWER).optional(),
```

- [x] **Step 2: Write the failing prompt test**

Append to `tests/ai/prompts.test.ts`:

```ts
describe('GRADE_SHORT_ANSWER_PROMPT v2 (KLP-aware)', () => {
  const card = makeCard()
  const klps = [
    { ref: 0, text: 'EBITDA excludes interest expense', kind: 'definition' },
    { ref: 1, text: 'D&A is added back because it is non-cash', kind: 'causal' },
  ]

  it('is version 2', () => {
    expect(GRADE_SHORT_ANSWER_PROMPT.version).toBe(2)
  })

  it('lists each KLP by ref and asks for a per-KLP status', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).toContain('[0]')
    expect(p).toContain('EBITDA excludes interest expense')
    expect(p).toContain('klpResults')
    expect(p).toContain('passed')
  })

  it('names every allowed error type so the model cannot invent one', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    for (const t of [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]) {
      expect(p).toContain(t)
    }
  })

  it('asks for severity but NEVER for significance', () => {
    // The AI supplies one ordinal; every score is computed in TypeScript.
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).toContain('severity')
    expect(p.toLowerCase()).not.toContain('significance')
  })

  it('falls back to the rubric-only prompt with no KLPs', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x' })
    expect(p).toContain('For each of the following categories')
    expect(p).not.toContain('klpResults')
  })

  it('never leaks a cuid', () => {
    const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
    expect(p).not.toContain(card.id)
  })
})
```

Add `ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES` to the imports.

- [x] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/ai/prompts.test.ts -t "KLP-aware"`
Expected: FAIL — version is 1 and `klps` is not accepted.

- [x] **Step 4: Implement**

In `src/lib/ai/prompts/grade-short-answer.ts`, add `klps?: PromptKlp[]` to `GradeShortAnswerBuildInput` (import `PromptKlp` from `./multiple-choice`), set `version: 2`, and make `build` append a KLP block when `klps` is non-empty. Keep the existing `RUBRIC_BODY` and the no-KLP output **byte-identical**.

The appended block:

```ts
const ANALYSIS_BODY = (klps: PromptKlp[]) => `
Key Learning Points this card teaches:
${klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')}

Additionally return:

"klpResults": one entry per Key Learning Point above, judging ONLY that point:
  - "passed"  — the answer covers it correctly
  - "partial" — mentioned but incomplete or imprecise
  - "failed"  — absent, or stated wrongly
  Include a short verbatim "evidence" quote from the answer where one exists.
  Reference points by their [ref] number.

"errorTags": at most ${MAX_TAGS_PER_ANSWER} tags, at most 2 per dimension.
  Tag only what is genuinely wrong; a clean answer returns an empty list.

  dimension "accuracy"     — types: ${ACCURACY_TYPES.join(', ')}
  dimension "clarity"      — types: ${CLARITY_TYPES.join(', ')}
  dimension "conciseness"  — types: ${CONCISENESS_TYPES.join(', ')}

  Each tag needs:
  - "type" from that dimension's list. Use NO other word.
  - "klpRef" when the error is about a specific point; omit it when the error
    is about the whole answer.
  - "secondaryKlpRef" for "conflation" only: the point it was confused WITH.
  - "severity" 1-5, how bad THIS instance is.
  - "quote": the span of the answer the tag refers to.

Rank by what matters most. Do not pad to the cap.`
```

Import the vocabularies and `MAX_TAGS_PER_ANSWER` from `@/lib/errors/taxonomy`.

- [x] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/ai/prompts.test.ts`
Expected: PASS, **including the pre-existing v1 assertions** via the fallback path.

- [x] **Step 6: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/grade-short-answer.ts tests/ai/prompts.test.ts
git commit -m "feat(ai): grade per-KLP outcomes and error tags in the existing call"
```

---

### Task 9: Wire analysis into `submitShortAnswer`

**Files:**
- Modify: `src/actions/quiz.ts` (`submitShortAnswer`, `:563-757`)
- Test: `tests/actions/analysis-short-answer.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 7, 8; `ensureKlpsReady` from `@/actions/klp`
- Produces: both paths persist analysis in the answer's own transaction

**Critical:** this function has **two** near-duplicate paths — text-only (`:608`) and multimodal (`:673`) — each with its own `quizAnswer.create`. Both must write analysis. Add one module-private helper and call it from both; do **not** refactor the duplication itself.

- [x] **Step 1: Add the shared write helper**

Add to `src/actions/quiz.ts`:

```ts
/**
 * Persists an answer together with its analysis, atomically.
 *
 * One transaction, not an after(): a QuizAnswer without an analysisStatus is a
 * row Spec 3 cannot classify — neither analyzed nor explicitly unanalyzable —
 * and nothing later can tell it apart from an analysis that genuinely failed.
 */
async function createAnswerWithAnalysis(
  answerData: Prisma.QuizAnswerUncheckedCreateInput,
  writes: AnalysisWrites,
) {
  return prisma.$transaction(async (tx) => {
    const answer = await tx.quizAnswer.create({
      data: {
        ...answerData,
        analysisStatus: writes.status,
        analysisVersion: ANALYSIS_VERSION,
        analysisWarnings: writes.warnings.length > 0 ? writes.warnings : undefined,
      },
    })
    if (writes.klpResults.length > 0) {
      await tx.answerKlpResult.createMany({
        data: writes.klpResults.map((r) => ({ ...r, quizAnswerId: answer.id })),
      })
    }
    if (writes.errorTags.length > 0) {
      await tx.answerErrorTag.createMany({
        data: writes.errorTags.map((t) => ({ ...t, quizAnswerId: answer.id })),
      })
    }
    return answer
  })
}
```

Add `export const ANALYSIS_VERSION = 1` near the top, with a comment that it covers the tag schema, the significance constants, and the credit constants together.

- [x] **Step 2: Resolve KLPs and starred state before grading**

In `submitShortAnswer`, after the card is loaded and before the branch at `:608`:

```ts
  const klps = await ensureKlpsReady(session.user.id, input.cardId);
  const progress = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
    select: { starred: true },
  });
  // No progress row means the learner has never interacted with this card —
  // a definite "not starred", not missing data.
  const starred = progress?.starred ?? false;
  const promptKlps = klps.map((k, ref) => ({ ref, text: k.text, kind: k.kind }));
```

Pass `klps: promptKlps.length > 0 ? promptKlps : undefined` into both `GRADE_SHORT_ANSWER_PROMPT.build` calls.

- [x] **Step 3: Replace both `quizAnswer.create` calls**

In **both** paths, replace `await prisma.quizAnswer.create({ data: {...} })` with:

```ts
      const writes = buildAnalysisWrites({
        mode: toStudySource('short-answer'),
        klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
        starred,
        klpResults: grade.klpResults ?? [],
        errorTags: (grade.errorTags ?? []) as ErrorTagDraft[],
      });

      const answer = await createAnswerWithAnalysis(
        {
          attemptId: input.attemptId,
          userId: session.user.id,
          cardId: input.cardId,
          mode: 'short-answer',
          prompt: input.answer,
          answer: input.answer,
          correctAnswer: card.definition,
          grade: { ...grade, annotations, promptVersion: GRADE_SHORT_ANSWER_PROMPT.version },
          score,
          isCorrect,
          latencyMs: normalizeLatency(input.latencyMs),
          feedback: grade.summary,
        },
        writes,
      );
```

That data object is the existing one, moved verbatim — do not change any field.
The multimodal path's object differs only in `prompt`; keep each path's own.

Add the imports: `buildAnalysisWrites`, `type ErrorTagDraft`, `type AnalysisWrites` from `@/lib/analysis/persist`; `toStudySource` from `@/lib/quiz/mode`; `ensureKlpsReady` from `@/actions/klp`; `Prisma` from `@prisma/client`.

- [x] **Step 4: Write the test**

Create `tests/actions/analysis-short-answer.test.ts` following the `vi.hoisted()` + `vi.mock()` pattern in `tests/actions/quiz-options.test.ts` (mock `@/auth`, `@/lib/db`, `@/lib/ai/generate`, `@/actions/klp`). Mock `ensureKlpsReady` to return `[{ id: 'klp-a', index: 0, text: 'x', weight: 5, kind: 'definition' }]`.

```ts
it('persists one KLP result per returned outcome, credited for the mode', async () => {
  h.generateJson.mockResolvedValue({
    ...gradeShape,
    klpResults: [{ klpRef: 0, status: 'passed', evidence: 'said it' }],
    errorTags: [],
  })

  await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

  expect(h.klpResultCreateMany.mock.calls[0][0].data).toEqual([
    expect.objectContaining({ klpId: 'klp-a', status: 'passed', credit: 0.95, mode: 'quiz-sa' }),
  ])
})

it('computes relevance from the STORED KLP weight, not from the model', async () => {
  // The load-bearing test. The AI's only numeric input is severity (1-5);
  // if it could influence relevance it could inflate its own significance.
  h.generateJson.mockResolvedValue({
    ...gradeShape,
    klpResults: [],
    errorTags: [{ dimension: 'accuracy', type: 'inversion', klpRef: 0, severity: 4, relevance: 99 }],
  })

  await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

  const tag = h.errorTagCreateMany.mock.calls[0][0].data[0]
  expect(tag.relevance).toBe(5)          // the KLP's stored weight
  expect(tag.severity).toBe(4)
  expect(tag.significance).toBe(9)       // round((.55*5 + .45*4) * 2 * 1.0)
})

it('drops an unknown type, keeps the answer, and names the rejection', async () => {
  h.generateJson.mockResolvedValue({
    ...gradeShape,
    klpResults: [],
    errorTags: [{ dimension: 'accuracy', type: 'vibes', klpRef: 0, severity: 3 }],
  })

  const res = await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

  expect(res.success).toBe(true)
  expect(h.errorTagCreateMany).not.toHaveBeenCalled()
  const data = h.answerCreate.mock.calls[0][0].data
  expect(data.analysisStatus).toBe('analyzed')   // lossy, but still analyzed
  expect(data.analysisWarnings).toContainEqual({ reason: 'unknown_type', value: 'vibes' })
})

it('records no_klps for a card with no live KLPs', async () => {
  h.ensureKlpsReady.mockResolvedValue([])
  h.generateJson.mockResolvedValue({ ...gradeShape, klpResults: [], errorTags: [] })

  await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

  expect(h.answerCreate.mock.calls[0][0].data.analysisStatus).toBe('no_klps')
  expect(h.klpResultCreateMany).not.toHaveBeenCalled()
})

it('writes the answer and its analysis in one transaction', async () => {
  // A QuizAnswer without an analysisStatus is a row Spec 3 cannot classify,
  // and nothing later can distinguish it from an analysis that failed.
  h.generateJson.mockResolvedValue({
    ...gradeShape,
    klpResults: [{ klpRef: 0, status: 'passed' }],
    errorTags: [],
  })

  await submitShortAnswer({ attemptId: 'a1', cardId: 'c1', answer: 'text' })

  expect(h.transaction).toHaveBeenCalledTimes(1)
})
```

Define `gradeShape` once at the top as a valid `ShortAnswerGradeSchema` object
(clarity/conciseness/correctness each `{score, pros, cons}`, plus `overall`,
`summary`, `suggestedImprovement`) so each test overrides only what it exercises.

- [x] **Step 5: Verify**

Run: `npx vitest run tests/actions/analysis-short-answer.test.ts && npm test && npx tsc --noEmit`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/actions/quiz.ts tests/actions/analysis-short-answer.test.ts
git commit -m "feat(quiz): persist short-answer analysis in the answer's transaction"
```

---

### Task 10: MC and TF analysis, with zero AI calls

**Files:**
- Modify: `src/actions/quiz.ts` (`submitMultipleChoiceAnswer` `:328`, `submitTrueFalseAnswer` `:424`)
- Test: `tests/actions/analysis-mc-tf.test.ts`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, 7; `parseOptionCache`, `resolveDistractorProvenance` from `@/lib/quiz/options`
- Produces: both submit actions persist analysis derived from `QuizQuestion`, with no `generateJson` call

**The rules** (spec §4, and each is a separate test):

| Case | `AnswerKlpResult` | `AnswerErrorTag` |
| --- | --- | --- |
| MC correct | one `passed` (credit 0.75) per targeted KLP | none |
| MC wrong, provenanced | one `failed` for the picked distractor's KLP **only** | one, type = its `corruption` |
| MC wrong, no provenance | none | none, `analysisStatus: 'no_provenance'` |
| TF correct | one `passed` (credit 0.50) per targeted KLP | none |
| TF wrong, shown corrupted, answered "true" | one `failed` for the corrupted KLP | one, type = `QuizQuestion.corruption` |
| TF wrong, shown real, answered "false" | **none** | none |

- [x] **Step 1: Write the failing test**

Create `tests/actions/analysis-mc-tf.test.ts` following `tests/actions/true-false.test.ts`'s mocking pattern. One test per row above, plus:

```ts
it('never calls generateJson for MC/TF analysis', async () => {
  // The entire point: a wrong pick is self-diagnosing because the generator
  // already recorded what each distractor was built to corrupt.
  await submitMultipleChoiceAnswer({ /* wrong pick, provenanced */ })
  expect(h.generateJson).not.toHaveBeenCalled()
})

it('writes one failed result for the PICKED distractor only', async () => {
  // The question targeted 3 KLPs. Rejecting the other two distractors carries
  // no information — the learner rejected the correct answer too.
  const rows = h.klpResultCreateMany.mock.calls[0][0].data
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ klpId: 'klp-picked', status: 'failed', credit: 0 })
})

it('writes NO KLP result when "false" was answered to the real definition', async () => {
  // Rejecting a TRUE statement is second-guessing, not a knowledge gap.
  // Recording `failed` would teach Spec 3 the learner lacks a proposition
  // they may well hold. See docs/ai/error-taxonomy.md §4.
  await submitTrueFalseAnswer({ /* isTrue: true, selected: 'false' */ })
  expect(h.klpResultCreateMany).not.toHaveBeenCalled()
  expect(h.errorTagCreateMany).not.toHaveBeenCalled()
})
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/actions/analysis-mc-tf.test.ts`
Expected: FAIL — no analysis rows are written.

- [x] **Step 3: Add the shared draft builder**

Add to `src/actions/quiz.ts`. This is the whole MC/TF analysis decision, in one
place, so the two actions cannot drift:

```ts
/**
 * Analysis drafts for a binary-mode answer, with NO AI call.
 *
 * Everything needed is already on the QuizQuestion row: the generator recorded
 * which KLP each distractor corrupts and how, so a wrong pick diagnoses itself.
 *
 * `targetKlpIds` are the KLPs the QUESTION tested — a correct answer credits
 * all of them, but a wrong answer implicates ONLY the one the learner actually
 * chose. Rejecting the other distractors carries no information, because the
 * correct answer was rejected too.
 */
function binaryModeDrafts(input: {
  mode: StudySource
  isCorrect: boolean
  klps: { id: string; weight: number }[]
  targetKlpIds: string[]
  /** The KLP the chosen wrong answer corrupts, when known. */
  failedKlpId: string | null
  corruption: Corruption | null
}): { klpResults: KlpResultDraft[]; errorTags: ErrorTagDraft[] } {
  const refOf = (id: string) => input.klps.findIndex((k) => k.id === id)

  if (input.isCorrect) {
    return {
      klpResults: input.targetKlpIds
        .map(refOf)
        .filter((ref) => ref >= 0)
        .map((klpRef) => ({ klpRef, status: 'passed' as const })),
      errorTags: [],
    }
  }

  // Wrong, but nothing tells us WHICH proposition failed: a v1 cache row, or
  // a TF question where the learner rejected a true statement. Record no
  // claim rather than an invented one.
  if (!input.failedKlpId || !input.corruption) {
    return { klpResults: [], errorTags: [] }
  }

  const klpRef = refOf(input.failedKlpId)
  if (klpRef < 0) return { klpResults: [], errorTags: [] }

  return {
    klpResults: [{ klpRef, status: 'failed' }],
    errorTags: [{
      dimension: 'accuracy',
      type: input.corruption,
      klpRef,
      severity: severityFromCorruption(input.corruption, input.mode),
    }],
  }
}
```

- [x] **Step 4: Wire it into `submitMultipleChoiceAnswer`**

After the existing `isCorrect` computation, before the answer write:

```ts
  const question = await prisma.quizQuestion.findUnique({
    where: { attemptId_cardId_mode: { attemptId: input.attemptId, cardId: input.cardId, mode: 'multiple-choice' } },
  });
  const parsed = question?.options ? parseOptionCache({ v: 2, correctAnswer: input.correctAnswer, options: question.options }) : null;
  const provenance = parsed && !isCorrect
    ? resolveDistractorProvenance(parsed, input.selectedOption)
    : null;

  const klps = await ensureKlpsReady(session.user.id, input.cardId);
  const progress = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
    select: { starred: true },
  });

  const mode = toStudySource('multiple-choice');
  const drafts = binaryModeDrafts({
    mode,
    isCorrect,
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    targetKlpIds: (question?.targetKlpIds as string[] | null) ?? [],
    failedKlpId: provenance?.sourceKlpId ?? null,
    corruption: provenance?.corruption ?? null,
  });

  // A wrong pick we cannot attribute is `no_provenance`, NOT a clean answer.
  const forcedStatus =
    !isCorrect && !provenance && parsed?.version === 1 ? ('no_provenance' as const) : undefined;

  const writes = buildAnalysisWrites({
    mode,
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    starred: progress?.starred ?? false,
    ...drafts,
    forcedStatus,
  });
```

Then replace `prisma.quizAnswer.create({ data })` with
`createAnswerWithAnalysis(data, writes)`.

- [x] **Step 5: Wire it into `submitTrueFalseAnswer`**

The `question` row is already loaded there (Spec 1, Task 11). After `isCorrect`:

```ts
  const klps = await ensureKlpsReady(session.user.id, input.cardId);
  const progress = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId: session.user.id, cardId: input.cardId } },
    select: { starred: true },
  });

  // Only a wrong answer to a CORRUPTED statement implicates a KLP. Answering
  // "false" to the real definition means the learner rejected something true —
  // second-guessing, not a knowledge gap (docs/ai/error-taxonomy.md §4).
  // Recording `failed` there would teach Spec 3 they lack a proposition they
  // may well hold.
  const rejectedTruth = question?.isTrue === true;
  const failedKlpId =
    isCorrect === false && !rejectedTruth
      ? ((question?.targetKlpIds as string[] | null) ?? [])[0] ?? null
      : null;

  const mode = toStudySource('true-false');
  const drafts = binaryModeDrafts({
    mode,
    isCorrect: isCorrect === true,
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    targetKlpIds: (question?.targetKlpIds as string[] | null) ?? [],
    failedKlpId,
    corruption: (question?.corruption as Corruption | null) ?? null,
  });

  const writes = buildAnalysisWrites({
    mode,
    klps: klps.map((k) => ({ id: k.id, weight: k.weight })),
    starred: progress?.starred ?? false,
    ...drafts,
  });
```

**`isCorrect` is `boolean | null` here** (Spec 1 made unscored answers real). An
unscored answer writes no analysis: pass `isCorrect: false` with a null
`failedKlpId`, which yields empty drafts.

- [x] **Step 6: Verify**

Run: `npx vitest run tests/actions/analysis-mc-tf.test.ts && npm test && npx tsc --noEmit`
Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/actions/quiz.ts tests/actions/analysis-mc-tf.test.ts
git commit -m "feat(quiz): derive MC/TF analysis from distractor provenance, no AI call"
```

---

### Task 11: Pin replacement safety

**Files:**
- Test: `tests/actions/analysis-short-answer.test.ts` (extend)

**Interfaces:**
- Consumes: Tasks 9, 10
- Produces: no new exports — a regression guard

**Why:** short answer and MC replace on resubmit (`deleteMany` then `create`). Analysis rows survive only because both relations declare `onDelete: Cascade`. If either were ever changed to `SetNull`, resubmission would accumulate duplicate diagnostic rows and every Spec 3 rate would inflate with each retry — silently, since nothing errors.

- [x] **Step 1: Add the schema assertion test**

```ts
import { readFileSync } from 'node:fs'

it('analysis tables cascade from QuizAnswer, so resubmission cannot duplicate them', () => {
  // Resubmission relies on the cascade. A change to SetNull would leave the
  // old rows orphaned but present, inflating every Spec 3 rate on each retry
  // with nothing throwing. Asserted against the schema because Prisma's
  // referential action is not observable from the client.
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const klpResult = schema.match(/model AnswerKlpResult \{[\s\S]*?\n\}/)![0]
  const errorTag = schema.match(/model AnswerErrorTag \{[\s\S]*?\n\}/)![0]

  expect(klpResult).toMatch(/quizAnswer\s+QuizAnswer @relation\([^)]*onDelete: Cascade/)
  expect(errorTag).toMatch(/quizAnswer\s+QuizAnswer @relation\([^)]*onDelete: Cascade/)
})
```

- [x] **Step 2: Add the behavioural test**

Assert that resubmitting a short answer calls `quizAnswer.deleteMany` **before** the create, so the old row (and its cascade) is gone first:

```ts
it('deletes the prior answer before writing the replacement', async () => {
  await submitShortAnswer({ /* same attemptId + cardId, second submission */ })
  const deleteOrder = h.answerDeleteMany.mock.invocationCallOrder[0]
  const createOrder = h.answerCreate.mock.invocationCallOrder[0]
  expect(deleteOrder).toBeLessThan(createOrder)
})
```

- [x] **Step 3: Verify**

Run: `npx vitest run tests/actions/analysis-short-answer.test.ts && npm test`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add tests/actions/analysis-short-answer.test.ts
git commit -m "test(analysis): pin the cascade that makes answer replacement safe"
```

---

## Done when

- Every short answer records per-KLP outcomes and error tags from the existing grading call — no new AI cost.
- Every MC and TF answer records the same shapes with **zero** AI calls, derived from Spec 1's provenance.
- Every number is computed in TypeScript from stored inputs; the AI supplies only a category and a 1-5 severity.
- An answer that cannot be analyzed says so in `analysisStatus`, rather than looking clean.
- A rejected tag is dropped and named in `analysisWarnings`, never defaulted into existence.
- Nothing renders. The UI is Spec 2b.
