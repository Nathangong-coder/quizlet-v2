# Stage 8 Spec 3 — Metrics Substrate & Learner Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the per-answer analysis corpus captured by Specs 2a/2b into a durable model of the learner — per-KLP knowledge, retention, pace, misconceptions, and a per-topic knowledge/articulation profile.

**Architecture:** A new `src/lib/metrics/` of pure modules (no Prisma, no I/O) carries all math, mirroring how `src/lib/memory/scoring.ts` and `src/lib/analysis/rollup.ts` already work. Thin DB shells query and delegate, following `src/lib/memory/profile.ts`'s split. Severity stops being a fixed lookup from an error type's name and becomes a per-type `[floor, ceiling]` band interpolated by an AI-supplied magnitude; severity and significance move to read-time derivation so Spec 3B's knobs can re-score history.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16 App Router, Vitest, Zod, Vercel AI SDK v7.

**Spec:** `docs/superpowers/specs/2026-08-05-metrics-substrate-learner-profile-design.md`
**Frozen reference:** `docs/ai/error-taxonomy.md`

## Global Constraints

- Test runner is Vitest. Full suite: `npm test`. Single file: `npx vitest run <path>`.
- Tests import via the `@/` alias (`@/lib/...`), and live under `tests/<area>/`.
- Pure modules must not import `@/lib/db`. `src/lib/db.ts` throws at import time when `DATABASE_URL` is unset, and Vitest does not load `.env`. DB shells import it **dynamically** (`await import('@/lib/db')`), exactly as `profile.ts:340` does.
- Every module returns `null` rather than a low-confidence number. Never substitute 0.
- `MIN_OBSERVATIONS = 3` — nothing may call a KLP weak below it.
- Guess rate is **derived**: `guessRate(mode) = 1 - EVIDENCE_STRENGTH[mode]`. Never re-declare 0.25 / 0.5 / 0.05.
- BKT reads `AnswerKlpResult.status` and `.mode` only. **Never** the stored `credit` float.
- Bands are passed as a parameter to every function that uses them. Never imported at a call site.
- Dates in tests come from a fixed `NOW` constant with an injectable clock, per `tests/memory/profile.test.ts`.
- Commit after every task. Do not skip hooks.

---

## File Structure

**Create:**
- `scripts/klp-health.ts` — one-off diagnostic (Task 1)
- `src/lib/errors/bands.ts` — band table + severity resolution (Task 2)
- `src/lib/errors/derive.ts` — read-time severity/significance + repeatBonus (Task 6)
- `src/lib/metrics/bkt.ts` (Task 7)
- `src/lib/metrics/pace.ts` (Task 8)
- `src/lib/metrics/forgetting.ts` (Task 9)
- `src/lib/metrics/session-shape.ts` (Task 10)
- `src/lib/metrics/misconceptions.ts` (Task 11)
- `src/lib/metrics/articulation.ts` — verbosity index + SA readiness (Task 12)
- `src/lib/metrics/cache.ts` — incremental BKT state (Task 13)
- `src/lib/memory/topic-profile.ts` (Task 15)
- `src/lib/metrics/read.ts` — scoped read API for Spec 3C (Task 16)

**Modify:**
- `prisma/schema.prisma` — `AnswerErrorTag.magnitude` (Task 3), `KlpState` model (Task 13)
- `src/lib/ai/schemas.ts` — magnitude replaces severity (Task 4)
- `src/lib/ai/prompts/grade-short-answer.ts` — ask for magnitude (Task 4)
- `src/lib/analysis/persist.ts` — write magnitude, bump `ANALYSIS_VERSION` (Task 5)
- `src/lib/memory/profile.ts` — rename to `LearnerCardProfile` (Task 14)
- `src/lib/ai/context.ts` — profile block extension (Task 17)

---

### Task 1: Verify KLP extraction health

Spec 3 reads `AnswerKlpResult` rows. If the corpus has no KLPs, every metric computes nothing regardless of correctness. Establish this **before** building on it.

