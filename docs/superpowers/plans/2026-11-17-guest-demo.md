# Interactive Demo Video + Guest Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the 60-second demo video on the landing page as a chaptered, clickable player, and add a no-login `/demo` where a visitor can browse the demo set, make up to 5 cards, take one one-question short-answer quiz, and try each AI feature once. At any limit, a "Request an invite" waitlist the owner manages from `/staff/waitlist`.

**Architecture:** `/demo` is a new public route tree outside the middleware matcher. Guest content lives in `localStorage`. Every guest AI call is a `'use server'` export in `src/actions/demo.ts` that runs one guard (`src/lib/demo/guard.ts`: kill switch → signed guest cookie → per-feature ticket → per-IP limit → global daily call cap → atomic call reservation), then calls `generateJson` with `userId = DEMO_AI_USER_ID`, reusing existing prompt builders and Zod schemas. The only guest-reachable DB writes are `DemoTicket` and `InviteRequest`.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7 (Neon adapter), Vitest + Testing Library, Tailwind v4, AI SDK v7 via `generateJson`.

**Spec:** `docs/superpowers/specs/2026-11-17-guest-demo-design.md` (read §12 "Settled after the builder check". It overrides §5.4/§5.5 where they differ).

## Global Constraints

- Branch: `spec2-klp-authoring` (current). Commit per task. **Never push** (the owner pushes).
- Every `*.test.tsx` starts with `// @vitest-environment jsdom` and calls `afterEach(cleanup)`. Mock `'use server'` modules in jsdom tests (BUILD-QUEUE trap 7).
- `src/components/home/Landing.tsx` imports no `@/lib/db`, `@prisma/client` or `@/actions/*` (`tests/components/landing.test.tsx`).
- `/demo` is never added to `src/middleware.ts`'s matcher, and `src/lib/auth/gate.ts` is not edited.
- Every bare `generateJson` call carries an `// ATTRIBUTION:` comment within 8 lines above (`tests/ai/model-attribution.test.ts`). Demo results are never persisted, so the comment says so.
- No new prompts. Reuse `GRADE_SHORT_ANSWER_PROMPT`, `EXTRACT_KLPS_PROMPT`, `MULTIPLE_CHOICE_PROMPT`, `HOT_SEAT_PROBE_PROMPT` and `AUTOCOMPLETE_PROMPT`, with their existing schemas.
- Guest input caps, enforced by Zod in `src/actions/demo.ts`: term ≤ 200 chars, definition ≤ 1,000, answer ≤ 2,000, autocomplete text ≤ 500, waitlist note ≤ 200, email ≤ 254.
- Env (all in `.env.example`): `DEMO_ENABLED` (on only if exactly `"true"`), `DEMO_SET_ID`, `DEMO_AI_USER_ID`, `DEMO_DAILY_CAP` (default **1000** calls), `DEMO_PER_IP_FEATURE_LIMIT` (default **3**), `NEXT_PUBLIC_DEMO_ENABLED` (on only if exactly `"true"`).
- Guest content limits: **1** guest set, **5** cards, **1** quiz with **1** question (short answer only).
- Migrations: `prisma migrate dev` doesn't work here. Use `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` → `prisma/migrations/<ts>_<name>/migration.sql` → `npx prisma migrate deploy`, then re-run the diff and expect "This is an empty migration".
- Verify with `npx vitest run <paths>`, plus `npx tsc --noEmit` and `npm run lint` at the end. Lint baseline is 178 problems, so new code must add none.

## Review Focus

1. **Double-click on a one-shot feature:** two concurrent `demoGrade` calls must produce exactly one AI call. The second gets `quota_used`. Pinned in Task 4 (`reserveCall` is one conditional `updateMany`) and live-checked in Task 15.
2. **A demo-set id that isn't the demo set:** any demo action given a card id from another (even public) set returns `invalid` without calling AI. Pinned in Task 6.
3. **Forged or edited key points:** grading a guest card with points whose signature doesn't verify (changed text, changed card) returns `invalid`. Pinned in Task 5/6.
4. **Storage blocked / private window:** `localStorage` throwing doesn't crash `/demo`. The store falls back to in-memory for the page view. Pinned in Task 8.
5. **Provider failure on a one-shot feature:** the guest isn't charged. The reservation is released and the ticket deleted, so a retry works. Pinned in Task 4/6.

---

### Task 1: Chaptered demo video on the landing page

**Files:**
- Move: `synapseHQ_demo.mp4` → `public/demo/synapseHQ_demo.mp4` (`git mv`)
- Create: `public/demo/poster.jpg` (frame at 0:30, the graded-answer screen: `ffmpeg -ss 30 -i public/demo/synapseHQ_demo.mp4 -frames:v 1 -vf scale=1280:-1 -q:v 4 public/demo/poster.jpg`)
- Create: `src/lib/marketing/demo-video.ts`, `src/components/marketing/DemoVideo.tsx`
- Modify: `src/components/home/Landing.tsx` (place `<DemoVideo />` directly under the hero CTA)
- Test: `tests/components/demo-video.test.tsx`, `tests/components/landing.test.tsx` (extend the no-DB file list)

**Interfaces:**
- Produces: `DEMO_CHAPTERS: readonly DemoChapter[]` where `DemoChapter = { start: number; title: string; caption: string; tryHref: string | null }`; `chapterAt(seconds: number): number` (index of the active chapter); `isDemoLinkEnabled(env?: Record<string,string|undefined>): boolean` (true only when `NEXT_PUBLIC_DEMO_ENABLED === 'true'`).

