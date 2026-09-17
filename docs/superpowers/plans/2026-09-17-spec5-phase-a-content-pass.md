# Spec 5 Phase A — The Content Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The runtime grader becomes a stateless instrument that reports, per key point / relation / form requirement, one of thirteen categorical verdicts with the quote that proves it, plus the claims the card never made — with the existing mastery engine kept running unchanged and a re-runnable benchmark that proves the grader ranks answers the way an adversary intended.

**Architecture:** One content call per answer (`GRADE_SHORT_ANSWER_PROMPT` v5) that imports the authoring grader's verdict block as a shared fragment; verdict rows keep their three-valued credit through a total `STATUS_CREDIT` table; quotes are resolved to spans in pure TS; relations and authored form requirements are graded in the same call; everything new is additive schema. The benchmark authors a four-level panel per card, grades each in isolation through the shipped prompt, and scores rank agreement in TS.

**Tech Stack:** Next.js App Router, Prisma/Postgres (Neon), Vercel AI SDK v7 (`generateText` + `Output.object`), Zod, vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-09-17-spec5-runtime-verdict-labels-design.md` — Phase A is §1–§8. Read the spec's "Decisions" table and "The boundary" before any task.

## Global Constraints

- **The grader never sees the learner.** No `profileBlock`, no history, no ability in any grading prompt. A test pins it (Task 3).
- **Spellings are persisted; never rename a verdict.** `CORRUPTIONS ⊂ ACCURACY_TYPES ⊂ KLP_VERDICTS` must hold and is tested.
- **`passed` is never written again** by any path; it is a read-only alias of `correct`.
- **No historical row is rewritten** by any task here. The regrade tool writes a new generation and marks the old one superseded.
- **No score is emitted by the grader** as a Phase A change to *new* outputs; the existing 1–10 rubric stays in the schema untouched until Phase B retires it (`isCorrect` keeps its `overall >= 8` rule until Phase B).
- **Every persisted AI artifact records its model** (`tests/ai/model-attribution.test.ts` scans for bare `generateJson` calls — use `generateJsonWithMeta` where a row stores the output).
- **Never push.** Commit at the end of each task; the owner pushes.
- **Baselines** at the start of this plan: full suite green (`npm test`), `npx tsc --noEmit` clean, lint at or below the standing ceiling. Every task ends with `npx tsc --noEmit` and the affected test files; run the full suite at the end of Tasks 3, 8, 11.
- **Environment traps** (see `docs/superpowers/BUILD-QUEUE.md` §"Environment gotchas"): `.env` has no `GOOGLE_KEY_ENCRYPTION_SECRET`, so stored credentials cannot be decrypted locally — live probes use raw env keys through `scripts/*` the way `scripts/probe-diagnostic-ai.ts` does. Migrations are applied with `npx prisma migrate deploy` against the dev database only when the task says so. Long-running scripts go detached via PowerShell `Start-Process` with a progress file.

---

## File map

| File | Responsibility |
| --- | --- |
| `src/lib/klp/verdicts.ts` (modify) | canonical vocabulary; gains `RUNTIME_VERDICTS` (the subset the runtime prompt offers) |
| `src/lib/errors/klp-credit.ts` (modify) | `KLP_STATUSES` = verdicts + legacy alias; one total `STATUS_CREDIT`; `isKlpStatus` |
| `src/lib/errors/labels.ts` (modify) | a label for every status |
| `src/lib/metrics/misconceptions.ts`, `missed.ts`, `src/lib/analysis/rollup.ts` (modify) | credit comparisons, never label comparisons |
| `src/components/quiz/QuizSummary.tsx`, `src/components/klp/KlpGraphCanvas.tsx`, `src/lib/games/hot-seat.ts`, `src/actions/games.ts` (modify) | display and hit logic by credit |
| `src/lib/ai/prompts/verdict-block.ts` (create) | `verdictInstructionBlock` — the one shared wording |
| `src/lib/ai/prompts/grade-candidate.ts`, `grade-short-answer.ts`, `diagnostic.ts` (modify) | import the block; drop the profile; relations + form reqs + unwarranted |
| `src/lib/ai/schemas.ts` (modify) | `klpResults.status: z.enum(RUNTIME_VERDICTS)`, `relationResults`, `formResults`, `unwarranted` |
| `src/lib/analysis/spans.ts` (create) | quote → `[start, end]` resolver |
| `src/lib/analysis/version.ts` (create) | `GRADER_VERSION` |
| `src/lib/analysis/persist.ts`, `write-answer.ts` (modify) | drafts and writes for the three new row kinds; spans; `graderVersion` |
| `src/lib/analysis/output-cap.ts` (create) | `gradeMaxOutputTokens(n)` |
| `src/lib/errors/contamination.ts` (modify) | reads unwarranted claims |
| `src/lib/klp/form-requirements.ts` (create), `src/lib/ai/prompts/write-form-reqs.ts` (create), `scripts/author-form-reqs.ts` (create) | the authoring pass |
| `src/lib/klp/build-set.ts`, `src/app/api/cron/author-klps/route.ts` (modify) | form reqs as a build step |
| `src/actions/quiz.ts`, `src/actions/diagnostic.ts` (modify) | wiring |
| `src/lib/analysis/regrade.ts` (create), `scripts/regrade.ts` (create) | the regrade tool |
| `src/lib/analysis/benchmark.ts` (create), `src/lib/ai/prompts/write-grader-panel.ts` (create), `scripts/bench-grader.ts` (create) | the benchmark |
| `scripts/probe-grade-tokens.ts`, `scripts/probe-runtime-grade.ts` (create) | live probes |
| `prisma/migrations/20260917100000_spec5_phase_a/`, `prisma/migrations/20260917110000_grader_panel/` (create) | additive schema |

---

### Task 1: One total credit table, and the legacy alias

**Files:**
- Modify: `src/lib/klp/verdicts.ts`
- Modify: `src/lib/errors/klp-credit.ts:1-11`
- Modify: `src/lib/errors/labels.ts:43-51`
- Test: `tests/errors/klp-credit.test.ts` (create), `tests/errors/labels.test.ts` (extend)

**Interfaces:**
- Produces: `KLP_STATUSES` (13 verdicts + `'passed'`), `type KlpStatus`, `STATUS_CREDIT: Record<KlpStatus, number>`, `isKlpStatus(v): v is KlpStatus`, `RUNTIME_VERDICTS` (the 11 the runtime prompt offers: every verdict except `fabrication` and `unsupported_leap`), `labelForKlpStatus` total.

- [ ] **Step 1: Write the failing tests**

`tests/errors/klp-credit.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { KLP_STATUSES, STATUS_CREDIT, isKlpStatus, klpCredit } from '@/lib/errors/klp-credit'
import { KLP_VERDICTS, VERDICT_CREDIT, RUNTIME_VERDICTS } from '@/lib/klp/verdicts'
import { CORRUPTIONS } from '@/lib/quiz/options'
import { stepBkt } from '@/lib/metrics/bkt'
import { GRADED_KLP_MODES } from '@/lib/errors/klp-credit'

describe('STATUS_CREDIT is total over KLP_STATUSES', () => {
  it('has a finite entry in [0,1] for every status', () => {
    for (const s of KLP_STATUSES) {
      expect(Number.isFinite(STATUS_CREDIT[s]), s).toBe(true)
      expect(STATUS_CREDIT[s]).toBeGreaterThanOrEqual(0)
      expect(STATUS_CREDIT[s]).toBeLessThanOrEqual(1)
    }
  })
  it('agrees with VERDICT_CREDIT on every verdict, and passed === correct', () => {
    for (const v of KLP_VERDICTS) expect(STATUS_CREDIT[v]).toBe(VERDICT_CREDIT[v])
    expect(STATUS_CREDIT.passed).toBe(STATUS_CREDIT.correct)
  })
  it('every corruption is a verdict (CORRUPTIONS ⊂ KLP_VERDICTS)', () => {
    for (const c of CORRUPTIONS) expect((KLP_VERDICTS as readonly string[]).includes(c), c).toBe(true)
  })
  it('RUNTIME_VERDICTS omits the two whole-answer labels and nothing else', () => {
    expect(RUNTIME_VERDICTS).not.toContain('fabrication')
    expect(RUNTIME_VERDICTS).not.toContain('unsupported_leap')
    expect(RUNTIME_VERDICTS.length).toBe(KLP_VERDICTS.length - 2)
  })
  it('isKlpStatus accepts the alias, rejects garbage', () => {
    expect(isKlpStatus('passed')).toBe(true)
    expect(isKlpStatus('inversion')).toBe(true)
    expect(isKlpStatus('missing_response')).toBe(false)
  })
  it('stepBkt is finite for every status × mode (the NaN guard)', () => {
    for (const s of KLP_STATUSES) for (const m of GRADED_KLP_MODES) {
      const p = stepBkt(0.5, { status: s, mode: m } as never)
      expect(Number.isFinite(p), `${s}/${m}`).toBe(true)
      expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1)
    }
  })
  it('klpCredit on a zero-credit label is 0 in every mode', () => {
    for (const m of GRADED_KLP_MODES) expect(klpCredit('inversion', m)).toBe(0)
  })
})
```
Check `stepBkt`'s real signature in `src/lib/metrics/bkt.ts` before writing the call; adapt the two arguments to its actual `(pKnown, observation)` shape. Add to `tests/errors/labels.test.ts`:
```ts
it('labelForKlpStatus is total over KLP_STATUSES', () => {
  for (const s of KLP_STATUSES) expect(labelForKlpStatus(s).length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/errors/klp-credit.test.ts tests/errors/labels.test.ts`
Expected: FAIL — `RUNTIME_VERDICTS`/`isKlpStatus` not exported; `STATUS_CREDIT['inversion']` undefined.

- [ ] **Step 3: Implement**

`src/lib/klp/verdicts.ts` — append:
```ts
/**
 * The labels the RUNTIME grader is offered. `fabrication` and
 * `unsupported_leap` describe what an answer ADDS, not how it fails a point —
 * that is `unwarranted[]`'s job (Spec 5 §3). They remain in KLP_VERDICTS for
 * the authoring grader and for rows that hold them.
 */
