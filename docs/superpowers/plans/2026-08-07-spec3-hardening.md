# Stage 8 Spec 3 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the defects found by an adversarial bug hunt over merged Spec 3, so that Spec 3B's tunable scoring is built on numbers that are actually correct.

**Architecture:** No new subsystems. Each task closes one defect with a regression test that fails against current `main`. The knowledge posterior is the through-line: it is maintained incrementally, so every error in it is permanent and invisible until repaired by a working backfill.

**Tech Stack:** TypeScript, Prisma 7 (Postgres/Neon), Next.js 16, Vitest, Zod.

**Provenance:** Two parallel adversarial reviews on 2026-08-07 over the write path and the read/derive path, plus direct execution of the backfill script by the coordinator. Baseline: `main` @ PR #11, 776 tests / 70 files passing, `tsc` clean.

## Global Constraints

- Test runner is Vitest. Full suite: `npx vitest run` (~7s). Single file: `npx vitest run <path>`.
- Tests import via `@/` and live under `tests/<area>/`. Pure modules must not import `@/lib/db`.
- **Every task must produce a test that FAILS against the pre-fix code.** These are regression fixes; a test that passes before the fix proves nothing. Verify the failure, then fix.
- Never accept a database reset. Never pass `--force-reset` or `--accept-data-loss`. Return BLOCKED if a migration is anything but cleanly additive.
- The knowledge posterior (`KlpState`) is maintained incrementally and is **not self-correcting**. A wrong value stays wrong forever until the backfill replays it. Treat any change touching it as high-risk.
- Two mode vocabularies exist: `StudySource` (`quiz-sa`) and `QuizMode` (`short-answer`), bridged by `src/lib/quiz/mode.ts`. Comparing one against a column storing the other silently matches zero rows.
- `null` means "not enough data"; `0` is a real measurement. Never collapse them, and never use a falsy check where the distinction matters.
- Run `npx tsc --noEmit` as well as the suite. Vitest does not type-check.
- Commit after every task. Do not skip hooks.

---

## The defects, as found

| # | Severity | Defect |
| --- | --- | --- |
| B1 | Critical | `scripts/backfill-klp-state.ts` cannot execute at all — verified by running it |
| B2 | Critical | Re-submitting an answer double-counts it in the posterior |
| B3 | Critical | `resetUserMemory` leaves every posterior standing |
| B4 | Critical | The card-grain profile ignores 3 of 4 scope dimensions |
| B5 | Important | `repeatBonus` fires on a negative attempt distance, ignoring the window |
| B6 | Important | Readiness numerator has no `analysisStatus` filter; its denominator does |
| B7 | Important | Readiness numerator drops superseded KLPs; its denominator keeps their answers |
| B8 | Important | Pace-outlier baseline is drawn from the scoped events, so a card scope can never produce an outlier |
| B9 | Important | Lost update: the posterior write is read-modify-write with no lock |
| B10 | Important | A duplicated `klpRef` from the grader rolls back the whole answer |

---

### Task 1: Make the backfill runnable and bounded (B1)

The repair tool for every other defect. Nothing else can be verified end-to-end until this runs.

**Files:**
- Modify: `scripts/backfill-klp-state.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `rebuildStatesFromResults` from `@/lib/metrics/cache`
- Produces: an `npm run backfill:klp-state` script that executes

- [ ] **Step 1: Reproduce the failure**

Run: `npx tsx scripts/backfill-klp-state.ts --dry-run`
Expected: FAILS. The script imports `../src/lib/metrics/cache` (relative, no extension); that module imports `@/lib/metrics/bkt` (path alias). `tsx` is **not** in `package.json`, so `npx` does not run the tool the docstring names, and neither Node's ESM resolver nor `ts-node` resolves those imports without configuration.

- [ ] **Step 2: Fix the runner**

Add `tsx` to `devDependencies` (it resolves TypeScript path aliases and extensionless imports natively, which is what this script and any future one needs), and add a script:

```json
    "backfill:klp-state": "tsx scripts/backfill-klp-state.ts"