- [ ] **Step 1: Write failing tests.**
  - `DEMO_CHAPTERS` has exactly these 8 entries, in order: `[0,'Built for finance interview prep','/demo']`, `[9,'82 M&A questions, tagged','/demo/set']`, `[16,'Build a written test','/demo/quiz']`, `[21,'Write the answer in your own words','/demo/quiz']`, `[29,'Graded point by point','/demo/quiz']`, `[37,'Scored on clarity, concision and correctness','/demo/quiz']`, `[46,'Confidence from 1 to 10','/demo/review']`, `[50,'Games built from your set','/demo/games']`. Captions are copied verbatim from the spec §4 table.
  - `chapterAt(0)===0`, `chapterAt(8.9)===0`, `chapterAt(9)===1`, `chapterAt(59)===7`.
  - Component: renders a `<video>` with `src="/demo/synapseHQ_demo.mp4"`, `poster="/demo/poster.jpg"`, `preload="metadata"`, no `autoplay`. Clicking the chapter button "Graded point by point" sets `video.currentTime` to 29 and calls `play` (stub `HTMLMediaElement.prototype.play`). Dispatching `timeupdate` at 40 s gives the "Scored on clarity…" row `aria-current="true"`. With `isDemoLinkEnabled` false, no "Try it" links render; with it true, the "Games" row links to `/demo/games`.
  - Landing test: add `src/components/marketing/DemoVideo.tsx` and `src/lib/marketing/demo-video.ts` to the no-DB/no-action scan list.
- [ ] **Step 2: Run** `npx vitest run tests/components/demo-video.test.tsx tests/components/landing.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.** `DemoVideo` is a client component that takes `linksEnabled: boolean` as a prop. `Landing` passes `isDemoLinkEnabled()`, read on the server, so the test can drive it. Desktop layout: video left (≈2/3), chapter list right. Below `md`, chapters stack under the video. Each chapter is a `<button>` (time + title + caption). "Try it →" is a separate `<Link>` that pauses the video on click. Add `<track kind="chapters" src="/demo/chapters.vtt" default>` (create `public/demo/chapters.vtt` from `DEMO_CHAPTERS`, with each cue ending where the next starts and the last at 60.3) and a visually hidden `<ol>` of the captions for screen readers. A "Try the demo" text link goes under the video (not a button; the hero keeps one primary CTA).
- [ ] **Step 4: Run** the same tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(landing): chaptered demo video with Try-it links`.

### Task 2: Schema — `DemoTicket` and `InviteRequest`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20261117120000_guest_demo/migration.sql`
- Test: `tests/schema/guest-demo.test.ts`

**Interfaces:**
- Produces:
  ```prisma
  /// One guest's use of one demo feature. `calls` is reserved before each AI call and released on failure.
  model DemoTicket {
    id        String   @id @default(cuid())
    guestId   String
    ipHash    String
    feature   String   /// DEMO_FEATURES in src/lib/demo/config.ts
    calls     Int      @default(0)
    createdAt DateTime @default(now())
    @@unique([guestId, feature])
    @@index([ipHash, feature, createdAt])
    @@index([createdAt])
  }
  model InviteRequest {
    id              String    @id @default(cuid())
    email           String    @unique /// lower-cased, trimmed
    note            String?
    source          String    @default("demo")
    ipHash          String
    createdAt       DateTime  @default(now())
    lastRequestedAt DateTime  @default(now())
    invitedAt       DateTime?
    inviteCode      String?   /// normalised InviteCode.code minted for this request
    @@index([invitedAt, createdAt])
  }
  ```

- [ ] **Step 1: Write the failing test.** It reads `prisma/schema.prisma` and asserts that both models exist, that `@@unique([guestId, feature])` is present, and that `InviteRequest.email` is `@unique`. This is the same source-read style as `tests/schema/regrade-generations.test.ts`.
- [ ] **Step 2: Run** `npx vitest run tests/schema/guest-demo.test.ts`. Expected: FAIL.
- [ ] **Step 3: Add the models.** Generate the migration SQL with `migrate diff`, save it, run `npx prisma migrate deploy` and `npx prisma generate`, then re-run the diff. Expected: "This is an empty migration".
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `feat(schema): DemoTicket and InviteRequest for the guest demo`.

### Task 3: Demo config, guest cookie, IP hash (pure)

**Files:**
- Create: `src/lib/demo/config.ts`, `src/lib/demo/identity.ts`
- Test: `tests/demo/config.test.ts`, `tests/demo/identity.test.ts`

**Interfaces:**
- Produces (`config.ts`):
  - `DEMO_FEATURES = ['grade','klp-extract','gauntlet','hot-seat','autocomplete'] as const`; `type DemoFeature`.
  - `FEATURE_CEILING: Record<DemoFeature, number> = { grade: 1, 'klp-extract': 5, gauntlet: 12, 'hot-seat': 15, autocomplete: 1 }`.
  - `RUN_FEATURES: ReadonlySet<DemoFeature> = new Set(['gauntlet','hot-seat'])`; `RUN_WINDOW_MS = 30 * 60 * 1000`.
  - `GUEST_LIMITS = { sets: 1, cards: 5, quizzes: 1, questionsPerQuiz: 1 } as const`.
  - `type DemoConfig = ReturnType<typeof readDemoConfig>`.
  - `readDemoConfig(env = process.env): { enabled: boolean; setId: string | null; aiUserId: string | null; dailyCap: number; perIpFeatureLimit: number; secret: string | null }`. Sets `enabled` only when `DEMO_ENABLED === 'true'` **and** `aiUserId`, `setId` and `secret` (`AUTH_SECRET ?? NEXTAUTH_SECRET`) are all present. Bad or non-positive numbers fall back to the defaults 1000 / 3.
