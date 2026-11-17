# Interactive demo video + guest demo (no account) — design

**Date:** 2026-11-17 · **Owner decisions taken in conversation** · **Status:** draft for owner approval

## 1. Intent

A first-time visitor to synapsehq.org can't currently feel the product. Every feature that makes
it different (written answers graded point by point, AI options, Hot Seat) sits behind an
invite-only account. The owner recorded a 60-second demo video (`synapseHQ_demo.mp4`, repo root,
commit `a34a426`) and wants two things:

1. **The video on the landing page, interactive.** A visitor clicks through it by feature and
   can jump from any feature into a hands-on try.
2. **A hands-on demo with no login.** A visitor can browse a flashcard set, **create cards**, take
   **one quiz with one question**, and try **every AI feature once** (Gauntlet included). Doing
   any of those a second time brings up a prompt to create an account.

Success: a visitor goes from the video to a graded answer of their own in under two minutes,
without signing up, and then meets a sign-up prompt at a point where they want more.

## 2. Goals, non-goals, anti-goals

**Goals**
- A chaptered video in the landing hero, with a "Try it" link into the demo for each chapter.
- A `/demo` area that works signed out: a curated demo set, a guest card builder, a one-question
  quiz, the AI features once each, and the existing games.
- Guest AI paid by one operator-designated account, with a hard daily cap across all guests.
- Server-side "once each" enforcement for anything that spends AI.
- A "Request an invite" waitlist at every limit (§5.6). *(Importing demo cards on sign-up is
  deferred, §5.7.)*

**Non-goals**
- Guest data in the database (no guest `User` rows, sets, cards, quiz attempts or study events).
  Guest content lives only in the visitor's browser.
- Changing the real app's auth gate. `src/middleware.ts` and `src/lib/auth/gate.ts` keep
  protecting the real routes exactly as today. The demo is a separate route tree.
- Memory, confidence history, leaderboards or mastery for guests. The demo *shows* the confidence
  feature but writes nothing.
- Voice (not built).

**Anti-goals (a failure even if it "works")**
- A guest endpoint that works as a free general-purpose LLM proxy. Every guest AI call has a
  fixed prompt, a Zod schema, a length cap on guest input, and a quota.
- Uncapped spend. With no daily cap, one script could drain the operator's balance.
- A guest-reachable `'use server'` export that writes to the database, or that takes a database
  id without re-checking it is the demo set. Server-action exports are public endpoints (see
  memory "use-server exports are endpoints").
- Generated key points on a guest card presented as being as good as authored ones (§5.3).
- Any change that weakens a real route's sign-in requirement.

## 3. Decisions taken (owner, 2026-11-17)

| # | Decision | Chosen |
|---|---|---|
| D1 | Video presentation | **Chapters + "Try it"**: video in the hero, clickable chapter list beside it; each chapter jumps the video and offers "Try it yourself →" into the demo |
| D2 | Demo shape | **Browser sandbox**: guest content in browser storage, nothing persisted server-side except quota counters |
| D3 | Who pays for guest AI | **An operator demo account with a daily cap**: calls bill that account's `AiCredential` pool, like the nightly cron bills `CRON_AUTHOR_USER_ID` |
| D4 | Limit enforcement | **Server-side** for AI: signed guest cookie + per-IP counter + global daily cap |
| D5 | Grading a guest's own card | **Both**: demo-set questions grade against the authored key points; a guest's own card gets key points generated on the spot by the single-pass extractor, **with a visible warning** that they are rougher than authored ones |

## 4. The video (D1)

**Asset.** Move `synapseHQ_demo.mp4` (1920×1080, H.264, 60.3 s, 4.6 MB) from the repo root to
`public/demo/synapseHQ_demo.mp4`, and generate a poster still (`public/demo/poster.jpg`, from a
frame showing the product). 4.6 MB is fine as a static asset. The page preloads metadata only
(`preload="metadata"`), never the whole file. *(Builder's call: re-encode smaller if needed; a
720p version could be about 1.5 MB.)*

**Chapters.** Read off the video's own captions (verified frame by frame):

