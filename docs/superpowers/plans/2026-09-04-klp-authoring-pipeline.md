# KLP Authoring Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-pass KLP extraction with a per-card pipeline that writes KLPs, then *tests whether they discriminate* between a strong answer and deliberately wrong ones — looping on a numeric score rather than a matter of taste.

**Architecture:** Four AI calls per card (author → grade × 4 candidates → revise → relate), with every score computed in TypeScript from the AI's categorical verdicts. Candidates are graded in isolated calls so the grader cannot rank them against each other and manufacture separation. Relations come from the same walk, and their graph replaces the AI's centrality opinion with a computed blast radius.

**Tech Stack:** TypeScript, Prisma/Postgres (Neon), Vercel AI SDK v7 via `generateJson`, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-09-04-klp-authoring-pipeline-design.md`

## Global Constraints

- **Baseline:** `npx vitest run` is **213 files / 2586 tests, 0 failures**; `tsc --noEmit` clean; `npx eslint` 164 problems against a standing ceiling of 175. Any failure you see is yours. **Run the FULL suite before every commit** — a scoped run on the previous spec hid a cross-cutting guard failure for six commits.
- **The AI never computes a score.** It returns categorical verdicts; separation, discrimination, and weight are computed in TypeScript. This mirrors the existing rule for significance and mastery.
- **Call B is graded in isolation, one candidate per call.** `GRADE_CANDIDATES_SEPARATELY` defaults `true`. A grader shown all four at once ranks them against each other and manufactures separation the KLPs never earned.
- **USE THE EXISTING VERDICT SPELLINGS.** Five of the thirteen labels are `CORRUPTIONS` members (`src/lib/quiz/options.ts`), persisted on every generated distractor. `tests/errors/taxonomy.test.ts` must keep passing untouched.
- **Every export of a file-level `'use server'` module is a callable RPC endpoint.** Nothing in this plan may add an ungated export to `src/actions/*.ts`. Shared logic lives in plain `src/lib/` modules.
- **The legacy path stays.** `KLP_BATCH_SIZE`, `EXTRACT_KLPS_PROMPT`, and the demand-driven `ensureKlpsReady` fallback are NOT deleted — Spec 4 owns that. New cards keep working exactly as they do today.
- **KLPs are versioned, never overwritten.** Superseding is what keeps a July error tag pointing at the version actually asked. Existing rows keep their AI weights.
- Commit messages end with exactly:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01688rk8nfGwF4HLWYxzKuuR
  ```

---

### Task 1: The verdict vocabulary

**Files:**
- Create: `src/lib/klp/verdicts.ts`
- Test: `tests/klp/verdicts.test.ts`

**Interfaces:**
- Consumes: `ACCURACY_TYPES` from `src/lib/errors/taxonomy.ts`, `CORRUPTIONS` from `src/lib/quiz/options.ts`.
- Produces: `KLP_VERDICTS` (13 strings), `type KlpVerdict`, `isKlpVerdict(v: unknown): v is KlpVerdict`, `VERDICT_CREDIT: Record<KlpVerdict, number>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/verdicts.test.ts
import { describe, it, expect } from 'vitest'
import { KLP_VERDICTS, isKlpVerdict, VERDICT_CREDIT } from '@/lib/klp/verdicts'
import { ACCURACY_TYPES } from '@/lib/errors/taxonomy'
import { CORRUPTIONS } from '@/lib/quiz/options'

describe('KLP_VERDICTS', () => {
  it('is exactly thirteen labels', () => {
    expect(KLP_VERDICTS).toHaveLength(13)
    expect(new Set(KLP_VERDICTS).size).toBe(13)
  })

  /**
   * The nine accuracy types are PROMOTED into this vocabulary, not renamed
   * beside it. Their spellings are persisted on AnswerErrorTag rows.
   */
  it('contains every ACCURACY_TYPE verbatim', () => {
    for (const t of ACCURACY_TYPES) expect(KLP_VERDICTS).toContain(t)
  })

  /**
   * The load-bearing one. CORRUPTIONS strings are written onto generated
   * distractors as provenance and persisted. If a verdict label were renamed,
   * every existing distractor row would lose its diagnosis.
   */
  it('contains every CORRUPTION verbatim', () => {
    for (const c of CORRUPTIONS) expect(KLP_VERDICTS).toContain(c)
  })

  it('adds exactly the four non-accuracy members', () => {
    const extra = KLP_VERDICTS.filter((v) => !(ACCURACY_TYPES as readonly string[]).includes(v))
    expect([...extra].sort()).toEqual(['contradicted', 'correct', 'failed', 'partial'])
  })
})

describe('isKlpVerdict', () => {
  it('narrows only real members', () => {
    expect(isKlpVerdict('inversion')).toBe(true)
    expect(isKlpVerdict('correct')).toBe(true)
    expect(isKlpVerdict('inverted')).toBe(false)
    expect(isKlpVerdict('')).toBe(false)
    expect(isKlpVerdict(undefined)).toBe(false)
    expect(isKlpVerdict(3)).toBe(false)
  })
})

