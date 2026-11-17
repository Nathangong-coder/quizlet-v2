# quizlet-v2

A redesigned Quizlet-style study app with first-class **short-answer** practice, built for finance interview prep (LBOs, M&A, valuation, accounting).

Flashcards and quizzes are only the start. Every card can be broken into **key learning points** (KLPs): small, testable claims that are linked to each other. The AI grader checks a written answer against those points one at a time, so you learn *which* idea you missed or got wrong, not just a score out of 10. That evidence feeds a per-learner memory, which drives review, mastery shading and targeted quizzes.

---

## Features

**Study**
- Sets and cards with an in-app builder, bulk import (`term | definition;` format), search, folders, and colored per-set categories
- Rich cards: images, video and files attached to either side (Vercel Blob)
- Flashcard carousel, Review mode (spaced re-queuing), and quizzes: multiple choice, short answer, true/false and matching, filtered by side, category, starred cards or previously failed cards
- Printable quizzes with answer-key controls
- Games (Match, Gauntlet, Hot Seat, Blitz, Crossword). Games are for practice and never write to your learning history
- Notes, study guides, post-mortems, groups and public profiles

**AI**
- Multiple-choice distractors made by corrupting one named key point, so a wrong pick tells you which misconception you hold
- Short-answer grading with a verdict for each key point (`correct`, `omission`, `contradicted`, …) and a verbatim quote from your answer as evidence
- A diagnostic test, autocomplete while authoring, and training plans
- **Bring your own keys:** each user stores encrypted credentials for Google (Gemini/Gemma), Anthropic, OpenAI, OpenRouter, DeepSeek, Z.ai (GLM) or a custom endpoint. Calls rotate across a user's keys, least recently tried first, and fail over to the next key on error

**Learner model**
- Confidence (1–10) and an append-only study history for every card, updated from Review and quizzes
- Per-key-point mastery, a learner dashboard (`/profile/learner`), and a memory history you can filter (`/profile/memory`)
- "Forget" really erases: resetting a card deletes its evidence, not just its score

**Accounts and admin**
- GitHub OAuth, or handle/email + password. Sign-up needs an invite code and a verified email address
- Sets are private by default, and the owner can make them shareable by link
- Roles (`learner` / `staff` / `admin`) and a staff area (`/staff`) for AI call history, key-point authoring, coverage and learners

> Voice interviews (spoken answers graded on delivery as well as content) are planned and not built yet.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui, Base UI, lucide icons |
| Database | Postgres (Neon) via Prisma 7 + the Neon driver adapter |
| Auth | Auth.js v5 (JWT sessions): GitHub OAuth + Credentials (bcryptjs) |
| AI | Vercel AI SDK v7 (`@ai-sdk/google`, `anthropic`, `openai`, `openai-compatible`) with Zod-validated structured output |
| Storage | Vercel Blob |
| Mail | Resend over raw `fetch`; falls back to printing links to the console |
| Tests | Vitest + Testing Library (jsdom) |
| Deploy | Vercel (includes a cron route for background key-point authoring) |

---

## Getting started