**Files:**
- Create: `scripts/klp-health.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing consumed by later tasks — a diagnostic only

- [ ] **Step 1: Write the diagnostic script**

```ts
// scripts/klp-health.ts
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const byStatus = await prisma.card.groupBy({
    by: ['klpStatus'],
    _count: { _all: true },
  })
  console.log('Cards by klpStatus:')
  for (const row of byStatus) {
    console.log(`  ${row.klpStatus}: ${row._count._all}`)
  }

  const liveKlps = await prisma.cardKlp.count({ where: { supersededAt: null } })
  const klpResults = await prisma.answerKlpResult.count()
  const tags = await prisma.answerErrorTag.count()

  const answersByAnalysis = await prisma.quizAnswer.groupBy({
    by: ['analysisStatus'],
    _count: { _all: true },
  })

  console.log(`\nLive KLPs: ${liveKlps}`)
  console.log(`AnswerKlpResult rows: ${klpResults}`)
  console.log(`AnswerErrorTag rows: ${tags}`)
  console.log('\nQuiz answers by analysisStatus:')
  for (const row of answersByAnalysis) {
    console.log(`  ${row.analysisStatus ?? 'null (legacy)'}: ${row._count._all}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/klp-health.ts`

Expected: counts print without error.

- [ ] **Step 3: Interpret before continuing**

**Stop and report to the user if** `pending` dominates `ready`, or `AnswerKlpResult` is 0 while quiz answers exist. That means extraction is not running and Spec 3 will have no input. Do not proceed silently — the remaining tasks will all pass their tests against fixtures and still produce an empty profile in production.

- [ ] **Step 4: Commit**

```bash
git add scripts/klp-health.ts
git commit -m "chore(spec3): add a KLP extraction health diagnostic"
```

---

### Task 2: Severity bands

**Files:**
- Create: `src/lib/errors/bands.ts`
- Test: `tests/errors/bands.test.ts`

**Interfaces:**
- Consumes: `Dimension`, `ACCURACY_TYPES`, `CLARITY_TYPES`, `CONCISENESS_TYPES` from `@/lib/errors/taxonomy`; `StudySource` from `@/lib/memory/scoring`; `CORRUPTION_SEVERITY` from `@/lib/errors/severity` (test only)
- Produces: `type SeverityBand = readonly [number, number]`, `type BandTable = Record<string, SeverityBand>`, `DEFAULT_BANDS: BandTable`, `MC_TF_MAGNITUDE = 10`, `resolveSeverity(input: { type: string; magnitude: number; mode: StudySource; bands?: BandTable }): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/bands.test.ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_BANDS, MC_TF_MAGNITUDE, resolveSeverity } from '@/lib/errors/bands'
import { CORRUPTION_SEVERITY } from '@/lib/errors/severity'
import { ACCURACY_TYPES, CLARITY_TYPES, CONCISENESS_TYPES } from '@/lib/errors/taxonomy'

describe('band table completeness', () => {
  it('covers every type in all three closed vocabularies', () => {
    const all = [...ACCURACY_TYPES, ...CLARITY_TYPES, ...CONCISENESS_TYPES]
    for (const type of all) {
      expect(DEFAULT_BANDS[type], `missing band for ${type}`).toBeDefined()
    }
  })

  it('has floor <= ceiling and stays within 1-5 for every band', () => {
    for (const [type, [floor, ceiling]] of Object.entries(DEFAULT_BANDS)) {
      expect(floor, type).toBeLessThanOrEqual(ceiling)
      expect(floor, type).toBeGreaterThanOrEqual(1)
      expect(ceiling, type).toBeLessThanOrEqual(5)
    }
  })
})

describe('MC/TF no-op property', () => {
  it('reproduces CORRUPTION_SEVERITY exactly for multiple choice at full magnitude', () => {
    for (const [corruption, expected] of Object.entries(CORRUPTION_SEVERITY)) {
      const actual = resolveSeverity({
        type: corruption,
        magnitude: MC_TF_MAGNITUDE,
        mode: 'quiz-mc',
      })
      expect(actual, corruption).toBe(expected)
    }
  })

  it('reproduces the true/false one-point dock', () => {
    for (const [corruption, rank] of Object.entries(CORRUPTION_SEVERITY)) {
      const actual = resolveSeverity({
        type: corruption,
        magnitude: MC_TF_MAGNITUDE,
        mode: 'quiz-tf',
      })
      expect(actual, corruption).toBe(Math.max(1, rank - 1))
    }
  })
})

describe('magnitude interpolation', () => {
  it('returns the floor at magnitude 1 and the ceiling at magnitude 10', () => {
    expect(resolveSeverity({ type: 'inversion', magnitude: 1, mode: 'quiz-sa' })).toBe(2)
    expect(resolveSeverity({ type: 'inversion', magnitude: 10, mode: 'quiz-sa' })).toBe(5)
  })

  it('lets a severe ramble outrank a mild redundancy', () => {
    const ramble = resolveSeverity({ type: 'rambling', magnitude: 10, mode: 'quiz-sa' })
    const redundancy = resolveSeverity({ type: 'redundancy', magnitude: 1, mode: 'quiz-sa' })
    expect(ramble).toBeGreaterThan(redundancy)
  })

  it('keeps kitchen_sink above rambling at every magnitude pairing', () => {
    for (let m = 1; m <= 10; m++) {
      const sink = resolveSeverity({ type: 'kitchen_sink', magnitude: 1, mode: 'quiz-sa' })
      const ramble = resolveSeverity({ type: 'rambling', magnitude: m, mode: 'quiz-sa' })
      expect(sink, `magnitude ${m}`).toBeGreaterThanOrEqual(ramble)
    }
  })

  it('clamps an unknown type to the neutral default band', () => {
    const result = resolveSeverity({ type: 'not_a_real_type', magnitude: 10, mode: 'quiz-sa' })
    expect(result).toBeGreaterThanOrEqual(1)
    expect(result).toBeLessThanOrEqual(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/bands.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/bands`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/errors/bands.ts
import type { StudySource } from '@/lib/memory/scoring'

/** Inclusive [floor, ceiling] on the 1-5 severity scale. */
export type SeverityBand = readonly [number, number]
export type BandTable = Record<string, SeverityBand>

/**
 * MC/TF distractors are generated by corrupting a named KLP with a named
 * corruption, so a wrong pick is by construction a FULL instance of that
 * corruption. They carry maximum magnitude and resolve to their ceiling.
 */
export const MC_TF_MAGNITUDE = 10

/**
 * Fallback for a type with no band — an unknown string that survived
 * validation. Neutral rather than harsh: a fabricated severity is worse than
 * a conservative one.
 */
const FALLBACK_BAND: SeverityBand = [1, 3]

/**
 * Default bands. The five accuracy CEILINGS are pinned, not chosen: MC/TF
 * resolve to the ceiling, so they must equal `CORRUPTION_SEVERITY` for the
 * band model to be a no-op on the existing path. tests/errors/bands.test.ts
 * asserts this, so drift is a build failure.
 *
 * The FLOORS are the new freedom, and are where magnitude sensitivity lands:
 * a soft inversion no longer scores like a true one.
 */
export const DEFAULT_BANDS: BandTable = {
  // accuracy — first five have pinned ceilings
  conflation: [3, 5],
  inversion: [2, 5],
  misapplication: [2, 4],
  overgeneralization: [1, 3],
  factual_error: [1, 2],
  omission: [2, 5],
  incomplete: [1, 3],
  unsupported_leap: [2, 4],
  fabrication: [3, 5],

  // clarity
  incoherent_syntax: [2, 5],
  disorganized: [2, 4],
  no_thesis: [1, 3],
  ambiguous_referent: [1, 3],
  undefined_jargon: [1, 3],
  hedging: [1, 3],

  // conciseness — kitchen_sink's floor sits above rambling's ceiling so it
  // always outranks it; rambling overlaps redundancy so a severe ramble can
  // beat a mild one. too_terse spans the full range because how bad
  // under-answering is depends on subject command — resolved in articulation.ts.
  kitchen_sink: [4, 5],
  too_terse: [1, 5],
  rambling: [2, 3],
  over_qualification: [1, 3],
  padding: [1, 2],
  redundancy: [1, 2],
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Compose a type's band with an instance magnitude into a 1-5 severity.
 *
 * Severity stays 1-5 so `computeSignificance`'s arithmetic is unchanged: with
 * relevance and severity both 1-5, `0.55r + 0.45s` scaled by 2 still lands in
 * 2-10 before dimension weight.
 *
 * The true/false dock is applied AFTER band resolution and is unchanged from
 * `severityFromCorruption`: selecting one of four named alternatives says more
 * about a learner's model than flipping a single bit. It is not a guess-rate
 * adjustment — guess rate discounts CORRECT answers.
 */
export function resolveSeverity(input: {
  type: string
  /** 1-10. `MC_TF_MAGNITUDE` for a generated distractor. */
  magnitude: number
  mode: StudySource
  bands?: BandTable
}): number {
  const table = input.bands ?? DEFAULT_BANDS
  const [floor, ceiling] = table[input.type] ?? FALLBACK_BAND
  const magnitude = clamp(input.magnitude, 1, 10)

  const interpolated = floor + (ceiling - floor) * ((magnitude - 1) / 9)
  const docked = input.mode === 'quiz-tf' ? interpolated - 1 : interpolated

  return clamp(Math.round(docked), 1, 5)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/bands.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors/bands.ts tests/errors/bands.test.ts
git commit -m "feat(spec3): add per-type severity bands with magnitude interpolation"
```

---

### Task 3: Add `magnitude` and `mode` to AnswerErrorTag

**Files:**
- Modify: `prisma/schema.prisma` (model `AnswerErrorTag`, around line 444)

**Interfaces:**
- Consumes: nothing
- Produces: `AnswerErrorTag.magnitude: Int?` and `AnswerErrorTag.mode: String?` readable by Tasks 5, 6, 12

**Why `mode` too.** `resolveSeverity` applies the true/false dock, so mode is now an *input* to severity — and read-time derivation cannot recover it. `AnswerErrorTag` stores no mode today, and reconstructing it by joining a sibling `AnswerKlpResult` fails for whole-answer tags, which have no KLP result to join to. Storing it follows the rule already governing this table: persist the inputs, derive the rest.

- [ ] **Step 1: Add the columns**

In `prisma/schema.prisma`, inside `model AnswerErrorTag`, directly after the `severity` line:

```prisma
  magnitude      Int?       // 1-10 instance magnitude; NULL means a legacy row
  mode           String?    // StudySource at answer time; NULL means a legacy row
```

Update the model's doc comment to record why null is meaningful:

```prisma
/// `magnitude` and `mode` are written on every row from Spec 3 onward —
/// the AI's 1-10 for short answer, MC_TF_MAGNITUDE for a generated distractor.
/// NULL therefore means "legacy row" and nothing else, which is what lets the
/// read path tell a pre-migration row (use stored `severity`) from a
/// full-magnitude one. `mode` is stored because it is an INPUT to severity —
/// the true/false dock — and a whole-answer tag has no AnswerKlpResult to
/// recover it from.
```

- [ ] **Step 2: Create and apply the migration**

Run: `npx prisma migrate dev --name add_error_tag_magnitude_and_mode`
Expected: migration created and applied; `npx prisma generate` runs automatically.

- [ ] **Step 3: Verify the client type**

Run: `npx tsc --noEmit`
Expected: no errors. `magnitude` is now `number | null` and `mode` is `string | null` on the generated type.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(spec3): add AnswerErrorTag.magnitude and mode, null meaning legacy"
```

---

### Task 4: Ask the grader for magnitude instead of severity

**Files:**
- Modify: `src/lib/ai/schemas.ts:46-53` (the `errorTags` array)
- Modify: `src/lib/ai/prompts/grade-short-answer.ts:78` and the prompt's `version`
- Test: `tests/ai/grade-short-answer-prompt.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `ShortAnswerGrade.errorTags[].magnitude: number` (1-10) replacing `.severity`; `GRADE_SHORT_ANSWER_PROMPT.version === 3`

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/grade-short-answer-prompt.test.ts
import { describe, it, expect } from 'vitest'
import { GRADE_SHORT_ANSWER_PROMPT } from '@/lib/ai/prompts/grade-short-answer'
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas'

const card = { term: 'WACC', definition: 'Weighted average cost of capital' } as any

describe('magnitude replaces severity in the grading contract', () => {
  it('asks for a 1-10 magnitude and never a 1-5 severity', () => {
    const text = GRADE_SHORT_ANSWER_PROMPT.build({
      card,
      answer: 'something',
      klps: [{ ref: 0, kind: 'definition', text: 'WACC weights by market value' }],
    })
    expect(text).toContain('magnitude')
    expect(text).not.toContain('"severity"')
  })

  it('accepts a magnitude of 10 and rejects 11', () => {
    const base = {
      clarity: { score: 5, pros: [], cons: [] },
      conciseness: { score: 5, pros: [], cons: [] },
      correctness: { score: 5, pros: [], cons: [] },
      overall: 5,
      summary: 's',
      suggestedImprovement: 'i',
    }
    const tag = { dimension: 'accuracy' as const, type: 'inversion', magnitude: 10 }

    expect(ShortAnswerGradeSchema.safeParse({ ...base, errorTags: [tag] }).success).toBe(true)
    expect(
      ShortAnswerGradeSchema.safeParse({ ...base, errorTags: [{ ...tag, magnitude: 11 }] }).success,
    ).toBe(false)
  })

  it('omits the analysis body entirely when no KLPs are supplied', () => {
    const text = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'a' })
    expect(text).not.toContain('magnitude')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/grade-short-answer-prompt.test.ts`
Expected: FAIL — the prompt still says `"severity" 1-5` and the schema rejects `magnitude`.

- [ ] **Step 3: Update the schema**

In `src/lib/ai/schemas.ts`, replace the `severity` line inside `errorTags` (line 51) with:

```ts
    magnitude: z.number().int().min(1).max(10),
```

And update the comment above it (lines 41-45):

```ts
  /**
   * `type` is z.string(), not an enum: it is validated against its OWN
   * dimension in TS (buildAnalysisWrites), which a flat enum cannot express.
   * `magnitude` is the AI's ONLY numeric contribution — how bad THIS instance
   * is within its type. The type's band converts it to a 1-5 severity in TS
   * (src/lib/errors/bands.ts); the model never sees the band.
   */
```

- [ ] **Step 4: Update the prompt**

In `src/lib/ai/prompts/grade-short-answer.ts`, replace line 78 with:

```ts
  - "magnitude" 1-10, how severe THIS instance of that type is. 1 is a
    borderline case barely worth tagging; 10 is the most severe form of this
    error you could see. Judge degree WITHIN the type you chose — do not use
    it to rank one type against another.
```

Bump the prompt version (line 96) from `2` to `3`, and add to its doc comment:

```ts
 * v3 (Stage 8 Spec 3): `severity` (absolute 1-5) is replaced by `magnitude`
 * (1-10, degree within the chosen type). The band table in TS converts it to
 * severity, which keeps the model out of cross-type ranking — a judgment it
 * has no stable anchor for.
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/ai/grade-short-answer-prompt.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full suite to catch dependents**

Run: `npm test`
Expected: failures only in tests that construct `errorTags` with `severity` — these are fixed in Task 5. Note which files fail.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/schemas.ts src/lib/ai/prompts/grade-short-answer.ts tests/ai/grade-short-answer-prompt.test.ts
git commit -m "feat(spec3): grading asks for a 1-10 magnitude, not an absolute severity"
```

---

### Task 5: Persist magnitude and bump the analysis version

**Files:**
- Modify: `src/lib/analysis/persist.ts` (`ErrorTagDraft`, `AnalysisWrites`, `buildAnalysisWrites`, `ANALYSIS_VERSION`)
- Modify: whichever call site builds MC/TF drafts (find with `grep -rn "severityFromCorruption" src/`)
- Test: `tests/analysis/persist.test.ts` (existing — update)

**Interfaces:**
- Consumes: `resolveSeverity`, `MC_TF_MAGNITUDE` from Task 2
- Produces: `AnalysisWrites.errorTags[].magnitude: number`; `ANALYSIS_VERSION === 2`

- [ ] **Step 1: Write the failing test**

Append to `tests/analysis/persist.test.ts`:

```ts
describe('magnitude persistence (Spec 3)', () => {
  it('stores magnitude alongside the derived severity for short answer', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      klpResults: [],
      errorTags: [
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: 1 },
      ],
    })

    expect(result.errorTags[0].magnitude).toBe(1)
    // inversion band [2,5] at magnitude 1 -> floor
    expect(result.errorTags[0].severity).toBe(2)
  })

  it('writes MC_TF_MAGNITUDE for a multiple-choice tag so null stays legacy-only', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-mc',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      klpResults: [],
      errorTags: [
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: MC_TF_MAGNITUDE },
      ],
    })

    expect(result.errorTags[0].magnitude).toBe(MC_TF_MAGNITUDE)
    expect(result.errorTags[0].severity).toBe(5)
  })

  it('still caps per dimension by the derived severity', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      klpResults: [],
      errorTags: [
        { dimension: 'conciseness', type: 'redundancy', magnitude: 1 },
        { dimension: 'conciseness', type: 'kitchen_sink', magnitude: 10 },
        { dimension: 'conciseness', type: 'rambling', magnitude: 10 },
      ],
    })

    const kept = result.errorTags.filter((t) => t.dimension === 'conciseness')
    expect(kept).toHaveLength(2)
    expect(kept.map((t) => t.type)).toContain('kitchen_sink')
    expect(kept.map((t) => t.type)).not.toContain('redundancy')
  })
})
```

Add the imports at the top of that file:

```ts
import { MC_TF_MAGNITUDE } from '@/lib/errors/bands'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/analysis/persist.test.ts`
Expected: FAIL — `magnitude` is not a property of `ErrorTagDraft`.

- [ ] **Step 3: Update persist.ts**

Change `ANALYSIS_VERSION` (line 18) to `2`, and extend its comment:

```ts
 * v2 (Spec 3): severity is now derived from a type band and an instance
 * magnitude, so a v1 row's severity is not comparable to a v2 row's.
```

Replace `severity` with `magnitude` in `ErrorTagDraft` (line 39):

```ts
  /** 1-10 instance magnitude. `MC_TF_MAGNITUDE` for a generated distractor. */
  magnitude: number
```

Add `magnitude` to the `AnalysisWrites.errorTags` element type (after line 63):

```ts
    magnitude: number
```

Add the import:

```ts
import { resolveSeverity } from '@/lib/errors/bands'
```

Inside the tag loop, replace the `computeSignificance` call (lines 138-143) with:

```ts
    const severity = resolveSeverity({
      type: t.type,
      magnitude: t.magnitude,
      mode: input.mode,
    })

    const sig = computeSignificance({
      relevance: target?.weight ?? WHOLE_ANSWER_RELEVANCE,
      severity,
      dimension: t.dimension,
      starred: input.starred,
    })
```

And add `magnitude` to the pushed object (after line 152):

```ts
      magnitude: t.magnitude,
```

- [ ] **Step 4: Update the MC/TF call site**

Run: `grep -rn "severityFromCorruption" src/`

At each call site building an `ErrorTagDraft` from a distractor's corruption, replace the `severity: severityFromCorruption(...)` field with:

```ts
      magnitude: MC_TF_MAGNITUDE,
```

importing `MC_TF_MAGNITUDE` from `@/lib/errors/bands`. The band resolution now applies the true/false dock, so `severityFromCorruption` is no longer called there.

**Delete `severityFromCorruption` from `src/lib/errors/severity.ts`, and keep `CORRUPTION_SEVERITY`.** The band table supersedes the function, and leaving it would be dead code. The constant stays because Task 2's test imports it to pin the no-op property — that is what makes the ceilings provably correct rather than merely asserted. Move the function's doc comment about the true/false dock (its rationale — a wrong answer is a deliberate choice, not luck, so this is not a guess-rate adjustment) onto `resolveSeverity` in `bands.ts`, where the dock now lives. Fix any other importer the grep in Step 4 turns up.

- [ ] **Step 5: Persist the columns in the writing action**

Run: `grep -rn "answerErrorTag.create\|answerErrorTag.createMany" src/`

Add both fields to the data object at each site:

```ts
        magnitude: tag.magnitude,
        mode: tag.mode,
```

`mode` comes from `AnalysisWrites`, so also add it to the `errorTags` element type in `persist.ts` (beside `magnitude`) and set it in the pushed object from `input.mode`:

```ts
      mode: input.mode,
```

- [ ] **Step 6: Retire the assertions Task 4 superseded**

Task 4 left `tests/ai/prompts.test.ts` with two knowingly-red assertions — `is version 2` and `asks for severity but NEVER for significance` — because they assert the prompt version and wording that Task 4 changed. Task 4 added a new, disjoint test file rather than editing them, so they are superseded, not broken.

Update them here: the version assertion becomes `3`, and the severity assertion becomes the magnitude wording. **Keep the "NEVER for significance" half intact** — significance is computed in TypeScript and must never be asked of the model, which is a live invariant, not a stale one.

- [ ] **Step 7: Run the full suite and type-check**

Run: `npm test && npx tsc --noEmit`
Expected: both PASS, with zero known-red tests remaining.

`tsc` is not optional here. Vitest does not type-check, so a fixture that still passes `severity` to a draft can pass at runtime while being wrong — Task 4 confirmed this. Before this task, `tsc` reported exactly two errors, both in `src/actions/quiz.ts` (around lines 970 and 1083), both "Property 'severity' is missing ... required in type 'ErrorTagDraft'". Both must be gone. Renaming the field on `ErrorTagDraft` will surface further stale fixtures that Vitest alone would hide; fix each to pass `magnitude`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/analysis/persist.ts src/lib/errors/severity.ts src/actions tests
git commit -m "feat(spec3): persist tag magnitude and derive severity from bands"
```

---

### Task 6: Read-time derivation with repeatBonus

**Files:**
- Create: `src/lib/errors/derive.ts`
- Test: `tests/errors/derive.test.ts`

**Interfaces:**
- Consumes: `resolveSeverity`, `BandTable` (Task 2); `computeSignificance` from `@/lib/errors/significance`
- Produces: `interface StoredTag`, `interface DerivedTag`, `interface RawTagRow`, `REPEAT_BONUS = 1`, `REPEAT_WINDOW_ATTEMPTS = 3`, `toStoredTags(rows: RawTagRow[]): StoredTag[]`, `deriveTagScores(tags: StoredTag[], bands?: BandTable): DerivedTag[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/derive.test.ts
import { describe, it, expect } from 'vitest'
import { deriveTagScores, toStoredTags, type StoredTag } from '@/lib/errors/derive'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const minsAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000)

function tag(overrides: Partial<StoredTag> & { attemptId: string }): StoredTag {
  return {
    dimension: 'accuracy',
    type: 'inversion',
    klpId: 'klp1',
    relevance: 3,
    starred: false,
    magnitude: 10,
    storedSeverity: 5,
    storedSignificance: 8,
    mode: 'quiz-sa',
    createdAt: NOW,
    ...overrides,
  }
}

describe('derivation from magnitude', () => {
  it('recomputes severity from the band rather than trusting the stored value', () => {
    const [derived] = deriveTagScores([tag({ attemptId: 'a1', magnitude: 1, storedSeverity: 5 })])
    expect(derived.severity).toBe(2) // inversion band [2,5] at magnitude 1
  })

  it('honours a caller-supplied band table', () => {
    const [derived] = deriveTagScores(
      [tag({ attemptId: 'a1', magnitude: 10 })],
      { inversion: [1, 2] },
    )
    expect(derived.severity).toBe(2)
  })
})

describe('legacy rows', () => {
  it('falls back to the stored severity when magnitude is null', () => {
    const [derived] = deriveTagScores([
      tag({ attemptId: 'a1', magnitude: null, storedSeverity: 4 }),
    ])
    expect(derived.severity).toBe(4)
    expect(derived.isLegacy).toBe(true)
  })
})

describe('repeatBonus', () => {
  it('adds +1 when the same (type, target) recurs within the last 3 attempts', () => {
    const tags = [
      tag({ attemptId: 'a1', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', createdAt: minsAgo(20) }),
    ]
    const derived = deriveTagScores(tags)
    expect(derived[0].repeatBonus).toBe(0)
    expect(derived[1].repeatBonus).toBe(1)
  })

  it('does not fire across a different type on the same KLP', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', type: 'inversion', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', type: 'omission', createdAt: minsAgo(20) }),
    ])
    expect(derived[1].repeatBonus).toBe(0)
  })

  it('does not fire once the earlier occurrence is more than 3 attempts back', () => {
    const derived = deriveTagScores([
      tag({ attemptId: 'a1', createdAt: minsAgo(50) }),
      tag({ attemptId: 'a2', type: 'omission', createdAt: minsAgo(40) }),
      tag({ attemptId: 'a3', type: 'omission', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a4', type: 'omission', createdAt: minsAgo(20) }),
      tag({ attemptId: 'a5', createdAt: minsAgo(10) }),
    ])
    expect(derived[4].repeatBonus).toBe(0)
  })

  it('never pushes significance above 10', () => {
    const tags = [
      tag({ attemptId: 'a1', relevance: 5, starred: true, createdAt: minsAgo(30) }),
      tag({ attemptId: 'a2', relevance: 5, starred: true, createdAt: minsAgo(20) }),
    ]
    const derived = deriveTagScores(tags)
    expect(derived[1].significance).toBeLessThanOrEqual(10)
  })
})

describe('toStoredTags', () => {
  const row = (o: any = {}) => ({
    dimension: 'accuracy', type: 'inversion', klpId: 'klp1',
    relevance: 3, starred: false, magnitude: 8, mode: 'quiz-mc',
    severity: 4, significance: 7, createdAt: NOW,
    quizAnswer: { attemptId: 'att1' },
    ...o,
  })

  it('lifts the attemptId out of the joined answer', () => {
    expect(toStoredTags([row()])[0].attemptId).toBe('att1')
  })

  it('falls back to quiz-sa for a legacy row with no stored mode', () => {
    // quiz-sa is the only mode with no dock, so a legacy tag is never docked
    // on a guess. Its severity comes from storedSeverity regardless.
    const stored = toStoredTags([row({ mode: null, magnitude: null })])
    expect(stored[0].mode).toBe('quiz-sa')
    expect(stored[0].magnitude).toBeNull()
    expect(stored[0].storedSeverity).toBe(4)
  })

  it('preserves a stored mode when present', () => {
    expect(toStoredTags([row({ mode: 'quiz-tf' })])[0].mode).toBe('quiz-tf')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/errors/derive.test.ts`
Expected: FAIL — cannot resolve `@/lib/errors/derive`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/errors/derive.ts
import type { StudySource } from '@/lib/memory/scoring'
import type { Dimension } from '@/lib/errors/taxonomy'
import { computeSignificance } from '@/lib/errors/significance'
import { resolveSeverity, type BandTable } from '@/lib/errors/bands'

/** Per the frozen taxonomy reference §3. */
export const REPEAT_BONUS = 1
export const REPEAT_WINDOW_ATTEMPTS = 3

/** An AnswerErrorTag row as read, plus the attempt it belongs to. */
export interface StoredTag {
  attemptId: string
  dimension: Dimension
  type: string
  klpId: string | null
  relevance: number
  starred: boolean
  /** Null on rows written before Spec 3. */
  magnitude: number | null
  storedSeverity: number
  storedSignificance: number
  mode: StudySource
  createdAt: Date
}

/** An AnswerErrorTag row as Prisma returns it, with its answer joined. */
export interface RawTagRow {
  dimension: string
  type: string
  klpId: string | null
  relevance: number
  starred: boolean
  magnitude: number | null
  mode: string | null
  severity: number
  significance: number
  createdAt: Date
  quizAnswer: { attemptId: string }
}

/**
 * Map DB rows to the pure shape. Lives here, not in the read shell, so the
 * legacy-mode fallback is a tested decision rather than an untested one.
 *
 * A legacy row stores no mode. `quiz-sa` is the safe stand-in because it is
 * the only mode with no true/false dock — so a legacy tag is never docked on
 * a guess. Its severity comes from `storedSeverity` regardless, since a
 * legacy row also has no magnitude.
 */
export function toStoredTags(rows: RawTagRow[]): StoredTag[] {
  return rows.map((r) => ({
    attemptId: r.quizAnswer.attemptId,
    dimension: r.dimension as StoredTag['dimension'],
    type: r.type,
    klpId: r.klpId,
    relevance: r.relevance,
    starred: r.starred,
    magnitude: r.magnitude,
    mode: (r.mode ?? 'quiz-sa') as StoredTag['mode'],
    storedSeverity: r.severity,
    storedSignificance: r.significance,
    createdAt: r.createdAt,
  }))
}

export interface DerivedTag extends StoredTag {
  severity: number
  repeatBonus: number
  significance: number
  /** True when the row predates `magnitude` and its severity could not be rederived. */
  isLegacy: boolean
}

/**
 * Recompute severity and significance from stored inputs, then apply
 * `repeatBonus` — which cannot be frozen at write time because it depends on
 * whether the same (type, target) recurs in LATER attempts.
 *
 * Tags are processed in chronological order so each one sees only what came
 * before it. Callers may pass an unsorted array.
 */
export function deriveTagScores(tags: StoredTag[], bands?: BandTable): DerivedTag[] {
  const chronological = [...tags].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  // Attempt order, oldest first, so "within the last N attempts" is countable.
  const attemptOrder: string[] = []
  for (const t of chronological) {
    if (!attemptOrder.includes(t.attemptId)) attemptOrder.push(t.attemptId)
  }
  const attemptIndex = new Map(attemptOrder.map((id, i) => [id, i]))

  const seen: { key: string; attemptIdx: number }[] = []
  const out: DerivedTag[] = []

  for (const t of chronological) {
    const isLegacy = t.magnitude === null
    const severity = isLegacy
      ? t.storedSeverity
      : resolveSeverity({ type: t.type, magnitude: t.magnitude as number, mode: t.mode, bands })

    const key = `${t.type}::${t.klpId ?? 'whole'}`
    const here = attemptIndex.get(t.attemptId) ?? 0
    const repeated = seen.some(
      (s) => s.key === key && here - s.attemptIdx <= REPEAT_WINDOW_ATTEMPTS && here !== s.attemptIdx,
    )
    const repeatBonus = repeated ? REPEAT_BONUS : 0
    seen.push({ key, attemptIdx: here })

    const base = computeSignificance({
      relevance: t.relevance,
      severity,
      dimension: t.dimension,
      starred: t.starred,
    })

    out.push({
      ...t,
      severity,
      repeatBonus,
      significance: Math.min(10, base.significance + repeatBonus),
      isLegacy,
    })
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/errors/derive.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors/derive.ts tests/errors/derive.test.ts
git commit -m "feat(spec3): derive severity and significance at read time with repeatBonus"
```

---

### Task 7: Per-KLP Bayesian Knowledge Tracing

**Files:**
- Create: `src/lib/metrics/bkt.ts`
- Test: `tests/metrics/bkt.test.ts`

**Interfaces:**
- Consumes: `EVIDENCE_STRENGTH`, `STATUS_CREDIT`, `KlpStatus` from `@/lib/errors/klp-credit`; `StudySource` from `@/lib/memory/scoring`
- Produces: `BKT_PRIOR`, `BKT_LEARN`, `BKT_SLIP`, `MIN_OBSERVATIONS`, `guessRate(mode)`, `interface KlpObservation`, `interface BktResult`, `traceKlp(observations: KlpObservation[]): BktResult`, `stepBkt(pKnown: number, obs: KlpObservation): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/bkt.test.ts
import { describe, it, expect } from 'vitest'
import { guessRate, traceKlp, stepBkt, MIN_OBSERVATIONS, BKT_PRIOR } from '@/lib/metrics/bkt'
import { EVIDENCE_STRENGTH } from '@/lib/errors/klp-credit'
import type { KlpObservation } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const obs = (o: Partial<KlpObservation> = {}): KlpObservation => ({
  status: 'passed',
  mode: 'quiz-mc',
  createdAt: NOW,
  ...o,
})

describe('guess rate is derived, never re-declared', () => {
  it('equals 1 - EVIDENCE_STRENGTH for every documented mode', () => {
    expect(guessRate('quiz-mc')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-mc'], 10)
    expect(guessRate('quiz-tf')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-tf'], 10)
    expect(guessRate('quiz-sa')).toBeCloseTo(1 - EVIDENCE_STRENGTH['quiz-sa'], 10)
  })

  it('yields the rates CLAUDE.md specifies', () => {
    expect(guessRate('quiz-mc')).toBeCloseTo(0.25, 10)
    expect(guessRate('quiz-tf')).toBeCloseTo(0.5, 10)
    expect(guessRate('quiz-sa')).toBeCloseTo(0.05, 10)
  })
})

describe('no ceiling on repeated correct multiple choice', () => {
  it('converges toward 1, not toward the ~0.76 fixed point credit would create', () => {
    const observations = Array.from({ length: 100 }, () => obs({ status: 'passed', mode: 'quiz-mc' }))
    const result = traceKlp(observations)
    expect(result.pKnown).toBeGreaterThan(0.99)
  })

  it('rises monotonically across a run of correct answers', () => {
    let p = BKT_PRIOR
    const seen: number[] = []
    for (let i = 0; i < 20; i++) {
      p = stepBkt(p, obs({ status: 'passed', mode: 'quiz-mc' }))
      seen.push(p)
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1])
    }
  })
})

describe('evidence strength by mode', () => {
  it('moves further on a correct short answer than a correct true/false', () => {
    const sa = stepBkt(BKT_PRIOR, obs({ status: 'passed', mode: 'quiz-sa' }))
    const tf = stepBkt(BKT_PRIOR, obs({ status: 'passed', mode: 'quiz-tf' }))
    expect(sa).toBeGreaterThan(tf)
  })

  it('drops pKnown on a failure in every mode', () => {
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      const after = stepBkt(0.8, obs({ status: 'failed', mode }))
      expect(after, mode).toBeLessThan(0.8)
    }
  })

  it('treats partial as between passed and failed', () => {
    const passed = stepBkt(0.5, obs({ status: 'passed', mode: 'quiz-sa' }))
    const partial = stepBkt(0.5, obs({ status: 'partial', mode: 'quiz-sa' }))
    const failed = stepBkt(0.5, obs({ status: 'failed', mode: 'quiz-sa' }))
    expect(partial).toBeLessThan(passed)
    expect(partial).toBeGreaterThan(failed)
  })
})

describe('observation floor', () => {
  it('reports observations so callers can refuse to judge on thin data', () => {
    const result = traceKlp([obs(), obs()])
    expect(result.observations).toBe(2)
    expect(result.observations).toBeLessThan(MIN_OBSERVATIONS)
  })

  it('returns the prior with zero observations rather than null', () => {
    const result = traceKlp([])
    expect(result.pKnown).toBe(BKT_PRIOR)
    expect(result.observations).toBe(0)
  })
})

describe('chronological replay', () => {
  it('is order-independent at the input boundary — unsorted input is sorted first', () => {
    const early = obs({ status: 'failed', createdAt: new Date('2026-08-01T00:00:00Z') })
    const late = obs({ status: 'passed', createdAt: new Date('2026-08-04T00:00:00Z') })
    expect(traceKlp([late, early]).pKnown).toBeCloseTo(traceKlp([early, late]).pKnown, 10)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/bkt.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/bkt`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/bkt.ts
import { EVIDENCE_STRENGTH, STATUS_CREDIT, type KlpStatus } from '@/lib/errors/klp-credit'
import type { StudySource } from '@/lib/memory/scoring'

/** P(knew it before any evidence). */
export const BKT_PRIOR = 0.25
/** P(learns it on this opportunity, given they did not know it). */
export const BKT_LEARN = 0.1
/** P(gets it wrong despite knowing it). */
export const BKT_SLIP = 0.1
/** Below this, no caller may describe a KLP as weak or strong. */
export const MIN_OBSERVATIONS = 3

/** Fallback for a mode with no documented evidence strength. */
const DEFAULT_GUESS = 1 - 0.75

/**
 * P(gets it right without knowing it).
 *
 * DERIVED from `EVIDENCE_STRENGTH`, which documents itself as `1 - guessRate`.
 * Writing 0.25 / 0.5 / 0.05 here a second time is the persisted-value-in-two-
 * places drift class Spec 2a keeps flagging; a test pins the equality so a
 * change to either side is a build failure.
 */
export function guessRate(mode: StudySource): number {
  const strength = EVIDENCE_STRENGTH[mode]
  return strength === undefined ? DEFAULT_GUESS : 1 - strength
}

export interface KlpObservation {
  status: KlpStatus
  mode: StudySource
  createdAt: Date
}

export interface BktResult {
  pKnown: number
  observations: number
}

/**
 * One BKT update.
 *
 * Reads `status` and `mode` UNMULTIPLIED and never the stored `credit` float.
 * `credit` is `STATUS_CREDIT x EVIDENCE_STRENGTH` — two quantities belonging in
 * two different positions here: `STATUS_CREDIT` in the mixing weight,
 * `EVIDENCE_STRENGTH` inside the likelihood via `guess`. Feeding the product as
 * the mixing weight applies the mode discount twice and creates a fixed point
 * (~0.76 for MC), so a learner answering correctly a hundred times running
 * could never be modelled as knowing it.
 */
export function stepBkt(pKnown: number, obs: KlpObservation): number {
  const guess = guessRate(obs.mode)
  const slip = BKT_SLIP

  const correctNum = pKnown * (1 - slip)
  const correctDen = correctNum + (1 - pKnown) * guess
  const pIfCorrect = correctDen === 0 ? pKnown : correctNum / correctDen

  const wrongNum = pKnown * slip
  const wrongDen = wrongNum + (1 - pKnown) * (1 - guess)
  const pIfWrong = wrongDen === 0 ? pKnown : wrongNum / wrongDen

  // The CATEGORICAL fraction only — mode never enters the mixing weight.
  const c = STATUS_CREDIT[obs.status]
  const posterior = c * pIfCorrect + (1 - c) * pIfWrong

  // Learning opportunity.
  return posterior + (1 - posterior) * BKT_LEARN
}

/**
 * Replay a KLP's observations chronologically. Input may be unsorted; the
 * result must not depend on the order rows came back from the database.
 */
export function traceKlp(observations: KlpObservation[]): BktResult {
  const chronological = [...observations].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  )

  let pKnown = BKT_PRIOR
  for (const obs of chronological) pKnown = stepBkt(pKnown, obs)

  return { pKnown, observations: chronological.length }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/bkt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/bkt.ts tests/metrics/bkt.test.ts
git commit -m "feat(spec3): add per-KLP Bayesian Knowledge Tracing"
```

---

### Task 8: Latency index

**Files:**
- Create: `src/lib/metrics/pace.ts`
- Test: `tests/metrics/pace.test.ts`

**Interfaces:**
- Consumes: `StudySource`
- Produces: `MIN_TIMED_OBSERVATIONS = 3`, `interface TimedEvent`, `paceIndex(events: TimedEvent[], cardId: string, mode: StudySource): number | null`, `medianOf(values: number[]): number | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/pace.test.ts
import { describe, it, expect } from 'vitest'
import { paceIndex, medianOf, MIN_TIMED_OBSERVATIONS } from '@/lib/metrics/pace'
import type { TimedEvent } from '@/lib/metrics/pace'

const ev = (cardId: string, latencyMs: number, mode: TimedEvent['mode'] = 'quiz-sa'): TimedEvent => ({
  cardId,
  mode,
  latencyMs,
})

describe('medianOf', () => {
  it('returns null for an empty list rather than 0', () => {
    expect(medianOf([])).toBeNull()
  })

  it('averages the middle pair for an even count', () => {
    expect(medianOf([10, 20, 30, 40])).toBe(25)
  })
})

describe('paceIndex', () => {
  const baseline = [ev('other1', 1000), ev('other2', 1000), ev('other3', 1000)]

  it('returns 1 when the card matches the learner baseline', () => {
    const events = [...baseline, ev('c1', 1000), ev('c1', 1000), ev('c1', 1000)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns above 1 for effortful retrieval', () => {
    const events = [...baseline, ev('c1', 2400), ev('c1', 2400), ev('c1', 2400)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeGreaterThan(2)
  })

  it('returns null below the observation floor rather than a one-sample ratio', () => {
    const events = [...baseline, ev('c1', 5000)]
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeNull()
    expect(MIN_TIMED_OBSERVATIONS).toBe(3)
  })

  it('never compares across modes — short answer and true/false differ by an order of magnitude', () => {
    const events = [
      ev('c1', 8000, 'quiz-sa'), ev('c1', 8000, 'quiz-sa'), ev('c1', 8000, 'quiz-sa'),
      ev('o1', 8000, 'quiz-sa'), ev('o2', 8000, 'quiz-sa'), ev('o3', 8000, 'quiz-sa'),
      ev('o1', 500, 'quiz-tf'), ev('o2', 500, 'quiz-tf'), ev('o3', 500, 'quiz-tf'),
    ]
    // The fast TF baseline must not inflate the SA index.
    expect(paceIndex(events, 'c1', 'quiz-sa')).toBeCloseTo(1, 5)
  })

  it('returns null when the mode has no baseline at all', () => {
    expect(paceIndex([ev('c1', 100, 'quiz-sa')], 'c1', 'quiz-tf')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/pace.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/pace`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/pace.ts
import type { StudySource } from '@/lib/memory/scoring'

/** Below this many timed answers on a card, no ratio is reported. */
export const MIN_TIMED_OBSERVATIONS = 3

export interface TimedEvent {
  cardId: string
  mode: StudySource
  latencyMs: number
}

export function medianOf(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * A card's median response time over the learner's own median IN THAT MODE.
 *
 * Mode-scoped because short answer and true/false differ by an order of
 * magnitude — a cross-mode ratio measures the mode, not the card. `> 1` is
 * effortful retrieval, `< 1` fluent. This is what separates "correct" from
 * "actually known": a card answered right at 2.4x baseline is not mastered.
 */
export function paceIndex(
  events: TimedEvent[],
  cardId: string,
  mode: StudySource,
): number | null {
  const inMode = events.filter((e) => e.mode === mode)
  const cardTimes = inMode.filter((e) => e.cardId === cardId).map((e) => e.latencyMs)
  if (cardTimes.length < MIN_TIMED_OBSERVATIONS) return null

  const cardMedian = medianOf(cardTimes)
  const baseline = medianOf(inMode.map((e) => e.latencyMs))
  if (cardMedian === null || baseline === null || baseline === 0) return null

  return cardMedian / baseline
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/pace.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/pace.ts tests/metrics/pace.test.ts
git commit -m "feat(spec3): add the mode-scoped latency index"
```

---

### Task 9: Empirical forgetting curve

**Files:**
- Create: `src/lib/metrics/forgetting.ts`
- Test: `tests/metrics/forgetting.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MIN_GAP_PAIRS = 5`, `GAP_BUCKETS`, `interface RecallPair`, `interface GapEvent`, `interface ForgettingCurve`, `toRecallPairs(events: GapEvent[]): RecallPair[]`, `buildForgettingCurve(pairs: RecallPair[]): ForgettingCurve | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/forgetting.test.ts
import { describe, it, expect } from 'vitest'
import { buildForgettingCurve, toRecallPairs, MIN_GAP_PAIRS } from '@/lib/metrics/forgetting'
import type { RecallPair } from '@/lib/metrics/forgetting'

const pair = (gapDays: number, recalled: boolean): RecallPair => ({ gapDays, recalled })

describe('insufficient data', () => {
  it('returns null below the pair floor rather than a curve from noise', () => {
    const pairs = Array.from({ length: MIN_GAP_PAIRS - 1 }, () => pair(1, true))
    expect(buildForgettingCurve(pairs)).toBeNull()
  })
})

describe('bucketing', () => {
  it('reports recall per bucket and omits buckets with no observations', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true), pair(0.5, false),
      pair(2, true), pair(2, false),
      pair(10, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    const under1d = curve.buckets.find((b) => b.label === '<1d')!
    expect(under1d.total).toBe(3)
    expect(under1d.recallRate).toBeCloseTo(2 / 3, 5)
    expect(curve.buckets.find((b) => b.label === '7-30d')).toBeUndefined()
  })
})

describe('half life', () => {
  it('interpolates where recall crosses 0.5', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true), pair(0.5, true), pair(0.5, true),
      pair(2, true), pair(2, false),
      pair(5, false), pair(5, false),
    ]
    const curve = buildForgettingCurve(pairs)!
    expect(curve.halfLifeDays).not.toBeNull()
    expect(curve.halfLifeDays!).toBeGreaterThan(0)
  })

  it('returns null half life when recall never falls to 0.5', () => {
    const pairs = [
      pair(0.5, true), pair(0.5, true),
      pair(2, true), pair(2, true),
      pair(10, true), pair(40, true),
    ]
    const curve = buildForgettingCurve(pairs)!
    expect(curve.halfLifeDays).toBeNull()
  })
})

describe('toRecallPairs', () => {
  const NOW = new Date('2026-08-05T12:00:00.000Z')
  const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

  it('pairs consecutive events on the same card and measures the gap in days', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c1', correct: false, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0].gapDays).toBeCloseTo(2, 5)
    expect(pairs[0].recalled).toBe(false)
  })

  it('never pairs across different cards', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c2', correct: true, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(0)
  })

  it('skips events with unknown correctness rather than guessing', () => {
    const pairs = toRecallPairs([
      { cardId: 'c1', correct: true, createdAt: at(5) },
      { cardId: 'c1', correct: null, createdAt: at(3) },
    ])
    expect(pairs).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/forgetting.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/forgetting`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/forgetting.ts

/** Below this many consecutive same-card pairs, no curve is reported. */
export const MIN_GAP_PAIRS = 5

export const GAP_BUCKETS = [
  { label: '<1d', maxDays: 1 },
  { label: '1-3d', maxDays: 3 },
  { label: '3-7d', maxDays: 7 },
  { label: '7-30d', maxDays: 30 },
  { label: '>30d', maxDays: Infinity },
] as const

export interface RecallPair {
  gapDays: number
  recalled: boolean
}

/** A scorable study event, for deriving gap pairs. */
export interface GapEvent {
  cardId: string
  correct: boolean | null
  createdAt: Date
}

/**
 * Turn a flat event log into consecutive same-card pairs: "they saw this N days
 * after last time — did they still have it?"
 *
 * Pure so the read shell stays a shell. Events with unknown correctness are
 * skipped rather than assumed, which also breaks the chain around them — a gap
 * spanning an unscored event is not a measured retention interval.
 */
export function toRecallPairs(events: GapEvent[]): RecallPair[] {
  const byCard = new Map<string, GapEvent[]>()
  for (const e of events) {
    if (e.correct === null) continue
    const list = byCard.get(e.cardId)
    if (list) list.push(e)
    else byCard.set(e.cardId, [e])
  }

  const pairs: RecallPair[] = []
  for (const list of byCard.values()) {
    const chronological = [...list].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    for (let i = 1; i < chronological.length; i++) {
      const gapMs = chronological[i].createdAt.getTime() - chronological[i - 1].createdAt.getTime()
      pairs.push({
        gapDays: gapMs / 86_400_000,
        recalled: chronological[i].correct === true,
      })
    }
  }
  return pairs
}

export interface ForgettingBucket {
  label: string
  /** Bucket midpoint in days, used for half-life interpolation. */
  centerDays: number
  recallRate: number
  total: number
}

export interface ForgettingCurve {
  buckets: ForgettingBucket[]
  halfLifeDays: number | null
}

function bucketFor(gapDays: number): (typeof GAP_BUCKETS)[number] {
  return GAP_BUCKETS.find((b) => gapDays < b.maxDays) ?? GAP_BUCKETS[GAP_BUCKETS.length - 1]
}

function centerOf(index: number): number {
  const lower = index === 0 ? 0 : GAP_BUCKETS[index - 1].maxDays
  const upper = GAP_BUCKETS[index].maxDays
  return upper === Infinity ? lower * 2 : (lower + upper) / 2
}

/**
 * An EMPIRICAL curve, deliberately not a fitted exponential. An optimizer over
 * a handful of sparse pairs returns a decay constant to three decimals the data
 * cannot support; buckets state only what was actually observed.
 */
export function buildForgettingCurve(pairs: RecallPair[]): ForgettingCurve | null {
  if (pairs.length < MIN_GAP_PAIRS) return null

  const buckets: ForgettingBucket[] = []
  GAP_BUCKETS.forEach((spec, i) => {
    const inBucket = pairs.filter((p) => bucketFor(p.gapDays).label === spec.label)
    if (inBucket.length === 0) return
    buckets.push({
      label: spec.label,
      centerDays: centerOf(i),
      recallRate: inBucket.filter((p) => p.recalled).length / inBucket.length,
      total: inBucket.length,
    })
  })

  return { buckets, halfLifeDays: interpolateHalfLife(buckets) }
}

/** Linear interpolation at the first 0.5 crossing. Null if it never crosses. */
function interpolateHalfLife(buckets: ForgettingBucket[]): number | null {
  for (let i = 1; i < buckets.length; i++) {
    const prev = buckets[i - 1]
    const curr = buckets[i]
    if (prev.recallRate >= 0.5 && curr.recallRate < 0.5) {
      const span = prev.recallRate - curr.recallRate
      if (span === 0) return curr.centerDays
      const t = (prev.recallRate - 0.5) / span
      return prev.centerDays + t * (curr.centerDays - prev.centerDays)
    }
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/forgetting.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/forgetting.ts tests/metrics/forgetting.test.ts
git commit -m "feat(spec3): add the empirical bucketed forgetting curve"
```

---

### Task 10: Session velocity and fatigue

**Files:**
- Create: `src/lib/metrics/session-shape.ts`
- Test: `tests/metrics/session-shape.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `MIN_ITEMS_FOR_SHAPE = 6`, `interface ShapeItem`, `interface SessionShape`, `sessionShape(items: ShapeItem[], durationMs: number): SessionShape | null`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/session-shape.test.ts
import { describe, it, expect } from 'vitest'
import { sessionShape, MIN_ITEMS_FOR_SHAPE } from '@/lib/metrics/session-shape'
import type { ShapeItem } from '@/lib/metrics/session-shape'

const item = (correct: boolean, latencyMs: number): ShapeItem => ({ correct, latencyMs })

describe('insufficient data', () => {
  it('returns null below 6 items — thirds of a 4-item quiz measure noise', () => {
    const items = Array.from({ length: MIN_ITEMS_FOR_SHAPE - 1 }, () => item(true, 1000))
    expect(sessionShape(items, 60_000)).toBeNull()
  })
})

describe('velocity', () => {
  it('reports items per minute', () => {
    const items = Array.from({ length: 12 }, () => item(true, 1000))
    expect(sessionShape(items, 120_000)!.itemsPerMinute).toBeCloseTo(6, 5)
  })

  it('returns null velocity for a zero duration rather than dividing by zero', () => {
    const items = Array.from({ length: 6 }, () => item(true, 1000))
    expect(sessionShape(items, 0)!.itemsPerMinute).toBeNull()
  })
})

describe('fatigue', () => {
  it('flags a session that degrades and slows across its thirds', () => {
    const items = [
      item(true, 1000), item(true, 1000),
      item(true, 1500), item(false, 1500),
      item(false, 3000), item(false, 3000),
    ]
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeLessThan(0)
    expect(shape.latencyRatio).toBeGreaterThan(1)
    expect(shape.fatigued).toBe(true)
  })

  it('does not flag a steady session', () => {
    const items = Array.from({ length: 9 }, () => item(true, 1000))
    const shape = sessionShape(items, 60_000)!
    expect(shape.accuracyDelta).toBeCloseTo(0, 5)
    expect(shape.fatigued).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/session-shape.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/session-shape`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/session-shape.ts

/** Splitting fewer items into thirds measures noise, not fatigue. */
export const MIN_ITEMS_FOR_SHAPE = 6

/** Accuracy must fall at least this far for the session to count as fatigued. */
const FATIGUE_ACCURACY_DROP = 0.15
/** ...and latency must rise by at least this factor. */
const FATIGUE_LATENCY_RATIO = 1.2

export interface ShapeItem {
  correct: boolean
  latencyMs: number
}

export interface SessionShape {
  itemsPerMinute: number | null
  /** Last third's accuracy minus the first third's. Negative means decline. */
  accuracyDelta: number
  /** Last third's mean latency over the first third's. Above 1 means slowing. */
  latencyRatio: number
  fatigued: boolean
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * Velocity and fatigue over one session, in the order items were answered.
 */
export function sessionShape(items: ShapeItem[], durationMs: number): SessionShape | null {
  if (items.length < MIN_ITEMS_FOR_SHAPE) return null

  const third = Math.floor(items.length / 3)
  const first = items.slice(0, third)
  const last = items.slice(items.length - third)

  const accuracyDelta =
    mean(last.map((i) => (i.correct ? 1 : 0))) - mean(first.map((i) => (i.correct ? 1 : 0)))

  const firstLatency = mean(first.map((i) => i.latencyMs))
  const latencyRatio = firstLatency === 0 ? 1 : mean(last.map((i) => i.latencyMs)) / firstLatency

  return {
    itemsPerMinute: durationMs > 0 ? items.length / (durationMs / 60_000) : null,
    accuracyDelta,
    latencyRatio,
    fatigued: accuracyDelta <= -FATIGUE_ACCURACY_DROP && latencyRatio >= FATIGUE_LATENCY_RATIO,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/session-shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/session-shape.ts tests/metrics/session-shape.test.ts
git commit -m "feat(spec3): add session velocity and fatigue"
```

---

### Task 11: Deterministic misconception promotion

Implements the frozen reference `docs/ai/error-taxonomy.md` §5 exactly.

**Files:**
- Create: `src/lib/metrics/misconceptions.ts`
- Test: `tests/metrics/misconceptions.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `PROMOTE_MIN_OCCURRENCES = 2`, `PROMOTE_MIN_SESSIONS = 2`, `RETIRE_AFTER_DAYS = 30`, `RETIRE_AFTER_CLEAN_ANSWERS = 3`, `interface ConflationTag`, `interface Misconception`, `interface KlpOutcome`, `computeCleanStreaks(outcomes: KlpOutcome[]): Record<string, number>`, `deriveMisconceptions(input): Misconception[]`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/misconceptions.test.ts
import { describe, it, expect } from 'vitest'
import { deriveMisconceptions, computeCleanStreaks } from '@/lib/metrics/misconceptions'
import type { ConflationTag } from '@/lib/metrics/misconceptions'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const daysAgo = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)

const tag = (o: Partial<ConflationTag> = {}): ConflationTag => ({
  klpId: 'a',
  secondaryKlpId: 'b',
  sessionId: 's1',
  quote: 'they are the same thing',
  createdAt: daysAgo(1),
  ...o,
})

describe('promotion', () => {
  it('promotes a pair at 2 occurrences across 2 distinct sessions', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(1)
    expect(result[0].klpId).toBe('a')
    expect(result[0].secondaryKlpId).toBe('b')
    expect(result[0].active).toBe(true)
  })

  it('does not promote two occurrences inside a single session', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's1' })],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(0)
  })

  it('keeps the verbatim quote from the triggering tag rather than regenerating', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ sessionId: 's1', quote: 'first' }),
        tag({ sessionId: 's2', quote: 'second' }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result[0].evidenceSnippet).toBe('second')
  })

  it('treats (a,b) and (b,a) as distinct pairs — direction is signal', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ klpId: 'a', secondaryKlpId: 'b', sessionId: 's1' }),
        tag({ klpId: 'b', secondaryKlpId: 'a', sessionId: 's2' }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result).toHaveLength(0)
  })
})

describe('retirement', () => {
  it('retires after 30 days with no recurrence', () => {
    const result = deriveMisconceptions({
      tags: [
        tag({ sessionId: 's1', createdAt: daysAgo(40) }),
        tag({ sessionId: 's2', createdAt: daysAgo(31) }),
      ],
      cleanStreaks: {},
      now: NOW,
    })
    expect(result[0].active).toBe(false)
    expect(result[0].retiredReason).toBe('stale')
  })

  it('retires after 3 consecutive clean answers on both KLPs', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: { a: 3, b: 3 },
      now: NOW,
    })
    expect(result[0].active).toBe(false)
    expect(result[0].retiredReason).toBe('cleared')
  })

  it('stays active when only one of the two KLPs is clean', () => {
    const result = deriveMisconceptions({
      tags: [tag({ sessionId: 's1' }), tag({ sessionId: 's2' })],
      cleanStreaks: { a: 3, b: 1 },
      now: NOW,
    })
    expect(result[0].active).toBe(true)
  })
})

describe('computeCleanStreaks', () => {
  it('counts consecutive passes back from the most recent outcome', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'failed', createdAt: daysAgo(5) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(3) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(2)
  })

  it('resets the streak at the most recent non-pass', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'passed', createdAt: daysAgo(5) },
      { klpId: 'a', status: 'passed', createdAt: daysAgo(3) },
      { klpId: 'a', status: 'partial', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(0)
  })

  it('tracks each KLP independently', () => {
    const streaks = computeCleanStreaks([
      { klpId: 'a', status: 'passed', createdAt: daysAgo(2) },
      { klpId: 'b', status: 'failed', createdAt: daysAgo(1) },
    ])
    expect(streaks.a).toBe(1)
    expect(streaks.b).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/misconceptions.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/misconceptions`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/misconceptions.ts

/** Frozen reference docs/ai/error-taxonomy.md §5. */
export const PROMOTE_MIN_OCCURRENCES = 2
export const PROMOTE_MIN_SESSIONS = 2
export const RETIRE_AFTER_DAYS = 30
export const RETIRE_AFTER_CLEAN_ANSWERS = 3

/** One `type = 'conflation'` error tag. */
export interface ConflationTag {
  klpId: string
  secondaryKlpId: string
  sessionId: string
  quote: string | null
  createdAt: Date
}

export interface Misconception {
  klpId: string
  secondaryKlpId: string
  occurrences: number
  sessionCount: number
  lastSeenAt: Date
  /** The verbatim learner quote from the triggering tag. Never regenerated. */
  evidenceSnippet: string | null
  active: boolean
  retiredReason: 'stale' | 'cleared' | null
}

/** One per-KLP outcome, for streak counting. */
export interface KlpOutcome {
  klpId: string
  status: 'passed' | 'partial' | 'failed'
  createdAt: Date
}

/**
 * Consecutive `passed` outcomes per KLP, counted back from the most recent.
 *
 * `partial` breaks a streak: retirement means the confusion is gone, and a
 * half-right answer is not evidence of that.
 */
export function computeCleanStreaks(outcomes: KlpOutcome[]): Record<string, number> {
  const byKlp = new Map<string, KlpOutcome[]>()
  for (const o of outcomes) {
    const list = byKlp.get(o.klpId)
    if (list) list.push(o)
    else byKlp.set(o.klpId, [o])
  }

  const streaks: Record<string, number> = {}
  for (const [klpId, list] of byKlp) {
    const newestFirst = [...list].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )
    let streak = 0
    for (const o of newestFirst) {
      if (o.status !== 'passed') break
      streak++
    }
    streaks[klpId] = streak
  }
  return streaks
}

/**
 * Derive misconceptions from accumulated conflation tags.
 *
 * A model asked to NAME a misconception invents fresh phrasing every time and
 * the same confusion never aggregates with itself — so the entity is derived
 * here, deterministically, and only its human-readable label is ever an AI
 * call.
 *
 * `(a,b)` and `(b,a)` are deliberately distinct: describing WACC using CAPM's
 * content is a different error from the reverse.
 */
export function deriveMisconceptions(input: {
  tags: ConflationTag[]
  /** Consecutive clean answers per klpId, as of now. */
  cleanStreaks: Record<string, number>
  now: Date
}): Misconception[] {
  const groups = new Map<string, ConflationTag[]>()
  for (const t of input.tags) {
    const key = `${t.klpId}::${t.secondaryKlpId}`
    const list = groups.get(key)
    if (list) list.push(t)
    else groups.set(key, [t])
  }

  const out: Misconception[] = []
  for (const tags of groups.values()) {
    const sessions = new Set(tags.map((t) => t.sessionId))
    if (tags.length < PROMOTE_MIN_OCCURRENCES) continue
    if (sessions.size < PROMOTE_MIN_SESSIONS) continue

    const chronological = [...tags].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )
    const latest = chronological[chronological.length - 1]

    const daysSince = (input.now.getTime() - latest.createdAt.getTime()) / 86_400_000
    const bothClean =
      (input.cleanStreaks[latest.klpId] ?? 0) >= RETIRE_AFTER_CLEAN_ANSWERS &&
      (input.cleanStreaks[latest.secondaryKlpId] ?? 0) >= RETIRE_AFTER_CLEAN_ANSWERS

    let retiredReason: Misconception['retiredReason'] = null
    if (daysSince >= RETIRE_AFTER_DAYS) retiredReason = 'stale'
    else if (bothClean) retiredReason = 'cleared'

    out.push({
      klpId: latest.klpId,
      secondaryKlpId: latest.secondaryKlpId,
      occurrences: tags.length,
      sessionCount: sessions.size,
      lastSeenAt: latest.createdAt,
      evidenceSnippet: latest.quote,
      active: retiredReason === null,
      retiredReason,
    })
  }

  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/misconceptions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/misconceptions.ts tests/metrics/misconceptions.test.ts
git commit -m "feat(spec3): derive misconceptions deterministically from conflation pairs"
```

---

### Task 12: Verbosity index and short-answer readiness

**Files:**
- Create: `src/lib/metrics/articulation.ts`
- Test: `tests/metrics/articulation.test.ts`

**Interfaces:**
- Consumes: `DerivedTag` (Task 6); `MIN_OBSERVATIONS` (Task 7)
- Produces: `ARTICULATION_MIN_PKNOWN = 0.6`, `OVER_TALK_TYPES`, `interface ArticulationInput`, `interface Articulation`, `computeArticulation(input: ArticulationInput): Articulation`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/articulation.test.ts
import { describe, it, expect } from 'vitest'
import { computeArticulation, ARTICULATION_MIN_PKNOWN } from '@/lib/metrics/articulation'
import type { DerivedTag } from '@/lib/errors/derive'

const NOW = new Date('2026-08-05T12:00:00.000Z')

const tag = (o: Partial<DerivedTag> = {}): DerivedTag => ({
  attemptId: 'a1',
  dimension: 'conciseness',
  type: 'rambling',
  klpId: 'klp1',
  relevance: 3,
  starred: false,
  magnitude: 8,
  storedSeverity: 3,
  storedSignificance: 6,
  mode: 'quiz-sa',
  createdAt: NOW,
  severity: 3,
  repeatBonus: 0,
  significance: 6,
  isLegacy: false,
  ...o,
})

const known = { klp1: { pKnown: 0.9, observations: 5 } }

describe('signed verbosity index', () => {
  it('is positive when the learner over-talks', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' }), tag({ type: 'kitchen_sink' })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBeGreaterThan(0)
  })

  it('is negative when the learner under-talks on material they know', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBeLessThan(0)
  })

  it('is near zero when over- and under-talking cancel', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 6 }), tag({ type: 'too_terse', significance: 6 })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBe(0)
  })
})

describe('too_terse is conditioned on knowledge', () => {
  it('excludes too_terse from the index when pKnown is below the threshold', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.2, observations: 5 } },
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes too_terse when the KLP is below the observation floor', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse' })],
      knowledge: { klp1: { pKnown: 0.9, observations: 1 } },
    })
    expect(result.verbosityIndex).toBe(0)
    expect(result.knowledgeGapTerseness).toBe(1)
  })

  it('excludes a whole-answer tag with no klpId — there is no pKnown to test', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'too_terse', klpId: null })],
      knowledge: known,
    })
    expect(result.verbosityIndex).toBe(0)
  })

  it('still counts over-talking regardless of knowledge', () => {
    const result = computeArticulation({
      tags: [tag({ type: 'rambling' })],
      knowledge: { klp1: { pKnown: 0.1, observations: 5 } },
    })
    expect(result.verbosityIndex).toBeGreaterThan(0)
    expect(ARTICULATION_MIN_PKNOWN).toBe(0.6)
  })
})

describe('readiness', () => {
  it('is null with no analyzed short-answer evidence rather than a fabricated score', () => {
    expect(computeArticulation({ tags: [], knowledge: {} }).readiness).toBeNull()
  })

  it('is lower for a learner with heavy clarity and conciseness problems', () => {
    const clean = computeArticulation({
      tags: [tag({ type: 'rambling', significance: 1 })],
      knowledge: known,
    })
    const messy = computeArticulation({
      tags: [
        tag({ type: 'rambling', significance: 9 }),
        tag({ dimension: 'clarity', type: 'disorganized', significance: 9 }),
      ],
      knowledge: known,
    })
    expect(messy.readiness!).toBeLessThan(clean.readiness!)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/metrics/articulation.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/articulation`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/metrics/articulation.ts
import type { DerivedTag } from '@/lib/errors/derive'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'

/**
 * A `too_terse` tag only counts as an ARTICULATION problem at or above this
 * pKnown. Below it, brevity is far more likely to mean the learner does not
 * know the material — and booking that as an expression gap would route them
 * to short-answer drilling when they need the concept, misdiagnosing exactly
 * the case this metric exists to separate.
 *
 * A starting value, named rather than inlined because it wants tuning once
 * real tag volume exists.
 */
export const ARTICULATION_MIN_PKNOWN = 0.6

/** Conciseness failures in the "too much" direction. */
export const OVER_TALK_TYPES = new Set([
  'rambling', 'padding', 'redundancy', 'over_qualification', 'kitchen_sink',
])

export interface KnowledgeRef {
  pKnown: number
  observations: number
}

export interface ArticulationInput {
  tags: DerivedTag[]
  /** Per-KLP BKT results, keyed by klpId. */
  knowledge: Record<string, KnowledgeRef>
}

export interface Articulation {
  /** Positive: over-talks. Negative: under-talks. Zero: calibrated. */
  verbosityIndex: number
  /** `too_terse` tags excluded as knowledge gaps rather than expression gaps. */
  knowledgeGapTerseness: number
  /** 0-1, higher is more interview-ready. Null with no evidence. */
  readiness: number | null
}

/** Scales total tag weight into a 0-1 readiness. Tuned to be gentle. */
const READINESS_SCALE = 20

export function computeArticulation(input: ArticulationInput): Articulation {
  let over = 0
  let under = 0
  let knowledgeGapTerseness = 0
  let expressionWeight = 0

  for (const tag of input.tags) {
    if (tag.dimension === 'clarity') {
      expressionWeight += tag.significance
      continue
    }
    if (tag.dimension !== 'conciseness') continue

    if (OVER_TALK_TYPES.has(tag.type)) {
      over += tag.significance
      expressionWeight += tag.significance
      continue
    }

    if (tag.type === 'too_terse') {
      const k = tag.klpId ? input.knowledge[tag.klpId] : undefined
      const counts =
        k !== undefined && k.observations >= MIN_OBSERVATIONS && k.pKnown >= ARTICULATION_MIN_PKNOWN
      if (counts) {
        under += tag.significance
        expressionWeight += tag.significance
      } else {
        knowledgeGapTerseness += 1
      }
    }
  }

  const hasEvidence = input.tags.length > 0
  const readiness = hasEvidence
    ? Math.max(0, 1 - expressionWeight / READINESS_SCALE)
    : null

  return { verbosityIndex: over - under, knowledgeGapTerseness, readiness }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/metrics/articulation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/metrics/articulation.ts tests/metrics/articulation.test.ts
git commit -m "feat(spec3): add the signed verbosity index and SA readiness"
```

---

### Task 13: Materialized BKT state with incremental stepping

**Files:**
- Modify: `prisma/schema.prisma` (new model `KlpState`)
- Create: `src/lib/metrics/cache.ts`
- Test: `tests/metrics/cache.test.ts`

**Interfaces:**
- Consumes: `stepBkt`, `traceKlp`, `BKT_PRIOR` (Task 7)
- Produces: `interface KlpStateRow`, `applyObservation(state, obs): KlpStateRow`, `rebuildState(userId, klpId, observations): KlpStateRow`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`:

```prisma
/// Stage 8 Spec 3: materialized per-KLP BKT posterior.
///
/// Stepped FORWARD on each new answer rather than invalidated — BKT's update
/// is incremental by construction, so a replay is only needed when the inputs
/// themselves change: a Spec 3B band edit, or a Spec 2a resubmit-cascade
/// re-analysis of an already-recorded answer.
model KlpState {
  id              String   @id @default(cuid())
  userId          String
  klpId           String
  pKnown          Float
  observations    Int
  lastObservedAt  DateTime
  updatedAt       DateTime @updatedAt
  user            User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  klp             CardKlp  @relation(fields: [klpId], references: [id], onDelete: Cascade)

  @@unique([userId, klpId])
  @@index([userId, pKnown])
}
```

Add the back-relations: `klpStates KlpState[]` on `model User`, and `states KlpState[]` on `model CardKlp`.

- [ ] **Step 2: Migrate**

Run: `npx prisma migrate dev --name add_klp_state`
Expected: migration applied, client regenerated.

- [ ] **Step 3: Write the failing test**

```ts
// tests/metrics/cache.test.ts
import { describe, it, expect } from 'vitest'
import { applyObservation, rebuildState } from '@/lib/metrics/cache'
import { traceKlp, BKT_PRIOR } from '@/lib/metrics/bkt'
import type { KlpObservation } from '@/lib/metrics/bkt'

const NOW = new Date('2026-08-05T12:00:00.000Z')
const at = (mins: number): Date => new Date(NOW.getTime() + mins * 60_000)
const obs = (o: Partial<KlpObservation> = {}): KlpObservation => ({
  status: 'passed',
  mode: 'quiz-mc',
  createdAt: NOW,
  ...o,
})

describe('incremental stepping matches a full replay', () => {
  it('produces the same posterior stepping forward as tracing from scratch', () => {
    const observations = [
      obs({ status: 'failed', createdAt: at(0) }),
      obs({ status: 'passed', createdAt: at(1) }),
      obs({ status: 'partial', mode: 'quiz-sa', createdAt: at(2) }),
      obs({ status: 'passed', mode: 'quiz-sa', createdAt: at(3) }),
    ]

    let state = rebuildState('u1', 'klp1', [])
    for (const o of observations) state = applyObservation(state, o)

    const replayed = traceKlp(observations)
    expect(state.pKnown).toBeCloseTo(replayed.pKnown, 10)
    expect(state.observations).toBe(replayed.observations)
  })
})

describe('rebuildState', () => {
  it('returns the prior with no observations', () => {
    const state = rebuildState('u1', 'klp1', [])
    expect(state.pKnown).toBe(BKT_PRIOR)
    expect(state.observations).toBe(0)
  })

  it('is order-independent, so a replay cannot depend on row order', () => {
    const a = obs({ status: 'failed', createdAt: at(0) })
    const b = obs({ status: 'passed', createdAt: at(5) })
    expect(rebuildState('u1', 'k', [b, a]).pKnown).toBeCloseTo(
      rebuildState('u1', 'k', [a, b]).pKnown, 10,
    )
  })
})

describe('lastObservedAt', () => {
  it('advances to the newest observation applied', () => {
    let state = rebuildState('u1', 'klp1', [])
    state = applyObservation(state, obs({ createdAt: at(10) }))
    expect(state.lastObservedAt.getTime()).toBe(at(10).getTime())
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/metrics/cache.test.ts`
Expected: FAIL — cannot resolve `@/lib/metrics/cache`.

- [ ] **Step 5: Write the implementation**

```ts
// src/lib/metrics/cache.ts
import { stepBkt, traceKlp, BKT_PRIOR, type KlpObservation } from '@/lib/metrics/bkt'

/** The pure shape of a KlpState row. No Prisma types here. */
export interface KlpStateRow {
  userId: string
  klpId: string
  pKnown: number
  observations: number
  lastObservedAt: Date
}

/**
 * Step the stored posterior forward by one observation.
 *
 * This is why the cache never needs invalidating: BKT's posterior after N
 * observations is a function of the posterior after N-1 and the new one, so a
 * new answer is a single row update rather than a replay.
 */
export function applyObservation(state: KlpStateRow, obs: KlpObservation): KlpStateRow {
  return {
    ...state,
    pKnown: stepBkt(state.pKnown, obs),
    observations: state.observations + 1,
    lastObservedAt:
      obs.createdAt > state.lastObservedAt ? obs.createdAt : state.lastObservedAt,
  }
}

/**
 * Full replay from scratch. Needed only when the inputs themselves change —
 * a Spec 3B band edit, or a resubmit-cascade re-analysis — never on a new
 * answer.
 */
export function rebuildState(
  userId: string,
  klpId: string,
  observations: KlpObservation[],
): KlpStateRow {
  const traced = traceKlp(observations)
  const latest = observations.reduce<Date | null>(
    (acc, o) => (acc === null || o.createdAt > acc ? o.createdAt : acc),
    null,
  )

  return {
    userId,
    klpId,
    pKnown: observations.length === 0 ? BKT_PRIOR : traced.pKnown,
    observations: traced.observations,
    lastObservedAt: latest ?? new Date(0),
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/metrics/cache.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/metrics/cache.ts tests/metrics/cache.test.ts
git commit -m "feat(spec3): materialize per-KLP BKT state with incremental stepping"
```

---

### Task 14: Rename LearnerProfile to LearnerCardProfile

Mechanical, but done as its own task so the rename is reviewable in isolation and does not hide inside a feature diff.

**Files:**
- Modify: `src/lib/memory/profile.ts`
- Modify: every importer (find with `grep -rn "LearnerProfile" src/ tests/`)

**Interfaces:**
- Consumes: nothing
- Produces: `LearnerCardProfile` type; `shapeLearnerProfile` and `buildLearnerProfile` keep their names and return it

- [ ] **Step 1: Rename the interface**

In `src/lib/memory/profile.ts`, rename `export interface LearnerProfile` to `LearnerCardProfile` and update the file's doc comment:

```ts
 * The CARD-grain learner snapshot. Spec 3 adds a topic-grain profile
 * (src/lib/memory/topic-profile.ts) and a composite `LearnerProfile` that
 * holds both — this one deliberately keeps its narrow, card-level meaning.
```

- [ ] **Step 2: Update every reference**

Run: `grep -rln "LearnerProfile" src/ tests/`

In each file, replace the type reference `LearnerProfile` with `LearnerCardProfile`. Do **not** rename the functions `shapeLearnerProfile` or `buildLearnerProfile` — their names remain accurate and renaming them would widen this diff for no benefit.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: PASS, no behaviour change.

- [ ] **Step 4: Commit**

```bash
git add src tests
git commit -m "refactor(spec3): rename LearnerProfile to LearnerCardProfile"
```

---

### Task 15: Topic profile and the composite

**Files:**
- Create: `src/lib/memory/topic-profile.ts`
- Test: `tests/memory/topic-profile.test.ts`

**Interfaces:**
- Consumes: `LearnerCardProfile` (Task 14); `computeArticulation`, `Articulation` (Task 12); `MIN_OBSERVATIONS` (Task 7)
- Produces: `interface TopicRow`, `interface RawCategoryRow`, `interface LearnerTopicProfile`, `interface LearnerProfile`, `toTopicRows(rows: RawCategoryRow[]): TopicRow[]`, `shapeTopicProfile(input): LearnerTopicProfile[]`, `composeLearnerProfile(cards, topics): LearnerProfile`

- [ ] **Step 1: Write the failing test**

```ts
// tests/memory/topic-profile.test.ts
import { describe, it, expect } from 'vitest'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import type { TopicRow } from '@/lib/memory/topic-profile'
import type { LearnerCardProfile } from '@/lib/memory/profile'

const NOW = new Date('2026-08-05T12:00:00.000Z')

const row = (o: Partial<TopicRow> & { normalizedName: string }): TopicRow => ({
  displayName: 'Valuation',
  color: '#3b82f6',
  klpIds: ['klp1'],
  ...o,
})

describe('topic keying', () => {
  it('groups per-set category rows sharing a normalizedName into one topic', () => {
    const result = shapeTopicProfile({
      topics: [
        row({ normalizedName: 'valuation', displayName: 'Valuation', klpIds: ['k1'] }),
        row({ normalizedName: 'valuation', displayName: 'valuation', klpIds: ['k2'] }),
      ],
      knowledge: {
        k1: { pKnown: 0.8, observations: 5 },
        k2: { pKnown: 0.4, observations: 5 },
      },
      tags: [],
    })

    expect(result).toHaveLength(1)
    expect(result[0].key).toBe('valuation')
    expect(result[0].klpCount).toBe(2)
  })

  it('averages pKnown across the topic KLPs that clear the observation floor', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1', 'k2'] })],
      knowledge: {
        k1: { pKnown: 0.9, observations: 5 },
        k2: { pKnown: 0.5, observations: 5 },
      },
      tags: [],
    })
    expect(result[0].knowledge).toBeCloseTo(0.7, 5)
  })

  it('reports null knowledge when no KLP clears the observation floor', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1'] })],
      knowledge: { k1: { pKnown: 0.9, observations: 1 } },
      tags: [],
    })
    expect(result[0].knowledge).toBeNull()
  })
})

describe('toTopicRows', () => {
  it('flattens joined assignments into a de-duplicable KLP id list', () => {
    const rows = toTopicRows([
      {
        normalizedName: 'valuation',
        name: 'Valuation',
        color: '#3b82f6',
        assignments: [
          { card: { klps: [{ id: 'k1' }, { id: 'k2' }] } },
          { card: { klps: [{ id: 'k3' }] } },
        ],
      },
    ])
    expect(rows[0].klpIds).toEqual(['k1', 'k2', 'k3'])
    expect(rows[0].displayName).toBe('Valuation')
  })

  it('yields an empty klpIds list for a category whose cards have no KLPs', () => {
    const rows = toTopicRows([
      { normalizedName: 'dcf', name: 'DCF', color: null, assignments: [{ card: { klps: [] } }] },
    ])
    expect(rows[0].klpIds).toEqual([])
  })
})

describe('composite', () => {
  it('holds both grains so prompts can read either', () => {
    const cards = { setId: null, setTitle: null, weak: [], fading: [], strong: [], starred: [],
      recent: { byMode: [], graded: [], streakDays: 0 } } as LearnerCardProfile
    const composite = composeLearnerProfile(cards, [])
    expect(composite.cards).toBe(cards)
    expect(composite.topics).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/memory/topic-profile.test.ts`
Expected: FAIL — cannot resolve `@/lib/memory/topic-profile`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/memory/topic-profile.ts
import type { LearnerCardProfile } from '@/lib/memory/profile'
import type { DerivedTag } from '@/lib/errors/derive'
import { MIN_OBSERVATIONS } from '@/lib/metrics/bkt'
import { computeArticulation, type KnowledgeRef } from '@/lib/metrics/articulation'

/**
 * One per-set `CardCategory` row, resolved to the KLPs its cards teach.
 *
 * Topics key on `normalizedName` because categories are SET-SCOPED: the same
 * concept exists as separate rows per set, and grouping on that key is how
 * `/profile/memory` already spans sets without a schema migration. Keying on
 * category id would make "valuation" three different topics across three sets.
 */
export interface TopicRow {
  normalizedName: string
  displayName: string
  color: string | null
  klpIds: string[]
}

export interface LearnerTopicProfile {
  key: string
  name: string
  color: string | null
  klpCount: number
  /** Mean pKnown across KLPs clearing MIN_OBSERVATIONS. Null when none do. */
  knowledge: number | null
  verbosityIndex: number
  knowledgeGapTerseness: number
  readiness: number | null
}

/** The composite injected into prompts — both grains, one object. */
export interface LearnerProfile {
  cards: LearnerCardProfile
  topics: LearnerTopicProfile[]
}

export function shapeTopicProfile(input: {
  topics: TopicRow[]
  knowledge: Record<string, KnowledgeRef>
  tags: DerivedTag[]
}): LearnerTopicProfile[] {
  const grouped = new Map<string, TopicRow[]>()
  for (const t of input.topics) {
    const list = grouped.get(t.normalizedName)
    if (list) list.push(t)
    else grouped.set(t.normalizedName, [t])
  }

  const out: LearnerTopicProfile[] = []
  for (const [key, rows] of grouped) {
    const klpIds = [...new Set(rows.flatMap((r) => r.klpIds))]
    const klpSet = new Set(klpIds)

    const scored = klpIds
      .map((id) => input.knowledge[id])
      .filter((k): k is KnowledgeRef => k !== undefined && k.observations >= MIN_OBSERVATIONS)

    const knowledge =
      scored.length === 0
        ? null
        : scored.reduce((sum, k) => sum + k.pKnown, 0) / scored.length

    const articulation = computeArticulation({
      tags: input.tags.filter((t) => t.klpId !== null && klpSet.has(t.klpId)),
      knowledge: input.knowledge,
    })

    out.push({
      key,
      // Most common display name wins, matching groupCategoriesByName.
      name: mostCommonName(rows),
      color: rows.find((r) => r.color !== null)?.color ?? null,
      klpCount: klpIds.length,
      knowledge,
      verbosityIndex: articulation.verbosityIndex,
      knowledgeGapTerseness: articulation.knowledgeGapTerseness,
      readiness: articulation.readiness,
    })
  }

  return out
}

function mostCommonName(rows: TopicRow[]): string {
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(r.displayName, (counts.get(r.displayName) ?? 0) + 1)
  let best = rows[0].displayName
  let bestCount = -1
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name
      bestCount = count
    }
  }
  return best
}

export function composeLearnerProfile(
  cards: LearnerCardProfile,
  topics: LearnerTopicProfile[],
): LearnerProfile {
  return { cards, topics }
}

/** A CardCategory row as Prisma returns it, with assignments and KLPs joined. */
export interface RawCategoryRow {
  normalizedName: string
  name: string
  color: string | null
  assignments: { card: { klps: { id: string }[] } }[]
}

/**
 * Flatten joined category rows into TopicRows. Lives here, not in the read
 * shell, so the KLP flattening is covered by tests like every other decision.
 */
export function toTopicRows(rows: RawCategoryRow[]): TopicRow[] {
  return rows.map((c) => ({
    normalizedName: c.normalizedName,
    displayName: c.name,
    color: c.color,
    klpIds: c.assignments.flatMap((a) => a.card.klps.map((k) => k.id)),
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/memory/topic-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/memory/topic-profile.ts tests/memory/topic-profile.test.ts
git commit -m "feat(spec3): add the topic profile and the composite LearnerProfile"
```

---

### Task 16: Scoped read API

The surface Spec 3C renders. It lives here so the dashboard adds no aggregation of its own and cannot drift from the prompt-facing path.

**Files:**
- Create: `src/lib/metrics/read.ts`
- Test: none — and this file must EARN that, per the `profile.ts:322-331` precedent. It may contain Prisma queries and delegation only. Every transformation lives in a tested pure function: `toStoredTags` (Task 6), `toTopicRows` (Task 15), `toRecallPairs` (Task 9), `computeCleanStreaks` (Task 11). If you find yourself writing a `.map` that decides anything, it belongs in one of those modules instead.

**Interfaces:**
- Consumes: every pure module above; `HistoryScope`, `scopeToCardWhere` from `@/lib/memory/scope`
- Produces: `getLearnerMetrics({ userId, scope }): Promise<LearnerMetrics>` where `LearnerMetrics = { profile: LearnerProfile; misconceptions: Misconception[]; forgetting: ForgettingCurve | null; paceOutliers: {...}[] }`

- [ ] **Step 1: Write the shell**

```ts
// src/lib/metrics/read.ts
import type { HistoryScope } from '@/lib/memory/scope'
import type { LearnerProfile } from '@/lib/memory/topic-profile'
import type { Misconception } from '@/lib/metrics/misconceptions'
import type { ForgettingCurve } from '@/lib/metrics/forgetting'
import { deriveTagScores, toStoredTags } from '@/lib/errors/derive'
import { deriveMisconceptions, computeCleanStreaks } from '@/lib/metrics/misconceptions'
import { buildForgettingCurve, toRecallPairs } from '@/lib/metrics/forgetting'
import { shapeTopicProfile, composeLearnerProfile, toTopicRows } from '@/lib/memory/topic-profile'
import { buildLearnerProfile } from '@/lib/memory/profile'
import type { BandTable } from '@/lib/errors/bands'

export interface LearnerMetrics {
  profile: LearnerProfile
  misconceptions: Misconception[]
  forgetting: ForgettingCurve | null
}

/**
 * Thin DB shell. Deliberately untested here — no DB-mocking precedent exists
 * in this suite, and every computation it delegates to is covered by the pure
 * modules' own tests. See the same note on `buildLearnerProfile`.
 *
 * `prisma` is imported DYNAMICALLY so importing this module for its types
 * never touches `lib/db.ts`, which throws at import time without DATABASE_URL.
 */
export async function getLearnerMetrics({
  userId,
  scope,
  bands,
  now = new Date(),
}: {
  userId: string
  scope: HistoryScope
  bands?: BandTable
  now?: Date
}): Promise<LearnerMetrics> {
  const { prisma } = await import('@/lib/db')

  const [cards, klpStates, tagRows, klpOutcomes, events] = await Promise.all([
    buildLearnerProfile({ userId, setId: scope.setIds[0] }),
    prisma.klpState.findMany({
      where: { userId },
      select: { klpId: true, pKnown: true, observations: true },
    }),
    prisma.answerErrorTag.findMany({
      where: { quizAnswer: { userId } },
      select: {
        dimension: true, type: true, klpId: true, secondaryKlpId: true,
        relevance: true, starred: true, magnitude: true, mode: true,
        severity: true, significance: true, quote: true, createdAt: true,
        quizAnswer: { select: { attemptId: true } },
      },
    }),
    prisma.answerKlpResult.findMany({
      where: { quizAnswer: { userId } },
      select: { klpId: true, status: true, createdAt: true },
    }),
    prisma.studyEvent.findMany({
      where: { userId },
      select: { cardId: true, correct: true, createdAt: true },
    }),
  ])

  const knowledge = Object.fromEntries(
    klpStates.map((s: any) => [s.klpId, { pKnown: s.pKnown, observations: s.observations }]),
  )

  const derived = deriveTagScores(toStoredTags(tagRows), bands)
  const topics = toTopicRows(await loadCategoryRows(prisma, userId, scope))

  const misconceptions = deriveMisconceptions({
    tags: tagRows
      .filter((t: any) => t.type === 'conflation' && t.klpId && t.secondaryKlpId)
      .map((t: any) => ({
        klpId: t.klpId,
        secondaryKlpId: t.secondaryKlpId,
        sessionId: t.quizAnswer.attemptId,
        quote: t.quote,
        createdAt: t.createdAt,
      })),
    cleanStreaks: computeCleanStreaks(
      klpOutcomes.map((o: any) => ({
        klpId: o.klpId,
        status: o.status,
        createdAt: o.createdAt,
      })),
    ),
    now,
  })

  return {
    profile: composeLearnerProfile(cards, shapeTopicProfile({ topics, knowledge, tags: derived })),
    misconceptions,
    forgetting: buildForgettingCurve(
      toRecallPairs(
        events.map((e: any) => ({
          cardId: e.cardId,
          correct: e.correct,
          createdAt: e.createdAt,
        })),
      ),
    ),
  }
}

/**
 * Query only — the shape mapping is `toTopicRows`, which is tested. Only LIVE
 * KLPs are selected: a superseded KLP belongs to an older version of the card
 * and its evidence should not count toward current knowledge.
 */
async function loadCategoryRows(prisma: any, userId: string, scope: HistoryScope) {
  return prisma.cardCategory.findMany({
    where: {
      set: { userId, ...(scope.setIds.length > 0 ? { id: { in: scope.setIds } } : {}) },
      ...(scope.categoryKeys.length > 0 ? { normalizedName: { in: scope.categoryKeys } } : {}),
    },
    select: {
      normalizedName: true, name: true, color: true,
      assignments: {
        select: {
          card: { select: { klps: { where: { supersededAt: null }, select: { id: true } } } },
        },
      },
    },
  })
}
```

- [ ] **Step 2: Type-check and reconcile against the real schema**

Run: `npx tsc --noEmit`

The relation names above are written from the schema as it stands, but verify each against the generated client and fix any mismatch: `quizAnswer` on `AnswerErrorTag` and `AnswerKlpResult`, `assignments` on `CardCategory`, `card` on `CardCategoryAssignment`, and the `CardKlp` back-relation on `Card`. If `QuizAnswer` has no direct `userId`, filter through its attempt instead (`quizAnswer: { attempt: { userId } }`) — Spec 2b's ownership fixes established that path.

- [ ] **Step 3: Verify**

Run: `npm test && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/metrics/read.ts
git commit -m "feat(spec3): add the scoped learner-metrics read API"
```

---

### Task 17: Extend the prompt block

**Files:**
- Modify: `src/lib/ai/context.ts` (`profileToPromptBlock`)
- Test: `tests/ai/context.test.ts` (existing — extend)

**Interfaces:**
- Consumes: `LearnerProfile` composite (Task 15)
- Produces: `MAX_PROFILE_CHARS = 2000`, `MAX_TOPICS_IN_BLOCK = 8`; `profileToPromptBlock(profile: LearnerProfile): string` accepts the composite

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/ai/context.test.ts
import { profileToPromptBlock, MAX_PROFILE_CHARS } from '@/lib/ai/context'

describe('Spec 3 profile block', () => {
  const topic = (key: string, knowledge: number | null, verbosity: number) => ({
    key, name: key, color: null, klpCount: 3,
    knowledge, verbosityIndex: verbosity, knowledgeGapTerseness: 0, readiness: 0.7,
  })

  const cards = { setId: null, setTitle: null, weak: [], fading: [], strong: [], starred: [],
    recent: { byMode: [], graded: [], streakDays: 0 } } as any

  it('never exceeds the character cap even with many topics', () => {
    const topics = Array.from({ length: 200 }, (_, i) => topic(`topic-${i}`, 0.4, 3))
    const block = profileToPromptBlock({ cards, topics })
    expect(block.length).toBeLessThanOrEqual(MAX_PROFILE_CHARS)
  })

  it('contains no cuids — the model sees text, never ids', () => {
    const block = profileToPromptBlock({ cards, topics: [topic('valuation', 0.4, 3)] })
    expect(block).not.toMatch(/c[a-z0-9]{24}/)
  })

  it('describes verbosity in both directions', () => {
    const over = profileToPromptBlock({ cards, topics: [topic('accounting', 0.8, 9)] })
    const under = profileToPromptBlock({ cards, topics: [topic('equity-value', 0.8, -9)] })
    expect(over).not.toBe(under)
  })

  it('omits a topic with null knowledge rather than calling it 0', () => {
    const block = profileToPromptBlock({ cards, topics: [topic('unknown-topic', null, 0)] })
    expect(block).not.toContain('0%')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/context.test.ts`
Expected: FAIL — `profileToPromptBlock` does not accept the composite.

- [ ] **Step 3: Implement**

In `src/lib/ai/context.ts`, add the caps and the topic section. Keep the existing card-section logic exactly as it is and append to it.

```ts
/**
 * Hard cap on the injected block. KLPs run 1-5 per card, so an uncapped topic
 * section would blow the very token budget this profile exists to respect.
 */
export const MAX_PROFILE_CHARS = 2000
export const MAX_TOPICS_IN_BLOCK = 8
/** |verbosityIndex| must exceed this before the block says anything about it. */
const VERBOSITY_SPEAK_THRESHOLD = 4

function verbosityClause(index: number): string {
  if (index > VERBOSITY_SPEAK_THRESHOLD) return ', tends to over-explain'
  if (index < -VERBOSITY_SPEAK_THRESHOLD) return ', tends to under-explain'
  return ''
}

function topicLines(topics: LearnerTopicProfile[]): string[] {
  return [...topics]
    // Weakest first; unknown knowledge last, since it is not evidence of weakness.
    .sort((a, b) => {
      if (a.knowledge === null) return 1
      if (b.knowledge === null) return -1
      return a.knowledge - b.knowledge
    })
    .slice(0, MAX_TOPICS_IN_BLOCK)
    .map((t) => {
      // A null knowledge is omitted entirely rather than rendered as 0% —
      // "not enough data" is not "knows nothing".
      const known = t.knowledge === null ? '' : ` ${Math.round(t.knowledge * 100)}%`
      return `- ${t.name}:${known || ' not yet assessed'}${verbosityClause(t.verbosityIndex)}`
    })
}

/** Truncate at a line boundary so the block never ends mid-sentence. */
function capBlock(text: string): string {
  if (text.length <= MAX_PROFILE_CHARS) return text
  const clipped = text.slice(0, MAX_PROFILE_CHARS)
  const lastNewline = clipped.lastIndexOf('\n')
  return lastNewline > 0 ? clipped.slice(0, lastNewline) : clipped
}
```

Then, in `profileToPromptBlock`, accept the composite and append the topic section before returning:

```ts
export function profileToPromptBlock(profile: LearnerProfile): string {
  const cardSection = buildCardSection(profile.cards) // the existing logic, unchanged

  const lines = topicLines(profile.topics)
  const topicSection = lines.length === 0 ? '' : `\nBy topic:\n${lines.join('\n')}`

  return capBlock(`${cardSection}${topicSection}`)
}
```

If the existing body of `profileToPromptBlock` is inline rather than a helper, extract it to `buildCardSection(cards: LearnerCardProfile): string` first, changing nothing about what it produces — the existing tests for it must keep passing untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ai/context.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

```bash
npm test
git add src/lib/ai/context.ts tests/ai/context.test.ts
git commit -m "feat(spec3): inject topic knowledge and articulation into the prompt block"
```

---

## Final verification

- [ ] Run the full suite: `npm test`
- [ ] Type-check: `npx tsc --noEmit`
- [ ] Lint: `npm run lint`
- [ ] Re-run `npx tsx scripts/klp-health.ts` and confirm `AnswerKlpResult` rows exist and `KlpState` is populating after a real quiz
- [ ] Take one real quiz end-to-end and confirm the results page still renders per-answer analysis unchanged (Spec 2b regression)

## Spec coverage

| Spec section | Task |
| --- | --- |
| §2 severity bands | 2 |
| §2.3 pinned ceilings / no-op property | 2 (test) |
| §2.5 bands as parameter | 2, 6 |
| §3.1 repeatBonus | 6 |
| §3.2 read-time derivation | 6 |
| §4 misconceptions | 11 |
| §5 bkt / pace / forgetting / session-shape | 7, 8, 9, 10 |
| §6.1 two metrics | 7, 12 |
| §6.2 verbosity index | 12 |
| §6.3 too_terse conditioning | 12 |
| §6.4 targeting exposed not decided | 16 (orderings surfaced; selection is Spec 3B) |
| §7 profile restructuring | 14, 15 |
| §7.1 topics from normalizedName | 15, 16 |
| §8.1 magnitude column | 3, 4, 5 |
| §8.2 incremental cache | 13 |
| §8.3 parallel shaper | 15 |
| §9 prompt block token budget | 17 |
| §10 read API | 16 |
| §11 testing | every task |
