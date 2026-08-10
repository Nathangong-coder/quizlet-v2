# Deletion & forgetting — design

**Date:** 2026-08-10
**Queue item:** `docs/superpowers/BUILD-QUEUE.md` #2
**Status:** designed, not built
**Supersedes:** the "DECIDED 2026-08-08, not yet built" paragraph in `CLAUDE.md` → Future Considerations. Delete that paragraph when this ships.

---

## 1. The problem

Deletion in this app is never one delete. Evidence rows feed derived aggregates that are **not invertible**, so removing evidence means *replaying* the aggregates from what survives:

| Aggregate | Derived from | Replayed by |
| --- | --- | --- |
| `CardProgress` | `StudyEvent` | `recomputeCardProgress` (`src/lib/memory/recompute.ts`) — pure |
| `KlpState` | `AnswerKlpResult` | `rebuildKlpStates` (`src/lib/metrics/state-writer.ts:131`) |

`KlpState` cannot be stepped backward at all: `stepBkt` mixes two Bayes updates plus a learning term, so several priors map to one posterior. Replay is the only correct response to a deletion.

**The invariant the whole spec turns on:** *no derived number may claim knowledge from evidence that no longer exists.* A stale posterior stays above `MIN_OBSERVATIONS` forever and is beyond the backfill's reach, because `scripts/backfill-klp-state.ts` rebuilds only from *surviving* `AnswerKlpResult` rows.

### What is broken today

1. **`forgetCard` / `forgetSet` (`src/actions/memory.ts:329-369`) delete only `ConfidenceEvent`, `StudyEvent`, `CardProgress`.** They leave `QuizAnswer`, `AnswerKlpResult`, `AnswerErrorTag` and `KlpState` standing. This is not the same corruption hardening defect B3 fixed — evidence and posterior stay mutually consistent, so a replay recomputes the same numbers — but "forget this card" leaving its KLP knowledge intact is the same *surprise*.
2. **There is no granular reset.** A learner can erase one memory-feed entry or their entire account, with nothing in between. Resetting one bad quiz, or one misgraded question, is impossible.
3. **`StudySession` is missing from `RESET_MEMORY_MODELS`** (`src/lib/memory/reset.ts`). Both `StudyEvent.sessionId` and `QuizAttempt.sessionId` are `onDelete: SetNull`, so a full account reset leaves every session row standing as an empty husk. Nothing renders sessions yet, which is why it has not bitten. **Found while designing this spec; not previously recorded anywhere.**
4. **A quiz answer writes two unlinked rows.** `QuizAnswer` (graded record) and `StudyEvent` (memory feed, drives confidence) share no foreign key — only `(userId, cardId, sessionId, source↔mode, createdAt≈)`. Nothing can reliably delete one when the other goes.

---

## 2. Decisions

All four were settled with the user before design, and are **not open**:

| Question | Decision |
| --- | --- |
| Does "forget" drop the estimate or the evidence? | **Both.** Forgetting a card or set deletes its `QuizAnswer` rows too, then replays. "Forget" means the app holds no record you ever studied it. |
| Does a reset quiz survive in history? | **No.** Full erasure — attempt, answers, session, events. Keeping a scored receipt would leave `QuizAnswer` rows marked `analysisStatus: 'analyzed'` with zero `AnswerKlpResult` rows, which by the schema's own definition means "analyzed and clean" and would silently inflate Spec 3's error-rate denominators. |
| How does deleting one row find its twin? | **An explicit FK** (`StudyEvent.quizAnswerId`) written at record time, plus a one-time backfill. No runtime heuristic matching. |
| Where do granular controls live? | **`/profile/activity/[id]`** (currently orphaned — nothing links to it) plus per-question controls inside `QuizSummary`, behind a prop so the live end-of-quiz screen is unaffected. |

### Stars do not survive

`CardProgress` carries `starred`. When a replay yields no surviving evidence the row is **deleted outright, star included** — forgetting a card unstars it. This matches what `deleteStudyEvent` and `resetUserMemory` already do, and needs no special case. A card with *surviving* evidence keeps its `CardProgress` row and therefore its star.

---

## 3. Architecture

One erasure module, six thin callers.

```
src/lib/memory/erase.ts
  ErasureScope        — discriminated union of the six scopes
  planErasure(...)    — PURE: (snapshot, scope) -> { deletes, replayCardIds, replayKlpIds }
  executeErasure(...) — transaction: lock -> read snapshot -> plan -> delete -> replay
```