describe('VERDICT_CREDIT', () => {
  it('assigns credit to every verdict, with no gaps', () => {
    for (const v of KLP_VERDICTS) expect(typeof VERDICT_CREDIT[v]).toBe('number')
  })

  it('keeps the three existing credit values — the labels are not ordered', () => {
    expect(VERDICT_CREDIT.correct).toBe(1)
    expect(VERDICT_CREDIT.incomplete).toBe(0.5)
    expect(VERDICT_CREDIT.partial).toBe(0.5)
    expect(VERDICT_CREDIT.inversion).toBe(0)
    expect(VERDICT_CREDIT.omission).toBe(0)
    expect(new Set(Object.values(VERDICT_CREDIT))).toEqual(new Set([1, 0.5, 0]))
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/verdicts.test.ts`
Expected: FAIL — cannot resolve `@/lib/klp/verdicts`.

- [ ] **Step 3: Implement**

```ts
// src/lib/klp/verdicts.ts
/**
 * How one KLP fared against one answer.
 *
 * THIRTEEN LABELS, and the spellings are inherited, not chosen. Five of them
 * (`inversion`, `conflation`, `misapplication`, `overgeneralization`,
 * `factual_error`) are members of CORRUPTIONS in src/lib/quiz/options.ts,
 * written onto every generated distractor as its provenance and PERSISTED.
 * Renaming one strands every existing distractor row's diagnosis. The nine
 * ACCURACY_TYPES are promoted here wholesale for the same reason.
 *
 * Only four members are new concepts: `correct`, `contradicted`, plus
 * `partial` and `failed`, which are the honest FALLBACKS a grader may use when
 * it cannot commit to a specific label — and which every historical
 * AnswerKlpResult row already holds. A migration cannot know which specific
 * failure a legacy `failed` was, and inventing one is exactly the fabrication
 * this engine refuses everywhere else.
 *
 * Spec 5 widens AnswerKlpResult.status to this vocabulary at runtime. This
 * module is introduced here and used ONLY by the authoring grader.
 */
import { ACCURACY_TYPES } from '@/lib/errors/taxonomy'

export const KLP_VERDICTS = [
  'correct',
  'partial',
  'failed',
  'contradicted',
  ...ACCURACY_TYPES,
] as const

export type KlpVerdict = (typeof KLP_VERDICTS)[number]

export function isKlpVerdict(value: unknown): value is KlpVerdict {
  return typeof value === 'string' && (KLP_VERDICTS as readonly string[]).includes(value)
}

/**
 * Credit stays SEPARATE from the label, and keeps the three values
 * STATUS_CREDIT already uses.
 *
 * The labels are not ordered — `inversion` is not "more wrong" than
 * `omission`, it is differently wrong — so mapping thirteen labels onto a
 * continuous scale would invent a ranking nobody chose. BKT is untouched.
 */
export const VERDICT_CREDIT: Record<KlpVerdict, number> = {
  correct: 1,
  partial: 0.5,
  incomplete: 0.5,
  failed: 0,
  contradicted: 0,
  omission: 0,
  conflation: 0,
  inversion: 0,
  misapplication: 0,
  factual_error: 0,
  overgeneralization: 0,
  unsupported_leap: 0,
  fabrication: 0,
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/klp/verdicts.test.ts tests/errors/taxonomy.test.ts && npx tsc --noEmit`
Expected: PASS both. The taxonomy subset test must be untouched and still green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/verdicts.ts tests/klp/verdicts.test.ts
git commit -m "feat(klp): add the thirteen-label verdict vocabulary"
```

---

### Task 2: Authoring configuration

**Files:**
- Create: `src/lib/klp/authoring-config.ts`
- Modify: `src/lib/ai/schemas.ts` (`MAX_KLPS_PER_CARD` 5 → 9)
- Test: `tests/klp/authoring-config.test.ts`

**Interfaces:**
- Produces: `SEPARATION_FLOOR = 0.4`, `MAX_REVISIONS = 2`, `MIN_KLPS_PER_CARD = 5`, `GRADE_CANDIDATES_SEPARATELY = true`, `PROBE_KINDS`, `type ProbeKind`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/authoring-config.test.ts
import { describe, it, expect } from 'vitest'
import {
  SEPARATION_FLOOR, MAX_REVISIONS, MIN_KLPS_PER_CARD,
  GRADE_CANDIDATES_SEPARATELY, PROBE_KINDS,
} from '@/lib/klp/authoring-config'
import { MAX_KLPS_PER_CARD } from '@/lib/ai/schemas'

describe('authoring config', () => {
  /**
   * The user's own failure case: "if your vague answer scores 6/7, your KLPs
   * are too loose". 6/7 = 0.857, so against a reference at 1.0 the separation
   * is 0.143 — the floor must reject that with room to spare, not sit on it.
   */
  it('sets a floor that rejects the 6-of-7 case by a wide margin', () => {
    const separation = 1 - 6 / 7
    expect(separation).toBeLessThan(SEPARATION_FLOOR)
    expect(SEPARATION_FLOOR - separation).toBeGreaterThan(0.2)
  })

  it('still lets a good adversary earn most of the way to the floor', () => {
    // The confident-but-wrong answer SHOULD get structural points right.
    expect(1 - SEPARATION_FLOOR).toBeGreaterThanOrEqual(0.6)
  })

  it('caps revisions so a card cannot loop forever on the key pool', () => {
    expect(MAX_REVISIONS).toBe(2)
  })

  it('targets 5-9 KLPs per card, up from the old cap of 5', () => {
    expect(MIN_KLPS_PER_CARD).toBe(5)
    expect(MAX_KLPS_PER_CARD).toBe(9)
  })

  it('grades candidates separately by default', () => {
    expect(GRADE_CANDIDATES_SEPARATELY).toBe(true)
  })

  it('names exactly the three adversary archetypes', () => {
    expect(PROBE_KINDS).toEqual(['confident_wrong', 'vague', 'memorized_template'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/authoring-config.test.ts`
Expected: FAIL — module missing, and `MAX_KLPS_PER_CARD` is 5.

- [ ] **Step 3: Implement**

```ts
// src/lib/klp/authoring-config.ts
/**
 * Every tunable in the authoring pipeline, in one place, so changing the
 * quality bar is one edit and one test rather than a hunt.
 */

/**
 * How far the reference answer must outscore the BEST wrong answer.
 *
 * The user's criterion, made numeric: "if your vague answer scores 6/7, your
 * KLPs are too loose". 6/7 is 0.857, so that card's separation is 0.143. A
 * floor of 0.4 rejects it with room to spare rather than sitting on the
 * boundary — while still letting a wrong answer earn up to 60%, because the
 * confident-but-wrong adversary SHOULD get the structural points right. That
 * is what makes it a good adversary rather than a straw man.
 */
export const SEPARATION_FLOOR = 0.4

/**
 * Revisions before giving up. Three grading rounds total.
 *
 * A card that still fails is written anyway and flagged
 * `low_discrimination`, never retried silently: retrying burns the user's key
 * pool, dropping loses the work, and shipping it unflagged is the exact
 * failure this pipeline exists to prevent.
 */
export const MAX_REVISIONS = 2

/**
 * The lower end of the grain target. A SMELL TEST, NOT A QUOTA — an atomic
 * card genuinely has one point, and the discrimination test is authoritative
 * over this range. Padding to reach five is precisely what the test catches,
 * because a padded KLP fires identically on every answer.
 */
export const MIN_KLPS_PER_CARD = 5

/**
 * One grading call per candidate answer.
 *
 * TRUE is not merely the careful setting. A grader shown all four candidates
 * at once can RANK them against each other instead of judging each against the
 * KLPs — handing the reference high marks and the wrong answers low ones by
 * comparison. That manufactures separation the KLPs never earned, and the
 * score would report success exactly when it was measuring nothing.
 *
 * Flipping this to false roughly halves authoring spend and costs that
 * guarantee. It exists as a constant so the trade is deliberate and visible.
 */
export const GRADE_CANDIDATES_SEPARATELY = true

/**
 * The three adversary archetypes, from the user's specification. Each fails
 * differently on purpose: the confident one is articulate and wrong, the vague
 * one refuses to commit, and the template one has structure with no substance.
 *
 * `memorized_template` is not only an adversary — it is a ready-made near-miss
 * for the `template_anchoring` diagnosis, generated for free here.
 */
export const PROBE_KINDS = ['confident_wrong', 'vague', 'memorized_template'] as const

export type ProbeKind = (typeof PROBE_KINDS)[number]
```

Then in `src/lib/ai/schemas.ts`, change `export const MAX_KLPS_PER_CARD = 5;` to `= 9;` and update its comment to say the range is 5-9 and that the discrimination test, not the number, is authoritative.

- [ ] **Step 4: Run the FULL suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. `MAX_KLPS_PER_CARD` bounds a Zod `.max()` in `KlpExtractionSchema`; widening it cannot fail an existing test, but confirm.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/authoring-config.ts src/lib/ai/schemas.ts tests/klp/authoring-config.test.ts
git commit -m "feat(klp): add authoring thresholds and widen the grain target to 5-9"
```

---

### Task 3: The separation score

**Files:**
- Create: `src/lib/klp/separation.ts`
- Test: `tests/klp/separation.test.ts`

**Interfaces:**
- Consumes: `KlpVerdict`, `VERDICT_CREDIT` (Task 1); `SEPARATION_FLOOR` (Task 2).
- Produces:
  - `interface CandidateGrade { kind: 'reference' | ProbeKind; verdicts: KlpVerdict[] }`
  - `scoreCandidate(verdicts: KlpVerdict[]): number`
  - `interface KlpDiscrimination { index: number; passesReference: boolean; failsSomeWrong: boolean; discriminates: boolean }`
  - `evaluateKlps(reference: CandidateGrade, wrong: CandidateGrade[]): KlpDiscrimination[]`
  - `interface SeparationResult { referenceScore: number; bestWrongScore: number; separation: number; separated: boolean; perKlp: KlpDiscrimination[] }`
  - `computeSeparation(reference: CandidateGrade, wrong: CandidateGrade[]): SeparationResult`

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/separation.test.ts
import { describe, it, expect } from 'vitest'
import { scoreCandidate, evaluateKlps, computeSeparation } from '@/lib/klp/separation'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const half: KlpVerdict = 'incomplete'
const no: KlpVerdict = 'omission'

describe('scoreCandidate', () => {
  it('is the mean credit over the KLPs', () => {
    expect(scoreCandidate([ok, ok, ok, ok])).toBe(1)
    expect(scoreCandidate([no, no])).toBe(0)
    expect(scoreCandidate([ok, no])).toBe(0.5)
    expect(scoreCandidate([ok, half])).toBe(0.75)
  })

  it('is 0 for no KLPs rather than NaN', () => {
    expect(scoreCandidate([])).toBe(0)
  })
})

describe('evaluateKlps', () => {
  it('marks a KLP discriminating when it passes the reference and fails some wrong answer', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [ok, ok] },
      [{ kind: 'vague', verdicts: [no, ok] }],
    )
    expect(out[0]).toMatchObject({ index: 0, passesReference: true, failsSomeWrong: true, discriminates: true })
  })

  /**
   * The core rule. A KLP that fires identically on the strong and every weak
   * answer carries no information — it is true of everyone, so it separates
   * nobody.
   */
  it('marks a KLP NOT discriminating when every wrong answer also passes it', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [ok] },
      [{ kind: 'vague', verdicts: [ok] }, { kind: 'confident_wrong', verdicts: [ok] }],
    )
    expect(out[0].discriminates).toBe(false)
  })

  /**
   * A KLP the REFERENCE fails was hallucinated past the artifact it was
   * supposed to be derived from. It must not count as discriminating however
   * badly the wrong answers do on it.
   */
  it('marks a KLP NOT discriminating when the reference itself fails it', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [no] },
      [{ kind: 'vague', verdicts: [no] }],
    )
    expect(out[0]).toMatchObject({ passesReference: false, discriminates: false })
  })

  it('treats a partial credit on the reference as passing', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [half] },
      [{ kind: 'vague', verdicts: [no] }],
    )
    expect(out[0].discriminates).toBe(true)
  })
})