- Produces (`identity.ts`):
  - `DEMO_COOKIE = 'synapse_demo'`; `signGuestId(id: string, secret: string): string` → `${id}.${base64url(hmacSha256(secret, 'demo-guest:' + id))}`; `verifyGuestCookie(value: string | undefined, secret: string): string | null` (constant-time compare; id must match `/^[A-Za-z0-9_-]{16,64}$/`); `newGuestId(): string` (`randomBytes(18).toString('base64url')`).
  - `clientIp(headers: Headers): string` (first `x-forwarded-for` entry, trimmed, else `x-real-ip`, else `'unknown'`); `hashIp(ip: string, secret: string): string` (`sha256('demo-ip:' + secret + ':' + ip)` hex).
  - `utcDayStart(now: Date): Date`.

- [ ] **Step 1: Write failing tests.**
  - `readDemoConfig({})` gives `enabled:false`. A full env with `DEMO_ENABLED:'TRUE'` also gives `enabled:false`. `DEMO_DAILY_CAP:'abc'` gives `dailyCap:1000`. `DEMO_PER_IP_FEATURE_LIMIT:'0'` gives `3`.
  - A signed id round-trips. A changed signature, a changed id, a missing dot and a wrong secret all return `null`.
  - `clientIp(new Headers({'x-forwarded-for':' 1.2.3.4 , 5.6.7.8'}))==='1.2.3.4'`. The same IP hashes to the same value and different secrets give different hashes.
  - `utcDayStart(new Date('2026-11-17T23:59:00-08:00'))` → `2026-11-18T00:00:00.000Z`.
- [ ] **Step 2: Run** `npx vitest run tests/demo`. Expected: FAIL.
- [ ] **Step 3: Implement** with `node:crypto` (`createHmac`, `timingSafeEqual`, `createHash`, `randomBytes`). No Prisma imports.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): config, signed guest cookie, hashed IP`.

### Task 4: The guard (tickets, caps, atomic reservation)

**Files:**
- Create: `src/lib/demo/guard.ts`
- Test: `tests/demo/guard.test.ts`

**Interfaces:**
- Consumes: Task 3 exports; `prisma` from `@/lib/db`.
- Produces:
  - `type DemoRefusal = 'demo_off' | 'demo_cap' | 'quota_used' | 'run_not_started'`.
  - `type GuestCtx = { guestId: string; ipHash: string; config: DemoConfig }`.
  - `startRun(ctx: GuestCtx, feature: DemoFeature, now?: Date): Promise<{ ok: true } | { ok: false; refusal: DemoRefusal }>`. For `RUN_FEATURES` only: refuses `quota_used` if a ticket exists for (guest, feature), and `quota_used` if the IP already has `perIpFeatureLimit` tickets for this feature since `utcDayStart`. Otherwise creates the ticket with `calls: 0`. A P2002 unique violation also means `quota_used`.
  - `reserveCall(ctx, feature, now?): Promise<{ ok: true; ticketId: string } | { ok: false; refusal: DemoRefusal }>`, in this order:
    1. **Global cap:** `_sum.calls` of tickets with `createdAt >= utcDayStart(now)` ≥ `dailyCap` → `demo_cap`.
    2. **Find the ticket** for (guest, feature).
    3. **No ticket:** for a run feature → `run_not_started`. Otherwise run the per-IP check (as in `startRun`) and create one (P2002 → re-read).
    4. **Run window:** for a run feature, ticket older than `RUN_WINDOW_MS` → `quota_used`.
    5. **Atomic increment:** `updateMany({ where: { id, calls: { lt: FEATURE_CEILING[feature] } }, data: { calls: { increment: 1 } } })`. A count of 0 → `quota_used`.
  - `releaseCall(ticketId: string, feature: DemoFeature): Promise<void>`: decrement, but never below 0. If the feature isn't a run feature and `calls` is now 0, delete the ticket (refund).
  - `guestContext(): Promise<GuestCtx | null>`. Reads `cookies()`/`headers()` from `next/headers`, verifies or issues the cookie (`httpOnly`, `sameSite:'lax'`, `secure` in production, `maxAge` 30 days, `path:'/'`). Returns `null` when `config.enabled` is false.

- [ ] **Step 1: Write failing tests** against a hand-rolled in-memory fake of `prisma.demoTicket` (`findUnique`, `create`, `count`, `aggregate`, `updateMany`, `delete`, `update`), injected with `vi.mock('@/lib/db')`:
  - `grade`: the first `reserveCall` gives ok, the second gives `quota_used`. `releaseCall` after the first deletes the ticket, and a new `reserveCall` gives ok again (refund).
  - `klp-extract`: five reservations are ok and the sixth is `quota_used`.
  - `gauntlet`: `reserveCall` before `startRun` gives `run_not_started`. After `startRun`, 12 reservations are ok and the 13th is `quota_used`. A second `startRun` is `quota_used`. A reservation 31 minutes after start is `quota_used`. `releaseCall` on a run ticket never deletes it.
  - Per IP: with limit 3, three guests on one `ipHash` each open `grade`, and the fourth gets `quota_used`. Yesterday's tickets don't count.
  - Global cap: `dailyCap: 2` with two calls spent today → `demo_cap`, regardless of feature.
  - Ordering: with the cap hit **and** the ticket used, the refusal is `demo_cap`.
- [ ] **Step 2: Run** `npx vitest run tests/demo/guard.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Keep `guestContext` separate from the pure-ish ticket functions so the tests never touch `next/headers`.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): guard — per-feature tickets, per-IP limit, daily cap, atomic reservation`.

### Task 5: Signed generated key points

**Files:**
- Create: `src/lib/demo/signed-points.ts`
- Test: `tests/demo/signed-points.test.ts`

**Interfaces:**
- Produces:
  - `type GuestPoint = { text: string; weight: number; kind: KlpKind }` (`KlpKind` from `KLP_KINDS` in `src/lib/ai/schemas.ts`).
  - `type SignedPoints = { cardHash: string; points: GuestPoint[]; sig: string }`.
  - `guestCardHash(card: { term: string; definition: string }): string` (sha256 of `term.trim() + '\u0000' + definition.trim()`, hex).
  - `signPoints(card, points, secret): SignedPoints`. HMAC over `cardHash + '\n' + JSON.stringify(points)`.
  - `verifyPoints(card, signed: unknown, secret): GuestPoint[] | null`. Zod-parses the shape first, recomputes `cardHash` from `card`, then compares signatures in constant time.

- [ ] **Step 1: Write failing tests.** A signed set verifies. Each of these returns `null`: changed point text, a point added, the card's definition edited, a different secret, and a malformed object (`{}`, `null`, `sig` not a string).
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): server-signed key points for guest cards`.