`planErasure` is pure: it takes a plain **snapshot** — the rows the scope reaches, read inside the transaction and passed in as data (attempts, answers, their `cardId`/`klpId`s, events, and each affected attempt's surviving answers) — and returns what to delete and what to replay. It issues no queries itself, which is what makes every rule in §3.1 a unit test.

Every verb becomes a scope selector over this module: `forgetCard`, `forgetSet`, `resetQuiz`, `resetQuestion`, `deleteStudyEvent`, `resetUserMemory`.

**Why one module rather than extending each action in place.** Five hand-written copies of "delete, then replay both aggregates" is exactly the shape that produced hardening defect B3 — one path forgot `KlpState`. Five paths means five chances to forget it again, and the failure is silent. Keeping the invariant in one pure, unit-testable function turns "does forgetting a card also drop its KLP evidence?" into an assertion instead of a database integration test.

**Order is load-bearing.** The planner's reads run *before* any delete, inside the transaction. After deletion the links that identify which cards and KLPs need replaying are gone.

**Database cascades are not sufficient and were rejected as the primary mechanism.** `CardProgress` and `KlpState` are derived aggregates, not FK children — no cascade can trigger a replay. Cascades do the mechanical part (`AnswerKlpResult`, `AnswerErrorTag`, `Annotation`, `QuizQuestion` under their parents) and that is their limit.

### 3.1 The six scopes

| Scope | Deletes | Replays |
| --- | --- | --- |
| `answer` | `QuizAnswer` → cascades `AnswerKlpResult`, `AnswerErrorTag`, `Annotation`, and (new FK) its `StudyEvent` | `CardProgress` for the card; `KlpState` for the KLPs that answer touched |
| `event` | Routes to `answer` when the event is quiz-sourced; otherwise deletes the lone `StudyEvent` | `CardProgress` for the card |
| `attempt` | `QuizAttempt` → cascades answers + `QuizQuestion`; plus its `StudySession` | Every card and KLP the attempt touched |
| `card` | `ConfidenceEvent`, `StudyEvent`, `QuizAnswer`, `CardProgress` for that card | That card's KLPs |
| `set` | The above for every card in the set, plus the set's `QuizAttempt` and `StudySession` rows | Every affected card and KLP |
| `account` | Every model in `RESET_MEMORY_MODELS` **plus `studySession`** | Nothing — the replay set is empty because no evidence survives |

**`event` routes to `answer` deliberately.** The FK cascade runs answer → event, one direction only. Without this routing, deleting a quiz-sourced entry from the memory feed would leave its graded answer and KLP evidence standing. Erasing an interaction erases every row describing it, from whichever page you reached it.

**Untouched by every scope:** `CardKlp` and `Card.klpStatus` (content, not memory), `QuizOptionCache` (generated content), `TrainingPlan` (explicitly out of scope — see §8).

### 3.2 Derived counters must be recomputed

`QuizAttempt.score` and `StudySession.itemCount` are stored numbers computed from answers. Deleting a question makes both wrong. For any attempt that loses answers but survives, the planner recomputes them from the surviving answers.

**If an attempt loses its last answer, the attempt and its session are deleted too** rather than left as a ghost quiz in the activity feed.

---

## 4. Schema change

```prisma
model StudyEvent {
  // ...
  quizAnswerId String?     @unique
  quizAnswer   QuizAnswer? @relation(fields: [quizAnswerId], references: [id], onDelete: Cascade)
}
```

`@unique` because one graded answer produces at most one memory event. The FK lives on `StudyEvent`, so deleting a `QuizAnswer` cascades the event away in the database — the `answer`, `attempt`, `card` and `set` scopes get that for free and cannot forget it.

`recordStudyEvent` (`src/lib/memory/record.ts`) gains an optional `quizAnswerId`, passed from the four call sites in `src/actions/quiz.ts` (MC at :555, TF at :732, SA text at :1098, SA multimodal at :1212).

### Backfill

`scripts/backfill-study-event-answer-link.ts` links existing rows on `(userId, cardId, sessionId, source→mode)` with nearest `createdAt`. Where a match is **ambiguous — more than one candidate in the group — it links nothing and logs**, rather than guessing. A wrong link deletes the wrong memory row later, which is worse than an unlinked legacy row.

Per the environment notes in `BUILD-QUEUE.md`, the script lives in `scripts/` and needs a `main()` wrapper — top-level `await` breaks under the CJS output format.

---

## 5. Surfaces

| Surface | Change |
| --- | --- |
| `/profile` → Recent Attempts | Repoint from `/profile/memory?sets=…` to `/profile/activity/[sessionId]`, rescuing the orphaned page. `getUserStats` must return `sessionId`; pre-Stage-6 attempts have none and render unlinked. |
| `/profile/activity/[id]` | Destructive **"Reset this quiz"** with a typed confirmation — this deletes graded work, so a plain `confirm()` is too cheap. Redirect to `/profile` on success. |
| `QuizSummary` | New `canReset?: boolean` prop, default `false`. The activity page passes `true`; the live end-of-quiz screen does not pass it and is unchanged. When true, each answer row gets a remove control. |
| `/profile/memory` | Existing controls keep working, but **all three confirm strings must be rewritten.** Forget card/set currently promise only "history and confidence", which stops being true once graded quiz answers go too. The per-entry delete promises only that it "will recompute this card's confidence and mastery" — but under the `event`→`answer` routing (§3.1) deleting a quiz-sourced entry now also deletes that graded answer, and the copy must say so. |

---

## 6. Error handling

**Ownership is on the memory rows, not the content.** Since the set-visibility work, a user can study a link-shared set they do not own, and their `StudyEvent`/`QuizAnswer` rows for someone else's card are legitimately theirs to erase. So the `card` and `set` scopes scope by `userId` and **must not require set ownership** — which is what `forgetCard`/`forgetSet` already do correctly. The `answer`, `event` and `attempt` scopes check `row.userId === session.user.id` inside the transaction and return `'Not found'` for both absent and not-yours, matching the convention the visibility work settled on.

**One transaction.** Plan, delete and replay all commit or none. A replay that throws rolls back the deletes rather than leaving evidence gone and aggregates stale — precisely the failure mode this spec exists to prevent.

**`lockKlpStates` first.** Any path that read-modify-writes `KlpState` takes the advisory lock (`state-writer.ts:77`), which already sorts its keys so concurrent callers cannot deadlock.

**Revalidate** `/profile`, `/profile/memory`, and `/profile/activity/[id]`.

### Accepted limits, stated rather than hidden

- A set-level forget issues **one advisory-lock query per KLP**. On a large set this is slow. Acceptable at current scale; batching is a known future optimization, not a hidden surprise.
- `KlpState` is protected by `lockKlpStates`, but **`CardProgress` has no lock** — a quiz answer landing mid-erasure can write after the replay. This is already true of `deleteStudyEvent` today; the spec inherits the behaviour rather than introducing it.

---

## 7. Testing

The planner is pure, so the load-bearing assertions need no database.

**Unit — `planErasure`:**
- Exact delete set and exact replay set, one test per scope, against a shared fixture graph.
- **B3 regression guard:** table-driven — *every* scope whose delete set can include `AnswerKlpResult` rows must also list KLPs to replay. This is the defect class that already shipped once (`resetUserMemory` clearing evidence and leaving the posterior standing); this makes a repeat a build failure rather than silent corruption.
- **Coverage guard:** the `account` scope's delete set equals `RESET_MEMORY_MODELS ∪ {studySession}`, so adding a memory model without teaching erasure about it fails a test.
- Counter recompute: attempt score and session `itemCount` after a partial delete; attempt *and* session removed when the last answer goes.
- `event` scope routes a quiz-sourced event to `answer`, and does not route a `review`-sourced one.

**Integration:**
- Deleting a `QuizAnswer` actually removes its linked `StudyEvent` — the FK does the work, so it gets pinned.
- Ownership: another user's attempt id returns `'Not found'` and deletes zero rows.

**Backfill script:**
- An ambiguous `(user, card, session, source)` group links nothing and logs.

**Live verification** against the dev DB before calling it done, as the visibility work did — the queue records that tests alone were not sufficient there. Note `.env` has no `NEXTAUTH_SECRET`; run with `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only npm run dev`.

---

## 8. Deferred: answers should not be resubmittable at all

**Decided 2026-08-10. Not built here — this spec only makes the existing resubmit path correct.**

`createAnswerWithAnalysis` (`src/actions/quiz.ts:796`) accepts a `replace` argument and deletes the prior `QuizAnswer` for a `(attempt, card, mode)` before writing a new one. This spec's FK makes that path *correct* — the superseded answer's `StudyEvent` cascades away and `CardProgress` is replayed, which also fixes a pre-existing double-step of confidence. **That fix stays.** But re-answering the same question should not be a product affordance in the first place: a second attempt at a question you have already seen graded is not evidence of knowledge, and every metric downstream treats it as though it were.

**The one legitimate case is different in kind, not a re-answer.** In short-answer, a learner may miss a high-weight KLP simply by not mentioning it. The right response is an **AI-generated follow-up question** targeting that KLP — a new question with its own provenance and its own `QuizAnswer` row — not a second pass at the original. That needs a different quiz type and a different UI (a conversational or multi-turn short-answer flow), and it should be designed as such.

When that lands, the `replace` path here should be removed rather than extended. Until then it stays, correct but unadvertised.

## 9. Out of scope

- **`TrainingPlan`.** It is derived from memory and will be stale after an erasure. Stage 7/Spec 4 owns the plan lifecycle; wiring erasure into it here would design half of that feature blind.
- **Undo.** Every verb is permanent. An undo buffer would need to snapshot evidence *and* aggregates, and the confirmation dialogs are the mitigation instead.
- **Batching the per-KLP advisory locks.** Recorded as a limit in §6, not fixed here.
- **Deleting a `StudySession` directly** (as opposed to via its attempt). Matching and confidence-ranking sessions have no reset verb; only quizzes do. If that gap matters it is a follow-up.
