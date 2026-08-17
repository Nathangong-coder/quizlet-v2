# Credentials auth — design & implementation plan

**Date:** 2026-08-17
**Status:** DESIGNED, NOT STARTED.
**Build after:** the four outstanding gates pass and `spec3b-tunable-scoring` merges.

Sign up and sign in with a username and password, alongside the existing GitHub OAuth.

Chosen as the next track for three reasons, in order of weight:

1. **A public directory is for strangers, and a stranger cannot sign up today.** Item 6c
   (sharing & discovery) is designed and ready, but it ships a browsable directory to an app
   only GitHub users can join. This is close to a prerequisite for that work being worth doing.
2. **It closes trap 6.** No signed-in page is reachable from an agent session, so *every* live
   gate on this project is owed to the human — four are outstanding right now. A credentials
   provider plus a seeded dev account lets an agent sign in and run its own.
3. The user asked for it directly (2026-08-17).

---

## §0 What the codebase already gives us, verified in code

Three facts, and the first two are unusually lucky:

- **`session: { strategy: "jwt" }` is already set** (`src/auth.ts`). This is the usual blocker:
  Auth.js will not use the Credentials provider with the database session strategy, and
  switching an app from database to JWT sessions invalidates every existing login. That
  migration is already done, for unrelated reasons.
- **`User.handle` / `normalizedHandle` shipped in item 6d.** The username half of "username and
  password" already exists, with validation, a reserved list and a uniqueness key.
- **`src/middleware.ts` imports `authConfig` and runs on the edge runtime.** This one is a trap,
  and it is the single most important constraint in this design. See §2.

Versions: `next-auth@5.0.0-beta.31`, `@auth/prisma-adapter@2.11.2`, `next@16.2.9`.

---

## §1 Schema

```prisma
// on User
passwordHash    String?   // null for OAuth-only accounts
passwordSetAt   DateTime?
sessionVersion  Int       @default(0)
```

- **`passwordHash` is nullable and that is permanent**, not a migration step. An account created
  through GitHub has no password and never needs one; an account created with a password can
  later link GitHub. Both states are legitimate forever.
- **`sessionVersion` exists because JWT sessions cannot be revoked.** With the database strategy
  you delete a session row; with JWT the token is valid until it expires, so "change my password"
  would not sign out an attacker who already holds one. The version is embedded in the token and
  compared in the `session` callback; bumping it invalidates every outstanding token for that
  user. Without this, a password change is theatre.
- **`email` stays required and unique.** The Prisma adapter expects it, and it is the only
  plausible reset channel. Sign-up therefore collects **handle + email + password**, not just
  handle and password.

---

## §2 The edge-runtime trap — read before writing any code

`src/middleware.ts` does:

```ts
import { authConfig } from "@/auth.config"
export default NextAuth(authConfig).auth((req) => { … })
```

Middleware runs on the **edge runtime**, which has no native modules and no Node built-ins. Any
real password hash — bcrypt, argon2, or `node:crypto`'s scrypt — is unavailable there.

**So the Credentials provider must NOT be added to `auth.config.ts`.** Putting it there bundles
the hashing library into the edge middleware and breaks every protected route in the app — not
with a type error, but at request time.

The split already in this repo is exactly the Auth.js recommended shape, and it exists for this
reason. Keep it:

| File | Runtime | Holds |
| --- | --- | --- |
| `src/auth.config.ts` | edge-safe | GitHub only, plus `pages`, plus the `authorized` callback |
| `src/auth.ts` | Node | `PrismaAdapter`, **Credentials**, session/jwt callbacks |

`auth.ts` merges rather than replaces:

```ts
providers: [...authConfig.providers, Credentials({ … })]
```

The middleware only needs to *read* a token to decide whether someone is signed in. It never
authorizes credentials, so it never needs that provider. **A test should assert
`auth.config.ts` imports nothing from the hashing module** — this is a runtime-only failure that
`tsc` and the unit suite both pass straight over, the same class as trap 8's `$queryRaw`.

---

## §3 Hashing

**`bcrypt` via `bcryptjs`**, cost factor 12.

Not `bcrypt` (the native binding): it needs a compile step that Vercel's build can trip over, and
this codebase has no native dependencies today. Not argon2 for the same reason. `bcryptjs` is
pure JS, slower per hash, and that cost is paid once per login — which is the operation we *want*
to be slow.

Two rules that are easy to get wrong:

- **Always run a comparison, even when the user does not exist.** A short-circuit `return null`
  on an unknown email returns in ~1 ms while a real account takes ~250 ms, which tells an attacker
  which emails have accounts. Compare against a fixed dummy hash instead, then fail.
- **One error message for every failure.** "No account with that email" and "wrong password" are
  the same message: *"Email or password is incorrect."* Distinguishing them is a user-enumeration
  oracle, and the small usability gain is not worth it.

---

## §4 Sign-up

`/signup` — handle, email, password, confirm.

- Handle validation reuses `checkHandle` (`src/lib/users/handle.ts`) unchanged, including the
  reserved list. **No second copy of those rules.**
- Password policy: minimum 12 characters, no composition rules. Length beats character-class
  requirements, which mostly produce `Password1!`. Reject the top few thousand known-breached
  passwords from a bundled list if it stays small; otherwise skip it rather than shipping a
  fake check.