describe('computeSeparation', () => {
  /**
   * THE USER'S OWN FAILURE CASE, verbatim: a vague answer scoring 6 of 7.
   */
  it('fails the card when the vague answer scores 6 of 7', () => {
    const seven = Array<KlpVerdict>(7).fill(ok)
    const sixOfSeven: KlpVerdict[] = [ok, ok, ok, ok, ok, ok, no]
    const res = computeSeparation(
      { kind: 'reference', verdicts: seven },
      [{ kind: 'vague', verdicts: sixOfSeven }],
    )
    expect(res.referenceScore).toBe(1)
    expect(res.bestWrongScore).toBeCloseTo(6 / 7, 5)
    expect(res.separated).toBe(false)
  })

  it('passes a card where the best wrong answer is far enough back', () => {
    const res = computeSeparation(
      { kind: 'reference', verdicts: [ok, ok, ok, ok] },
      [
        { kind: 'vague', verdicts: [ok, no, no, no] },
        { kind: 'confident_wrong', verdicts: [ok, ok, no, no] },
      ],
    )
    expect(res.bestWrongScore).toBe(0.5)
    expect(res.separation).toBe(0.5)
    expect(res.separated).toBe(true)
  })

  /**
   * The BEST wrong answer is the bar, not the average. Averaging lets one
   * hopeless adversary mask a near-miss that the KLPs genuinely fail to catch.
   */
  it('measures against the best wrong answer, never their mean', () => {
    const res = computeSeparation(
      { kind: 'reference', verdicts: [ok, ok] },
      [{ kind: 'vague', verdicts: [no, no] }, { kind: 'confident_wrong', verdicts: [ok, ok] }],
    )
    expect(res.bestWrongScore).toBe(1)
    expect(res.separated).toBe(false)
  })

  it('fails a card when no wrong answers were produced at all', () => {
    const res = computeSeparation({ kind: 'reference', verdicts: [ok] }, [])
    expect(res.separated).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/separation.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/klp/separation.ts
/**
 * The discrimination test, in TypeScript.
 *
 * THE AI NEVER COMPUTES THIS. It returns categorical verdicts; every number
 * here is derived from them, the same division of labour significance and
 * mastery already use. A model asked to score its own KLPs reports that they
 * are good, which is the exact failure this pipeline replaces.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import { SEPARATION_FLOOR } from '@/lib/klp/authoring-config'
import type { ProbeKind } from '@/lib/klp/authoring-config'

export interface CandidateGrade {
  kind: 'reference' | ProbeKind
  /** One verdict per KLP, in the KLPs' own order. */
  verdicts: KlpVerdict[]
}

/** Mean credit across the KLPs. 0 for an empty set, never NaN. */
export function scoreCandidate(verdicts: KlpVerdict[]): number {
  if (verdicts.length === 0) return 0
  return verdicts.reduce((sum, v) => sum + VERDICT_CREDIT[v], 0) / verdicts.length
}

export interface KlpDiscrimination {
  index: number
  passesReference: boolean
  failsSomeWrong: boolean
  discriminates: boolean
}

/**
 * Per-KLP verdict on whether the point earns its place.
 *
 * Two conditions, and both are load-bearing:
 *  - It must PASS on the reference. A KLP the reference does not support was
 *    hallucinated past the artifact it was derived from.
 *  - It must FAIL on at least one wrong answer. One that fires identically
 *    across strong and weak carries no information.
 */
export function evaluateKlps(
  reference: CandidateGrade,
  wrong: CandidateGrade[],
): KlpDiscrimination[] {
  return reference.verdicts.map((refVerdict, index) => {
    const passesReference = VERDICT_CREDIT[refVerdict] > 0
    const failsSomeWrong = wrong.some((w) => {
      const v = w.verdicts[index]
      return v !== undefined && VERDICT_CREDIT[v] === 0
    })
    return {
      index,
      passesReference,
      failsSomeWrong,
      discriminates: passesReference && failsSomeWrong,
    }
  })
}

export interface SeparationResult {
  referenceScore: number
  bestWrongScore: number
  separation: number
  separated: boolean
  perKlp: KlpDiscrimination[]
}

/**
 * `separation = referenceScore - bestWrongScore`, against SEPARATION_FLOOR.
 *
 * The BEST wrong answer sets the bar, never the mean: averaging lets one
 * hopeless adversary mask a near-miss the KLPs genuinely fail to catch, and
 * the near-miss is the whole point of writing three of them.
 *
 * No wrong answers means the test did not run, which is a failure, not a pass.
 */
export function computeSeparation(
  reference: CandidateGrade,
  wrong: CandidateGrade[],
): SeparationResult {
  const referenceScore = scoreCandidate(reference.verdicts)
  const bestWrongScore = wrong.length === 0
    ? referenceScore
    : Math.max(...wrong.map((w) => scoreCandidate(w.verdicts)))
  const separation = referenceScore - bestWrongScore
  return {
    referenceScore,
    bestWrongScore,
    separation,
    separated: wrong.length > 0 && separation >= SEPARATION_FLOOR,
    perKlp: evaluateKlps(reference, wrong),
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/klp && npx tsc --noEmit`
Expected: PASS, 12 tests in this file.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/separation.ts tests/klp/separation.test.ts
git commit -m "feat(klp): compute the discrimination score in TypeScript"
```

---

### Task 4: Mechanical validators

**Files:**
- Create: `src/lib/klp/validate.ts`
- Test: `tests/klp/validate.test.ts`

**Interfaces:**
- Consumes: `MIN_KLPS_PER_CARD` (Task 2), `MAX_KLPS_PER_CARD` from `@/lib/ai/schemas`.
- Produces: `interface KlpDefect { index: number | null; rule: string; detail: string }`, `validateKlpSet(klps: { text: string }[], question: string): KlpDefect[]`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/validate.test.ts
import { describe, it, expect } from 'vitest'
import { validateKlpSet } from '@/lib/klp/validate'

const k = (text: string) => ({ text })

describe('validateKlpSet', () => {
  it('flags a compound KLP that could half-fail', () => {
    const out = validateKlpSet([k('EBIT falls by 10 and net income falls by 6')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(true)
  })

  /**
   * "and" inside a noun phrase is not a compound proposition. Flagging it
   * would train the author to avoid ordinary English.
   */
  it('does not flag "and" joining a noun phrase', () => {
    const out = validateKlpSet([k('Property, plant and equipment falls by 10')], 'Walk me through it')
    expect(out.some((d) => d.rule === 'compound')).toBe(false)
  })

  it('flags a KLP that merely restates the question', () => {
    const out = validateKlpSet([k('Walk me through a $10 depreciation')], 'Walk me through a $10 depreciation')
    expect(out.some((d) => d.rule === 'restatement')).toBe(true)
  })

  it('flags a set below the grain floor', () => {
    const out = validateKlpSet([k('a'), k('b')], 'q')
    expect(out.some((d) => d.rule === 'count')).toBe(true)
  })

  it('flags a set above the cap', () => {
    const out = validateKlpSet(Array.from({ length: 10 }, (_, i) => k(`point ${i}`)), 'q')
    expect(out.some((d) => d.rule === 'count')).toBe(true)
  })

  it('accepts a well-formed set of six', () => {
    const out = validateKlpSet(
      Array.from({ length: 6 }, (_, i) => k(`Distinct proposition number ${i}`)),
      'Walk me through it',
    )
    expect(out).toEqual([])
  })

  it('flags duplicate propositions', () => {
    const six = Array.from({ length: 5 }, (_, i) => k(`Proposition ${i}`))
    const out = validateKlpSet([...six, k('Proposition 0')], 'q')
    expect(out.some((d) => d.rule === 'duplicate')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/validate.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/klp/validate.ts
/**
 * Step 7 of the authoring pipeline, mechanically — no AI call.
 *
 * These are the defects a model reliably produces and cannot reliably
 * self-detect, so they are checked with code rather than asked about.
 */
import { MIN_KLPS_PER_CARD } from '@/lib/klp/authoring-config'
import { MAX_KLPS_PER_CARD } from '@/lib/ai/schemas'

export interface KlpDefect {
  /** The offending KLP, or null for a whole-set defect. */
  index: number | null
  rule: 'compound' | 'restatement' | 'count' | 'duplicate'
  detail: string
}

/** Cheap normalisation for comparing two propositions. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * A COMPOUND KLP is one that could half-fail — two independent claims joined
 * so a learner can get one right and one wrong, leaving the verdict
 * meaningless.
 *
 * The test is "and" joining two CLAUSES, not two nouns: "property, plant and
 * equipment" is one noun phrase and must not be flagged, or the author learns
 * to avoid ordinary English. A clause is approximated by a verb appearing on
 * both sides, which is crude but errs toward silence.
 */
const VERBISH = /\b(is|are|was|were|falls?|rises?|increases?|decreases?|equals?|has|have|adds?|drops?|becomes?|reduces?|raises?)\b/

function isCompound(text: string): boolean {
  const parts = text.split(/\band\b/i)
  if (parts.length < 2) return false
  return parts.filter((p) => VERBISH.test(p)).length >= 2
}

export function validateKlpSet(
  klps: { text: string }[],
  question: string,
): KlpDefect[] {
  const defects: KlpDefect[] = []

  if (klps.length < MIN_KLPS_PER_CARD || klps.length > MAX_KLPS_PER_CARD) {
    defects.push({
      index: null,
      rule: 'count',
      detail: `${klps.length} KLPs; expected ${MIN_KLPS_PER_CARD}-${MAX_KLPS_PER_CARD}`,
    })
  }

  const q = normalize(question)
  const seen = new Map<string, number>()

  klps.forEach((klp, index) => {
    if (isCompound(klp.text)) {
      defects.push({ index, rule: 'compound', detail: 'two claims joined by "and" — split it' })
    }
    const n = normalize(klp.text)
    if (n === q) {
      defects.push({ index, rule: 'restatement', detail: 'restates the question' })
    }
    const first = seen.get(n)
    if (first !== undefined) {
      defects.push({ index, rule: 'duplicate', detail: `same proposition as KLP ${first}` })
    } else {
      seen.set(n, index)
    }
  })

  return defects
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/klp && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/validate.ts tests/klp/validate.test.ts
git commit -m "feat(klp): add mechanical KLP validators"
```

---

### Task 5: Relation types, acyclicity, and blast-radius weights

**Files:**
- Create: `src/lib/klp/relations.ts`
- Test: `tests/klp/relations.test.ts`

**Interfaces:**
- Produces:
  - `RELATION_TYPES`, `type RelationType`, `DIRECTED_TYPES`, `SYMMETRIC_TYPES`, `isRelationType`
  - `RELATION_PROVENANCES`, `type RelationProvenance`
  - `interface RelationEdge { from: number; to: number; type: RelationType }`
  - `canonicalizeEdges(edges: RelationEdge[]): RelationEdge[]`
  - `findCycles(edges: RelationEdge[]): number[][]`
  - `blastRadius(klpCount: number, edges: RelationEdge[]): number[]`
  - `weightFromBlastRadius(radius: number): number`

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/relations.test.ts
import { describe, it, expect } from 'vitest'
import {
  RELATION_TYPES, DIRECTED_TYPES, SYMMETRIC_TYPES, isRelationType,
  canonicalizeEdges, findCycles, blastRadius, weightFromBlastRadius,
} from '@/lib/klp/relations'

describe('the vocabulary', () => {
  it('has no part_of — that is the concept tree, not a KLP relation', () => {
    expect(RELATION_TYPES).not.toContain('part_of')
  })

  it('splits cleanly into directed and symmetric with nothing left over', () => {
    expect([...DIRECTED_TYPES, ...SYMMETRIC_TYPES].sort()).toEqual([...RELATION_TYPES].sort())
    for (const t of SYMMETRIC_TYPES) expect(DIRECTED_TYPES).not.toContain(t)
  })

  it('narrows only real members', () => {
    expect(isRelationType('causes')).toBe(true)
    expect(isRelationType('contrasts')).toBe(false)
    expect(isRelationType(undefined)).toBe(false)
  })
})

describe('canonicalizeEdges', () => {
  it('orders symmetric endpoints so one pair cannot be stored twice', () => {
    const out = canonicalizeEdges([{ from: 3, to: 1, type: 'confused_with' }])
    expect(out[0]).toEqual({ from: 1, to: 3, type: 'confused_with' })
  })

  it('leaves directed endpoints alone — direction is the information', () => {
    const out = canonicalizeEdges([{ from: 3, to: 1, type: 'causes' }])
    expect(out[0]).toEqual({ from: 3, to: 1, type: 'causes' })
  })

  it('collapses a symmetric pair emitted in both directions', () => {
    const out = canonicalizeEdges([
      { from: 1, to: 2, type: 'confused_with' },
      { from: 2, to: 1, type: 'confused_with' },
    ])
    expect(out).toHaveLength(1)
  })
})

describe('findCycles', () => {
  /**
   * The shape this exists to catch: a model emits X causes Y in one call and
   * Y causes X in another, and neither call can see the other.
   */
  it('finds a two-node cycle across directed edges', () => {
    const cycles = findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 0, type: 'causes' },
    ])
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('finds a three-node cycle', () => {
    const cycles = findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 2, type: 'requires' },
      { from: 2, to: 0, type: 'precedes' },
    ])
    expect(cycles.length).toBeGreaterThan(0)
  })

  it('accepts a diamond — shared ancestry is not a cycle', () => {
    expect(findCycles([
      { from: 0, to: 1, type: 'causes' },
      { from: 0, to: 2, type: 'causes' },
      { from: 1, to: 3, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
    ])).toEqual([])
  })

  /** Symmetric edges are not dependencies and must be exempt. */
  it('ignores symmetric edges entirely', () => {
    expect(findCycles([
      { from: 0, to: 1, type: 'confused_with' },
      { from: 1, to: 0, type: 'confused_with' },
    ])).toEqual([])
  })
})

describe('blastRadius', () => {
  /**
   * The user's own worked example, reduced: K3 (non-cash) causes K4 (CFO up),
   * K1 (EBIT down) causes K2 (NI down) which precedes K4.
   */
  it('counts everything downstream, transitively', () => {
    const r = blastRadius(5, [
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 3, type: 'precedes' },
      { from: 2, to: 3, type: 'causes' },
    ])
    expect(r[0]).toBe(2)  // 1 and 3
    expect(r[1]).toBe(1)  // 3
    expect(r[2]).toBe(1)  // 3
    expect(r[3]).toBe(0)  // leaf
    expect(r[4]).toBe(0)  // disconnected
  })

  it('counts a descendant once even when two paths reach it', () => {
    const r = blastRadius(4, [
      { from: 0, to: 1, type: 'causes' },
      { from: 0, to: 2, type: 'causes' },
      { from: 1, to: 3, type: 'causes' },
      { from: 2, to: 3, type: 'causes' },
    ])
    expect(r[0]).toBe(3)
  })

  it('ignores symmetric edges — they are not dependencies', () => {
    expect(blastRadius(2, [{ from: 0, to: 1, type: 'confused_with' }])).toEqual([0, 0])
  })

  it('terminates on a cycle instead of hanging', () => {
    const r = blastRadius(2, [
      { from: 0, to: 1, type: 'causes' },
      { from: 1, to: 0, type: 'causes' },
    ])
    expect(r[0]).toBe(1)
    expect(r[1]).toBe(1)
  })
})

describe('weightFromBlastRadius', () => {
  /**
   * G1: 92% of AI-assigned weights were 4 or 5, so significance never spanned
   * 1-10. A graph property spreads because the graph spreads.
   */
  it('maps a leaf to 1 and a wide root to 5', () => {
    expect(weightFromBlastRadius(0)).toBe(1)
    expect(weightFromBlastRadius(1)).toBe(2)
    expect(weightFromBlastRadius(4)).toBe(5)
    expect(weightFromBlastRadius(50)).toBe(5)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/relations.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

```ts
// src/lib/klp/relations.ts
/**
 * KLP-to-KLP relations: the vocabulary, the invariant, and the graph property
 * that replaces the AI's centrality opinion.
 *
 * An edge is admitted to this vocabulary only if it makes a SPECIFIC FAILURE
 * nameable. `part_of` is deliberately absent — that is the concept tree
 * (SetKltNode) and duplicating it here would give one hierarchy two homes.
 */

export const DIRECTED_TYPES = ['causes', 'requires', 'precedes', 'applies_within'] as const
export const SYMMETRIC_TYPES = ['confused_with', 'analogous_to'] as const
export const RELATION_TYPES = [...DIRECTED_TYPES, ...SYMMETRIC_TYPES] as const

export type RelationType = (typeof RELATION_TYPES)[number]

export function isRelationType(value: unknown): value is RelationType {
  return typeof value === 'string' && (RELATION_TYPES as readonly string[]).includes(value)
}

export const RELATION_PROVENANCES = ['perturbation', 'order_violation', 'substitution'] as const
export type RelationProvenance = (typeof RELATION_PROVENANCES)[number]

/** Endpoints are KLP INDEXES within one card, not ids — ids do not exist yet. */
export interface RelationEdge {
  from: number
  to: number
  type: RelationType
}

function isSymmetric(type: RelationType): boolean {
  return (SYMMETRIC_TYPES as readonly string[]).includes(type)
}

/**
 * Store each symmetric pair once, under a fixed endpoint ordering.
 *
 * Without this, `confused_with` between 1 and 3 can be persisted twice — once
 * from each direction — and the unique constraint cannot see that they are the
 * same fact.
 */
export function canonicalizeEdges(edges: RelationEdge[]): RelationEdge[] {
  const seen = new Set<string>()
  const out: RelationEdge[] = []
  for (const e of edges) {
    const edge = isSymmetric(e.type) && e.from > e.to
      ? { from: e.to, to: e.from, type: e.type }
      : e
    const key = `${edge.from}>${edge.to}:${edge.type}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(edge)
  }
  return out
}

/**
 * Every cycle among the DIRECTED edges.
 *
 * An AI will happily emit X causes Y in one call and Y causes X in another,
 * because neither call can see the other. `src/lib/klt/invariants.ts` was
 * needed for a strictly easier invariant, so this one gets the same treatment:
 * a pure checker, tested in both directions, run before persistence.
 *
 * Symmetric types are exempt — they assert similarity, not dependency, so a
 * pair pointing both ways is the same fact rather than a contradiction.
 */
export function findCycles(edges: RelationEdge[]): number[][] {
  const adj = new Map<number, number[]>()
  for (const e of edges) {
    if (isSymmetric(e.type)) continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }

  const cycles: number[][] = []
  const state = new Map<number, 'open' | 'done'>()
  const stack: number[] = []

  const walk = (node: number) => {
    state.set(node, 'open')
    stack.push(node)
    for (const next of adj.get(node) ?? []) {
      if (state.get(next) === 'open') {
        cycles.push(stack.slice(stack.indexOf(next)))
      } else if (state.get(next) !== 'done') {
        walk(next)
      }
    }
    stack.pop()
    state.set(node, 'done')
  }

  for (const node of adj.keys()) {
    if (!state.has(node)) walk(node)
  }
  return cycles
}

/**
 * For each KLP, how many OTHER KLPs break if it is false.
 *
 * This is the perturbation pass read off the graph, and it is what replaces
 * the AI's 1-5 centrality rating. Audit finding G1: 92% of AI-assigned weights
 * were 4 or 5, so no accuracy error could score below 5 and significance never
 * spanned its own range. A model asked "how central is this point?" says
 * "very"; a graph says how much actually depends on it.
 *
 * Visited-set traversal, so a cycle terminates instead of hanging — cycles are
 * rejected before persistence, but this must not be the thing that discovers
 * one by never returning.
 */
export function blastRadius(klpCount: number, edges: RelationEdge[]): number[] {
  const adj = new Map<number, number[]>()
  for (const e of edges) {
    if (isSymmetric(e.type)) continue
    const list = adj.get(e.from)
    if (list) list.push(e.to)
    else adj.set(e.from, [e.to])
  }

  return Array.from({ length: klpCount }, (_, start) => {
    const seen = new Set<number>()
    const queue = [...(adj.get(start) ?? [])]
    while (queue.length > 0) {
      const node = queue.shift()!
      if (node === start || seen.has(node)) continue
      seen.add(node)
      queue.push(...(adj.get(node) ?? []))
    }
    return seen.size
  })
}

/** 0 dependents is a leaf (1); 4 or more is a root cause (5). */
export function weightFromBlastRadius(radius: number): number {
  return Math.min(5, Math.max(1, radius + 1))
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/klp && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/relations.ts tests/klp/relations.test.ts
git commit -m "feat(klp): relation vocabulary, acyclicity, and blast-radius weights"
```

---

### Task 6: Schema — authoring artifacts and relations

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260904000000_klp_authoring/migration.sql`

**Interfaces:**
- Produces: `CardAuthoring`, `AuthoringProbe`, `KlpRelation` models; new relation fields on `Card` and `CardKlp`.

- [ ] **Step 1: Add the models**

Add to `model Card`: `authorings CardAuthoring[]`.
Add to `model CardKlp`: `relationsFrom KlpRelation[] @relation("RelationFrom")` and `relationsTo KlpRelation[] @relation("RelationTo")`.

Then add the three models exactly as specified in the design doc §4 (`docs/superpowers/specs/2026-09-04-klp-authoring-pipeline-design.md`) — copy the model blocks and their doc comments verbatim, including the JSON-exception rationale on `AuthoringProbe.verdicts`.

- [ ] **Step 2: Write the migration**

```sql
-- prisma/migrations/20260904000000_klp_authoring/migration.sql

CREATE TABLE "CardAuthoring" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "klpVersion" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "referenceAnswer" TEXT NOT NULL,
    "separationScore" DOUBLE PRECISION NOT NULL,
    "revisions" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CardAuthoring_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CardAuthoring_cardId_createdAt_idx" ON "CardAuthoring"("cardId", "createdAt");
ALTER TABLE "CardAuthoring" ADD CONSTRAINT "CardAuthoring_cardId_fkey"
    FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AuthoringProbe" (
    "id" TEXT NOT NULL,
    "authoringId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "verdicts" JSONB NOT NULL,
    CONSTRAINT "AuthoringProbe_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuthoringProbe_authoringId_idx" ON "AuthoringProbe"("authoringId");
ALTER TABLE "AuthoringProbe" ADD CONSTRAINT "AuthoringProbe_authoringId_fkey"
    FOREIGN KEY ("authoringId") REFERENCES "CardAuthoring"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "KlpRelation" (
    "id" TEXT NOT NULL,
    "fromKlpId" TEXT NOT NULL,
    "toKlpId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "probe" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KlpRelation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "KlpRelation_fromKlpId_toKlpId_type_key" ON "KlpRelation"("fromKlpId", "toKlpId", "type");
CREATE INDEX "KlpRelation_fromKlpId_idx" ON "KlpRelation"("fromKlpId");
CREATE INDEX "KlpRelation_toKlpId_idx" ON "KlpRelation"("toKlpId");
ALTER TABLE "KlpRelation" ADD CONSTRAINT "KlpRelation_fromKlpId_fkey"
    FOREIGN KEY ("fromKlpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KlpRelation" ADD CONSTRAINT "KlpRelation_toKlpId_fkey"
    FOREIGN KEY ("toKlpId") REFERENCES "CardKlp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 3: Validate and generate**

Run: `npx prisma validate && npx prisma generate`
Expected: valid, generated.

- [ ] **Step 4: Apply and VERIFY it landed**

Run: `npx prisma migrate deploy`
Then verify against the database rather than trusting the exit code — query `information_schema.tables` and `information_schema.columns` for all three tables via a short `npx tsx --env-file=.env` script using the `PrismaNeon` adapter pattern from `src/lib/db.ts`. A mutation that did not apply looks exactly like one that did. Report the columns you saw.

If the database is unreachable, commit the schema and migration and report BLOCKED. Do not use `prisma db push`.

- [ ] **Step 5: Run the FULL suite and commit**

```bash
npx vitest run && npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/20260904000000_klp_authoring
git commit -m "feat(db): add KLP authoring artifacts and relations"
```

---

### Task 7: Extract `writeKlpVersion` to a plain module

**Files:**
- Create: `src/lib/cards/klp-write.ts`
- Modify: `src/actions/klp.ts` (delete the private copy, import instead)
- Test: `tests/cards/klp-write.test.ts`

**Interfaces:**
- Produces: `interface KlpRowInput { text, weight, kind, source, promptVersion }`, `writeKlpVersion(cardId: string, klps: KlpRowInput[], hash: string): Promise<{ version: number; klpIds: string[] }>`.

- [ ] **Step 1: Understand why this move is required**

`writeKlpVersion` is currently a private function inside `src/actions/klp.ts`, which carries `'use server'`. **Exporting it from there would make it a callable RPC endpoint** — an unauthenticated structural write into any card — which is the exact defect `tests/actions/klt-gated-exports-guard.test.ts` exists to catch, and the same fix the codebase already applied to `applyPaths`/`loadSetTree` by moving them to `src/lib/klt/structure.ts`.

The authoring pipeline needs it, so it moves to a plain module with no directive. It must also **return the created KLP ids**, which the current version does not: relations are attached to real rows.

- [ ] **Step 2: Write the failing test**

```ts
// tests/cards/klp-write.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  transaction: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn(),
  createMany: vi.fn(), findMany: vi.fn(), cardUpdate: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) => {
      h.transaction()
      return fn({
        cardKlp: { aggregate: h.aggregate, updateMany: h.updateMany, createMany: h.createMany, findMany: h.findMany },
        card: { update: h.cardUpdate },
      })
    },
  },
}))

import { writeKlpVersion } from '@/lib/cards/klp-write'

beforeEach(() => {
  vi.clearAllMocks()
  h.aggregate.mockResolvedValue({ _max: { version: 2 } })
  h.findMany.mockResolvedValue([{ id: 'k-a' }, { id: 'k-b' }])
})

const rows = [
  { text: 'a', weight: 3, kind: 'mechanism', source: 'ai', promptVersion: 2 },
  { text: 'b', weight: 1, kind: 'definition', source: 'ai', promptVersion: 2 },
]

describe('writeKlpVersion', () => {
  it('supersedes the live rows and writes the next version', async () => {
    await writeKlpVersion('c1', rows, 'hash')
    expect(h.updateMany).toHaveBeenCalledWith({
      where: { cardId: 'c1', supersededAt: null },
      data: { supersededAt: expect.any(Date) },
    })
    expect(h.createMany.mock.calls[0][0].data[0]).toMatchObject({ cardId: 'c1', version: 3, index: 0 })
  })

  /** Relations attach to real rows, so the ids must come back. */
  it('returns the created ids in index order', async () => {
    const out = await writeKlpVersion('c1', rows, 'hash')
    expect(out).toEqual({ version: 3, klpIds: ['k-a', 'k-b'] })
    expect(h.findMany).toHaveBeenCalledWith({
      where: { cardId: 'c1', version: 3 },
      orderBy: { index: 'asc' },
      select: { id: true },
    })
  })

  /**
   * A new KLP version has NEW ids, so its topics do not exist yet. Leaving
   * kltStatus 'ready' would serve the previous version's topics against
   * propositions the card no longer teaches.
   */
  it('resets kltStatus to pending', async () => {
    await writeKlpVersion('c1', rows, 'hash')
    expect(h.cardUpdate.mock.calls[0][0].data).toMatchObject({
      klpStatus: 'ready', klpVersion: 3, klpSourceHash: 'hash', kltStatus: 'pending',
    })
  })

  it('reads the version inside the transaction, not before it', async () => {
    await writeKlpVersion('c1', rows, 'hash')
    expect(h.transaction).toHaveBeenCalledTimes(1)
    expect(h.aggregate).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3: Move the function**

Create `src/lib/cards/klp-write.ts` containing the body of `writeKlpVersion` from `src/actions/klp.ts:246-298`, **preserving every doc comment verbatim** — they explain the same-transaction version read, the concurrent-extraction race, the P2002 retry, and the `kltStatus` reset, and each of those is a bug someone already paid for.

Add the id read-back inside the transaction, after `createMany`:

```ts
      const created = await tx.cardKlp.findMany({
        where: { cardId, version },
        orderBy: { index: 'asc' },
        select: { id: true },
      })
```

and return `{ version, klpIds: created.map((r) => r.id) }`. Read back rather than using `createManyAndReturn` so the code does not depend on a Prisma version feature this repo has not otherwise adopted; the read is inside the same transaction, so it cannot see another writer's rows.

Then in `src/actions/klp.ts`: delete the private copy and `import { writeKlpVersion, type KlpRowInput } from '@/lib/cards/klp-write'`. Do NOT re-export it — a named re-export from a `'use server'` module is a violation the structural guard treats as unconditional.

- [ ] **Step 4: Run the FULL suite**

Run: `npx vitest run && npx tsc --noEmit`
Expected: all pass. `tests/actions/klt-gated-exports-guard.test.ts` and every existing KLP test must be green — this is a pure move plus an additive return value.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cards/klp-write.ts src/actions/klp.ts tests/cards/klp-write.test.ts
git commit -m "refactor(klp): move writeKlpVersion out of the 'use server' module"
```

---

### Task 8: The `author` AI task and the four prompts

**Files:**
- Modify: `src/lib/ai/model-routing.ts` (`AI_TASKS` gains `'author'`)
- Create: `src/lib/ai/prompts/author-klps.ts`, `src/lib/ai/prompts/grade-candidate.ts`, `src/lib/ai/prompts/revise-klps.ts`, `src/lib/ai/prompts/relate-klps.ts`
- Modify: `src/lib/ai/schemas.ts` (four new Zod schemas)
- Test: `tests/ai/authoring-prompts.test.ts`

**Interfaces:**
- Consumes: `KLP_VERDICTS` (Task 1), `PROBE_KINDS` (Task 2), `RELATION_TYPES`/`RELATION_PROVENANCES` (Task 5), `KLP_KINDS` from `@/lib/ai/schemas`.
- Produces: `AUTHOR_KLPS_PROMPT`, `GRADE_CANDIDATE_PROMPT`, `REVISE_KLPS_PROMPT`, `RELATE_KLPS_PROMPT`, each `{ id, version, schema, build(input): string }` matching `EXTRACT_KLPS_PROMPT`'s shape; and `AuthorDraftSchema`, `CandidateGradeSchema`, `RelationDraftSchema`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/ai/authoring-prompts.test.ts
import { describe, it, expect } from 'vitest'
import { AUTHOR_KLPS_PROMPT } from '@/lib/ai/prompts/author-klps'
import { GRADE_CANDIDATE_PROMPT } from '@/lib/ai/prompts/grade-candidate'
import { RELATE_KLPS_PROMPT } from '@/lib/ai/prompts/relate-klps'
import { AI_TASKS } from '@/lib/ai/model-routing'
import { KLP_VERDICTS } from '@/lib/klp/verdicts'

describe('AI_TASKS', () => {
  it('has an author task, separate from grade', () => {
    expect(AI_TASKS).toContain('author')
    expect(AI_TASKS).toContain('grade')
  })
})

describe('AUTHOR_KLPS_PROMPT', () => {
  const built = AUTHOR_KLPS_PROMPT.build({
    setTitle: 'Accounting', term: 'Depreciation walkthrough',
    definition: 'A $10 depreciation expense, 40% tax rate.',
  })

  it('asks for the reference answer FIRST — KLPs are derived from an artifact', () => {
    expect(built.toLowerCase().indexOf('reference answer'))
      .toBeLessThan(built.toLowerCase().indexOf('key learning point'))
  })

  it('names all three adversary archetypes', () => {
    for (const k of ['confident', 'vague', 'template']) {
      expect(built.toLowerCase()).toContain(k)
    }
  })

  it('states the 5-9 range as a smell test, not a quota', () => {
    expect(built).toMatch(/5\D{0,4}9/)
    expect(built.toLowerCase()).toContain('not a quota')
  })
})

describe('GRADE_CANDIDATE_PROMPT', () => {
  const built = GRADE_CANDIDATE_PROMPT.build({
    question: 'Walk me through it',
    referenceAnswer: 'EBIT falls 10...',
    klps: [{ text: 'EBIT falls by the full 10' }, { text: 'Net income falls 6' }],
    candidateAnswer: 'Uh, something goes down.',
  })

  it('offers the full verdict vocabulary', () => {
    for (const v of KLP_VERDICTS) expect(built).toContain(v)
  })

  /**
   * THE ISOLATION RULE. The grader must not learn which archetype it is
   * looking at, or it grades the label instead of the answer.
   */
  it('never reveals which adversary archetype the candidate is', () => {
    const lower = built.toLowerCase()
    for (const k of ['confident_wrong', 'vague', 'memorized_template', 'deliberately wrong']) {
      expect(lower).not.toContain(k)
    }
  })

  it('grades exactly one candidate', () => {
    expect(built).toContain('Uh, something goes down.')
    expect(built.toLowerCase()).not.toContain('candidate 2')
  })
})

describe('RELATE_KLPS_PROMPT', () => {
  const built = RELATE_KLPS_PROMPT.build({
    question: 'Walk me through it',
    klps: [{ text: 'a' }, { text: 'b' }],
  })

  /**
   * "K3 is false" cannot be propagated; "depreciation is a cash charge" can.
   * This distinction decides whether perturbation works at all.
   */
  it('asks for a counterfactual premise, not a negation', () => {
    expect(built.toLowerCase()).toContain('counterfactual')
    expect(built.toLowerCase()).not.toMatch(/assume .{0,20}is false/)
  })

  it('demands the adversarial artifact that proves an edge informative', () => {
    expect(built.toLowerCase()).toContain('both endpoints')
  })

  it('does not offer part_of — that is the concept tree', () => {
    expect(built).not.toContain('part_of')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ai/authoring-prompts.test.ts`
Expected: FAIL — modules missing, `AI_TASKS` has no `author`.

- [ ] **Step 3: Add the task and the schemas**

In `src/lib/ai/model-routing.ts`:

```ts
export const AI_TASKS = ['grade', 'plan', 'distractors', 'autocomplete', 'note-analysis', 'diagnostic', 'author'] as const;
```

with a comment: authoring is judgment-heavy and runs rarely; runtime grading is latency-sensitive and runs constantly. One task for both would force a single routing decision on two different workloads.

In `src/lib/ai/schemas.ts`, add:

```ts
export const AuthorDraftSchema = z.object({
  referenceAnswer: z.string().min(1),
  klps: z.array(z.object({
    text: z.string().min(1),
    kind: z.enum(KLP_KINDS),
  })).min(1).max(MAX_KLPS_PER_CARD),
  wrongAnswers: z.array(z.object({
    kind: z.enum(PROBE_KINDS),
    text: z.string().min(1),
  })).min(1).max(PROBE_KINDS.length),
});

export const CandidateGradeSchema = z.object({
  verdicts: z.array(z.object({
    klpIndex: z.number().int().min(0),
    verdict: z.enum(KLP_VERDICTS),
    evidence: z.string().optional(),
  })),
});

export const RelationDraftSchema = z.object({
  relations: z.array(z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    type: z.enum(RELATION_TYPES),
    provenance: z.enum(RELATION_PROVENANCES),
    rationale: z.string().min(1),
    probe: z.string().min(1),
  })),
});
```

**Note the deliberate absence of `weight`** from `AuthorDraftSchema`. Weight is computed from the relation graph (Task 5), not asked for — that is what closes G1.

- [ ] **Step 4: Write the four prompts**

Each follows `EXTRACT_KLPS_PROMPT`'s shape exactly (`src/lib/ai/prompts/extract-klps.ts`): an exported const with `id`, `version: 1`, `schema`, and `build(input): string`. Read that file first for house voice.

Content requirements, each of which a test above pins:

`AUTHOR_KLPS_PROMPT` — one card. Ask, in this order: (1) a reference answer at the bar expected of a strong candidate; (2) KLPs extracted **from that answer**, 5-9, stated as the smell test with the words "not a quota", each an independently checkable proposition; (3) exactly three wrong answers, one per `PROBE_KINDS` member, described by behaviour — articulate and wrong; refuses to commit; correct structure with no substance — and **written to fail specific KLPs**.

`GRADE_CANDIDATE_PROMPT` — question, reference answer, the KLP list, and ONE candidate answer. Return one verdict per KLP from `KLP_VERDICTS`. **It must not say the candidate is deliberately wrong, name an archetype, or mention other candidates.** Its whole job is judging this answer against these propositions.

`REVISE_KLPS_PROMPT` — the current KLPs plus the per-KLP discrimination result, and instructions to cut or split the non-discriminating ones. Say plainly that a KLP passing on every answer carries no information, and that the fix is usually to split a vague point into the specific claims it was hiding.

`RELATE_KLPS_PROMPT` — the surviving KLPs. Ask for perturbation (a **counterfactual premise**, then re-derive inside that world), order violation (keep a rejection only where the later point's derivation consumes the earlier one's output, with a reason), and substitution (which pairs get mistaken for each other → `confused_with`). For every candidate edge demand a `probe`: an answer getting **both endpoints** demonstrably right and the link wrong. State that if no such answer can be written, the edge is definitional and must be dropped. Offer only `RELATION_TYPES`; `analogous_to` is cross-card and must not be emitted here.

- [ ] **Step 5: Run the FULL suite and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/ai/model-routing.ts src/lib/ai/schemas.ts src/lib/ai/prompts tests/ai/authoring-prompts.test.ts
git commit -m "feat(ai): add the author task and the four authoring prompts"
```

---

### Task 9: The orchestrator

**Files:**
- Create: `src/lib/klp/authoring.ts`
- Test: `tests/klp/authoring.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-5 and 8.
- Produces:
  - `interface AuthoringGenerator { author(...): Promise<...>; grade(...): Promise<...>; revise(...): Promise<...>; relate(...): Promise<...> }`
  - `interface AuthoringOutcome { referenceAnswer: string; klps: { text: string; kind: string; weight: number }[]; probes: { kind: ProbeKind; text: string; score: number; verdicts: Record<string, KlpVerdict> }[]; relations: RelationEdge[] & { provenance, rationale, probe }[]; separationScore: number; revisions: number; status: 'separated' | 'low_discrimination' | 'failed'; defects: KlpDefect[] }`
  - `authorCard(input: { question: string; definition: string; setTitle: string }, gen: AuthoringGenerator): Promise<AuthoringOutcome>`

- [ ] **Step 1: Write the failing test**

The generator is INJECTED, exactly as `KltGenerator` is in `src/lib/klt/summarize.ts`, so the loop is testable with zero AI calls. Read that file for the pattern.

```ts
// tests/klp/authoring.test.ts
import { describe, it, expect, vi } from 'vitest'
import { authorCard } from '@/lib/klp/authoring'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const no: KlpVerdict = 'omission'

function gen(over: Partial<Record<string, unknown>> = {}) {
  const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
  return {
    author: vi.fn().mockResolvedValue({
      referenceAnswer: 'ref',
      klps,
      wrongAnswers: [
        { kind: 'confident_wrong', text: 'w1' },
        { kind: 'vague', text: 'w2' },
        { kind: 'memorized_template', text: 'w3' },
      ],
    }),
    // Reference all-correct; every wrong answer all-wrong → separation 1.0
    grade: vi.fn().mockImplementation(({ candidateAnswer }: { candidateAnswer: string }) => ({
      verdicts: klps.map((_, i) => ({
        klpIndex: i, verdict: candidateAnswer === 'ref' ? ok : no,
      })),
    })),
    revise: vi.fn().mockResolvedValue({ klps }),
    relate: vi.fn().mockResolvedValue({ relations: [] }),
    ...over,
  }
}

const card = { question: 'Walk me through it', definition: 'x', setTitle: 'Accounting' }

describe('authorCard', () => {
  it('separates on the first pass and never revises', async () => {
    const g = gen()
    const out = await authorCard(card, g)
    expect(out.status).toBe('separated')
    expect(out.revisions).toBe(0)
    expect(g.revise).not.toHaveBeenCalled()
  })

  it('grades every candidate in its OWN call — reference plus three wrong', async () => {
    const g = gen()
    await authorCard(card, g)
    expect(g.grade).toHaveBeenCalledTimes(4)
  })

  /** The grader must never be told which archetype it is looking at. */
  it('passes no probe kind into the grade call', async () => {
    const g = gen()
    await authorCard(card, g)
    for (const call of g.grade.mock.calls) {
      expect(Object.keys(call[0])).not.toContain('kind')
    }
  })

  it('revises when the wrong answers score too well, then re-grades', async () => {
    const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
    let round = 0
    const g = gen({
      grade: vi.fn().mockImplementation(({ candidateAnswer }: { candidateAnswer: string }) => {
        // Round 0: wrong answers score 5/6. Round 1+: they score 0.
        const passing = candidateAnswer === 'ref' || round === 0
        return { verdicts: klps.map((_, i) => ({ klpIndex: i, verdict: passing && i < 5 ? ok : (candidateAnswer === 'ref' ? ok : no) })) }
      }),
    })
    const out = await authorCard(card, { ...g, grade: g.grade as never })
    round = 1
    expect(g.revise).toHaveBeenCalled()
    expect(out.revisions).toBeGreaterThan(0)
  })

  /**
   * A card that will not separate is WRITTEN and FLAGGED, never dropped and
   * never retried silently.
   */
  it('flags low_discrimination after the cap instead of looping or dropping', async () => {
    const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
    const g = gen({
      grade: vi.fn().mockResolvedValue({ verdicts: klps.map((_, i) => ({ klpIndex: i, verdict: ok })) }),
    })
    const out = await authorCard(card, g)
    expect(out.status).toBe('low_discrimination')
    expect(out.revisions).toBe(2)
    expect(out.klps.length).toBeGreaterThan(0)
  })

  it('computes weight from the relation graph, never from the model', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          { from: 1, to: 2, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g)
    expect(out.klps[0].weight).toBe(3)  // reaches 1 and 2
    expect(out.klps[2].weight).toBe(1)  // leaf
  })

  it('drops a relation that would create a cycle rather than persisting it', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          { from: 1, to: 0, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g)
    expect(out.relations.length).toBeLessThan(2)
  })

  it('reports mechanical defects without failing the card', async () => {
    const g = gen({
      author: vi.fn().mockResolvedValue({
        referenceAnswer: 'ref',
        klps: [{ text: 'only one point', kind: 'definition' }],
        wrongAnswers: [{ kind: 'vague', text: 'w' }],
      }),
    })
    const out = await authorCard(card, g)
    expect(out.defects.some((d) => d.rule === 'count')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/klp/authoring.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the orchestrator**

`authorCard` runs: author → grade each candidate in its own call (reference first, then each wrong answer, passing ONLY `{ question, referenceAnswer, klps, candidateAnswer }` — never the probe kind) → `computeSeparation` → while not separated and revisions < `MAX_REVISIONS`: revise, re-grade all candidates → `relate` → `canonicalizeEdges` → drop any edge whose addition introduces a cycle (`findCycles` on the accumulated set, adding edges one at a time so the specific offender is dropped rather than the whole batch) → `blastRadius` → `weightFromBlastRadius` → `validateKlpSet`.

Status is `separated` when the loop exited on separation, `low_discrimination` when the cap was hit, `failed` only when the author call produced no KLPs at all.

`GRADE_CANDIDATES_SEPARATELY === false` grades all candidates in one call; keep that branch, and comment that it trades the test's validity for spend.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/klp && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/authoring.ts tests/klp/authoring.test.ts
git commit -m "feat(klp): the authoring orchestrator and its discrimination loop"
```

---

### Task 10: Persistence

**Files:**
- Create: `src/lib/klp/authoring-persist.ts`
- Test: `tests/klp/authoring-persist.test.ts`

**Interfaces:**
- Consumes: `AuthoringOutcome` (Task 9), `writeKlpVersion` (Task 7), the models from Task 6.
- Produces: `persistAuthoring(cardId: string, outcome: AuthoringOutcome, promptVersion: number): Promise<{ authoringId: string; klpIds: string[] }>`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/klp/authoring-persist.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  write: vi.fn(), authoringCreate: vi.fn(), probeCreateMany: vi.fn(), relationCreateMany: vi.fn(),
}))
vi.mock('@/lib/cards/klp-write', () => ({ writeKlpVersion: h.write }))
vi.mock('@/lib/db', () => ({
  prisma: {
    cardAuthoring: { create: h.authoringCreate },
    authoringProbe: { createMany: h.probeCreateMany },
    klpRelation: { createMany: h.relationCreateMany },
  },
}))

import { persistAuthoring } from '@/lib/klp/authoring-persist'

beforeEach(() => {
  vi.clearAllMocks()
  h.write.mockResolvedValue({ version: 4, klpIds: ['k0', 'k1', 'k2'] })
  h.authoringCreate.mockResolvedValue({ id: 'a1' })
})

const outcome = {
  referenceAnswer: 'ref',
  klps: [
    { text: 'p0', kind: 'mechanism', weight: 3 },
    { text: 'p1', kind: 'causal', weight: 2 },
    { text: 'p2', kind: 'definition', weight: 1 },
  ],
  probes: [{ kind: 'vague' as const, text: 'w', score: 0.2, verdicts: { '0': 'omission' as const } }],
  relations: [{ from: 0, to: 1, type: 'causes' as const, provenance: 'perturbation' as const, rationale: 'r', probe: 'p' }],
  separationScore: 0.8,
  revisions: 1,
  status: 'separated' as const,
  defects: [],
}

describe('persistAuthoring', () => {
  it('writes the KLPs with their COMPUTED weights', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.write.mock.calls[0][1]).toEqual([
      { text: 'p0', kind: 'mechanism', weight: 3, source: 'ai', promptVersion: 1 },
      { text: 'p1', kind: 'causal', weight: 2, source: 'ai', promptVersion: 1 },
      { text: 'p2', kind: 'definition', weight: 1, source: 'ai', promptVersion: 1 },
    ])
  })

  /** Relation endpoints are INDEXES until the rows exist; they must be mapped. */
  it('maps relation indexes onto the real KLP ids', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.relationCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      fromKlpId: 'k0', toKlpId: 'k1', type: 'causes',
    })
  })

  it('records the run with its separation score and status', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.authoringCreate.mock.calls[0][0].data).toMatchObject({
      cardId: 'c1', klpVersion: 4, referenceAnswer: 'ref',
      separationScore: 0.8, revisions: 1, status: 'separated',
    })
  })

  it('writes no relations when there are none, rather than an empty call', async () => {
    await persistAuthoring('c1', { ...outcome, relations: [] }, 1)
    expect(h.relationCreateMany).not.toHaveBeenCalled()
  })

  it('writes KLPs before relations — a relation needs real rows to point at', async () => {
    await persistAuthoring('c1', outcome, 1)
    expect(h.write.mock.invocationCallOrder[0])
      .toBeLessThan(h.relationCreateMany.mock.invocationCallOrder[0])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/klp/authoring-persist.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Order matters and the test pins it: `writeKlpVersion` first (it returns the ids), then `cardAuthoring.create`, then probes, then relations with indexes mapped through `klpIds`. Skip `createMany` calls with empty arrays.

- [ ] **Step 4: Run tests and commit**

```bash
npx vitest run tests/klp && npx tsc --noEmit
git add src/lib/klp/authoring-persist.ts tests/klp/authoring-persist.test.ts
git commit -m "feat(klp): persist authoring runs, probes and relations"
```

---

### Task 11: The script

**Files:**
- Create: `scripts/author-klps.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `authorCard` (Task 9), `persistAuthoring` (Task 10).
- Produces: `npm run author-klps -- --set <setId> [--direct] [--limit N] [--dry-run]`.

- [ ] **Step 1: Read the precedent**

`scripts/backfill-klts.ts` is the model. Copy three things from it deliberately:

1. **The injected generator.** It takes a `KltGenerator` so the AI layer is swappable.
2. **`--direct`.** It runs against a raw `GOOGLE_API_KEY` instead of stored credentials, because `GOOGLE_KEY_ENCRYPTION_SECRET` locally is not the secret those credentials were encrypted with, so every decrypt throws and the feature cannot be exercised at all. **Without this flag the pilot cannot be run on this machine.** It writes nothing to `AiCredential`.
3. Its resumability and progress reporting.

- [ ] **Step 2: Write the script**

Requirements:
- `--set <setId>` is required. Refuse to run without it — this must never walk the corpus; Spec 4 owns that.
- Process cards **one at a time**, in `position` order, printing `[n/total] <term> — separation 0.83, 6 KLPs, 3 relations` per card.
- **Resumable:** skip a card that already has a `CardAuthoring` row for its current `klpVersion` unless `--force`. A failure at card 37 of 50 must not restart from 1.
- **Never throw out of the loop.** One card's failure records `klpStatus: 'failed'` with `klpError` and continues, matching `extractKlpsForCards`'s posture.
- `--dry-run` runs the pipeline and prints the outcome without writing.
- `--limit N` stops after N cards, so the first pilot run can be two cards rather than fifty.
- Print a summary: cards authored, mean separation, how many `low_discrimination`, total KLPs, total relations.

Add to `package.json`: `"author-klps": "tsx --env-file=.env scripts/author-klps.ts"`.

- [ ] **Step 3: Verify on ONE card**

Run: `npm run author-klps -- --set <LBO setId> --limit 1 --dry-run --direct`

Get the LBO set id first with a short read-only query. Expected: a reference answer, 5-9 KLPs, three wrong answers, a separation score, and relations printed — with nothing written. Report the actual output verbatim, including the KLPs, so the controller can judge grain and quality before any real spend.

**If the output is poor, STOP and report it.** That is the pipeline failing its purpose, and a prompt problem is cheaper to fix now than after fifty cards.

- [ ] **Step 4: Commit**

```bash
npx vitest run && npx tsc --noEmit
git add scripts/author-klps.ts package.json
git commit -m "feat(klp): add the author-klps pilot script"
```

---

### Task 12: Surface authoring in the staff view

**Files:**
- Modify: `src/lib/staff/queries.ts`, `src/components/staff/KlpTable.tsx`
- Test: `tests/staff/klp-table.test.tsx`

**Interfaces:**
- Consumes: `StaffKlpRow` (Spec 1).
- Produces: `StaffKlpRow` gains `separation: number | null` and `authoringStatus: string | null`.

- [ ] **Step 1: Write the failing test**

Add to `tests/staff/klp-table.test.tsx`:

```tsx
it('shows the separation score for a discrimination-tested KLP', () => {
  render(<KlpTable rows={[row({ separation: 0.83, authoringStatus: 'separated' })]} />)
  expect(screen.getByText('0.83')).toBeInTheDocument()
})

/**
 * A card that would not separate must be visible, not silently equivalent to
 * one that did. That flag is the whole reason the loop writes instead of
 * retrying.
 */
it('flags a low-discrimination card', () => {
  render(<KlpTable rows={[row({ separation: 0.12, authoringStatus: 'low_discrimination' })]} />)
  expect(screen.getByText(/low discrimination/i)).toBeInTheDocument()
})

/** Legacy KLPs predate the pipeline; an em dash, never a zero. */
it('shows an em dash for a KLP authored by the legacy path', () => {
  const { container } = render(<KlpTable rows={[row({ separation: null, authoringStatus: null })]} />)
  expect(screen.queryByText('0.00')).not.toBeInTheDocument()
  expect(container.textContent).toContain('—')
})
```

Extend the `row()` helper with the two new fields, defaulting to `null`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tests/staff/klp-table.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `loadStaffKlps`, include the card's most recent `CardAuthoring` row whose `klpVersion` matches the KLP's `version`, and map `separationScore` / `status` onto the row. A KLP with no matching run gets `null` for both — never 0, for the same reason `meanPKnown` is null rather than 0.

Add one column to `KlpTable` between "Mean known" and "Verdicts". **Do not touch the Relations column** — Spec 3 fills it.

- [ ] **Step 4: Run the FULL suite and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/staff/queries.ts src/components/staff/KlpTable.tsx tests/staff/klp-table.test.tsx
git commit -m "feat(staff): surface separation scores in the KLP inspector"
```

---

### Task 13: The pilot run and documentation

**Files:**
- Modify: `CLAUDE.md`, `docs/superpowers/BUILD-QUEUE.md`

- [ ] **Step 1: Verify**

Run: `npx vitest run`, `npx tsc --noEmit`, `npx eslint`. Report exact counts. The suite must be at or above 2586 with zero failures; lint at or below 175.

- [ ] **Step 2: Author the LBO pilot**

Run: `npm run author-klps -- --set <LBO setId> --direct`

Ten cards. Report the summary verbatim: mean separation, `low_discrimination` count, total KLPs, total relations. Then print the KLPs for two cards in full so the controller can judge grain against the old 2-per-card mode.

**Do not proceed to `Accounting - Knowledge`.** That is the acceptance run and it is the owner's call to make after reading the pilot in `/staff/klps`.

- [ ] **Step 3: Update `CLAUDE.md`**

Add a paragraph to the AI integration section describing the authoring pipeline: that KLPs are now discrimination-tested rather than merely generated, that the separation score and per-KLP verdicts are computed in TypeScript from the AI's categorical judgments, that weight is a computed blast radius rather than an AI centrality rating (and why — G1), and that candidates are graded in isolated calls because a grader shown all four ranks them against each other and manufactures separation. Note that the legacy batched path still serves new cards until Spec 4.

- [ ] **Step 4: Update `docs/superpowers/BUILD-QUEUE.md`**

Mark Spec 2 as built, with the pilot numbers. Record that `KlpRelation` rows now exist for the pilot set and that Spec 3 fills `/staff/klps`'s empty Relations column rather than adding one. Note that G1 is closed by computed weights and G7 by the pipeline, and that G2 remains open until Spec 4.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md docs/superpowers/BUILD-QUEUE.md
git commit -m "docs: record Spec 2 as built with the LBO pilot results"
```

---

## Self-Review

**Spec coverage.** §1 call structure → Tasks 8, 9. §1.1 isolation → Task 8's prompt test and Task 9's `grade` call-count and no-kind tests. §1.2 `author` task → Task 8. §2 separation score → Tasks 2, 3. §3 blast-radius weight → Task 5, wired in Task 9, persisted in Task 10. §4 schema → Task 6. §5 relations → Tasks 5, 8, 9. §6 verdict vocabulary → Task 1. §7 code changes → Tasks 2 (`MAX_KLPS_PER_CARD`), 7 (`writeKlpVersion` move), 11 (script). §8 verification → every task's tests plus Task 13's pilot. §9 out-of-scope items appear nowhere.

**One addition beyond the spec, deliberate:** Task 7 (moving `writeKlpVersion`) is not in the design doc. It is forced by a constraint the design doc states elsewhere — every export of a `'use server'` module is an RPC endpoint — and discovered while reading the code: the function the pipeline must call is private to `src/actions/klp.ts`, and the pipeline also needs it to return ids it currently discards.

**Placeholder scan.** No TBD/TODO. Every code step carries real code. Task 8's four prompts are specified by their pinned content requirements rather than full text, because prompt prose is the one artifact where dictating every word would be worse than stating what each must contain and letting it read the house voice — each requirement has a corresponding assertion.

**Type consistency.** `KlpVerdict` (Task 1) is used unchanged in Tasks 3, 8, 9, 10. `RelationEdge`'s `from`/`to` are KLP **indexes** everywhere until Task 10 maps them to ids, which its test pins. `AuthoringOutcome` is produced in Task 9 and consumed in Task 10 with the same field names. `writeKlpVersion`'s new return type `{ version, klpIds }` is defined in Task 7 and consumed in Task 10.

**One risk carried deliberately.** Task 11's Step 3 is a real AI call against the live pilot set, and its output cannot be predicted here. That step exists precisely to surface a bad pipeline before fifty cards of spend, and it says to stop and report rather than continue.