| Start | Chapter (caption) | Sub-caption | "Try it" target |
|---|---|---|---|
| 0:00 | Built for finance interview prep | Flashcards, written tests, games and study groups in one place | `/demo` |
| 0:09 | 82 M&A questions, tagged | Filter to must-know, technical or niche | `/demo/set` (flashcards, category filter) |
| 0:16 | Build a written test | Short answer, filtered by category | `/demo/quiz` (setup) |
| 0:21 | Write the answer in your own words | No multiple choice to lean on | `/demo/quiz` (question) |
| 0:29 | Graded point by point | Each key idea marked covered, partial or missed | `/demo/quiz` |
| 0:37 | Scored on clarity, concision and correctness | Plus one targeted fix for next time | `/demo/quiz` |
| 0:46 | Confidence from 1 to 10 | Cards you miss come back until you know them | `/demo/review` |
| 0:50 | Games built from your set | Gauntlet, Hot Seat, Blitz, Crossword and Match | `/demo/games` |
| 0:55 | (end card: synapsehq.org) | | — |

The chapter list is a static constant (one module). Timestamps are data, not markup, so
re-cutting the video means editing one array.

**Behaviour.**
- Hero layout: video left, chapter list right on desktop; chapters stack under the video on
  mobile (16px gutters, no horizontal scroll).
- Clicking a chapter sets `currentTime` and plays. The chapter list highlights the active
  chapter from `timeupdate`.
- Each chapter row has a "Try it →" link to its target. Following one pauses the video.
- The chapters are also emitted as a WebVTT `chapters` track, and the burned-in captions are
  restated as a text list for screen readers (the video has no audio narration to caption).
- Muted autoplay is **off**. The video plays on click. Respect `prefers-reduced-motion`.

**Landing constraints that stay.** `Landing.tsx` must keep **no data fetching** (a test scans
for a DB import) and **one primary call to action**. The video area adds "Try the demo" as the
secondary action, a text link like "Browse published sets", not a second primary button.
`isSignupOpen()` still decides whether the primary button is Sign up or Sign in.

## 5. The guest demo (D2)

### 5.1 Routes

A new public route tree, **`/demo`**, outside `(app)` and outside the middleware matcher. It
needs no session and must render correctly with one. A signed-in visitor may use the demo;
their account is unaffected and their own AI keys are **not** used.

| Route | What the guest does |
|---|---|
| `/demo` | Demo home: the demo set, "Make your own card", "Take a quiz", "Play a game", and what's left of their allowance |
| `/demo/set` | Flashcards for the demo set plus the guest's own cards, category filter, key points visible on demo-set cards |
| `/demo/create` | Guest card builder: one guest set, term + definition, AI autocomplete once |
| `/demo/quiz` | Quiz setup → one short-answer (or multiple-choice) question → AI grading |
| `/demo/review` | Review mode over the demo set: flip, Know it / Don't know, confidence shown changing, **in browser state only** |
| `/demo/games` | Gallery linking to the games; AI games use the demo endpoints (§5.4) |

### 5.2 The demo set

- Configured by `DEMO_SET_ID` (env). It must be a set whose visibility makes it readable
  signed out (`readableSetWhere(null)`), with authored key points. The owner's choice is
  expected to be the **M&A set** shown in the video. *(Guess: confirm the id at build time.)*