```

Update the docstring's usage line to `npm run backfill:klp-state -- --dry-run`.

If `tsx` proves unworkable, the fallback is `ts-node -r tsconfig-paths/register` with `module`/`moduleResolution` overrides — but note the repo's `tsconfig.json` uses `moduleResolution: "bundler"`, which conflicts with CommonJS and made that path fail during diagnosis. Prefer `tsx`.

- [ ] **Step 3: Bound the read**

The script currently fetches every `AnswerKlpResult` row with no `take`, no `orderBy`, and materialises a second full copy grouped by user. Add an `orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]` and process users in batches.

The `orderBy` is not cosmetic: the columns are `TIMESTAMP(3)`, `traceKlp` uses a stable sort, and without a deterministic order two same-millisecond observations with different statuses produce **different posteriors on different runs**. `id` breaks the tie.

- [ ] **Step 4: State the live-traffic caveat honestly**

The docstring claims "safe to re-run — idempotent by construction". That is true of re-runs but **not** of running against live traffic: the script takes one snapshot then writes absolute values, so an answer committed in between is overwritten and its observation lost. Amend the docstring to say so and to direct the operator to run it during a quiet period.

- [ ] **Step 5: Verify**

Run: `npm run backfill:klp-state -- --dry-run`
Expected: completes, printing per-user per-KLP rows. **Do not run it for real yet** — the write path is still wrong; Task 9 runs it once the rest is fixed.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-klp-state.ts package.json package-lock.json
git commit -m "fix(spec3): make the KlpState backfill executable and deterministic"
```

---

### Task 2: Roll back the posterior when an answer is re-submitted (B2)

**Files:**
- Modify: `src/actions/quiz.ts` (the three `deleteMany` sites, ~`:464`, `:638`, `:911`)
- Modify: `src/lib/metrics/state-writer.ts`
- Test: `tests/metrics/state-writer.test.ts`

**Interfaces:**
- Consumes: `rebuildStatesFromResults` from `@/lib/metrics/cache`
- Produces: `rebuildKlpStates(tx, userId, klpIds)` in `state-writer.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/metrics/state-writer.test.ts — append
import { rebuildStatesFromResults } from '@/lib/metrics/cache'

describe('re-submission must not double-count (B2)', () => {
  const NOW = new Date('2026-08-07T12:00:00.000Z')

  it('a failed-then-resubmitted-passed answer yields the same state as one passed answer', () => {
    // After a re-submit, the failed AnswerKlpResult row is DELETED by the
    // cascade. The surviving history is one passed observation, so the
    // posterior must equal a replay of exactly that.
    const survivingHistory = [
      { userId: 'u1', klpId: 'k1', status: 'passed' as const, mode: 'quiz-sa' as const, createdAt: NOW },
    ]
    const truth = rebuildStatesFromResults(survivingHistory)

    expect(truth[0].observations).toBe(1)
    expect(truth[0].pKnown).toBeCloseTo(0.5909090909, 8)
  })
})
```

- [ ] **Step 2: Run it and confirm the real bug**

Run: `npx vitest run tests/metrics/state-writer.test.ts`
Expected: this test PASSES — it documents the truth. The defect is that the production path does not reach it. Confirm the defect by reading `src/actions/quiz.ts` around each `deleteMany`: the prior answer and its `AnswerKlpResult` rows are deleted **outside** the transaction, and nothing decrements `KlpState`. The next submit steps a posterior that already absorbed the deleted attempt, giving `pKnown 0.4157, observations 2` instead of `0.5909, observations 1`.

- [ ] **Step 3: Add a rebuild helper**

```ts
// src/lib/metrics/state-writer.ts
/**
 * Recompute state for specific KLPs from surviving history.
 *
 * Needed because the posterior is incremental and therefore NOT self-
 * correcting: deleting an AnswerKlpResult (as a re-submit does) removes the
 * evidence but leaves its contribution baked in forever. Stepping backward is
 * not possible — the BKT update is not invertible — so the only correct
 * response to a deletion is a replay of what remains.
 */
export async function rebuildKlpStates(
  tx: { answerKlpResult: any; klpState: any },
  userId: string,
  klpIds: string[],
): Promise<void> {
  if (klpIds.length === 0) return

  const rows = await tx.answerKlpResult.findMany({
    where: { klpId: { in: klpIds }, quizAnswer: { userId } },
    select: { klpId: true, status: true, mode: true, createdAt: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const states = rebuildStatesFromResults(
    rows.map((r: any) => ({ userId, klpId: r.klpId, status: r.status, mode: r.mode, createdAt: r.createdAt })),
  )
  const rebuilt = new Map(states.map((s) => [s.klpId, s]))

  for (const klpId of klpIds) {
    const s = rebuilt.get(klpId)
    if (!s) {
      // No surviving evidence: the row must go, or a stale posterior claims
      // knowledge for observations that no longer exist.
      await tx.klpState.deleteMany({ where: { userId, klpId } })
      continue
    }
    await tx.klpState.upsert({
      where: { userId_klpId: { userId, klpId } },
      create: { userId, klpId, pKnown: s.pKnown, observations: s.observations, lastObservedAt: s.lastObservedAt },
      update: { pKnown: s.pKnown, observations: s.observations, lastObservedAt: s.lastObservedAt },
    })
  }
}
```