export const RUNTIME_VERDICTS = KLP_VERDICTS.filter(
  (v) => v !== 'fabrication' && v !== 'unsupported_leap',
) as readonly Exclude<KlpVerdict, 'fabrication' | 'unsupported_leap'>[]
```

`src/lib/errors/klp-credit.ts` lines 1–11 become:
```ts
import type { StudySource } from '@/lib/memory/scoring'
import { KLP_VERDICTS, VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'

/** Read-only alias of `correct`: every row written before Spec 5. Never written again. */
export const LEGACY_KLP_STATUSES = ['passed'] as const
export const KLP_STATUSES = [...KLP_VERDICTS, ...LEGACY_KLP_STATUSES] as const
export type KlpStatus = KlpVerdict | (typeof LEGACY_KLP_STATUSES)[number]

/**
 * ONE table. Three values (1 / 0.5 / 0). This is a GUARD, not a formula:
 * `stepBkt` indexes it with no fallback, so a status outside it is a NaN
 * posterior written to KlpState. `tests/errors/klp-credit.test.ts` asserts
 * totality; Spec 7 may replace the engine and discard this.
 */
export const STATUS_CREDIT: Record<KlpStatus, number> = { ...VERDICT_CREDIT, passed: 1 }

export function isKlpStatus(value: unknown): value is KlpStatus {
  return typeof value === 'string' && (KLP_STATUSES as readonly string[]).includes(value)
}
```
Keep everything else in the file. `src/lib/errors/labels.ts:43-51`:
```ts
const KLP_STATUS_LABELS: Record<KlpStatus, string> = {
  correct: 'Covered', passed: 'Covered',
  partial: 'Partially covered', incomplete: 'Partially covered',
  failed: 'Missed', omission: 'Missing', contradicted: 'Contradicted',
  inversion: 'Inverted', conflation: 'Confused with another point',
  misapplication: 'Misapplied', factual_error: 'Factually wrong',
  overgeneralization: 'Overgeneralised', unsupported_leap: 'Unsupported leap',
  fabrication: 'Invented',
}
```

- [ ] **Step 4: Run tests and tsc**

Run: `npx vitest run tests/errors && npx tsc --noEmit`
Expected: PASS; tsc will now report every site that narrowed on the three literals — those are Task 2's list. If tsc is not clean, note the errors and fix only the *type-only* ones here (casts in `cache.ts:106`, `read.ts:336`, `regrade.ts:146-152`, `hot-seat.ts:44`'s union → `KlpStatus`); leave logic changes to Task 2.

- [ ] **Step 5: Commit**

```bash
git add src/lib/klp/verdicts.ts src/lib/errors/klp-credit.ts src/lib/errors/labels.ts tests/errors/klp-credit.test.ts tests/errors/labels.test.ts src/lib/metrics/cache.ts src/lib/metrics/read.ts src/lib/klp/regrade.ts src/lib/games/hot-seat.ts
git commit -m "spec5: one total credit table; passed is a read-only alias of correct"
```

---

### Task 2: The reader audit — compare credit, never labels

**Files:**
- Modify: `src/lib/metrics/misconceptions.ts:85-105`, `src/lib/metrics/missed.ts:50-62`, `src/lib/analysis/rollup.ts:66-78`, `src/components/quiz/QuizSummary.tsx:125-145`, `src/components/klp/KlpGraphCanvas.tsx:60-67`, `src/lib/games/hot-seat.ts:115-131,211`, `src/actions/games.ts:270-285`
- Test: `tests/metrics/misconceptions.test.ts`, `tests/metrics/missed.test.ts`, `tests/analysis/rollup.test.ts` (extend each — find the existing files by those names or the nearest match under `tests/metrics` / `tests/analysis`), `tests/klp/graph-outcome.test.ts` (create), `tests/games/hot-seat.test.ts` (extend)

**Interfaces:**
- Consumes: `STATUS_CREDIT`, `isKlpStatus` (Task 1).

- [ ] **Step 1: Write the failing tests**

In the misconceptions test:
```ts
it('a correct row is a clean answer; an inversion breaks the streak', () => {
  const t = (status: string, ms: number) => ({ klpId: 'k', status, createdAt: new Date(ms) })
  expect(computeCleanStreaks([t('correct', 3), t('passed', 2), t('inversion', 1)] as never)).toEqual({ k: 2 })
  expect(computeCleanStreaks([t('inversion', 3), t('correct', 2)] as never)).toEqual({ k: 0 })
})
```
In the missed test:
```ts
it('every zero- and half-credit label is a miss; correct and passed are not', () => {
  const rows = ['omission', 'inversion', 'partial', 'incomplete', 'correct', 'passed'].map((status, i) => ({
    klpId: `k${i}`, status, /* ...whatever shape shapeMissedWork's fixture uses */
  }))
  const out = shapeMissedWork({ results: rows as never, /* other required fields from the existing fixture */ })
  const missed = new Set(out.flatMap((t) => t.klps.map((k) => k.klpId)))
  expect(missed).toEqual(new Set(['k0', 'k1', 'k2', 'k3']))
})
```
In the rollup test: an attempt with `klpResults` statuses `['omission', 'contradicted', 'partial', 'correct']` yields `failCount === 2` for those KLPs (not 0). In `tests/klp/graph-outcome.test.ts`:
```ts
import { outcomeOf } from '@/components/klp/KlpGraphCanvas'
it('historical passed rows render as right, not untested', () => {
  expect(outcomeOf('passed')).toBe('right')
  expect(outcomeOf('correct')).toBe('right')
  expect(outcomeOf('incomplete')).toBe('partial')
  expect(outcomeOf('inversion')).toBe('wrong')
  expect(outcomeOf('nonsense')).toBe('untested')
})
```
In the hot-seat test: `probeTarget` picks an `inversion` row over a `partial` one; the HP function treats `correct` as gained and `omission` as lost.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/metrics tests/analysis tests/klp/graph-outcome.test.ts tests/games/hot-seat.test.ts`
Expected: FAIL on each new assertion.

- [ ] **Step 3: Implement**

`misconceptions.ts:100`: `if (STATUS_CREDIT[o.status as KlpStatus] < 1) break` (import both from `@/lib/errors/klp-credit`). `missed.ts:57-62`: delete `MISS_STATUSES`; the loop becomes `if ((STATUS_CREDIT[r.status as KlpStatus] ?? 0) >= 1) continue`. `rollup.ts:73`: `if ((STATUS_CREDIT[r.status as KlpStatus] ?? 0) > 0) continue`. `QuizSummary.tsx:130-140`: compute `const credit = STATUS_CREDIT[r.status as KlpStatus] ?? 0` and pick the icon by `credit >= 1` / `credit > 0` / else. `KlpGraphCanvas.tsx:62`: `if (!isKlpStatus(status)) return 'untested'` and `const credit = STATUS_CREDIT[status]`. `hot-seat.ts:44`: `status: KlpStatus`; the HP loop and `probeTarget` use `STATUS_CREDIT[v.status]` (`>= 1` gained, `=== 0` lost, else split; `probeTarget` = heaviest zero-credit, else heaviest half-credit). `games.ts:273-283`: `accuracyOf` earns `v.weight * STATUS_CREDIT[v.status]`; `isHit` heavy rows require `STATUS_CREDIT[v.status] >= 1`, the empty case requires every row `> 0`.

- [ ] **Step 4: Run tests and tsc**

Run: `npx vitest run tests/metrics tests/analysis tests/klp tests/games && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add -A src/lib/metrics src/lib/analysis/rollup.ts src/components/quiz/QuizSummary.tsx src/components/klp/KlpGraphCanvas.tsx src/lib/games/hot-seat.ts src/actions/games.ts tests
git commit -m "spec5: readers compare credit, never labels — streaks, misses, rollup, graph, games"
```

---

### Task 3: The shared verdict block, the prompt port, and the profile removed

**Files:**
- Create: `src/lib/ai/prompts/verdict-block.ts`
- Modify: `src/lib/ai/prompts/grade-candidate.ts` (use the block), `src/lib/ai/prompts/grade-short-answer.ts` (whole `ANALYSIS_BODY`, `build`, `buildParts`; drop `profileBlock` and `learnerContextBlock`), `src/lib/ai/prompts/diagnostic.ts:113-118`, `src/lib/ai/schemas.ts:42-46,207-211`, `src/lib/ai/prompts/registry.ts` (versions)
- Test: `tests/ai/grade-short-answer-prompt.test.ts`, `tests/ai/diagnostic-prompt.test.ts`, `tests/ai/authoring-prompts.test.ts` (extend), `tests/ai/grader-no-profile.test.ts` (create)

**Interfaces:**
- Produces: `verdictInstructionBlock({ strict, showKinds, vocabulary }): string`; `GRADE_SHORT_ANSWER_PROMPT.build({ card, answer, klps?, relations?, formReqs?, referenceAnswer? })` (no `profileBlock`); `ShortAnswerGradeSchema.klpResults[].status: z.enum(RUNTIME_VERDICTS)`, `.quote?: string` (replaces `evidence` in the *schema* — keep `evidence` accepted as an alias for one version by `.or()`), `relationResults?: { relationRef, status, quote? }[]`, `formResults?: { formRef, status: 'met' | 'not_met', quote? }[]`, `unwarranted?: { text, quote, magnitude }[]`.
- Prompt types: `PromptRelation { ref: number; type: string; fromRef: number; toRef: number }`, `PromptFormReq { ref: number; text: string }`.

- [ ] **Step 1: Write the failing tests**

`tests/ai/grade-short-answer-prompt.test.ts` — add:
```ts
import { RUNTIME_VERDICTS } from '@/lib/klp/verdicts'
import { verdictInstructionBlock } from '@/lib/ai/prompts/verdict-block'

const klps = [{ ref: 0, text: 'D&A is added back because it is non-cash', kind: 'mechanism' }]
const card = { term: 'Walk me through D&A', definition: '...' } as never

it('offers every runtime verdict verbatim and never "passed"', () => {
  const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
  for (const v of RUNTIME_VERDICTS) expect(p).toContain(`"${v}"`)
  expect(p).not.toMatch(/"passed"/)
})
it('is written against the shared block (mutation check)', () => {
  const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
  expect(p).toContain(verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS }))
})
it('carries the strict and kind clauses', () => {
  const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps })
  expect(p).toContain('GRADE STRICTLY')
  expect(p).toContain('Strictness by kind')
})
it('lists relations and form requirements when given', () => {
  const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'x', klps: [...klps, { ref: 1, text: 'FCF rises', kind: 'causal' }],
    relations: [{ ref: 0, type: 'causes', fromRef: 0, toRef: 1 }], formReqs: [{ ref: 0, text: 'States direction and magnitude' }] })
  expect(p).toContain('[R0] (causes) [0] → [1]')
  expect(p).toContain('[F0] States direction and magnitude')
  expect(p).toContain('"relationResults"'); expect(p).toContain('"formResults"'); expect(p).toContain('"unwarranted"')
})
it('shows the reference answer after the key points and before the answer', () => {
  const p = GRADE_SHORT_ANSWER_PROMPT.build({ card, answer: 'THE ANSWER', klps, referenceAnswer: 'THE REFERENCE' })
  expect(p.indexOf('THE REFERENCE')).toBeGreaterThan(p.indexOf(klps[0].text))
  expect(p.indexOf('THE REFERENCE')).toBeLessThan(p.indexOf('THE ANSWER'))
})
```
`tests/ai/grader-no-profile.test.ts`:
```ts
import { readFileSync } from 'fs'
import { join } from 'path'
it('the grading prompt module never imports learner context', () => {
  const src = readFileSync(join(__dirname, '../../src/lib/ai/prompts/grade-short-answer.ts'), 'utf-8')
  expect(src).not.toMatch(/learnerContextBlock|profileBlock/)
})
it('submitShortAnswer never fetches a profile block', () => {
  const src = readFileSync(join(__dirname, '../../src/actions/quiz.ts'), 'utf-8')
  const fn = src.slice(src.indexOf('export async function submitShortAnswer'))
  const end = fn.indexOf('\nexport async function', 1)
  expect(fn.slice(0, end === -1 ? undefined : end)).not.toMatch(/safeProfileBlock\(/)
})
```
(The second assertion goes red until Task 8 wires the action; that is intended — leave it failing and note it in the task report, or write it in Task 8 instead. Prefer Task 8.) The diagnostic prompt test gains the same "every runtime verdict verbatim / never passed" pair.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/ai/grade-short-answer-prompt.test.ts tests/ai/diagnostic-prompt.test.ts`
Expected: FAIL — `verdict-block` missing, prompt still says `"passed"`.

- [ ] **Step 3: Implement the block**

`src/lib/ai/prompts/verdict-block.ts`:
```ts
import { KLP_VERDICTS, type KlpVerdict } from '@/lib/klp/verdicts'
import { STRICT_GRADING_CLAUSE, KIND_STRICTNESS_CLAUSE } from './grade-candidate'

export interface VerdictBlockInput {
  strict: boolean
  showKinds: boolean
  /** The labels to offer. Authoring passes KLP_VERDICTS; the runtime passes RUNTIME_VERDICTS. */
  vocabulary?: readonly KlpVerdict[]
}

/**
 * ONE measured wording for "how to judge a key point", shared by the authoring
 * grader (grade-candidate), the runtime grader (grade-short-answer) and the
 * diagnostic grader. The vocabulary is listed VERBATIM and quoted, because a
 * model told "use a specific label" without the list invents one
 * (`missing_response`, 2026-09-06) and TypeScript then has nothing to keep.
 */
export function verdictInstructionBlock(input: VerdictBlockInput): string {
  const vocab = input.vocabulary ?? KLP_VERDICTS
  const list = vocab.map((v) => `"${v}"`).join(', ')
  return `Choose exactly one verdict per key point from this vocabulary: ${list}.

Use "correct" when the answer states the point or entails it unmistakably. Use "omission" when the point is never mentioned at all — a hole. Use "contradicted" when the answer asserts the opposite or a false version of it — a wrong model; these two are different failures and must not be confused. Use "inversion" when a direction or cause-and-effect is reversed; "conflation" when the right idea appears under the wrong name or two points are merged; "misapplication" when the point is applied outside its conditions; "incomplete" when it is named but not explained. "partial" and "failed" are honest fallbacks when nothing more specific fits — do not force a specific label.

For every verdict other than "correct", include "quote": a VERBATIM excerpt of the answer (at most 20 words, copied exactly, no paraphrase) that decided the verdict; for "omission" quote the closest thing the answer says, or omit the field if nothing is relevant. Omit "quote" on "correct".${input.strict ? `\n\n${STRICT_GRADING_CLAUSE}${input.showKinds ? `\n\n${KIND_STRICTNESS_CLAUSE}` : ''}` : ''}`
}
```
Move `STRICT_GRADING_CLAUSE`, `RELAXED_KINDS`, `KIND_STRICTNESS_CLAUSE` **out of** `grade-candidate.ts` into `verdict-block.ts` and re-export them from `grade-candidate.ts` so existing importers and `tests/ai/authoring-prompts.test.ts` keep working (avoid the import cycle). In `grade-candidate.ts`'s `build`, replace the paragraph from "Choose exactly one verdict" through the strict/kind clauses with `${verdictInstructionBlock({ strict: !!input.strict, showKinds })}` and keep its own output-format line (`"verdicts": [{ klpIndex, verdict, evidence }]`) — authoring keeps its `evidence` field name; run `tests/ai/authoring-prompts.test.ts` to confirm the wording it pins still holds, and update those assertions only where the text moved verbatim.

- [ ] **Step 4: Port the runtime prompt**

`grade-short-answer.ts`: delete the `learnerContextBlock` import and both `profileBlock` fields. Add to both input interfaces:
```ts
klps?: PromptKlp[]
relations?: PromptRelation[]
formReqs?: PromptFormReq[]
/** CardAuthoring.referenceAnswer when the card has one. */
referenceAnswer?: string
```
with `export interface PromptRelation { ref: number; type: string; fromRef: number; toRef: number }` and `export interface PromptFormReq { ref: number; text: string }`. Replace `ANALYSIS_BODY` with:
```ts
const ANALYSIS_BODY = (input: { klps: PromptKlp[]; relations?: PromptRelation[]; formReqs?: PromptFormReq[]; referenceAnswer?: string }) => {
  const rel = input.relations?.length
    ? `\nRelations between key points (a link the card teaches):\n${input.relations.map((r) => `[R${r.ref}] (${r.type}) [${r.fromRef}] → [${r.toRef}]`).join('\n')}\n`
    : ''
  const form = input.formReqs?.length
    ? `\nForm requirements (the SHAPE the answer must have):\n${input.formReqs.map((f) => `[F${f.ref}] ${f.text}`).join('\n')}\n`
    : ''
  const reference = input.referenceAnswer
    ? `\nA strong reference answer, for context on what a complete response looks like (do not compare the learner's WORDING against it — judge only whether the learner's OWN claims satisfy each point):\n${input.referenceAnswer}\n`
    : ''
  return `
Key Learning Points this card teaches:
${input.klps.map((k) => `[${k.ref}] (${k.kind}) ${k.text}`).join('\n')}
${rel}${form}${reference}
${verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS })}

Return:

"klpResults": one entry per key point above — { "klpRef": number, "status": verdict, "quote"?: string }.
${input.relations?.length ? `"relationResults": one entry per relation above — { "relationRef": number, "status": verdict, "quote"?: string }. "correct" = the answer asserts the link itself; "omission" = both ends present, link never made; "inversion" = link asserted backwards; "contradicted" = the answer denies it.\n` : ''}${input.formReqs?.length ? `"formResults": one entry per form requirement — { "formRef": number, "status": "met" | "not_met", "quote"?: string }.\n` : ''}
"unwarranted": every claim the answer makes that the key points above do NOT make and that is false, misleading or invented — { "text": one sentence naming the claim, "quote": verbatim excerpt, "magnitude": 1-10 how serious this instance is }. An answer that covers every key point can still be wrong; this list is exactly what the points above cannot see. A clean answer returns [].

"errorTags": at most ${MAX_TAGS_PER_ANSWER} tags, at most 2 per dimension. Tag only what is genuinely wrong; a clean answer returns an empty list.
  dimension "accuracy"     — types: ${ACCURACY_TYPES.join(', ')}
  dimension "clarity"      — types: ${CLARITY_TYPES.join(', ')}
  dimension "conciseness"  — types: ${CONCISENESS_TYPES.join(', ')}
  Each tag: "type" from that dimension's list and NO other word; "klpRef" when about one point (omit for the whole answer); "secondaryKlpRef" for "conflation" only; "magnitude" 1-10 within the type; "quote".
Rank by what matters most. Do not pad to the cap.`
}
```
Both `build` and `buildParts` call `ANALYSIS_BODY(input)` when `klps` is non-empty and drop the `learnerContextBlock` prefix. Bump `version: 4` → `5` and add a v5 doc-comment paragraph: *vocabulary widened to RUNTIME_VERDICTS via the shared block; strict + kind-aware; profile removed (the grader never sees the learner); relations, form requirements, unwarranted claims, verbatim quotes.* `diagnostic.ts:113-118`: replace the three-label paragraph with `${verdictInstructionBlock({ strict: true, showKinds: true, vocabulary: RUNTIME_VERDICTS })}` and `"klpResults": exactly one entry, with klpRef 0 — { "klpRef": 0, "status": verdict, "quote"?: string }`; bump its version. Update `registry.ts` if it pins versions.

- [ ] **Step 5: Schemas**

`schemas.ts:42-46` (and the diagnostic twin at 207-211):
```ts
klpResults: z.array(z.object({
  klpRef: z.number().int().min(0),
  status: z.enum(RUNTIME_VERDICTS as unknown as [string, ...string[]]),
  quote: z.string().optional(),
  evidence: z.string().optional(),   // accepted for one version; the block asks for `quote`
})).optional(),
relationResults: z.array(z.object({
  relationRef: z.number().int().min(0),
  status: z.enum(RUNTIME_VERDICTS as unknown as [string, ...string[]]),
  quote: z.string().optional(),
})).optional(),
formResults: z.array(z.object({
  formRef: z.number().int().min(0),
  status: z.enum(['met', 'not_met']),
  quote: z.string().optional(),
})).optional(),
unwarranted: z.array(z.object({
  text: z.string().min(1),
  quote: z.string().optional(),
  magnitude: z.number().int().min(1).max(10),
})).optional(),
```
Import `RUNTIME_VERDICTS` from `@/lib/klp/verdicts`; remove the `KLP_STATUSES` import if now unused.

- [ ] **Step 6: Run tests, tsc, full suite**

Run: `npx vitest run tests/ai && npx tsc --noEmit && npm test`
Expected: the prompt tests PASS; `tests/ai/prompts.test.ts`'s v1 byte-identity test for the no-KLP path still passes (the rubric block is untouched); the whole suite green except any test that hand-wrote `status: 'passed'` into a *draft* — fix those fixtures to `correct`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/prompts src/lib/ai/schemas.ts tests/ai
git commit -m "spec5: one shared verdict block; runtime grader offers the vocabulary, strict and kind-aware, and never sees the learner"
```

---

### Task 4: Spans, the grader version, and the Phase A migration

**Files:**
- Create: `src/lib/analysis/spans.ts`, `src/lib/analysis/version.ts`, `prisma/migrations/20260917100000_spec5_phase_a/migration.sql`
- Modify: `prisma/schema.prisma` (`AnswerKlpResult`, `QuizAnswer`, new models)
- Test: `tests/analysis/spans.test.ts` (create), `tests/schema/answer-analysis-cascade.test.ts` (extend)

**Interfaces:**
- Produces: `resolveSpan(answer: string, quote: string): { start: number; end: number } | null`; `unionCoverage(spans: Span[], length: number): number` (used by Phase B, cheap to ship now); `GRADER_VERSION = 1`.
- Schema: `AnswerKlpResult.spanStart Int?`, `spanEnd Int?`; `AnswerRelationResult { id, quizAnswerId, relationId, status, credit, provenance ('passive' | 'active'), evidence?, spanStart?, spanEnd?, createdAt }` with `@@unique([quizAnswerId, relationId])` and cascade; `AnswerFormResult { id, quizAnswerId, formRequirementId, status ('met' | 'not_met'), evidence?, spanStart?, spanEnd?, createdAt }` `@@unique([quizAnswerId, formRequirementId])`, cascade; `AnswerUnwarrantedClaim { id, quizAnswerId, text, magnitude, evidence?, spanStart?, spanEnd?, createdAt }`, cascade; `CardFormRequirement { id, cardId, klpVersion, index, text, promptVersion, model?, createdAt }` `@@index([cardId, klpVersion])`, cascade from Card; `QuizAnswer.graderVersion Int?`. `KlpRelation` gains `answerResults AnswerRelationResult[]`.

- [ ] **Step 1: Write the failing tests**

`tests/analysis/spans.test.ts`:
```ts
import { resolveSpan, unionCoverage } from '@/lib/analysis/spans'
const a = 'D&A is added back because it is non-cash, so FCF rises.'
it('exact match', () => expect(resolveSpan(a, 'added back because it is non-cash')).toEqual({ start: 7, end: 40 }))
it('normalised match ignores case, quotes and whitespace runs', () =>
  expect(resolveSpan(a, 'Added  back because it is NON-CASH')).toEqual({ start: 7, end: 40 }))
it('first occurrence wins', () => expect(resolveSpan('a b a b', 'a b')).toEqual({ start: 0, end: 3 }))
it('paraphrase is null', () => expect(resolveSpan(a, 'depreciation is non cash')).toBeNull())
it('empty quote is null', () => expect(resolveSpan(a, '')).toBeNull())
it('union coverage merges overlaps', () =>
  expect(unionCoverage([{ start: 0, end: 10 }, { start: 5, end: 15 }, { start: 20, end: 22 }], 100)).toBeCloseTo(0.17))
```
Cascade test — add three `it`s asserting `AnswerRelationResult.quizAnswer`, `AnswerFormResult.quizAnswer`, `AnswerUnwarrantedClaim.quizAnswer` contain `onDelete: Cascade`, and `CardFormRequirement.card` likewise.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/analysis/spans.test.ts tests/schema/answer-analysis-cascade.test.ts`
Expected: FAIL (module and models missing).

- [ ] **Step 3: Implement spans and version**

`src/lib/analysis/spans.ts`:
```ts
export interface Span { start: number; end: number }

/**
 * Quote → [start, end] over the stored answer. The MODEL quotes; TypeScript
 * locates. Models count characters badly, so an offset from the model would
 * poison every metric built on coverage; an exact-or-normalised text match
 * cannot be off by one.
 *
 * Exact first. Then a normalised pass (case-folded, straight quotes, runs of
 * whitespace collapsed) mapped back to original offsets. Then null — which
 * means the model paraphrased instead of quoting, and the caller records
 * `quote_unresolved`; that rate is a grader-quality number the benchmark reports.
 */
export function resolveSpan(answer: string, quote: string): Span | null {
  if (!quote.trim()) return null
  const exact = answer.indexOf(quote)
  if (exact >= 0) return { start: exact, end: exact + quote.length }
  const { text, map } = normalise(answer)
  const q = normalise(quote).text
  if (!q) return null
  const at = text.indexOf(q)
  if (at < 0) return null
  return { start: map[at], end: map[at + q.length - 1] + 1 }
}

/** Lower-cased, quotes straightened, whitespace runs → one space; `map[i]` is the original index of normalised char i. */
function normalise(s: string): { text: string; map: number[] } {
  const out: string[] = []; const map: number[] = []
  let pendingSpace = false
  for (let i = 0; i < s.length; i++) {
    let c = s[i].toLowerCase()
    if (c === '‘' || c === '’') c = "'"
    if (c === '“' || c === '”') c = '"'
    if (/\s/.test(c)) { pendingSpace = out.length > 0; continue }
    if (pendingSpace) { out.push(' '); map.push(i - 1); pendingSpace = false }
    out.push(c); map.push(i)
  }
  return { text: out.join(''), map }
}

/** Fraction of `length` covered by the union of spans. */
export function unionCoverage(spans: Span[], length: number): number {
  if (length <= 0) return 0
  const sorted = [...spans].filter((s) => s.end > s.start).sort((a, b) => a.start - b.start)
  let covered = 0; let curStart = -1; let curEnd = -1
  for (const s of sorted) {
    if (s.start > curEnd) { if (curEnd > curStart) covered += curEnd - curStart; curStart = s.start; curEnd = s.end }
    else curEnd = Math.max(curEnd, s.end)
  }
  if (curEnd > curStart) covered += curEnd - curStart
  return Math.min(1, covered / length)
}
```
`src/lib/analysis/version.ts`:
```ts
/**
 * Which INSTRUMENT produced a QuizAnswer's analysis rows. Bumped on any change
 * to the content prompt, the expression prompt, the span resolver, or the
 * metrics code — a lexicon edit changes numbers without touching a prompt.
 * `ANALYSIS_VERSION` (persist.ts) describes the CONTRACT (what rows exist);
 * this describes the grader. Both persist on QuizAnswer.
 */
export const GRADER_VERSION = 1
```

- [ ] **Step 4: Schema and migration**

Edit `prisma/schema.prisma`: on `AnswerKlpResult` add `spanStart Int?` and `spanEnd Int?` after `evidence`; on `QuizAnswer` add `graderVersion Int?` beside `analysisVersion`, plus `relationResults AnswerRelationResult[]`, `formResults AnswerFormResult[]`, `unwarranted AnswerUnwarrantedClaim[]`; on `KlpRelation` add `answerResults AnswerRelationResult[]`; on `Card` add `formRequirements CardFormRequirement[]`. Add the four models exactly as in **Interfaces** (String ids `@default(cuid())`, `createdAt DateTime @default(now())`, relations with `onDelete: Cascade`, the uniques and index named above, and a doc comment on each saying which spec section it implements). Then:
```
npx prisma migrate dev --name spec5_phase_a --create-only
```
Rename the folder to `20260917100000_spec5_phase_a` if the tool timestamps it differently, read the SQL and confirm it is purely `ALTER TABLE … ADD COLUMN` / `CREATE TABLE` / indexes. Apply: `npx prisma migrate deploy` then `npx prisma generate`.

- [ ] **Step 5: Run tests and tsc**

Run: `npx vitest run tests/analysis/spans.test.ts tests/schema && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysis/spans.ts src/lib/analysis/version.ts prisma/schema.prisma prisma/migrations/20260917100000_spec5_phase_a tests/analysis/spans.test.ts tests/schema/answer-analysis-cascade.test.ts
git commit -m "spec5: span resolver, GRADER_VERSION, and the additive Phase A schema"
```

---

### Task 5: Drafts and writes — spans, relations, form results, unwarranted claims

**Files:**
- Modify: `src/lib/analysis/persist.ts` (drafts, `AnalysisWrites`, `buildAnalysisWrites`), `src/lib/analysis/write-answer.ts:40-120` (writes), `src/lib/errors/contamination.ts:139-156`
- Test: `tests/analysis/persist.test.ts` (extend — find the existing `buildAnalysisWrites` tests), `tests/errors/contamination.test.ts` (extend), `tests/actions/analysis-short-answer.test.ts` (extend the write assertions)

**Interfaces:**
- Consumes: `resolveSpan` (Task 4), `STATUS_CREDIT`/`klpCredit` (Task 1).
- Produces: `buildAnalysisWrites(input)` accepts `answerText: string`, `relations: { id: string }[]`, `formReqs: { id: string }[]`, `relationResults: RelationResultDraft[]`, `formResults: FormResultDraft[]`, `unwarranted: UnwarrantedDraft[]`; `AnalysisWrites` gains `relationResults[]`, `formResults[]`, `unwarranted[]`, and `klpResults[]` rows carry `spanStart/spanEnd`. Warnings: `quote_unresolved` (value = `klp:<ref>` / `rel:<ref>` / `form:<ref>` / `unwarranted:<i>`), `unresolved_relation_ref`, `unresolved_form_ref`. `contaminationFactor` takes `{ tags, unwarranted: { magnitude }[] }`.
- `ANALYSIS_VERSION` 3 → 4.

- [ ] **Step 1: Write the failing tests**

In the persist tests:
```ts
const base = { mode: 'quiz-sa' as const, klps: [{ id: 'k1', weight: 3 }, { id: 'k2', weight: 4 }], starred: false,
  relations: [{ id: 'r1' }], formReqs: [{ id: 'f1' }], answerText: 'FCF rises because D&A is non-cash.', errorTags: [] }

it('resolves quotes to spans and warns on a paraphrase', () => {
  const w = buildAnalysisWrites({ ...base,
    klpResults: [{ klpRef: 0, status: 'correct' }, { klpRef: 1, status: 'inversion', quote: 'FCF rises' }],
    relationResults: [], formResults: [], unwarranted: [] })
  expect(w.klpResults[1]).toMatchObject({ klpId: 'k2', status: 'inversion', credit: 0, spanStart: 0, spanEnd: 9 })
  const w2 = buildAnalysisWrites({ ...base, klpResults: [{ klpRef: 1, status: 'omission', quote: 'cash flow goes up' }],
    relationResults: [], formResults: [], unwarranted: [] })
  expect(w2.klpResults[0].spanStart).toBeNull()
  expect(w2.warnings).toContainEqual({ reason: 'quote_unresolved', value: 'klp:1' })
})
it('writes relation results with passive provenance and form results', () => {
  const w = buildAnalysisWrites({ ...base, klpResults: [],
    relationResults: [{ relationRef: 0, status: 'omission', quote: 'D&A is non-cash' }],
    formResults: [{ formRef: 0, status: 'not_met' }], unwarranted: [] })
  expect(w.relationResults[0]).toMatchObject({ relationId: 'r1', status: 'omission', credit: 0, provenance: 'passive', spanStart: 20 })
  expect(w.formResults[0]).toMatchObject({ formRequirementId: 'f1', status: 'not_met' })
})
it('an unresolved relation ref is a warning, never a row', () => {
  const w = buildAnalysisWrites({ ...base, klpResults: [], relationResults: [{ relationRef: 7, status: 'correct' }], formResults: [], unwarranted: [] })
  expect(w.relationResults).toHaveLength(0)
  expect(w.warnings).toContainEqual({ reason: 'unresolved_relation_ref', value: '7' })
})
it('unwarranted claims dock KLP credit through the contamination band', () => {
  const clean = buildAnalysisWrites({ ...base, klpResults: [{ klpRef: 0, status: 'correct' }], relationResults: [], formResults: [], unwarranted: [] })
  const dirty = buildAnalysisWrites({ ...base, klpResults: [{ klpRef: 0, status: 'correct' }], relationResults: [], formResults: [],
    unwarranted: [{ text: 'claims D&A is a cash outflow', quote: 'D&A is non-cash', magnitude: 10 }] })
  expect(dirty.unwarranted[0]).toMatchObject({ text: 'claims D&A is a cash outflow', magnitude: 10, spanStart: 20 })
  expect(dirty.klpResults[0].credit).toBeLessThan(clean.klpResults[0].credit)
})
it('never writes passed', () => {
  const w = buildAnalysisWrites({ ...base, klpResults: [{ klpRef: 0, status: 'correct' }], relationResults: [], formResults: [], unwarranted: [] })
  expect(w.klpResults.every((r) => r.status !== 'passed')).toBe(true)
})
```
In the contamination test: `contaminationFactor({ tags: [], unwarranted: [{ magnitude: 10 }] })` equals the old `contaminationFactor([{ dimension: 'accuracy', type: 'fabrication', klpId: null, severity: 5 }])`; `{ tags: [], unwarranted: [] }` is 1. In `tests/actions/analysis-short-answer.test.ts`: the mocked `tx` receives `answerRelationResult.createMany`, `answerFormResult.createMany`, `answerUnwarrantedClaim.createMany` when writes carry rows, and `quizAnswer.create` data includes `graderVersion: GRADER_VERSION`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/analysis tests/errors/contamination.test.ts tests/actions/analysis-short-answer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`contamination.ts` — keep the old function body as `contaminationFactorFromTags(tags)` and add:
```ts
export interface ContaminationSources { tags: ContaminationInput[]; unwarranted: { magnitude: number }[] }
/** Unwarranted claims (Spec 5 §3) carry a 1-10 magnitude; map it to the same 1-5 severity band tags use and take the worst source. */
export function contaminationFactor(src: ContaminationSources): number {
  const fromTags = contaminationFactorFromTags(src.tags)
  if (src.unwarranted.length === 0) return fromTags
  const worst = Math.max(...src.unwarranted.map((u) => Math.ceil(Math.min(Math.max(u.magnitude, 1), 10) / 2)))
  const scaled = Math.min(worst, MAX_SEVERITY) / MAX_SEVERITY
  return Math.min(fromTags, 1 - CONTAMINATION_MAX_DOCK * scaled)
}
```
Update `isContaminated` and every caller (`grep -rn contaminationFactor src`) to the object form. `persist.ts`: add drafts
```ts
export interface RelationResultDraft { relationRef: number; status: KlpVerdict; quote?: string }
export interface FormResultDraft { formRef: number; status: 'met' | 'not_met'; quote?: string }
export interface UnwarrantedDraft { text: string; quote?: string; magnitude: number }
```
`KlpResultDraft` gains `quote?: string` (and accepts `evidence` — `const quote = r.quote ?? r.evidence`). `AnalysisWrites` gains the three arrays with the persisted shapes from Task 4's Interfaces (`relationResults[].credit = klpCredit(status, mode, factor)`, `provenance: 'passive'`). `buildAnalysisWrites` computes `factor = contaminationFactor({ tags: errorTags-as-before, unwarranted: input.unwarranted })`, resolves each quote with `resolveSpan(input.answerText, quote)` and pushes `quote_unresolved` when a quote was given and no span found; `evidence` on every row is the quote text. `ANALYSIS_VERSION = 4` with the doc comment from the spec §6. `write-answer.ts`: after the tag `createMany`, add the three `createMany`s (skipping empties) and set `graderVersion: GRADER_VERSION` in `quizAnswer.create`. The `analysisStatus` derivation is unchanged.

- [ ] **Step 4: Run tests and tsc**

Run: `npx vitest run tests/analysis tests/errors tests/actions && npx tsc --noEmit`
Expected: PASS. Every caller of `buildAnalysisWrites` (quiz MC/TF drafts, diagnostic, regrade-run, probes) now needs the new required fields — pass `answerText`, empty arrays and `relations: []`, `formReqs: []` at each call site for now; Task 8 wires the real values for SA and the diagnostic.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis src/lib/errors/contamination.ts src/actions src/lib/klp/regrade-run.ts scripts tests
git commit -m "spec5: analysis writes carry spans, passive relation verdicts, form results and unwarranted claims; ANALYSIS_VERSION 4"
```

---

### Task 6: Form requirements — the authoring pass

**Files:**
- Create: `src/lib/ai/prompts/write-form-reqs.ts`, `src/lib/klp/form-requirements.ts`, `scripts/author-form-reqs.ts`
- Modify: `src/lib/ai/schemas.ts` (`FormRequirementsSchema`), `src/lib/ai/model-routing.ts` (`AI_TASKS` gains `'form-reqs'`), `src/lib/ai/task-defaults.ts` (grader-family default for it), `package.json` (`"author-form-reqs"` script), `src/lib/klp/build-set.ts` (a `'form-reqs'` step after `'author'`), `src/app/api/cron/author-klps/route.ts` (drained like topics)
- Test: `tests/ai/write-form-reqs-prompt.test.ts` (create), `tests/klp/form-requirements.test.ts` (create)

**Interfaces:**
- Produces: `WRITE_FORM_REQS_PROMPT.build({ question, definition, referenceAnswer, klps: { text, kind }[] })`, version 1; `FormRequirementsSchema = z.object({ requirements: z.array(z.object({ text: z.string().min(8).max(160) })).min(3).max(5) })`; `authorFormRequirements(cardId, gen: (prompt, schema) => Promise<{ value, model }>): Promise<{ written: number; weak: boolean }>` in `form-requirements.ts` — loads the card + live KLPs + latest `CardAuthoring`, skips if rows exist at the current `klpVersion`, writes `CardFormRequirement` rows (`promptVersion`, `model`), then runs the **weak check**: grades the stored `memorized_template` `AuthoringProbe.text` (if any) once through `GRADE_SHORT_ANSWER_PROMPT` with only `formReqs` and reports `weak = every formResult is 'met'` (logged; nothing persisted beyond a console line — a `weak` flag column is Phase B's call if the rate warrants it). `planFormReqs(cards)` pure helper: which cards need authoring.

- [ ] **Step 1: Write the failing tests**

`tests/ai/write-form-reqs-prompt.test.ts`:
```ts
it('asks for 3-5 shape rules, names the four archetypes, forbids content restatement', () => {
  const p = WRITE_FORM_REQS_PROMPT.build({ question: 'Q', definition: 'D', referenceAnswer: 'R', klps: [{ text: 'K', kind: 'causal' }] })
  for (const s of ['answers the question asked', 'direction and magnitude', 'causal order', 'closes the loop']) expect(p.toLowerCase()).toContain(s)
  expect(p).toMatch(/3.{0,5}5/)
  expect(p).toMatch(/not restate|never restate|do not restate/i)
})
```
`tests/klp/form-requirements.test.ts` — `planFormReqs` returns cards with no rows at the current `klpVersion` and skips the rest; `authorFormRequirements` with a fake `gen` writes rows with `index 0..n-1`, `promptVersion`, `model`, and returns `weak: true` when the fake grader meets every rule (use a mocked prisma in the style of the existing `tests/klp/*.test.ts` files).

- [ ] **Step 2: Run to verify they fail** — `npx vitest run tests/ai/write-form-reqs-prompt.test.ts tests/klp/form-requirements.test.ts` → FAIL.

- [ ] **Step 3: Implement the prompt**

```ts
export const WRITE_FORM_REQS_PROMPT = {
  id: 'write-form-reqs', version: 1, schema: FormRequirementsSchema,
  build(input: { question: string; definition: string; referenceAnswer: string; klps: { text: string; kind: string }[] }): string {
    return `You are writing FORM REQUIREMENTS for one interview question: 3-5 rules about the SHAPE a complete answer must have, as distinct from its content. The key points below already say what must be PRESENT; do not restate them. A form requirement is something a fluent answer to a slightly different question would FAIL.

The four archetypes (use the ones that apply, phrased for THIS question):
- answers the question asked (not the neighbouring one)
- states direction and magnitude where the question has them
- presents steps in causal order (setup → mechanism → result)
- closes the loop: lands the conclusion the question asked for

Each requirement is one sentence, at most 160 characters, checkable by a grader reading the answer alone.

Question: ${input.question}
Definition on the card: ${input.definition}
Reference answer: ${input.referenceAnswer}
Key points (do NOT restate these):
${input.klps.map((k, i) => `[${i}] (${k.kind}) ${k.text}`).join('\n')}

Output JSON: { "requirements": [ { "text": string } ] }`
  },
}
```
`form-requirements.ts` follows the shape of `src/lib/klp/reuse.ts`/`regrade-run.ts` for loading and writing; the script `scripts/author-form-reqs.ts` mirrors `scripts/reuse-klps.ts` (`--set <id>` required, `--direct` for env keys via `src/lib/klp/direct-pool.ts`, resumable, prints a per-card line and the token table from `src/lib/klp/token-meter.ts`). `build-set.ts`: after the `'author'` branch returns ready, a `'form-reqs'` step authors up to the budget for cards missing them, returning `did: 'form-reqs'`; the cron loop's break condition treats it like `'mint'`. Add `'form-reqs'` to `AI_TASKS` and a grader-family default in `task-defaults.ts` (DeepSeek first, then Z.ai — these are judgments about the question, not writing).

- [ ] **Step 4: Run tests and tsc** — `npx vitest run tests/ai tests/klp && npx tsc --noEmit` → PASS. `tests/ai/model-routing.test.ts` may pin the task list; extend it.

- [ ] **Step 5: Commit**

```bash
git add src/lib/ai/prompts/write-form-reqs.ts src/lib/klp/form-requirements.ts scripts/author-form-reqs.ts src/lib/ai/schemas.ts src/lib/ai/model-routing.ts src/lib/ai/task-defaults.ts package.json src/lib/klp/build-set.ts src/app/api/cron/author-klps/route.ts tests
git commit -m "spec5: form requirements authored in a separate pass, never a re-author"
```

---

### Task 7: The fluid output ceiling, and D6's fail-loud path

**Files:**
- Create: `src/lib/analysis/output-cap.ts`, `scripts/probe-grade-tokens.ts`
- Modify: `src/lib/ai/generate.ts` (unknown-enum detection on `NoObjectGeneratedError`: record the offending value in the `AiCallLog` row's error text and rethrow as `schema_invalid` with `detail.value`), `src/lib/errors/classify.ts` (`finishReason === 'length'` → new kind `output_truncated`)
- Test: `tests/analysis/output-cap.test.ts` (create), `tests/errors/classify.test.ts` (extend), `tests/ai/generate.test.ts` (extend)

**Interfaces:**
- Produces: `gradeMaxOutputTokens(itemCount: number): number` = `GRADE_TOKENS_BASE + itemCount * GRADE_TOKENS_PER_ITEM`, with the two constants exported and **initially** `2048` / `600` (to be replaced by the probe's numbers before Task 8 ships — the probe prints the suggested pair); `FailureKind` gains `'output_truncated'`.

- [ ] **Step 1: Write the failing tests**

```ts
it('scales with item count and never drops below the base', () => {
  expect(gradeMaxOutputTokens(0)).toBe(GRADE_TOKENS_BASE)
  expect(gradeMaxOutputTokens(9) - gradeMaxOutputTokens(4)).toBe(5 * GRADE_TOKENS_PER_ITEM)
})
```
classify: an SDK `NoObjectGeneratedError` whose `finishReason` is `'length'` classifies `output_truncated` (system-attributed), not `schema_invalid`. generate: when the thrown error is a Zod enum failure, the recorded `AiCallLog.error` contains the received value (assert with the existing mocked-prisma harness in `tests/ai/generate.test.ts`).

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`output-cap.ts` per Interfaces with a doc comment: *the ceiling is fluid — one base for reasoning, one slope per graded item; `scripts/probe-grade-tokens.ts` sets both at ≈2× the observed p95.* `classify.ts`: read `error.finishReason` (present on `NoObjectGeneratedError`) before the message heuristics. `generate.ts`: in the catch that classifies `schema_invalid`, if `error.cause` is a `ZodError` with an `invalid_enum_value` issue, append `unknown value: <received>` to the logged error text and to `detail`. `scripts/probe-grade-tokens.ts` (raw env keys, read-only DB): load 20 stored `QuizAnswer` rows with `mode = 'short-answer'` and text, across cards with 4–9 live KLPs; build v5 prompts with relations/form reqs where present; call `generateText` + `Output.object` with a generous cap (16384) on each configured model (`--models deepseek-flash,gemini-3.1-flash-lite`); print per call `items`, `outputTokens`, `finishReason`; fit slope and intercept by least squares; print `p95` and the recommended `GRADE_TOKENS_BASE` / `GRADE_TOKENS_PER_ITEM` (≈2× p95 at the mean item count, split by the fitted slope). Record the run in `docs/ai/model-performance.md` under "Spec 5 — the grading ceiling".

- [ ] **Step 4: Run tests and tsc** → PASS.

- [ ] **Step 5: Run the probe (owner's shell if keys are absent) and set the constants** — `npx tsx --conditions=react-server --env-file=.env scripts/probe-grade-tokens.ts --models deepseek-flash`. Put the printed pair into `output-cap.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/analysis/output-cap.ts scripts/probe-grade-tokens.ts src/lib/ai/generate.ts src/lib/errors/classify.ts docs/ai/model-performance.md tests
git commit -m "spec5: fluid grading output ceiling from measurement; unknown labels fail loud and are logged"
```

---

### Task 8: Wire the quiz and the diagnostic

**Files:**
- Modify: `src/actions/quiz.ts:854-1130` (both SA branches), `src/actions/diagnostic.ts:470-490`, `src/actions/klp.ts:240-275` (`ensureKlpsReady` → also return relations; add `loadGradingContext(userId, cardId)`)
- Test: `tests/actions/analysis-short-answer.test.ts`, `tests/diagnostic/*grading*.test.ts` (extend), `tests/ai/grader-no-profile.test.ts` (the action assertion from Task 3)

**Interfaces:**
- Produces: `loadGradingContext(userId, cardId): Promise<{ klps, relations: { id, type, fromKlpId, toKlpId }[], formReqs: { id, text }[], referenceAnswer: string | null }>` (relations restricted to `provenance` of the live KLP version, both endpoints live; form reqs at the live `klpVersion`; `referenceAnswer` from the latest `CardAuthoring` for that version).

- [ ] **Step 1: Write the failing tests**

In `tests/actions/analysis-short-answer.test.ts` (mocked prisma + mocked `generateJsonWithMeta`): the prompt passed to the generator contains `[R0]` and `[F0]` when the context has one relation and one form req; `maxOutputTokens` equals `gradeMaxOutputTokens(klps + relations + formReqs)`; the writes passed to `createAnswerWithAnalysis` carry `relationResults`/`formResults`/`unwarranted` from the grade; `safeProfileBlock` is not called. The diagnostic test: its grading call's prompt contains every `RUNTIME_VERDICT` and the writes carry spans.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement**

`klp.ts`: `loadGradingContext` — one `findMany` on `cardKlp` (live), one on `klpRelation` where both endpoints are in that id set, one on `cardFormRequirement` at `klpVersion`, one on `cardAuthoring` (latest by `createdAt` for that `klpVersion`, select `referenceAnswer`). `quiz.ts`, in both branches: delete the `safeProfileBlock` line and the `profileBlock` args (the annotation prompt keeps its own — it is not grading; pass `undefined` or drop the field there too per its signature); build `promptRelations = relations.map((r, ref) => ({ ref, type: r.type, fromRef: idx(r.fromKlpId), toRef: idx(r.toKlpId) }))` and `promptFormReqs`; pass `referenceAnswer ?? undefined`; `maxOutputTokens: gradeMaxOutputTokens(promptKlps.length + promptRelations.length + promptFormReqs.length)`; on the caught grading error, if `classifyError(err).kind === 'schema_invalid'` retry the same call **once** before recording the failed analysis (D6); `buildAnalysisWrites({ ..., answerText: input.answer, relations, formReqs, relationResults: grade.relationResults ?? [], formResults: grade.formResults ?? [], unwarranted: grade.unwarranted ?? [] })`. `diagnostic.ts:476-486`: same shape per question (its KLP list is one point; relations/form reqs are passed as empty for the diagnostic — it asks one point). Keep `score`/`isCorrect` exactly as they are (Phase B).

- [ ] **Step 4: Run tests, tsc, full suite** — `npx vitest run tests/actions tests/diagnostic tests/ai && npx tsc --noEmit && npm test` → all green.

- [ ] **Step 5: Commit**

```bash
git add src/actions/quiz.ts src/actions/diagnostic.ts src/actions/klp.ts tests
git commit -m "spec5: the quiz and diagnostic grade through the content pass — relations, form reqs, reference, fluid ceiling, no profile"
```

---

### Task 9: The regrade tool

**Files:**
- Create: `src/lib/analysis/regrade.ts`, `scripts/regrade.ts`
- Modify: `prisma/schema.prisma` (`AnswerKlpResult.supersededAt DateTime?`, same on the three new tables; `QuizAnswer.regradedAt DateTime?`) + `prisma/migrations/20260917103000_regrade_generations/`, `package.json` (`"regrade"`), every reader of `AnswerKlpResult` that must see only live rows (`grep -rn "answerKlpResult.findMany\|klpResults:" src/lib src/actions` — add `supersededAt: null` to each `where`/nested select, and a test that greps for it)
- Test: `tests/analysis/regrade.test.ts` (create), `tests/analysis/live-rows-only.test.ts` (create — source scan)

**Interfaces:**
- Produces: `planRegrade(answers, opts: { graderVersion }): { toGrade: string[]; skipped: { id, reason }[] }` (pure: skips rows already at the current `graderVersion`, rows with no text, rows whose card has no live KLPs); `regradeAnswer(answerId, gen)` — re-runs the content pass with `loadGradingContext`, marks the answer's existing analysis rows `supersededAt = now`, writes the new generation via the same `buildAnalysisWrites` + a `writeAnalysisGeneration(tx, answerId, writes)` helper extracted from `createAnswerWithAnalysis`, sets `graderVersion`/`analysisVersion`/`regradedAt`, and replays `KlpState` for the touched KLPs through the existing `persistKlpStates`/rebuild path so the posterior reflects the live generation only.

- [ ] **Step 1: Write the failing tests** — `planRegrade` skip rules (three cases + one to grade); a source-scan test asserting every `answerKlpResult` read under `src/lib/metrics`, `src/lib/analysis`, `src/lib/staff` filters `supersededAt: null`.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — extract `writeAnalysisGeneration` from `write-answer.ts:95-110` (the four `createMany`s) and call it from both places. Script: `--set <id>` or `--attempt <id>`, `--dry-run` prints the plan, `--direct` uses env keys via the direct pool, resumable (rows at the current `graderVersion` are skipped), token table at the end. Migration is additive (`supersededAt`, `regradedAt`).

- [ ] **Step 4: Run tests and tsc** → PASS; `npx prisma migrate deploy && npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/analysis prisma scripts/regrade.ts package.json tests
git commit -m "spec5: regrade tool writes a new generation and supersedes the old; readers see live rows only"
```

---

### Task 10: The grader benchmark — models, panel prompt, scoring

**Files:**
- Create: `src/lib/ai/prompts/write-grader-panel.ts`, `src/lib/analysis/benchmark.ts`, `prisma/migrations/20260917110000_grader_panel/`
- Modify: `prisma/schema.prisma` (`GraderPanel`, `GraderPanelAnswer`, `GraderPanelResult`), `src/lib/ai/schemas.ts` (`GraderPanelSchema`), `src/lib/ai/model-routing.ts` (`AI_TASKS` gains `'grader-panel'`, writer-family default)
- Test: `tests/analysis/benchmark.test.ts` (create), `tests/ai/write-grader-panel-prompt.test.ts` (create)

**Interfaces:**
- Schema: `GraderPanel { id, cardId, klpVersion, kind ('levels' | 'modes'), promptVersion, model, createdAt, answers GraderPanelAnswer[] }` `@@unique([cardId, klpVersion, kind])`; `GraderPanelAnswer { id, panelId, level ('expert'|'competent'|'weak'|'wrong') | null, mode ('gap'|'misconception'|'connectivity'|'template') | null, intendedRank Int, text, rationale, results GraderPanelResult[] }`; `GraderPanelResult { id, answerId, graderVersion, model, promptVersion, verdicts Json, relationVerdicts Json, formVerdicts Json, unresolvedQuotes Int, createdAt }`.
- Pure: `coverageScore(verdicts: { status, weight }[]): number` (credit-weighted); `rankAgreement(answers: { intendedRank, score }[]): { agreed: number; total: number; inversions: [a, b][] }`; `adjacentGaps(answers): number[]`; `shapeAgreement(answer: { mode, verdicts, relationVerdicts, formVerdicts }): { expected: string; observed: string; agreed: boolean }` where observed is: `omission` dominant → `gap`; any `contradicted`/`inversion` on a KLP → `misconception`; KLPs ≥ 1 credit but any relation `omission` → `connectivity`; any form `not_met` with KLP coverage ≥ 0.8 → `template`; else `none`.
- Prompt: `WRITE_GRADER_PANEL_PROMPT.build({ question, definition, referenceAnswer, klps, relations, formReqs, kind })` returning `{ answers: [{ level|mode, intendedRank, text, rationale }] }`; it must **never** be shown to the grader.

- [ ] **Step 1: Write the failing tests** — `rankAgreement` on a perfect order is 6/6 with no inversions and on one swapped pair is 5/6 naming the pair; `adjacentGaps` on scores `[1, .8, .5, .1]` is `[.2, .3, .4]`; `shapeAgreement` on each of four hand-built answers picks the right observed shape; the prompt test asserts the four levels (or four modes), "intendedRank", "rationale", and the instruction that the expert answer must not copy the reference verbatim.

- [ ] **Step 2: Run to verify they fail** → FAIL.

- [ ] **Step 3: Implement** — schema + migration (additive), the prompt (writer family; ask for each answer to be self-contained, 60–200 words, the `wrong` answer confidently wrong on at least one causal point, the `weak` answer missing at least two points but contradicting none), `benchmark.ts` per Interfaces with doc comments stating the isolation rule and that no number here is an AI opinion.

- [ ] **Step 4: Run tests and tsc** → PASS; migrate + generate.

- [ ] **Step 5: Commit**

```bash
git add prisma src/lib/ai/prompts/write-grader-panel.ts src/lib/analysis/benchmark.ts src/lib/ai/schemas.ts src/lib/ai/model-routing.ts src/lib/ai/task-defaults.ts tests
git commit -m "spec5: grader benchmark — panel models, adversary prompt, rank and shape scoring in TS"
```

---

### Task 11: `npm run bench-grader`, and the first baseline

**Files:**
- Create: `scripts/bench-grader.ts`
- Modify: `package.json` (`"bench-grader"`), `scripts/author-klps.ts` (print the set's latest benchmark summary beside the histogram when panels exist), `docs/ai/model-performance.md`
- Test: `tests/analysis/benchmark-report.test.ts` (create — `formatBenchmarkReport(rows)` pure text formatter)

- [ ] **Step 1: Write the failing test** — the report for two cards prints rank agreement as `n/6`, lists an inversion with both rationales' first lines, and prints the unresolved-quote rate.

- [ ] **Step 2: Run to verify it fails** → FAIL.

- [ ] **Step 3: Implement the script** — `--set <id>` required; `--author` writes panels for cards lacking one at the current `klpVersion` (`kind` from `--kind levels|modes`, default `levels`); then grades every panel answer **one call each** through `GRADE_SHORT_ANSWER_PROMPT` v5 with the card's real `loadGradingContext`, via the direct pool (`--direct`) or the stored pool; resolves spans with `resolveSpan`; writes `GraderPanelResult`; prints `formatBenchmarkReport`; the token table at the end. Idempotent per `(answerId, graderVersion, model)`.

- [ ] **Step 4: Run it on the LBO set** — `npx tsx --conditions=react-server --env-file=.env scripts/bench-grader.ts --set cmtj7pxfc000005l4rv4krxxy --author --direct` (needs the DeepSeek/Z.ai env keys; ~50 calls). Record the numbers under "Spec 5 — grader benchmark baseline" in `docs/ai/model-performance.md`: rank agreement per card, mean adjacent gap, unresolved-quote rate, model, `graderVersion`. **This is the baseline the prompt is held to from now on.**

- [ ] **Step 5: Run tests, tsc, full suite** → green.

- [ ] **Step 6: Commit**

```bash
git add scripts/bench-grader.ts package.json scripts/author-klps.ts docs/ai/model-performance.md tests
git commit -m "spec5: bench-grader — the LBO baseline for rank agreement and quote resolution"
```

---

### Task 12: Live probe, docs, and the queue

**Files:**
- Create: `scripts/probe-runtime-grade.ts`
- Modify: `docs/ai/model-performance.md`, `docs/superpowers/BUILD-QUEUE.md` (a Phase A "BUILT" entry under Spec 5 with what is owed), `CLAUDE.md` (the "AI grading is a core domain concept" paragraph: the grader is stateless per response, emits categorical verdicts with spans and no score; the rubric retires in Phase B)

- [ ] **Step 1: Write the probe** — the shape of `scripts/probe-diagnostic-ai.ts`: one authored LBO card, three fixed answers (the reference, a blank, a hand-inverted copy of the reference with one causal point reversed); grade each through v5 with the real context; assert and print: one verdict per KLP/relation/form req, every label in `RUNTIME_VERDICTS`, reference all `correct`, blank all `omission`, the inverted answer's reversed point `inversion` or `contradicted`, every quote resolved, output tokens vs the ceiling; then the same three through `GRADE_CANDIDATE_PROMPT` strict and print per-point agreement.

- [ ] **Step 2: Run it** — `npx tsx --conditions=react-server --env-file=.env scripts/probe-runtime-grade.ts --model deepseek-flash` and once with a Google key. Record both under "Spec 5 — the content pass, live" in `docs/ai/model-performance.md`.

- [ ] **Step 3: One real quiz** — a short-answer quiz on the LBO set in the running app (owner, or the agent if an `AiCredential` can be decrypted), then read the rows with a one-off `npx tsx --env-file=.env -e` query: `analysisVersion 4`, `graderVersion 1`, statuses in vocabulary, `spanStart` set on non-correct rows, `KlpState.pKnown` finite. Record the result in the queue entry.

- [ ] **Step 4: Docs** — the three edits above. The queue entry lists what Phase B owes and states plainly whether Step 3 ran.

- [ ] **Step 5: Full suite, tsc, lint** — `npm test && npx tsc --noEmit && npm run lint` → green, lint at or below the ceiling.

- [ ] **Step 6: Commit**

```bash
git add scripts/probe-runtime-grade.ts docs CLAUDE.md
git commit -m "spec5 phase A: live probe, model record, queue entry"
```

---

## Self-review

**Spec coverage (Phase A §1–§8):** §1 vocabulary/credit → Task 1; §2 contract by mode → Tasks 3, 5, 8 (MC/TF `binaryModeDrafts` write `corruption`/`correct` — covered by Task 5's "never writes passed" and the existing MC draft tests; verify `src/actions/quiz.ts:90-151` writes `status: 'correct'` for a correct pick during Task 8 and add the assertion there); §3 spans + unwarranted → Tasks 4, 5; §4 prompt port, relations, ceiling, D6 → Tasks 3, 7, 8; §5 form requirements → Task 6 (+ grading in 3/5/8); §6 persistence, `graderVersion`, regrade → Tasks 4, 5, 9; §7 reader audit → Tasks 1, 2; §8 benchmark → Tasks 10, 11; §13 testing → each task, live probes in 7, 11, 12.

**Gaps closed inline:** the `AnnotationPrompt` still takes `profileBlock` — it is not grading, left alone; the MC `correct`-pick assertion is added to Task 8. The `weak` flag for form requirements is logged, not persisted (spec §5 says "flagged"; a console line plus the script summary satisfies "reported, never retried" — if the owner wants it on the card, it is one nullable column in Phase B).

**Type consistency:** `KlpStatus` (Task 1) is the row type everywhere; `RUNTIME_VERDICTS` (Task 1) is the prompt/schema type (Tasks 3, 5); `PromptRelation`/`PromptFormReq` (Task 3) feed `buildAnalysisWrites`'s `relations`/`formReqs` id lists (Task 5) via `loadGradingContext` (Task 8); `gradeMaxOutputTokens` (Task 7) is called in Task 8 and Task 11; `resolveSpan` (Task 4) is used in Tasks 5 and 11; `writeAnalysisGeneration` (Task 9) is the shared writer for Tasks 5 and 9.