- Server components load it with `readableSetWhere(null)`. If `DEMO_SET_ID` is unset or not
  readable, `/demo` renders a "demo unavailable" state, and the landing hides "Try it" links
  (the landing can't check the DB, so it reads a build-time env flag; see §8).
- The non-AI games (Blitz, Crossword, Match, and Gauntlet multiple choice with plain options)
  **already work signed out on a public set**. `/demo/games` links to them on the demo set as
  they are, unlimited.

### 5.3 Guest content (browser only)

- Stored in `localStorage` under one versioned key (e.g. `synapse-demo:v1`): the guest set
  (title + cards), generated key points per guest card, quiz progress, and **client-side
  copies** of the counters for display.
- Wrapped in try/catch. With storage blocked, the demo still works for one page view.
- **Limits on content** (my call; the owner said "about 1 of each thing"): **one** guest set,
  **up to 5 cards** (a game needs a few; one card is too thin to demo a set), term ≤ 200 chars,
  definition ≤ 1,000 chars. Adding a 6th card brings up the sign-up prompt.
- **Generated key points (D5).** When a guest quizzes on or plays an AI game with their own card,
  the server generates key points for that card first via the existing single-pass extractor
  (`src/lib/ai/prompts/extract-klps.ts`, task `klp-extract`). They are shown with a persistent
  warning, something like: *"These key points were generated instantly for your card. In the
  full app, key points are written and tested against deliberately wrong answers before anyone
  is graded on them, so expect these to be rougher."* Generated points are cached in the guest's
  browser storage so a second grade on the same card doesn't regenerate them.

### 5.4 AI features: each once per guest

Every guest AI call goes through **one server module** (`src/lib/demo/`), exposed through
either one route handler (`/api/demo/[feature]`) or dedicated `'use server'` actions. Either
way, every entry point runs the same guard first (§6). They reuse the **existing prompt
builders and Zod schemas**. No new prompts. They call `generateJson` with
`userId = DEMO_AI_USER_ID`.

| Feature (allowance key) | Once means | Input from guest | Source of card content |
|---|---|---|---|
| `grade` | one short-answer grade | answer text (≤ 2,000 chars) | demo-set card id (server loads it and its live key points), **or** a guest card inline (term/definition + its generated points) |
| `klp-extract` | key points for guest cards, **one batch** covering up to all 5 guest cards | guest cards inline | inline |
| `distractors` | AI multiple-choice options for one question | — | demo-set card (use the cached options if present, which costs no AI), or a guest card inline |
| `gauntlet` | one AI-backed Gauntlet run: AI options per card **and** short-answer swings, capped at the run length | answers | demo set and/or guest cards |
| `hot-seat` | one Hot Seat run, capped at the run's rounds (probe calls included) | answers | demo-set cards with ready key points |
| `autocomplete` | one suggestion | partial term/definition | inline |

Rules:
- **A demo-set id is re-checked server-side** against `DEMO_SET_ID`. A guest can never name any
  other card or set.
- **Inline guest content is never written to the DB.** It goes into the prompt and nowhere else.
- **Nothing persists** except the quota rows (§6) and the normal `AiCallLog` rows that
  `generateJson` writes. These are billed to `DEMO_AI_USER_ID`, so demo spend shows up on
  `/staff/ai-history` and the usage dashboards.
- **Failures don't use up the allowance.** The counter is spent only when the AI call succeeds.
  A provider failure shows "the demo is having trouble, try again" (a classified error from
  `src/lib/errors/classify.ts`, attributed to `system`).
- Every guest-facing AI result shows a small "Demo · 1 of 1 used" chip so the limit is no
  surprise.

### 5.5 The quiz: one quiz, one question

- Setup screen mirrors the real one (mode, side, categories), trimmed to what a single question
  needs: short answer (default) or multiple choice; pick from the demo set or "my cards".
- The quiz always has **exactly one question**. "Add another question" / "Next" brings up the
  sign-up prompt.
- Starting a **second** quiz brings up the sign-up prompt. A quiz counts as started when its
  question is shown.
- The result screen reuses the real short-answer result's presentation (per-key-point verdicts
  with quoted evidence, the clarity/concision/correctness rubric, the targeted fix). It does
  **not** write a `QuizAnswer` or `StudyEvent`.
- The quiz counter is browser-side (it costs nothing). The grade inside it is server-side
  (`grade`).

### 5.6 The sign-up prompt

One shared component (dialog on desktop, bottom sheet on mobile). It names what they just
tried ("You've used your free graded answer"), lists what an account adds (unlimited quizzes,
memory that brings back what you miss, your own key points tested properly), and has one
button. It is shown when:
- a second quiz, a second question, a 6th card or a second guest set is attempted, or
- any AI feature's allowance is spent (server says `quota_used`), or
- the global daily cap is hit (server says `demo_cap`): "The demo is busy today."

**The button is "Request an invite" (owner, 2026-11-17, Q1).** Sign-up stays invite-only and
nothing about `/signup`, `CREDENTIALS_SIGNUP_ENABLED` or `InviteCode` changes. The prompt
collects an **email** (plus an optional one-line "what are you preparing for?"), and a
secondary "Already have an invite? Sign up · Sign in" text link goes to the existing pages.

- **Storage:** a new table (e.g. `InviteRequest`): normalized email (unique; a repeat request
  updates `lastRequestedAt` and says "you're already on the list"), optional note (≤ 200
  chars), `source` (`demo`), the guest's `ipHash`, `createdAt`, and `invitedAt` (null until
  handled). This is the **one** guest-reachable DB write besides quota rows. It goes through
  one server entry point with a Zod-validated email, a per-IP limit (e.g. 5 per day) and the
  `DEMO_ENABLED` switch. §9's "no writes" test allows exactly these two tables.
