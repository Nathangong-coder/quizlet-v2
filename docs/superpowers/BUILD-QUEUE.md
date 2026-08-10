# Build queue & carried-over findings

**Last updated:** 2026-08-09
**Read this first** before starting any Stage 8 work. The order below is not derivable from spec filenames or dates.

This file is the canonical queue. A Claude-Code memory (`build-queue.md`) mirrors it, but **this file wins** — it is in the repo and readable by any tool.

---

## The queue

### 1. ✅ Set visibility — DONE (2026-08-09)

Spec: `specs/2026-08-08-set-visibility-design.md` · Plan: `plans/2026-08-08-set-visibility.md`
Branch `spec3b-tunable-scoring`, ~10 commits, **not merged, not pushed**.

Sets are private by default, owner-togglable to link-shareable. Closed 10 read-by-id exposures. Verified live against the dev server and the real DB, not just in tests.

### 2. ⬜ Deletion & forgetting — **NO SPEC YET. START HERE.**

**The user's decisions are already made** (2026-08-08) — do not re-litigate, just design against them:

1. **Memory reset extends to quiz history.** *Already true at account level* — `resetUserMemory` (`src/actions/user.ts`) deletes `QuizAttempt` + `QuizAnswer` (cascading `AnswerKlpResult`/`AnswerErrorTag`), `ConfidenceEvent`, `CardProgress`, `StudyEvent`, `KlpState`. The Spec 2a note claiming quiz history survives a reset went stale in commit `4a9d0ef`. **Nothing to do here.**
2. **Granular reset is the real ask** — reset a *specific quiz* (attempt) or a *specific question* (answer).
3. **Forget must affect the data it stored and everything it fed.** Today `forgetCard`/`forgetSet` (`src/actions/memory.ts:329-369`) delete only `ConfidenceEvent`, `StudyEvent`, `CardProgress`. They leave `QuizAnswer`, `AnswerKlpResult`, `AnswerErrorTag` and `KlpState` standing.

**Machinery that already exists — extend it, don't reinvent:**
- `deleteStudyEvent` (`src/actions/memory.ts:269-327`) is the exact shape to copy: delete one row inside a transaction, then recompute the derived aggregate from what survives.
- `recomputeCardProgress` (`src/lib/memory/recompute.ts`) — pure replay for `CardProgress`.
- `rebuildKlpStates` (`src/lib/metrics/state-writer.ts:131`) — pure-ish replay for the BKT posterior. **Required**, because the posterior is incremental and *not invertible*: `stepBkt` mixes two Bayes updates plus a learning term, so several priors map to one posterior. The only correct response to a deletion is replaying what remains.
- `lockKlpStates` (`state-writer.ts:77`) — advisory lock, needed on any path that read-modify-writes `KlpState`.

**The invariant the whole spec turns on:** *no derived number may claim knowledge from evidence that no longer exists.* A stale posterior stays above `MIN_OBSERVATIONS` forever and is beyond the backfill's reach, because `scripts/backfill-klp-state.ts` only rebuilds from *surviving* `AnswerKlpResult` rows.

**Open question to settle in the spec:** should `forgetCard`/`forgetSet` drop the *estimate*, the *evidence*, or both? They currently leave `QuizAnswer` intact, so evidence and posterior stay mutually consistent — a replay recomputes the same numbers. That is why it is not a repeat of hardening defect B3. But "forget this card" leaving KLP knowledge intact is the same *surprise* B3 fixed at account level.

### 3. ⬜ Spec 3B — tunable scoring — **PLAN READY TO EXECUTE**

Spec: `specs/2026-08-05-spec3b-tunable-scoring-and-targeting-design.md`
Plan: `plans/2026-08-06-stage8-spec3b-tunable-scoring.md` — **rebuilt 2026-08-08** against post-hardening code (commit `269714b`). 10 tasks.

Knob set (user-approved): severity bands + targeting strategy + `MIN_OBSERVATIONS` + `ARTICULATION_MIN_PKNOWN` + `READINESS_WEIGHT_PER_ANSWER`.

**Known limit, accepted deliberately:** `getLearnerMetrics` has **zero production callers**. Task 6 makes it tuning-aware for 3C to consume; the ranked output renders nowhere until then. 3B's visible surface is the settings panels + the quiz results screen.

### 4. ⬜ Spec 3C — learner dashboard (the UI spec) — **SPEC EXISTS, NO PLAN, NO CODE**

Spec: `specs/2026-08-05-spec3c-learner-dashboard-design.md`

Must also close **both** Spec 3 §14 follow-ups, which are still open and verified so on 2026-08-08:
- `profileToPromptBlock`'s callers hardcode `topics: []` (`src/lib/ai/context.ts:155`, `src/actions/training-plan.ts:34`), so topic-grain data reaches **no prompt**.
- `capBlock` truncates the topic section **first**, because the uncapped card section is concatenated ahead of it.

**Fix both together or neither** — closing the first alone silently drops the topic signal the moment an active learner's card section fills `MAX_PROFILE_CHARS`.

---

## Where deferred issues are recorded

Never in memory — always in a spec's own section.