### Task 6: Demo AI actions

**Files:**
- Create: `src/lib/demo/demo-set.ts`, `src/actions/demo.ts`
- Test: `tests/demo/actions.test.ts`, `tests/demo/source-scan.test.ts`

**Interfaces:**
- Consumes: Tasks 3–5; `generateJson`, `resolveTaskModel` (`src/lib/ai/generate.ts`); `readableSetWhere(null)`; `parseOptionCache`, `fallbackOptions`, `planRun` (as used in `src/actions/games.ts`); `pickHotSeatCards`, `HOT_SEAT_MODES`, `personaForSubject`; `STATUS_CREDIT`.
- Produces (`demo-set.ts`, server-only): `loadDemoSet(): Promise<DemoSet | null>`, where `DemoSet = { id; title; subject; cards: { id; term; definition; categories: { name; color }[]; klps: { id; text; weight; kind; role }[] }[] }`. It uses `readableSetWhere(null)` and only live points (`supersededAt: null`). Also `isDemoCard(cardId: string): Promise<boolean>`.
- Produces (`src/actions/demo.ts`, `'use server'`). Every export returns `DemoResult<T> = { ok: true; data: T } | { ok: false; reason: DemoRefusal | 'invalid' | 'ai_failed'; message: string }`. **Every export calls `guestContext()` first**, and when it returns `null` the export returns `demo_off`.
  - `demoGrade(input: { kind: 'demo'; cardId: string; answer: string } | { kind: 'guest'; card: { term; definition }; points: SignedPoints; answer: string }): DemoResult<{ grade: ShortAnswerGrade; verdicts: KlpVerdict[]; accuracy: number; generatedPoints: boolean }>` (feature `grade`). Demo cards grade against their live points. Guest cards grade against `verifyPoints(...)`, and a failed verification is `invalid`. The prompt is `GRADE_SHORT_ANSWER_PROMPT.build({ card, answer, klps })` with `ShortAnswerGradeSchema`. Verdicts and accuracy are computed in TS as in `gradeGameAnswer`. Move `accuracyOf`/`isHit` out of `src/actions/games.ts` into `src/lib/games/grading.ts` (exported, same bodies) and import them from both places.
  - `demoExtractPoints(input: { card: { term; definition } }): DemoResult<SignedPoints>` (feature `klp-extract`, one card per call). `EXTRACT_KLPS_PROMPT.build({ setTitle: 'My demo cards', cards: [{ ref: 0, ...card }] })` with `KlpExtractionSchema`. If `cards[0]` is missing, that's `ai_failed` (release).
  - `demoGauntletRun(): DemoResult<RunPlan & { cards: { id; term; definition }[] }>`. Runs `startRun('gauntlet')`, then `planRun({ cards, memory: [], seed, mode: 'mc' })` over the demo set.
  - `demoGauntletOptions(cardId: string, ask: 'term' | 'definition'): DemoResult<{ options: string[]; correct: string; source: 'ai' | 'fallback' }>`. The card must be a demo card. `ask === 'definition'` gives fallback. Otherwise read `QuizOptionCache` under `resolveTaskModel(aiUserId, 'distractors')`: a hit costs nothing and needs no reservation. A miss reserves a `gauntlet` call and generates as `gauntletOptions` does, **without writing the cache**. A refusal returns fallback options with `source: 'fallback'` (the game still plays).
  - `demoStartHotSeat(): DemoResult<{ cards: HotSeatCard[]; persona: Persona; costume: string }>`. Runs `startRun('hot-seat')`, then `pickHotSeatCards` over demo cards that have points (`'normal'` mode).
  - `demoGradeGameAnswer(cardId: string, answer: string, opts?: { klpIds?: string[] }): DemoResult<{ hit: boolean; accuracy: number; verdicts: KlpVerdict[] }>`. Reserves a `hot-seat` call. Demo cards only.
  - `demoProbeHotSeat(cardId: string, missedKlpId: string, answer: string, persona: Persona): DemoResult<{ question: string }>`. Reserves a `hot-seat` call. The point must belong to the card.
  - `demoAutocomplete(input: { currentText: string; side: 'term' | 'definition'; referenceText?: string; cards: { term; definition }[] }): DemoResult<{ suggestions: string[] }>` (feature `autocomplete`). `AUTOCOMPLETE_PROMPT.build({ set: { title: 'My demo cards', cards }, currentText, side, categories: [], referenceText })`, with at most 5 `cards`.
  - **Pattern for each AI call:** `reserveCall` → `try { generateJson({ userId: config.aiUserId, task, schema, prompt }) } catch { releaseCall; return ai_failed }`. Messages: `quota_used` → "You've used this in the demo.", `demo_cap` → "The demo is busy today.", `demo_off` → "The demo is switched off right now.".