- **The owner handles requests from the terminal**, matching `npm run invite`'s
  terminal-first rule: `npm run invite -- --requests` lists pending requests, and
  `npm run invite -- --uses 1 --days 14 --for <email>` mints a code and stamps `invitedAt`.
  *(Builder's call: email the code through `src/lib/mail/` when `RESEND_API_KEY` is set;
  otherwise print it for the owner to send.)*
- Optional: notify `FEEDBACK_TO` of each new request through the existing mail path.
- After submitting, the guest sees "You're on the list. We'll email an invite." Their demo
  cards stay in their browser.

### 5.7 Import on sign-up — DEFERRED

**Not built in this pass** (consequence of Q1: guests can't sign up straight away). Guest
cards stay in `synapse-demo:v1` until the guest returns with an invite. The original design,
kept for when it's picked up:

After a guest signs up and signs in, if `synapse-demo:v1` holds guest cards, the home page (or
first signed-in page) shows a one-time banner: "Bring the cards you made in the demo?" →
creates a private set through the existing `createSet` action, then clears the demo storage.
Dismissing it clears the banner (the cards stay in storage until the demo key's expiry). Only
term and definition carry over. Generated key points don't; the real pipeline makes its own.

## 6. Quotas, cost and abuse (D3, D4)

**Guest identity.** A cookie `synapse_demo` holding a random id plus an HMAC signature (keyed
by `NEXTAUTH_SECRET`/`AUTH_SECRET`), HttpOnly, SameSite=Lax, 30-day expiry. It is set by the
first demo AI call if absent. An unsigned or tampered cookie is treated as absent.

**Storage.** A new table (name is the builder's call, e.g. `DemoUsage`): one row per
*successful* AI spend: `guestId`, `ipHash` (sha256 of IP + server salt, never the raw IP),
`feature`, `createdAt`, plus `tokens` if cheaply available. Indexed for the three checks below.
Rows older than ~30 days can be deleted by the existing cron or left; a cleanup is the
builder's call.

**The guard**, run before any guest AI call, in this order:
1. **Kill switch:** `DEMO_ENABLED` must be exactly `"true"`, else `demo_off`. Same convention as
   `CREDENTIALS_SIGNUP_ENABLED`.
2. **Global daily cap:** rows since UTC midnight < `DEMO_DAILY_CAP` (default **300** AI
   spends/day across all guests, about $1–3 at measured prices), else `demo_cap`.
3. **Per guest:** no prior row for (`guestId`, `feature`), else `quota_used`.
4. **Per IP:** no more than `DEMO_PER_IP_FEATURE_LIMIT` (default **3**) rows per (`ipHash`,
   `feature`) per day. Clearing cookies gets a few more tries, not unlimited ones. This is
   deliberately a little loose so a shared office or campus IP isn't locked out after one
   person.

Check-then-spend runs in one transaction, or uses an insert that the uniqueness rule rejects, so
two concurrent clicks can't both spend one allowance (the builder picks the mechanism). The
global cap may be overshot by in-flight calls; that's acceptable.

**Input caps** on every guest field (above), enforced in the Zod input schema server-side, not
just in the UI.

**Billing account.** `DEMO_AI_USER_ID` names the account whose `AiCredential` pool pays (an
explicit id, like `CRON_AUTHOR_USER_ID`, so who pays doesn't change when a role is granted).
Unset → `demo_off`. Task routing and the measured defaults apply as for that account.

## 7. Constraints (from the codebase)

- Credentials provider stays out of `src/auth.config.ts`. The demo doesn't touch auth config.
- Every AI response validated by its existing Zod schema. TypeScript computes everything the
  real app computes (credit, hit/accuracy), the same as `gradeGameAnswer` does.
- `Landing.tsx` keeps no data fetching (`tests/components/landing.test.tsx`).
- Component tests: `// @vitest-environment jsdom` first line + `afterEach(cleanup)`. Mock
  server-action modules in jsdom tests.
- A schema migration is needed (§6 table). `prisma migrate dev` doesn't work from an agent
  shell; use the `migrate diff` → `migrate deploy` route in BUILD-QUEUE.
- No push. The owner pushes.

## 8. Configuration

| Variable | Meaning | Default / unset |
|---|---|---|
| `DEMO_ENABLED` | Master switch for guest AI | off unless `"true"` |
| `DEMO_SET_ID` | The curated demo set | unset → demo shows "unavailable" |
| `DEMO_AI_USER_ID` | Account whose keys pay | unset → guest AI off |
| `DEMO_DAILY_CAP` | Global AI spends per UTC day | 300 |
| `DEMO_PER_IP_FEATURE_LIMIT` | Spends per IP per feature per day | 3 |
| `NEXT_PUBLIC_DEMO_ENABLED` | Lets the static landing show "Try it" links | off unless `"true"` |

All six go in `.env.example` with comments.

## 9. Testing

- Pure guard logic (ordering, each refusal, cookie signature verification, IP hashing): unit
  tests with no DB.
- The concurrency rule (two spends, one allowance) needs a **live DB check**. A mocked
  transaction can't prove it (BUILD-QUEUE trap 8 and memory "live verification catches what
  mocks cannot").
- A source-scan test: every export in `src/lib/demo/` entry points calls the guard before
  `generateJson`. The same idea as the bare-`generateJson` attribution scan.
- A test that no demo entry point imports a write path (`createSet`, `recordStudyEvent`,
  `prisma.*.create` outside the quota table).
- Component tests for the chapter list (click → `currentTime`, active highlight) and the
  sign-up prompt triggers.
- Live gate: signed out, watch → Try it → make a card → one quiz → graded with the warning →
  second quiz → prompt; then the cap by setting `DEMO_DAILY_CAP=1`.

## 10. Left to the builder

Component reuse vs. demo-specific copies of the quiz result / flashcard / builder views;
route handler vs. server actions for `src/lib/demo/`; the quota table's exact shape and
cleanup; video re-encode and poster frame; exact copy for the prompt and warning (tone: plain,
no hype); whether `/demo/review` and `/demo/set` share one page.

## 11. Open questions for the owner

- **Q1 — ANSWERED 2026-11-17: "Request an invite" (waitlist)**, see §5.6. Sign-up is unchanged;
  import-on-sign-up (§5.7) is deferred. Original question: sign-up needs an invite code today
  (`CREDENTIALS_SIGNUP_ENABLED` + `InviteCode`). What should "create an account" mean for a
  demo visitor?

## 12. Settled after the builder check (my calls, owner to confirm on reading)

- **S1. The allowance unit is one feature USE (a "ticket"); the global cap counts AI CALLS.**
  A ticket is spent by the first successful call of that use and then authorizes the rest of
  the run, up to a per-feature call ceiling (Gauntlet: the run's card count; Hot Seat: its rounds
  plus one probe per round). A failed call mid-run neither refunds the ticket nor blocks the next
  call. The quota table therefore records one row per call with a `ticketId`; "per guest" checks
  look for a ticket, the cap counts rows. `DEMO_DAILY_CAP` default becomes **1,000 calls/day**
  (at measured DeepSeek/GLM prices, well under $1).
- **S2. Demo Gauntlet = multiple-choice mode with AI-written options.** Short-answer Gauntlet stays
  sign-in only (20+ grade calls a run, and the graded written answer is already the quiz's job).
  The `distractors` allowance folds into `gauntlet`.
- **S3. The one quiz is short answer only.** The demo quiz has no multiple-choice mode, so the one
  quiz always ends in a graded written answer (§1's success criterion). Multiple choice is
  experienced through Gauntlet. This replaces §5.5's "short answer or multiple choice".
- **S4. No guest endpoint writes the option cache.** An operator script pre-fills
  `QuizOptionCache` for the demo set under `DEMO_AI_USER_ID`'s model, so demo-set options are
  served from cache at no cost; options for guest cards are generated and not cached.
- **S5. `klp-extract` allowance = key points for up to 5 distinct guest cards, each extracted at
  most once.** Keyed by a hash of the card's term + definition; editing a card after extraction
  keeps the old points (with the warning).
- **S6. Generated key points are server-signed.** The extract endpoint returns the points with an
  HMAC over (card hash, points); the grade endpoint accepts guest-card points only with a valid
  signature, so a guest can't grade against points they wrote themselves.
- **S7. A test pins that `/demo` is never in the middleware matcher**, since `isProtectedPath`
  would treat `/demo/quiz` and `/demo/review` as protected.
- **S8. Warning copy stays accurate:** new cards in the real app also start on the single-pass
  extractor until the owner's "Build key points" step or the nightly cron authors them, so the
  warning says demo points are *untested*, not that every real card's points are tested already.