### Prerequisites
- **Node.js 22+** (AI SDK v7 requires it)
- A Postgres database. A free [Neon](https://neon.tech) branch works

### 1. Install

```bash
npm install
```

### 2. Configure the environment

```bash
cp .env.example .env
```

The minimum for a working local app:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `NEXTAUTH_SECRET` | Auth.js secret (`openssl rand -base64 32`). **Without it, `auth()` throws `MissingSecret` and pages fail in confusing ways** |
| `NEXTAUTH_URL` | `http://localhost:3000` |
| `GOOGLE_KEY_ENCRYPTION_SECRET` | 32-byte base64 key that encrypts users' stored AI credentials, **for every provider**. Do not rename it or change its format, or every stored key becomes unreadable |

Optional:
- `GITHUB_ID` / `GITHUB_SECRET`: GitHub sign-in
- `BLOB_READ_WRITE_TOKEN`: uploading images and files to cards
- `RESEND_API_KEY` / `MAIL_FROM`: real email. When unset, verification and reset links print to the server log, so local sign-up works with no inbox
- `CREDENTIALS_SIGNUP_ENABLED="true"`: turns on password sign-up (off by default; this is a master switch)

`.env.example` documents every variable, including the operator-script ones (`DEEPSEEK_API_KEY`, `ZAI_API_KEY`, `GOOGLE_API_KEYS`, `KLP_*`, `CRON_*`). **Never commit `.env`.**

### 3. Set up the database

```bash
npx prisma migrate deploy
npx prisma generate
```

### 4. Run it

```bash
npm run dev
```

Open http://localhost:3000.

### 5. Sign in

The quickest way to get a local account:

```bash
npm run seed:dev-user      # uses DEV_USER_EMAIL / DEV_USER_HANDLE / DEV_USER_PASSWORD from .env
```

Then sign in at `/login` with that handle or email. The script refuses to run against production and is safe to re-run.

To try the real sign-up flow, set `CREDENTIALS_SIGNUP_ENABLED="true"` and mint an invite:

```bash
npm run invite -- --uses 5 --days 30 --label "friends"
```

To make yourself an admin (this also unlocks `/staff`):

```bash
npm run grant-role -- --email you@example.com --role admin
```

### 6. Add an AI key

AI features use **your own** provider credentials. Add one at **Settings → AI** (`/settings/ai`). Saving a key makes a real generation call, so a model ID that would fail is caught on the spot. You can also pin a task (grading, distractors, plans, …) to a specific key and model.

---

## Scripts

### App

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `prisma migrate deploy` → `prisma generate` → `next build` |
| `npm start` | Serve the production build |
| `npm test` / `npm run test:watch` | Vitest |
| `npm run lint` | ESLint |
| `npm run db:studio` | Prisma Studio |
| `npm run seed:dev-user` | Create or update the local dev account |
| `npm run invite` | Mint, list (`--list`) or revoke (`--revoke CODE`) invite codes |
| `npm run grant-role` | Grant, list or revoke `staff` / `admin` |

### Operator and AI tooling

These run against the database and use real AI quota. Most take `--set <setId>`, and `--direct` makes a script use raw keys from `.env` instead of a user's stored credentials.

| Command | What it does |
|---|---|
| `npm run author-klps` | Write a card's key points and test them: grade deliberately wrong answers against the points, and revise until the points tell good answers from bad ones |
| `npm run probe-definitions` | Grade each card's own definition against its key points (the acceptance test for authored points) |
| `npm run regrade` | Regrade saved answers into a new generation. Old results are kept and marked superseded, never deleted |
| `npm run klp-histogram` | Show the key-point weight distribution and flag clustering |
| `npm run bench-models` / `bench-grader` | Benchmark models and the grader. Results go in `docs/ai/model-performance.md` |
| `npm run probe-models` | Check that model IDs work with a real generation call |

The full list is in `package.json`.

---

## Project layout

```
src/
  app/            Next.js routes: (app) is the signed-in product, (marketing) the landing pages, api/ the route handlers and cron
  actions/        Server actions (sets, quizzes, AI credentials, …)
  components/     UI components
  lib/
    ai/           generateJson, key rotation, model routing, the versioned prompt registry
    klp/          Key-point authoring, separation scoring, templates, relations
    analysis/     Answer analysis: verdicts, spans, grader versioning
    memory/       Study events, confidence, mastery, erasure
    quiz/         Quiz construction and grading context
    errors/       Failure classification (whose problem is this error?)
    parser/       Import parser
  auth.ts         Auth.js + the Credentials provider (Node runtime only)
  auth.config.ts  Edge-safe auth config used by middleware
prisma/           Schema and migrations
scripts/          Operator scripts (see above)
tests/            Vitest suites, mirroring src/
docs/
  ai/             Prompting strategy, error taxonomy, model-performance record
  superpowers/    BUILD-QUEUE.md (build order and handoff notes), specs, plans
  vision/         Product direction
```

---

## Development notes

- **Start with `docs/superpowers/BUILD-QUEUE.md`.** It has the build order, current test and lint baselines, and an "Environment gotchas" section.
- **`CLAUDE.md`** is the detailed architecture reference, especially for AI integration and grading.
- Never add the Credentials provider to `src/auth.config.ts`. Middleware bundles that file for the edge runtime, where bcrypt breaks every protected route. `tests/auth/edge-safety.test.ts` enforces this.
- Every AI response is validated with a Zod schema before it is stored. Scores and mastery are computed in TypeScript; the AI only returns categorical verdicts.
- `prisma migrate dev` needs an interactive terminal. In a non-interactive shell, generate the SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, save it as a new migration, and run `npx prisma migrate deploy`.
- Component tests need `// @vitest-environment jsdom` as their first line, and must call `afterEach(cleanup)` themselves.
- On Windows, stop a stuck dev server with `taskkill /PID <pid> /F`.

### Local AI proxy (optional)

`litellm_config.yaml` runs a local Anthropic-compatible endpoint backed by Gemini models, for Anthropic-shaped clients in development. It is separate from the in-app credentials.

```bash
litellm --config litellm_config.yaml   # needs LITELLM_MASTER_KEY and GOOGLE_API_KEY
```

---

## Deploying

The app targets Vercel. Set the same environment variables in the project settings. `npm run build` applies migrations first. `vercel.json` schedules `/api/cron/author-klps` daily; set `CRON_SECRET` (the route refuses every request without it) and `CRON_AUTHOR_USER_ID` (the account whose AI keys pay for background authoring).