- [ ] **Step 1: Write failing tests** (`vi.mock` the guard, `@/lib/db`, `@/lib/ai/generate` and `next/headers`):
  - `guestContext` null → every export returns `demo_off`, and `generateJson` is never called. Use `it.each` over all 8 exports.
  - `demoGrade({kind:'demo', cardId:'not-demo'})` → `invalid`, with no reservation and no AI call (Review Focus 2). The same goes for `demoGauntletOptions`, `demoGradeGameAnswer` and `demoProbeHotSeat`.
  - `demoGrade` with a guest card and tampered points → `invalid`, with no reservation (Review Focus 3).
  - `generateJson` rejects → `ai_failed`, and `releaseCall` is called once with the ticket id (Review Focus 5).
  - `reserveCall` gives `quota_used` → that refusal comes back and there's no AI call.
  - An answer of 2,001 chars → `invalid`.
  - `demoGauntletOptions` with a cache hit → `source:'ai'`, and neither `reserveCall` nor `generateJson` is called. With a miss → `generateJson` is called once and `prisma.quizOptionCache.upsert` is **not** called.
  - `demoGrade` on a demo card passes the live points (in index order) to the prompt and returns `generatedPoints:false`. On a guest card it returns `generatedPoints:true`.
- [ ] **Step 2: Write `tests/demo/source-scan.test.ts`:**
  - In `src/actions/demo.ts`, every `export async function` body contains `guestContext(` before its first `generateJson(` and before any `reserveCall(`.
  - The file contains no `.create(`, `.upsert(`, `.update(` or `.delete(` on any model except through `@/lib/demo/guard` or `@/lib/demo/waitlist` (Task 12).
  - `src/middleware.ts` contains no `/demo` matcher entry, and `isProtectedPath('/demo')` is false.
- [ ] **Step 3: Run** `npx vitest run tests/demo`. Expected: FAIL.
- [ ] **Step 4: Implement** `src/lib/games/grading.ts`, `demo-set.ts` and `src/actions/demo.ts`. Re-point `src/actions/games.ts` to the shared `accuracyOf`/`isHit`.
- [ ] **Step 5: Run** `npx vitest run tests/demo tests/games`. Expected: PASS, with no change to the games tests.
- [ ] **Step 6: Commit** `feat(demo): guarded demo AI actions on the operator's keys`.

### Task 7: Games take an injectable API

**Files:**
- Modify: `src/components/games/GauntletGame.tsx`, `src/components/games/HotSeatGame.tsx`
- Create: `src/lib/games/api.ts`
- Test: `tests/components/game-api-injection.test.tsx`

**Interfaces:**
- Produces: `GauntletApi = { buildRun(setId: string, mode: GauntletMode): Promise<Result<…>>; options(cardId, ask): Promise<Result<…>>; grade(cardId, answer, opts?): Promise<Result<…>>; submitScore(input): Promise<Result<{ saved: boolean }>> }` and `HotSeatApi = { start(setId, mode); grade(cardId, answer, opts?); probe(cardId, klpId, answer, persona); submitScore(input) }`. Here `Result<T> = { success: true; data: T } | { success: false; error: string }`, the existing `ActionResult` shape. `src/lib/games/api.ts` exports `realGauntletApi` and `realHotSeatApi`, which wrap the existing actions. Both components gain an optional `api` prop that defaults to the real one. `GauntletGame` also gains optional `aiLabel?: string`, shown in place of `CredentialNote` when set.
- Demo adapters live in Task 11 and map `DemoResult` to `Result`: `ok:false` becomes `{ success:false, error: message }`, and `submitScore` resolves `{ success: true, data: { saved: false } }` without a call.

- [ ] **Step 1: Write failing tests.** Render `GauntletGame` with a fake `api` and start a run. `fake.buildRun` is called and the real `@/actions/games` mock is not. Render with no `api` prop and the real mock is called (default unchanged). Do the same pair for `HotSeatGame`'s `start`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** by replacing direct action calls with `api.*`. No other behaviour changes. **Step 4: Run** `npx vitest run tests/components tests/games`. Expected: PASS.
- [ ] **Step 5: Commit** `refactor(games): Gauntlet and Hot Seat take an injectable API (default unchanged)`.

### Task 8: Guest browser store

**Files:**
- Create: `src/lib/demo/store.ts`
- Test: `tests/demo/store.test.ts`

**Interfaces:**
- Produces: `DEMO_STORE_KEY = 'synapse-demo:v1'`, and the type `GuestState = { set: { title: string; cards: { id: string; term: string; definition: string; points?: SignedPoints }[] } | null; quizzesStarted: number; used: Partial<Record<DemoFeature, true>> }`.
  - `loadGuestState(storage?: Storage | null): GuestState`. Returns the empty state on a missing key, bad JSON, a wrong shape, or a `getItem` that throws.
  - `saveGuestState(state, storage?)`. Swallows errors.
  - Pure transitions, each returning `{ ok: true; state } | { ok: false; limit: 'cards' | 'sets' | 'quizzes' }`: `createGuestSet(state, title)`, `addGuestCard(state, { term, definition })` (refuses past 5, and refuses blank term or definition with `limit` absent: `{ ok:false; invalid: true }`), `editGuestCard(state, id, patch)` (keeps `points`), `startGuestQuiz(state)` (refuses past 1).
  - `markUsed(state, feature)`.
  - `useGuestState()`: a React hook that keeps the state in memory when storage throws (Review Focus 4).