- Uniqueness on both `email` and `normalizedHandle` is resolved by the **P2002 constraint
  violation**, never a pre-flight `SELECT` — the same TOCTOU argument as `saveHandle` in item 6d.
- **An existing email must not leak.** If the email is taken, the honest options are to send a
  "someone tried to sign up with your address" mail (no mail provider — see §7) or to return the
  generic failure. v1 returns the generic failure and says so in `§7 Known limits`.

**Linking, which is where this gets subtle.** Someone signs up with `alice@x.com` + password,
then later clicks "Sign in with GitHub" on a GitHub account carrying the same address. Auth.js
will refuse with `OAuthAccountNotLinked` by default, which is the *safe* behaviour and should be
kept — auto-linking on a matching email trusts the OAuth provider's email verification, and not
every provider verifies. The reverse direction is the one to support: a signed-in OAuth user
setting a password on `/account`, which is just `saveHandle`-shaped and has no linking problem at
all.

---

## §5 Sign-in

`/login` — email (or handle) + password.

- Accepting **either** an email or a handle costs one extra `OR` in the lookup and removes the
  most common login failure ("which one did I use?").
- `src/middleware.ts` currently redirects to `/api/auth/signin`, the built-in Auth.js page. Point
  `pages.signIn` at `/login` in `auth.config.ts` so both the middleware redirect and any
  `signIn()` call land on the real page.
- **Rate limiting has no home in this codebase.** There is no Redis, no KV, and serverless
  instances share no memory — so an in-process counter is security theatre that resets on every
  cold start. v1 ships without it and records that as a known limit rather than pretending. The
  honest mitigations available now are the bcrypt cost factor (§3) and a per-account lockout
  counter in Postgres, which *is* shared state; the lockout is the one worth building if any of
  this becomes public.

---

## §6 Closing trap 6 — the part that pays for itself

A dev-only seed script, `scripts/seed-dev-user.ts`, creating an account with a known handle and
password from env vars, refusing to run when `NODE_ENV === 'production'`.

That single script is what lets an agent sign in against a dev database and run the live gates
that currently queue up on the user — four of them today, and every future spec adds more. It is
a small piece of work attached to a large one, and it should be built in the same pass rather
than "later", because the moment credentials work is the moment the bottleneck can be removed.

---

## §7 Known limits, stated rather than discovered

- **No password reset.** It needs email delivery, which does not exist: `RESEND_API_KEY` is gone
  from `.env`, and Stage 7 already deferred email as "schema-ready" only. **A user who forgets
  their password is locked out permanently.** This is the single biggest reason to consider
  building the mail provider first — or to keep credentials sign-up behind a flag until it exists.
  The `emailUpdates` / `contactEmail` fields from item 6d are the beginning of that surface.
- **No rate limiting** (§5).
- **No email verification at sign-up**, so an address is unproven until reset exists to prove it.
- **`OAuthAccountNotLinked` is a real dead end** for a user who signs up by password and then
  tries GitHub with the same address. Correct and safe, but the error page must explain it rather
  than showing Auth.js's default.

---

## §8 Defects anticipated on paper

1. **Credentials provider in `auth.config.ts`** bundles a hashing library into edge middleware and
   breaks every protected route at request time — invisible to `tsc` and the unit suite. §2
2. **JWT sessions cannot be revoked**, so a password change would not sign out a held token
   without `sessionVersion`. §1
3. **Short-circuiting on an unknown email** leaks which addresses have accounts, through timing
   and through response text. §3
4. **A pre-flight uniqueness `SELECT`** is TOCTOU; the constraint decides. §4
5. **Auto-linking OAuth to a matching email** trusts an unverified provider claim. Keep Auth.js's
   refusal. §4
6. **In-process rate limiting** resets on every cold start and protects nothing. §5

---

## §9 Task order

Each task is a commit. Tasks 1–3 are the security core and should be reviewed hardest.

| # | Task | Verified by |
| --- | --- | --- |
| 1 | `passwordHash`, `passwordSetAt`, `sessionVersion` + migration | `migrate diff` reports empty |
| 2 | `src/lib/auth/password.ts` — hash, verify, dummy-compare, policy | pure unit tests + mutants |
| 3 | Credentials provider in **`auth.ts` only**; `sessionVersion` in jwt/session callbacks | a test asserting `auth.config.ts` has no hashing import |
| 4 | `/signup` route + `signUp` action | action tests: P2002, generic failure, handle reuse |
| 5 | `/login` route + `pages.signIn`; middleware redirect follows | component + redirect test |
| 6 | Email-or-handle lookup | unit test on the lookup builder |
| 7 | "Set a password" panel on `/account` for OAuth users | action test; session bump on change |
| 8 | `scripts/seed-dev-user.ts`, production-refusing | run it |
| 9 | `OAuthAccountNotLinked` error page copy | manual |

**Then** item 6c (sharing & discovery) starts at its step 2, since handles already shipped.

---

## §10 Open, needs a decision before Task 4

**Does credentials sign-up ship publicly without password reset?** Three options, and this is a
product call rather than a technical one:

- ship it, and accept that a forgotten password means a lost account;
- ship it behind a flag, so it exists for dev seeding and the trap-6 win but not for real users;
- build email delivery first, and ship credentials complete.

The middle option gets the agent-gate benefit immediately at almost no risk, and is the
recommendation if the answer is not obvious.