- [ ] **Step 4: Move the delete inside the transaction and rebuild**

At each of the three `deleteMany` sites in `src/actions/quiz.ts`: collect the KLP ids of the answer being deleted **before** deleting, move the delete inside the same `$transaction` as the new answer, and call `rebuildKlpStates(tx, userId, affectedKlpIds)` after the new answer's own state write.

Deleting outside the transaction is itself a defect: a failure between the delete and the insert loses the answer entirely.

- [ ] **Step 5: Verify**

Run: `npx vitest run tests/metrics && npx vitest run tests/actions && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/actions/quiz.ts src/lib/metrics/state-writer.ts tests/metrics/state-writer.test.ts
git commit -m "fix(spec3): rebuild the posterior when a re-submit deletes evidence"
```

---

### Task 3: Clear the posterior on memory reset (B3)

**Files:**
- Modify: `src/actions/user.ts` (~`:96-102`)
- Test: `tests/actions/user-reset.test.ts` (create if absent)

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Confirm the defect**

Read `resetUserMemory`. It deletes `QuizAttempt`/`QuizAnswer` (cascading `AnswerKlpResult`) plus progress and events, but never `KlpState`. After "reset my memory" the learner's knowledge estimates are unchanged — and unfixable, because a KLP with zero remaining rows produces no state and so is never upserted back to the prior by the backfill either.

- [ ] **Step 2: Write the failing test**

Assert against the action's delete set rather than a live database: extract the list of models the reset clears into an exported constant and assert `KlpState` is in it.

```ts
// tests/actions/user-reset.test.ts
import { describe, it, expect } from 'vitest'
import { RESET_MEMORY_MODELS } from '@/actions/user'

describe('resetUserMemory (B3)', () => {
  it('clears the knowledge posterior, not only the evidence behind it', () => {
    // KlpState is incremental and not self-correcting: leaving it behind means
    // "reset my memory" silently preserves every knowledge estimate, and no
    // backfill can repair it once the underlying rows are gone.
    expect(RESET_MEMORY_MODELS).toContain('klpState')
  })

  it('still clears the evidence tables it always cleared', () => {
    expect(RESET_MEMORY_MODELS).toEqual(
      expect.arrayContaining(['quizAttempt', 'cardProgress', 'studyEvent']),
    )
  })
})
```

- [ ] **Step 3: Run it and confirm failure**

Run: `npx vitest run tests/actions/user-reset.test.ts`
Expected: FAIL — `RESET_MEMORY_MODELS` does not exist yet, then fails again on the missing `klpState` once it does.

- [ ] **Step 4: Fix**