- [ ] **Step 1: Write failing tests.**
  - A 6th card gives `{ok:false, limit:'cards'}`. A second set gives `limit:'sets'`. A second quiz gives `limit:'quizzes'`.
  - An editing a card keeps its `points`.
  - `loadGuestState` with a storage whose `getItem` throws returns the empty state, and `saveGuestState` with a throwing `setItem` doesn't throw.
  - A round-trip through a Map-backed fake storage preserves the state.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): guest state in browser storage with demo limits`.

### Task 9: `/demo` layout, home, set, create, review

**Files:**
- Create: `src/app/demo/layout.tsx`, `src/app/demo/page.tsx`, `src/app/demo/set/page.tsx`, `src/app/demo/create/page.tsx`, `src/app/demo/review/page.tsx`
- Create: `src/components/demo/DemoShell.tsx` (top bar: logo, "Demo" badge, allowance summary, "Request an invite" text button), `src/components/demo/GuestCardBuilder.tsx`, `src/components/demo/DemoReview.tsx`, `src/components/demo/DemoUnavailable.tsx`
- Test: `tests/components/demo-pages.test.tsx`

**Interfaces:**
- Consumes: `loadDemoSet` (Task 6), `useGuestState` and transitions (Task 8), `demoAutocomplete` (Task 6), `FlashcardCarousel` (existing; pass guest cards with `id`/`term`/`definition`), and `WaitlistPrompt` (Task 12; until then, import a placeholder that renders nothing: `src/components/demo/WaitlistPrompt.tsx` exporting `WaitlistPrompt({ open, onOpenChange, reason }: { open: boolean; onOpenChange: (o: boolean) => void; reason: string })`).
- `/demo` (home): the demo set's title and card count, four tiles (Flashcards → `/demo/set`, Make a card → `/demo/create`, Take the quiz → `/demo/quiz`, Play a game → `/demo/games`), and an allowance list from `GuestState.used` ("Graded answer: 1 left / used", etc.). The same allowance summary appears in `DemoShell` as "Demo · n of 5 tries used".
- Server pages call `loadDemoSet()`. If it returns `null`, or `readDemoConfig().enabled` is false, they render `<DemoUnavailable />` ("The demo isn't available right now. Browse published sets →" linking to `/browse`).
- `/demo/set`: the carousel over demo cards plus guest cards (guest cards labelled "Yours"), a category filter (reuse `filterCardsByCategories`), and each demo card's key points listed under the card.
- `/demo/create`: `GuestCardBuilder` with title + term + definition fields and an "AI suggest" button per field that calls `demoAutocomplete` once. After it's used, the button shows "Used in the demo" and clicking opens `WaitlistPrompt` with reason `'autocomplete'`. A 6th card opens `WaitlistPrompt` with reason `'cards'`.
- `/demo/review`: a Review loop over the demo set. Flip, then "Know it" / "Don't know" adjusts a per-card confidence (start 5, ±1, clamped 1–10) shown as a number. "Don't know" re-queues the card. State is in memory only; **no server call**.

- [ ] **Step 1: Write failing tests** (mock `@/actions/demo`):
  - The builder adds 5 cards, and the 6th click opens the prompt with `reason='cards'`. A blank definition shows an inline error.
  - The AI suggest button calls `demoAutocomplete` once. A second click opens the prompt and makes no second call.
  - `DemoReview`: "Don't know" on card A moves it to the end of the queue and its confidence goes 5 → 4. "Know it" on a card at 10 stays 10.
  - `DemoUnavailable` renders a link to `/browse`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): demo home, set view, guest card builder, review`.

### Task 10: `/demo/quiz` — one question, graded, with the generated-points warning

**Files:**
- Create: `src/app/demo/quiz/page.tsx`, `src/components/demo/DemoQuiz.tsx`, `src/components/demo/DemoVerdicts.tsx`, `src/components/demo/GeneratedPointsWarning.tsx`
- Test: `tests/components/demo-quiz.test.tsx`

**Interfaces:**
- Consumes: `demoGrade`, `demoExtractPoints` (Task 6); `startGuestQuiz` (Task 8); `GradeCard` (existing; takes `{ grade: ShortAnswerGrade }`); `WaitlistPrompt`.
- `DemoQuiz` steps:
  1. **Setup:** source = "Demo set" (default) | "My cards" (disabled when there are no guest cards), plus a category filter for the demo set. Short answer only, and the screen says "1 question".
  2. **Start:** `startGuestQuiz`. If refused, open the prompt with `'quizzes'`. Then pick one card at random from the source.
  3. **For a guest card without `points`:** call `demoExtractPoints`, store the signed points on the card, and show `GeneratedPointsWarning` above the question.
  4. **Submit:** call `demoGrade`. Render `DemoVerdicts` (each point: text + status chip + quoted evidence when present) and `GradeCard`, plus `GeneratedPointsWarning` again when `generatedPoints`.
  5. **"Next question" / "New quiz":** open the prompt with `'questions'` / `'quizzes'`.
- `GeneratedPointsWarning` copy (exact): **"These key points were generated instantly for your card. In the full app, key points are written and tested against deliberately wrong answers before they're used for grading, so expect these to be rougher."**
- A refusal (`quota_used` / `demo_cap` / `demo_off`) opens the prompt with the refusal as `reason`. `ai_failed` shows "The demo is having trouble. Try again." and keeps the answer.