| Spec | Section | Status |
| --- | --- | --- |
| `2026-08-03-answer-analysis-capture-design.md` (2a) | "Known drift risks, deliberately out of scope" | **All 3 resolved.** Two fixed 2026-08-08; the third (reset ↔ quiz history) was already true in code. |
| `2026-08-04-answer-analysis-display-design.md` (2b) | "Explicitly NOT fixed" | **Resolved** — `startQuizAttempt` ownership, closed by the visibility work. |
| `2026-08-05-metrics-substrate-learner-profile-design.md` (Spec 3) | **§14 follow-ups** | **BOTH STILL OPEN** — see queue item 4. |
| `CLAUDE.md` | Future Considerations | Both product decisions now answered (visibility → item 1, forget → item 2). **Prune each from CLAUDE.md as it ships.** |

---

## Findings from the 2026-08-08/09 session

### Fixed

| Finding | Where | Commit |
| --- | --- | --- |
| `rebuildState`'s doc comment told the next reader a Spec 3B band edit needs a posterior replay. False since spec §3.3 was corrected — bands never reach BKT. Would have been read as an instruction. | `src/lib/metrics/cache.ts:32` | `00f0aef` |
| `StudySource` re-listed as two literal `z.enum([...])` arrays, so adding a mode type-checked everywhere then failed at **runtime** on `SessionInsight` parsing. Now derives from `STUDY_SOURCES`. | `src/lib/memory/scoring.ts`, `insight.ts` | `356b51d` |
| `Card.klpStatus`'s four literals scattered across 2 actions, a component and a Prisma comment, with no shared constant. Worst in `KlpEditor`, which renders retry/skipped affordances off `status === '...'` — a typo fails by showing nothing. | `src/lib/cards/klp-status.ts` (new) | `6680820` |
| `card-autocomplete.ts` fetched **any** set by id with no owner check and fed every card into an AI prompt. Previously unrecorded anywhere. Tightened to owner-only. | `src/actions/card-autocomplete.ts` | `fae943e` |
| `print/page.tsx` fetched a `QuizAttempt` by id checking only `attempt.setId`, so any signed-in user could print another learner's attempt (their `selectedCardIds` + generated options). Same class Spec 2b fixed twice and missed here. | `src/app/sets/[id]/print/page.tsx` | `78d58e0` |
| `profile.ts` fetched a set **title** from a URL-controlled scope with no check — anyone could pull another user's set title into their profile block. Found by the plan's own final-verification grep. | `src/lib/memory/profile.ts:420` | `92102b6` |
| Spec + plan both claimed `/match` is readable signed-out. It is not — middleware gates it — and matching *is* studying, so it shouldn't be. | docs + `match/page.tsx` comment | (doc commit) |

### Still open — not bugs, but know them

- **`getLearnerMetrics` has zero production callers** (tests only). An earlier memory claimed the hardening pass changed this; it had not. Re-verified 2026-08-08.
- **Spec 3 §14's two prompt-block defects** — see queue item 4.
- **`MIN_OBSERVATIONS = 3` hides every knowledge number.** Live DB has 19 answers, 1 user, every KLP seen exactly once, so **zero topics report non-null knowledge** and the signed verbosity index cannot go negative. Nothing is broken — the corpus is thin. **Do not seed synthetic study data**: the posterior is incremental and not self-correcting, so fabricated evidence does not cleanly come back out. Spec 3B makes the floor tunable, which is the real fix.

---

## Environment gotchas (will waste your time otherwise)

1. **`.env` contains only `DATABASE_URL`.** No `NEXTAUTH_SECRET`, so `auth()` throws `MissingSecret` and the app is broken locally — pages 500 or misbehave in confusing ways. For local verification, pass one to the dev process rather than editing the file:
   ```bash
   NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev
   ```
   **CLAUDE.md's security note is stale** — it says `.env` holds live `GOOGLE_API_KEY` and `RESEND_API_KEY`. It no longer does.

2. **`cursor-agents/` is a separate git repo** cloned into the project root on 2026-08-09. It has its own `.git` and `package.json` and depends on an uninstalled `@cursor/sdk`. Because `tsconfig.json` includes `**/*.ts` and excludes only `node_modules`, it **breaks `tsc` and `vitest` for this project**:
   - `npx tsc --noEmit` → 1 error, entirely from `cursor-agents`
   - `npx vitest run` → 993 tests, 7 failing, all in `cursor-agents`

   Verify this project alone with:
   ```bash
   npx vitest run --exclude "**/cursor-agents/**" --exclude "**/node_modules/**"
   npx tsc --noEmit 2>&1 | grep -v "^cursor-agents"
   ```
   Left untouched deliberately — it is not part of this project. If it stays, it wants a `tsconfig`/`vitest` exclude.

3. **Windows:** `pkill` does not stop the Next dev server. Use `taskkill /PID <pid> /F` after finding it with `netstat -ano | grep :3001`.

4. **`tsx` scripts must live inside the project** (e.g. `scripts/`) or module resolution fails, and they need a `main()` wrapper — top-level `await` breaks under the CJS output format.

---

## Baselines (branch `spec3b-tunable-scoring`, 2026-08-09)

- **Tests:** 80 files / **874 passing** (excluding `cursor-agents`)
- **`tsc --noEmit`:** clean (excluding `cursor-agents`)
- **`npm run lint`:** **187 problems** (130 errors, 57 warnings) — all pre-existing. Compare against this; do not fix unrelated ones.
- Branch is **not merged and not pushed**.