Export the model list, add `klpState` to it, and delete it inside the same transaction as the rest. Place the `klpState` delete alongside the others so a future model added to the reset is added in one place.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run tests/actions && npx tsc --noEmit
git add src/actions/user.ts tests/actions/user-reset.test.ts
git commit -m "fix(spec3): clear KlpState on memory reset"
```

---

### Task 4: Scope the card-grain profile (B4)

**Files:**
- Modify: `src/lib/memory/profile.ts` (`buildLearnerProfile`)
- Modify: `src/lib/metrics/read.ts` (~`:67`)
- Test: `tests/memory/scope.test.ts`

**Interfaces:**
- Consumes: `buildStudyEventWhere`, `buildCardScopeWhere` from `@/lib/memory/scope`
- Produces: `buildLearnerProfile({ userId, scope, categoryIds })`

- [ ] **Step 1: Confirm the defect**

`read.ts` calls `buildLearnerProfile({ userId, setIds: scope.setIds })`. That function accepts **only** `setIds`, so `categoryKeys`, `cardId`, and `source` are dropped — while `profile.topics`, returned in the same object, honours all four. A request scoped to one card returns that card's topics beside weak/strong/starred terms and a streak computed over the learner's entire library. This is the same failure mode the file's own comment claims to have closed.

- [ ] **Step 2: Write the failing test**

```ts
// tests/memory/scope.test.ts — append
describe('the card-grain profile honours every scope dimension (B4)', () => {
  it('narrows by category, not only by set', () => {
    const where = buildCardScopeWhere(
      { setIds: [], categoryKeys: ['valuation'] },
      ['cat1'],
    )
    expect(JSON.stringify(where)).toContain('cat1')
  })

  it('narrows by card, which subsumes set and category', () => {
    const where = buildCardScopeWhere({ setIds: ['s1'], categoryKeys: [], cardId: 'c1' }, [])
    expect(JSON.stringify(where)).toContain('c1')
  })
})
```

Adjust the assertions to the real shape `buildCardScopeWhere` returns — read it first rather than assuming.

- [ ] **Step 3: Widen the signature**

Change `buildLearnerProfile` to take the full `HistoryScope` plus resolved `categoryIds`, and build its `cardProgress` and `studyEvent` filters from the shared `buildCardScopeWhere` / `buildStudyEventWhere` rather than an inline `setId` filter. Update all three callers — `read.ts`, `src/actions/training-plan.ts`, and `src/lib/ai/context.ts`.

Note there are **three** callers, not two: an earlier task's brief undercounted them and the miss was only caught by a type error.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/memory/profile.ts src/lib/metrics/read.ts src/actions/training-plan.ts src/lib/ai/context.ts tests/memory/scope.test.ts
git commit -m "fix(spec3): scope the card-grain profile on every dimension"
```

---

### Task 5: Fix the repeat-bonus window (B5)