- [ ] **Step 1: Write failing tests** (mock `@/actions/demo`):
  - A demo-set quiz shows exactly one question with no "Next" until graded. After grading, the verdict rows render statuses from the mock and "Next question" opens the prompt.
  - A guest-card quiz calls `demoExtractPoints` before showing the question, renders the warning text exactly, and passes the returned `SignedPoints` to `demoGrade`.
  - The second "New quiz" opens the prompt with `'quizzes'`.
  - `ai_failed` keeps the typed answer and shows the retry message.
  - `demo_cap` opens the prompt with `reason='demo_cap'`.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): one-question graded quiz with generated-points warning`.

### Task 11: `/demo/games`

**Files:**
- Create: `src/app/demo/games/page.tsx`, `src/app/demo/games/gauntlet/page.tsx`, `src/app/demo/games/hot-seat/page.tsx`, `src/lib/demo/game-adapters.ts`
- Test: `tests/demo/game-adapters.test.ts`

**Interfaces:**
- Consumes: `GauntletApi`/`HotSeatApi` (Task 7), the demo actions (Task 6), `loadDemoSet`.
- Produces: `demoGauntletApi: GauntletApi` and `demoHotSeatApi: HotSeatApi`, which map `DemoResult` to `Result` (`submitScore` resolves `{ success:true, data:{ saved:false } }` with no call). A `quota_used` from `buildRun`/`start` comes back as `{ success:false, error:"You've used this in the demo." }`. The page wraps the game so that this error opens `WaitlistPrompt` (an `onRefused` callback passed through the adapter factory: `makeDemoGauntletApi(onRefused: (r: DemoRefusal) => void)`).
- `/demo/games`: tiles for **Gauntlet (AI options, once)** → `/demo/games/gauntlet` and **Hot Seat (once)** → `/demo/games/hot-seat`, plus **Blitz**, **Crossword** and **Match** linking to the existing `/sets/${DEMO_SET_ID}/games/blitz`, `/sets/${DEMO_SET_ID}/games/crossword` and `/sets/${DEMO_SET_ID}/match` (unlimited, they already work signed out).
- Gauntlet page: `<GauntletGame setId={demoSet.id} signedIn={false} api={demoGauntletApi} aiLabel="Demo · AI-written options, one run" />`. Hot Seat page: `<HotSeatGame … api={demoHotSeatApi} />` with the props that `src/app/sets/[id]/games/hot-seat/page.tsx` passes, minus sign-in.

- [ ] **Step 1: Write failing tests:**
  - The adapter maps `{ok:true,data}` to `{success:true,data}`.
  - `{ok:false, reason:'quota_used'}` becomes `{success:false}` and calls `onRefused('quota_used')`.
  - `submitScore` makes no action call.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(demo): demo games — AI Gauntlet and Hot Seat once, other games linked`.

### Task 12: Waitlist prompt, `requestInvite`, `notifyOwner`

**Files:**
- Create: `src/lib/demo/waitlist.ts`, `src/lib/notify/owner.ts`
- Modify: `src/components/demo/WaitlistPrompt.tsx` (replaces the Task 9 placeholder), `src/actions/demo.ts` (add `requestInvite`)
- Test: `tests/demo/waitlist.test.ts`, `tests/components/waitlist-prompt.test.tsx`

**Interfaces:**
- Produces:
  - `normalizeEmail(raw: string): string | null` (trim, lower-case, Zod `.email()`, ≤ 254).
  - `recordInviteRequest(input: { email: string; note: string | null; ipHash: string }, now?: Date): Promise<{ status: 'added' | 'already' } | { status: 'rate_limited' }>`. Refuses after 5 requests from one `ipHash` since `utcDayStart`. An existing email updates `lastRequestedAt` and returns `'already'`.
  - `requestInvite(input: { email: string; note?: string }): DemoResult<{ status: 'added' | 'already' }>`, a `'use server'` export in `src/actions/demo.ts`. Uses `guestContext()`, and null → `demo_off`. On `'added'` it calls `notifyOwner({ kind: 'waitlist_request', email, note })` inside `after()`.
  - `notifyOwner(event: OwnerEvent): Promise<void>`, where `OwnerEvent = { kind: 'waitlist_request'; email: string; note: string | null }`. It must never throw. It sends to `feedbackRecipient()` through the existing mail transport, falling back to the console transport when `RESEND_API_KEY` is absent. Add `ownerNotificationTemplate(event)` to `src/lib/mail/templates.ts` and `sendOwnerNotification(event)` to `src/lib/mail/send.ts` (the `sendQuietly` pattern). Put a comment on `notifyOwner` saying it's the single seam where CallMeBot/WhatsApp plugs in later (spec §5.6).
- `WaitlistPrompt` props: `{ open; onOpenChange; reason: 'cards' | 'sets' | 'quizzes' | 'questions' | DemoFeature | DemoRefusal }`. The heading comes from the reason: `quota_used`/feature → "You've used your free try of this", `demo_cap` → "The demo is busy today", limits → "You've reached the demo's limit". Then there are three lines on what an account adds (unlimited quizzes; memory that brings back what you miss; key points tested properly on your own cards), an email field, an optional "What are you preparing for?" field, a **"Request an invite"** button, and the secondary text "Already have an invite? Sign up · Sign in" (links to `/signup` and `/login`). Success shows "You're on the list. We'll email you an invite." and `'already'` shows "You're already on the list."