**Files:**
- Modify: `src/lib/errors/derive.ts` (~`:128`)
- Test: `tests/errors/derive.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: nothing

- [ ] **Step 1: Write the failing test**

```ts
// tests/errors/derive.test.ts — append
describe('the repeat window rejects negative distances (B5)', () => {
  it('does not fire when the earlier-seen tag belongs to a LATER attempt', () => {
    // Reachable whenever attempts interleave (open a quiz, start a second,
    // finish the first), and unavoidably when a tag names an attempt absent
    // from attemptOrder — those are appended at the end, so every later
    // real-attempt tag scores a negative distance against them.
    const tags = [
      tag({ attemptId: 'a6', createdAt: minsAgo(30) }),
      tag({ attemptId: 'a1', createdAt: minsAgo(10) }),
    ]
    const derived = deriveTagScores(tags, undefined, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'])
    const onA1 = derived.find((d) => d.attemptId === 'a1')!
    expect(onA1.repeatBonus).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and confirm failure**

Run: `npx vitest run tests/errors/derive.test.ts`
Expected: FAIL — the tag on `a1` receives `repeatBonus: 1` from an occurrence five attempts away, because `here - s.attemptIdx <= WINDOW` passes for every negative difference.

- [ ] **Step 3: Fix**

```ts
    const repeated = seen.some(
      (s) => s.key === key && here > s.attemptIdx && here - s.attemptIdx <= REPEAT_WINDOW_ATTEMPTS,
    )
```

The `here !== s.attemptIdx` guard is subsumed by `here > s.attemptIdx` — keep only the latter, and update the comment to say the window looks strictly backward.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/errors && npx tsc --noEmit
git add src/lib/errors/derive.ts tests/errors/derive.test.ts
git commit -m "fix(spec3): repeat bonus must look strictly backward"
```

---

### Task 6: Align readiness on analysis status and KLP version (B6, B7)

Both halves of the same ratio disagreeing about their population. Fixed together because a test for either must control both.

**Files:**
- Modify: `src/lib/metrics/read.ts` (the `answerErrorTag` query, ~`:75`)
- Modify: `src/lib/memory/topic-profile.ts` (~`:98`)
- Test: `tests/memory/topic-profile.test.ts`

- [ ] **Step 1: Confirm both defects**

**B6:** the denominator counts only `analysisStatus: 'analyzed'`, but the numerator's tag query has no such filter — and `buildAnalysisWrites` still writes whole-answer clarity/conciseness tags under `no_klps` and `no_provenance`. A topic whose cards have no key points yet contributes expression weight with no matching answer in the denominator, so readiness reads far worse than reality and can pin to 0.

**B7:** the numerator filters KLP-targeted tags through the topic's **live** KLP set, but historical tags reference the KLP version that was live at answer time. Editing a card supersedes its KLPs, so every past tag on it silently leaves the numerator while its answers stay in the denominator — readiness jumps toward 1.0 with no change in behaviour.

- [ ] **Step 2: Write the failing tests**

```ts
// tests/memory/topic-profile.test.ts — append
describe('readiness populations must agree (B6, B7)', () => {
  it('ignores tags from answers whose analysis did not run', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k1'] })],
      knowledge: { k1: { pKnown: 0.9, observations: 5 } },
      tags: [
        tag({ klpId: null, type: 'rambling', dimension: 'conciseness', analysisStatus: 'no_klps' }),
      ],
      analyzedAnswersByTopic: { dcf: 2 },
    })
    // The no_klps answer is absent from the denominator, so its weight must be
    // absent from the numerator too.
    expect(result[0].readiness).toBe(1)
  })

  it('keeps tags whose target KLP has since been superseded', () => {
    const result = shapeTopicProfile({
      topics: [row({ normalizedName: 'dcf', klpIds: ['k-new'] })],
      knowledge: {},
      tags: [tag({ klpId: 'k-old', type: 'too_terse', dimension: 'conciseness' })],
      analyzedAnswersByTopic: { dcf: 4 },
      // k-old was superseded by k-new on the same card.
      supersededKlpTopics: { 'k-old': 'dcf' },
    })
    expect(result[0].readiness).toBeLessThan(1)
  })
})
```

Extend the local `tag` helper with `analysisStatus`, and `ShapeTopicProfileInput` with `supersededKlpTopics: Record<string, string>` mapping a retired KLP id to the topic key it belonged to.

- [ ] **Step 3: Run and confirm failure**

Run: `npx vitest run tests/memory/topic-profile.test.ts`
Expected: FAIL on both — the first because the `no_klps` tag lowers readiness below 1, the second because the superseded tag is filtered out and readiness stays 1.

- [ ] **Step 4: Fix**

For B6, add `quizAnswer: { analysisStatus: 'analyzed' }` to the `answerErrorTag` query's `where` in `read.ts`, so numerator and denominator share the population. For B7, resolve superseded KLPs to their topic — select KLPs without the `supersededAt: null` filter for the purpose of tag attribution only, keeping the live-only filter for knowledge — and pass the mapping through so `shapeTopicProfile` can attribute a historical tag to its topic.

Knowledge must stay live-only: a superseded KLP belongs to an older version of the card and its evidence should not count toward current knowledge. Only *tag attribution* changes.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/metrics/read.ts src/lib/memory/topic-profile.ts tests/memory/topic-profile.test.ts
git commit -m "fix(spec3): align the readiness numerator and denominator"
```

---

### Task 7: Fix the pace-outlier baseline under scope (B8)

**Files:**
- Modify: `src/lib/metrics/read.ts` (~`:160`)
- Test: `tests/metrics/pace.test.ts`

- [ ] **Step 1: Confirm the defect**

`paceOutliers` receives only the scope-filtered events, and `paceIndex` draws its baseline median from that same array. Under a card scope the filtered set **is** that card's own events, so the card median equals the baseline and the index is exactly 1.0 — below the outlier threshold, always. A card-scoped view reports "no fluency problem" for a card that is a 2.4× outlier globally.

- [ ] **Step 2: Write the failing test**

```ts
// tests/metrics/pace.test.ts — append
describe('the baseline must not be narrowed with the scope (B8)', () => {
  it('still reports an outlier when only that card\'s events are supplied as the scoped set', () => {
    const baseline = Array.from({ length: 12 }, (_, i) => ev(`other${i}`, 1000))
    const cardOnly = [ev('c1', 2400), ev('c1', 2400), ev('c1', 2400)]
    // Scoped view supplies only c1's events, but the baseline population must
    // remain the learner's own unscoped median for the mode.
    const out = paceOutliers([...cardOnly], undefined, [...baseline, ...cardOnly])
    expect(out.map((o) => o.cardId)).toContain('c1')
  })
})
```

Adjust to the real signature once you extend it — the point is that the *candidate* set narrows with scope while the *baseline* population does not.

- [ ] **Step 3: Fix**

Give `paceOutliers` a separate baseline population parameter, defaulting to the candidate events so existing callers are unchanged, and have `read.ts` pass the user's unscoped in-mode events as the baseline while keeping the scoped events as candidates. Add the unscoped query alongside the scoped one — this mirrors the reasoning already applied to the `attempts` query, which was deliberately left unscoped for the same class of reason.

- [ ] **Step 4: Verify and commit**

```bash
npx vitest run tests/metrics && npx tsc --noEmit
git add src/lib/metrics/pace.ts src/lib/metrics/read.ts tests/metrics/pace.test.ts
git commit -m "fix(spec3): draw the pace baseline from unscoped events"
```

---

### Task 8: Harden the posterior write against concurrency and duplicates (B9, B10)

**Files:**
- Modify: `src/lib/analysis/persist.ts` (`buildAnalysisWrites`)
- Modify: `src/lib/metrics/state-writer.ts`
- Modify: `src/actions/quiz.ts` (transaction options)
- Test: `tests/analysis/persist.test.ts`

- [ ] **Step 1: Write the failing test for B10**

```ts
// tests/analysis/persist.test.ts — append
describe('duplicate KLP references must not destroy the answer (B10)', () => {
  it('keeps one result per KLP when the grader names the same point twice', () => {
    // ShortAnswerGradeSchema permits a repeated klpRef. Without deduping,
    // createMany violates the (quizAnswerId, klpId) unique constraint, the
    // whole transaction rolls back, and a paid-for grading is discarded with
    // "Failed to submit answer".
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      klpResults: [
        { klpRef: 0, status: 'partial' },
        { klpRef: 0, status: 'passed' },
      ],
      errorTags: [],
    })

    expect(result.klpResults).toHaveLength(1)
    expect(result.warnings.map((w) => w.reason)).toContain('duplicate_klp_ref')
  })
})
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run tests/analysis/persist.test.ts`
Expected: FAIL — two results are returned.

- [ ] **Step 3: Fix B10**

Dedupe by `klpRef` in `buildAnalysisWrites`, keeping the **first** occurrence and recording a `duplicate_klp_ref` warning. Keeping the first rather than merging is deliberate: merging two contradictory statuses would invent a judgment the grader did not make.

While here, delete `state-writer.ts`'s "two results naming the same KLP compose into two observations" rationale and the test asserting it — the unique constraint makes it unreachable, so the comment describes behaviour that cannot occur.

- [ ] **Step 4: Fix B9**

The posterior write is `findUnique` → `upsert` with absolute values, with no row lock and default READ COMMITTED isolation. Two answers touching one KLP in flight both read the same pre-state and the second silently drops an observation.

Make the update relative and atomic instead of read-modify-write, or take a row lock (`SELECT ... FOR UPDATE` via `$queryRaw`) inside the transaction before reading. Add `transactionOptions` raising the interactive timeout above the 5s default — the transaction now performs two serialized round-trips per KLP, and a five-KLP card on a slow connection converts into `P2028` and a discarded graded answer.

- [ ] **Step 5: Verify and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/analysis/persist.ts src/lib/metrics/state-writer.ts src/actions/quiz.ts tests/analysis/persist.test.ts tests/metrics/state-writer.test.ts
git commit -m "fix(spec3): dedupe KLP refs and harden the posterior write"
```

---

### Task 9: Run the backfill and verify end to end

**Files:** none — this is an operational task.

- [ ] **Step 1: Full verification first**

Run: `npx vitest run && npx tsc --noEmit && npm run lint 2>&1 | tail -3`
Expected: suite green, types clean, no new lint problems versus baseline.

- [ ] **Step 2: Dry run**

Run: `npm run backfill:klp-state -- --dry-run`
Record the per-user, per-KLP output. Sanity-check a few values against `scripts/klp-health.ts`'s counts.

- [ ] **Step 3: Run it**

Run: `npm run backfill:klp-state`
Expected: rows written. **Report the count to the coordinator before proceeding.**

- [ ] **Step 4: Verify the posterior is now populated**

Re-run `scripts/klp-health.ts` and confirm `KlpState` rows exist. Then confirm the substrate reports real numbers rather than nulls: a topic with at least three observations on a KLP must now report non-null knowledge.

**This is the check the original plan's final step called for and could not pass** — until now there was no writer and no working backfill, so every knowledge value was permanently null.

- [ ] **Step 5: Commit any incidental fixes**

If steps 1-4 surfaced anything, fix and commit it. Otherwise nothing to commit — the backfill writes data, not code.

---

## Final verification

- [ ] `npx vitest run` — full suite green
- [ ] `npx tsc --noEmit` — clean
- [ ] Every defect B1-B10 has a test that fails against `main` @ PR #11
- [ ] The backfill has run and `KlpState` is populated
- [ ] A topic with sufficient observations reports non-null knowledge, and the signed verbosity index can now go negative — the two things Spec 3 shipped unable to do