- [ ] **Step 1: Write failing tests:**
  - `normalizeEmail('  A@B.co ')==='a@b.co'` and `normalizeEmail('nope')===null`.
  - `recordInviteRequest`: the 6th request from one IP is `rate_limited`. A repeat email is `'already'` and updates `lastRequestedAt`.
  - `notifyOwner` resolves even when the transport throws.
  - Prompt: submitting calls `requestInvite` with the email and note and shows the success text. An invalid email shows an inline error with no call. `reason='demo_cap'` shows "The demo is busy today".
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run tests/demo tests/components/waitlist-prompt.test.tsx`. Expected: PASS (including the Task 6 source scan, which allows `@/lib/demo/waitlist`).
- [ ] **Step 5: Commit** `feat(demo): Request-an-invite waitlist and the notifyOwner seam`.

### Task 13: Admin waitlist page + invite from the waitlist

**Files:**
- Create: `src/app/(app)/staff/waitlist/page.tsx`, `src/components/staff/WaitlistTable.tsx`, `src/actions/waitlist.ts`, `src/lib/invites/mint.ts`
- Modify: `src/app/(app)/staff/StaffNav.tsx` (admin tabs: add `{ href: '/staff/waitlist', label: 'Waitlist' }`), `src/app/(app)/staff/page.tsx` (admin-only tile "Waitlist (pending)"), `scripts/mint-invite.ts` (`--requests`, `--for <email>`; use `mintInvite`)
- Test: `tests/staff/waitlist.test.ts`, `tests/invites/mint.test.ts`

**Interfaces:**
- Produces:
  - `mintInvite(input: { uses: number; days?: number; label?: string | null }): Promise<{ code: string }>` in `src/lib/invites/mint.ts`. This is the body currently inline in `scripts/mint-invite.ts`, moved, and the script calls it.
  - `inviteFromWaitlist(requestId: string): Promise<ActionResult<{ code: string; emailed: boolean }>>`, `'use server'`. Starts with `requireAdmin()`, and null → `{ success:false, error:'Not found' }`. It refuses a request that's already invited. It mints `{ uses: 1, days: 14, label: 'waitlist: <email>' }`, sets `invitedAt` and `inviteCode`, and emails the code through a new `sendInviteEmail(to, code)` when `RESEND_API_KEY` is set (returning `emailed`).
  - `listWaitlist(filter: 'pending' | 'invited' | 'all'): Promise<WaitlistRow[]>` (server-only, in `src/lib/demo/waitlist.ts`), newest first.
- The page: `requireAdmin()` or `notFound()`. Filter tabs; a table with email, note, requested, last requested and status; and an "Invite" button on pending rows that calls the action and then shows the formatted code with a copy button.
- Script: `--requests` prints pending requests. `--for <email>` mints for that request (normalises the email, errors if there's no such request or it's already invited) and stamps it.

- [ ] **Step 1: Write failing tests:**
  - `inviteFromWaitlist`: with `requireAdmin` null, it returns `'Not found'` and nothing is written. As admin, it creates exactly one `inviteCode` with `maxUses:1` and sets `invitedAt`. A second call on the same request returns an error and mints nothing.
  - `mintInvite({uses:1, days:14})` sets `expiresAt` 14 days out and `usesRemaining === maxUses`.
  - `listWaitlist('pending')` excludes invited rows.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(staff): admin waitlist page with one-click single-use invites`.

### Task 14: Pre-fill the demo set's option cache

**Files:**
- Create: `scripts/demo-prefill-options.ts`
- Modify: `package.json` (`"demo:prefill": "tsx --conditions=react-server --env-file=.env scripts/demo-prefill-options.ts"`)

**Interfaces:**
- Consumes: `readDemoConfig`, `loadDemoSet`, `resolveTaskModel`, `MULTIPLE_CHOICE_PROMPT`, `MultipleChoiceKlpSchema`, `prisma.quizOptionCache`.
- Behaviour: for each demo card with no cache row under `resolveTaskModel(aiUserId, 'distractors')`, it generates options exactly as `gauntletOptions` does (KLP path when the card has points) and upserts the cache. It prints `n generated, m already cached`, and `--dry-run` only counts. It runs inside `main()` with no top-level await (BUILD-QUEUE trap 4), and the operator runs it. It's not a guest path, so it has no guard.

- [ ] **Step 1:** Implement the script, then run `npm run demo:prefill -- --dry-run`. Expected: it prints counts and makes no AI call. (If `DEMO_SET_ID`/`DEMO_AI_USER_ID` aren't set locally, it exits with the message `"DEMO_SET_ID and DEMO_AI_USER_ID must be set"`. That counts as the expected output.)
- [ ] **Step 2: Commit** `feat(demo): operator script to pre-fill the demo set's option cache`.

### Task 15: Config, docs, full verification, live gate

**Files:**
- Modify: `.env.example` (the six variables, each with a comment from spec §8), `README.md` (a "Guest demo" paragraph under Features and the variables under Getting started), `docs/superpowers/BUILD-QUEUE.md` (a dated entry: what shipped, the owed live gate, CallMeBot later), `CLAUDE.md` (one paragraph under "Decided stack": `/demo` sits outside the gate, guest AI bills `DEMO_AI_USER_ID`, and the only guest writes are `DemoTicket`/`InviteRequest`)

- [ ] **Step 1: Run the full suite.**
  - `npx vitest run`: everything passes, and the count is the 4,449 baseline plus the new tests.
  - `npx tsc --noEmit`: clean.
  - `npm run lint`: 178 problems or fewer.
- [ ] **Step 2: Live DB concurrency check.** Write `scripts/verify-demo-guard.ts`. It fires two `reserveCall` calls for one fresh guest on `grade` with `Promise.all` against the real DB, asserts exactly one `ok`, then deletes the ticket. Expected output: `1 ok, 1 quota_used`.
- [ ] **Step 3: Live gate**, signed out, with `NEXTAUTH_SECRET=dev-only AUTH_SECRET=dev-only DEMO_ENABLED=true NEXT_PUBLIC_DEMO_ENABLED=true DEMO_SET_ID=<M&A set id> DEMO_AI_USER_ID=<owner id> npm run dev`:
  1. On the landing page, click the "Graded point by point" chapter and confirm the video seeks to 0:29.
  2. Click "Try it" and land on `/demo/quiz`.
  3. Answer a demo-set question and confirm the graded verdicts appear.
  4. Start a "New quiz" and confirm the prompt appears.
  5. Go to `/demo/create`, add a card, and run a quiz on "My cards". Confirm the warning and a grade (needs a fresh guest cookie: clear the cookie, then expect the per-IP limit to allow it).
  6. Play Gauntlet once, then confirm a second run brings up the prompt.
  7. Submit a waitlist email, then confirm it appears at `/staff/waitlist` when signed in as admin, and that "Invite" shows a code.
  8. Restart with `DEMO_DAILY_CAP=1` and confirm "The demo is busy today".
  Record each step's outcome in the BUILD-QUEUE entry. Anything that needs a real inbox or production goes to the owner as an explicit gate.
- [ ] **Step 4: Commit** `docs: guest demo — env, README, BUILD-QUEUE handoff, CLAUDE.md`.
