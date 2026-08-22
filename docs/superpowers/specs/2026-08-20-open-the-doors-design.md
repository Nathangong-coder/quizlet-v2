# Open the doors — invite codes, email verification, and password reset

**Date:** 2026-08-20
**Queue item:** 8 — the next build
**Branch:** `spec3b-tunable-scoring` (unmerged, same branch as items 1, 2, 2b, 6a–6f)
**Predecessor:** `2026-08-17-credentials-auth-design.md` (item 6e). This spec closes that
design's §7 limits and its §10 decision.

---

## §0 What this is for

Item 6e shipped password sign-in behind `CREDENTIALS_SIGNUP_ENABLED`, off. It is off for one
reason, recorded in that design's §7: **a user who forgets their password is locked out
permanently**, because there is no mail provider and therefore no reset.

This spec builds the three things that make flipping that flag a decision rather than a gamble:

1. **A mail transport**, because reset is impossible without one.
2. **Invite codes**, which bound how many accounts can exist. This is the user's stated fear —
   "my backend will be fried" — answered exactly. A rate limiter slows a burst; only a finite
   pool of codes caps the total.
3. **Email verification and password reset**, which make an account recoverable and prove the
   address is real before it is relied on for recovery.

They are one item because none of them is worth shipping alone. Reset without a cap is
uncontrolled growth. A cap without reset hands someone a code to an account they can lose
forever. Verification without either is decoration.

**Out of scope, deliberately:** hosting changes. The user asked on 2026-08-20 whether moving to a
free Oracle VM would reduce throttling. The answer recorded then is no — it relocates the ceiling
rather than raising it, and trades a managed platform that scales to zero for a fixed box plus ops
work. The live database that day held 4 users, 6 sets, 80 cards, 6 quiz answers. Move compute when
there is a measured bill or a real 429.

Also out of scope: magic-link sign-in. It was considered (it would make password reset stop
existing as a concept) and rejected — it adds a third auth path days after the second, and does
not reduce the work here, since the mail transport, the invite gate, and verification semantics
are all still required.

---

## §1 Decisions taken with the user, 2026-08-20

| Question | Decision |
| --- | --- |
| Sending domain | **A real domain the user owns**, verified in Resend. Reset therefore works for arbitrary recipients, not just the operator's own inbox. |
| Invite shape | **Bearer code with `maxUses` + expiry.** `maxUses=1` is a personal invite; `maxUses=25` is a study-group code. Handed out by any channel — text, Discord, in person. |
| Rate limiting | **Vercel Firewall rules**, configured in the dashboard. No new dependency, no network hop, and the burst is dropped before it reaches a function. |
| Email verification | **Required before password sign-in.** A typo is caught immediately rather than silently, and the marginal cost over "send but don't enforce" is one screen and one branch. |
| Minting codes | **`npm` script only.** No admin role, no admin page, no new privilege concept. |
| Per-account lockout | **Not built.** A hard lockout is itself an attack — anyone who knows an address can lock its owner out on purpose, and there is no support desk to undo it. Firewall handles volume. Revisit on evidence of real credential stuffing. |
| Token storage | **One `UserToken` table with the purpose bound into the hash** (approach 1 of 3). |

---

## §2 What the codebase already gives us, verified in code

Read before designing anything; each of these changed a decision.

- **`jwtCallback` already does a primary-key lookup on every session resolution**
  (`src/lib/auth/session.ts`), to compare `sessionVersion`. Anything else needed from the user row
  rides along at zero marginal cost.
- **Middleware cannot check the database.** `src/middleware.ts` builds its own Auth.js instance
  from `auth.config.ts`, which is edge-bundled and has no Prisma. `session.ts` already documents
  this. A verification gate therefore **cannot** live in middleware; it lives in
  `authorizeCredentials`.
- **`after()` is an established pattern here** — `src/actions/sets.ts:227` and `src/actions/klp.ts`
  use it for fire-and-forget work. It is what makes the enumeration-safe mail rule (§5) possible.
- **`edge-safety.test.ts` needs no extension.** Its `FORBIDDEN` list already contains `@/lib/db`,
  and the walk is transitive, so any module importing Prisma is caught for free. The mail module is
  `fetch`-only and edge-safe regardless. *Do not add a task for this.*
- **The schema contains zero Prisma enums.** Every closed vocabulary in this repo is a string
  column plus a shared TS constant (`src/lib/cards/klp-status.ts` is the model the queue praises).
  `UserToken.purpose` follows that, not a Prisma `enum`.
- **`identifierWhere`** (`src/lib/auth/identifier.ts`) already resolves email-or-handle. Reset
  reuses it, so a user can request a reset by handle.
- **Auth.js's own `VerificationToken` model exists** (adapter-owned, for the Email provider). It is
  **not** reused: it has no `usedAt`, no `purpose`, no FK to `User`, and the adapter creates and
  deletes rows on its own semantics.

---

## §3 Schema

Two new models plus one column on `User`.

```prisma
model UserToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// sha256(purpose + ':' + rawToken), hex. NEVER the raw token — a token in a
  /// database is a bearer credential exactly like a password.
  ///
  /// The purpose is mixed into the hash on purpose (§4). It makes a
  /// verification token unable to hash to a reset row's value, so forgetting
  /// the `purpose` clause in a `where` fails closed instead of opening a
  /// confused-deputy hole.
  tokenHash String    @unique

  /// 'password_reset' | 'email_verify'. String + shared constant, matching
  /// src/lib/cards/klp-status.ts; this schema has no Prisma enums.
  purpose   String

  expiresAt DateTime
  /// Single-use. Enforced by an atomic conditional update asserting count === 1,
  /// never by read-then-write.
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  /// Supports "invalidate every other outstanding token of this purpose".
  @@index([userId, purpose])
}

model InviteCode {
  id            String    @id @default(cuid())

  /// Normalised Crockford Base32, stored in PLAINTEXT — deliberately, see §6.
  code          String    @unique
  /// Free text for the operator: "discord launch", "study group A".
  label         String?

  /// Immutable, for display: "3 of 5 used".
  maxUses       Int
  /// The atomic gate. Counts DOWN. See §6 for why this is not `usesCount`.
  usesRemaining Int

  expiresAt     DateTime?
  revokedAt     DateTime?
  createdAt     DateTime  @default(now())

  redeemedBy    User[]
}
```

On `User`:

```prisma
  /// Which invite let this account in, or null for GitHub accounts, the seeded
  /// dev user, and everything predating invite codes. Nullable permanently.
  /// This is the audit trail — "who came in on which code" — for one FK.
  invitedByCodeId String?
  invitedByCode   InviteCode? @relation(fields: [invitedByCodeId], references: [id], onDelete: SetNull)

  userTokens      UserToken[]
```

`emailVerified` already exists (Auth.js adapter). It gains a second, load-bearing meaning
documented in the schema comment: **for a credentials account, null means sign-in is refused.**

**GitHub sign-in is not gated by it and must never be.** The check lives in
`authorizeCredentials` (§7.6) and nowhere else, so an OAuth account with `emailVerified: null`
signs in exactly as it does today. GitHub's verification of its own users is GitHub's business;
this column governs the addresses *we* let people self-register.

### The migration carries a data statement

```sql
UPDATE "User" SET "emailVerified" = NOW() WHERE "emailVerified" IS NULL;
```

Non-negotiable. `emailVerified` is null for every account that exists today — including the
seeded `dev_user`, which has a password. Shipping the gate without this locks that account out on
deploy, and it is the account an agent uses to run live gates. The statement asserts "everything
predating the gate is grandfathered," which is exactly true.

---

## §4 The token module — `src/lib/auth/tokens.ts`

The only place raw tokens are generated, hashed, or compared.

```ts
export const TOKEN_PURPOSES = ['password_reset', 'email_verify'] as const
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number]

/** Reset is short because a live reset link is an account takeover waiting to happen. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60 * 1000,        // 1 hour
  email_verify: 24 * 60 * 60 * 1000,     // 24 hours
}

/** 32 bytes from a CSPRNG, base64url. base64url specifically — the value goes
 *  into a path segment, and standard base64's `+` and `/` would need escaping
 *  that a mail client's link detection will get wrong. Not a UUID: a v4 UUID is
 *  122 bits and some generators are not cryptographically seeded. */
export function generateRawToken(): string

/** sha256(`${purpose}:${raw}`), hex. Fast on purpose: the input is already
 *  high-entropy, so slow hashing buys nothing and costs a request. */
export function hashToken(purpose: TokenPurpose, raw: string): string
```

**Why the purpose is inside the hash.** The alternative is a `purpose` clause in every `where`,
which is a guard someone can forget. Binding it into the hash means the same raw string produces
two different stored values, so a verification token *cannot* be presented at the reset endpoint
even if every query filter is dropped. It costs about twenty characters and removes a whole class
of confused-deputy bug. The direct test asserts
`hashToken('email_verify', s) !== hashToken('password_reset', s)`.

Consumption is atomic and is the single most important guard in this spec:

```ts
// NOT findFirst-then-update. Two concurrent clicks on the same emailed link
// would both read usedAt: null and both succeed.
const { count } = await tx.userToken.updateMany({
  where: { tokenHash, purpose, usedAt: null, expiresAt: { gt: new Date() } },
  data: { usedAt: new Date() },
})
if (count !== 1) return { ok: false, reason: 'invalid_or_expired' }
```

Minting a token of a given purpose **invalidates that user's other outstanding tokens of the same
purpose**, so a second "resend" does not leave the first link live.

---

## §5 The enumeration rule — one invariant, three endpoints

> Every action that may send mail returns **one fixed message for every input**, and performs all
> of its work inside `after()`.

Identical text is not sufficient. Sending mail takes a couple of hundred milliseconds and not
sending takes none, so a caller can time the difference and learn which addresses have accounts.
`after()` returns the response before any of that work begins, which makes both paths
indistinguishable without a manufactured delay.

This governs `requestPasswordReset`, `resendVerification`, and `signUp`'s duplicate-account path.

Item 6e already established the sibling rule for sign-in — one byte-identical failure message,
and a dummy bcrypt comparison so the unknown-account path costs the same as the wrong-password
path (`src/lib/auth/credentials.ts`). This spec must not weaken it.

**Invite-code errors are exempt and may be specific** ("That invite code isn't valid or has been
used up"). A code is not a user; saying it is dead enumerates nothing about people. Guessing codes
is bounded by 50 bits of entropy (§6) and the Firewall rule on `POST /signup` (§9).

---

## §6 Invite codes

### Format

Crockford Base32, 10 characters, displayed as `XXXXX-XXXXX`. Alphabet
`0123456789ABCDEFGHJKMNPQRSTVWXYZ` — no `I`, `L`, `O`, or `U`. That is 5 bits per character,
**50 bits total**.

Normalisation is a pure function, `normalizeInviteCode`, and it follows Crockford's decoding
rules so a code survives being read aloud or written down: uppercase, strip anything outside the
alphabet (hyphens, spaces), then map `I`/`l`/`L` → `1` and `O`/`o` → `0`. Round-trip tests cover
`quiz` style lowercase input, hyphen variants, and each ambiguous character.

### Stored in plaintext, and why that is not an inconsistency

Tokens in §4 are hashed; codes here are not. The asymmetry is deliberate:

- A leaked **reset token** is account takeover. Hash it.
- A leaked **invite code** costs one signup slot from a pool that is already bounded — and the
  operator genuinely needs to read codes back out ("what was that code again?", "which code is
  the Discord one?"). Hashing trades real usability for approximately no security.

### `usesRemaining` counts down — the concurrency story

Prisma cannot compare two columns in a `where`, so a `usesCount < maxUses` gate would need raw
SQL. A counter that decrements toward zero makes the gate a plain atomic update:

```ts
const { count } = await tx.inviteCode.updateMany({
  where: {
    code,
    usesRemaining: { gt: 0 },
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  },
  data: { usesRemaining: { decrement: 1 } },
})
if (count !== 1) throw new InviteUnavailable()
```

`count === 0` means the code was dead, revoked, expired, or its last use was taken by someone else
between the pre-check and here. **Two people racing for the final slot cannot both get in.**
`maxUses` stays immutable for display; used count is `maxUses - usesRemaining`.

### Minting — `scripts/mint-invite.ts`, `npm run invite`

```
npm run invite -- --uses 5 --days 30 --label "discord launch"
```

Prints the formatted code once. Follows `scripts/seed-dev-user.ts` conventions, including its
production refusal check first in `main()`. Supports `--list` and `--revoke <code>`. No admin page
— recorded as a follow-up in §12 for when handing out codes gets frequent enough to hurt.

---

## §7 Flows

### 7.1 Sign-up — order of operations is load-bearing

`signUp` (`src/actions/auth-signup.ts`) gains an `inviteCode` field. The sequence:

1. `isSignupOpen()` — the flag survives as a master kill switch (§8).
2. Validate handle, email, and password **shape**. Pure, no I/O.
3. **Cheap `SELECT` on the invite code.** Reject an obviously dead code here.
4. **Hash the password.**
5. **Transaction:** atomic decrement (§6), then `user.create` with `invitedByCodeId` and
   `emailVerified: null`.
6. `after()`: mint an `email_verify` token and send the mail.
7. Return the generic success.

Two things about that order are not stylistic:

**Step 3 is a cost filter, not the gate.** Step 5 is the gate. Step 3 exists so that a garbage
code is rejected *before* 250ms of bcrypt — otherwise `/signup` is a CPU amplifier that anyone can
fire with random codes. It is TOCTOU by construction and that is fine, because the atomic
decrement decides.

**Step 4 is outside the transaction.** Holding a Postgres transaction open across a quarter-second
of bcrypt is how a serverless app exhausts its connection pool under any concurrency at all.

If `user.create` hits P2002 (duplicate email or handle), the transaction rolls back and **the
invite use is restored** — a typo must not burn someone's code. The P2002 message continues to
name neither field (item 6e's rule).

### 7.2 Check your inbox — `/signup/check-email`

Shows **the address as typed**. This is the primary typo defence, and it is better than the email
itself: the user sees `me@gmial.com` on screen while they still remember typing it. Carries a
resend control, governed by §5.

`resendVerification` takes an identifier and mints only when the account exists **and**
`emailVerified` is null. An already-verified account gets the same fixed response and no mail —
otherwise "resend" becomes a way to make the app send unlimited messages to any address that has
ever registered.

### 7.3 Verify — `/verify/[token]`

Consumes an `email_verify` token, sets `emailVerified`, invalidates sibling verify tokens,
redirects to `/login?verified=1`. Does **not** auto-sign-in: the token is in a URL that lands in
browser history.

An invalid or expired token renders a plain page offering a resend, never a stack trace.

### 7.4 Request a reset — `/forgot`

Accepts email **or handle**, via `identifierWhere`. Always answers: *"If that account exists,
we've sent a link to its email address."* All work in `after()` (§5).

**A token is only minted for an account that already has a `passwordHash`.** An OAuth-only account
already has a working way in, so mailing it a reset link would convert "controls the inbox" into
"owns the account" on the strength of an email claim GitHub gave us and we never verified. The
response is byte-identical either way, so refusing leaks nothing. An OAuth user who wants a
password uses `/account`, which requires being signed in — which they can be, via GitHub.

### 7.5 Consume a reset — `/reset/[token]`

GET validates and renders a new-password form, or an expired/invalid page linking back to
`/forgot`. POST, in one transaction:

- consume the token atomically (§4);
- write `passwordHash`, `passwordSetAt`;
- **set `emailVerified` if null** — clicking a link in an inbox proves the inbox. This is what
  gives an unverified, locked-out user exactly one path back, and it works;
- **bump `sessionVersion`** — it is a password change, so every outstanding JWT for the account
  must die, exactly as `savePassword` does today;
- invalidate the user's other outstanding `password_reset` tokens.

Redirects to `/login?reset=1`.

### 7.6 The sign-in gate

`authorizeCredentials` gains a third outcome, so the pure function stays testable without booting
Auth.js:

```ts
export type AuthorizeOutcome =
  | { kind: 'ok'; user: AuthorizedUser }
  | { kind: 'rejected' }    // unknown account OR wrong password — indistinguishable
  | { kind: 'unverified' }  // the password was CORRECT; the address is not verified
```

**The gate is enumeration-safe because of when it fires: only after the password verifies.** At
that moment the person already knows the account exists and knows its password, so telling them
"verify your email" reveals nothing they did not supply. Wrong password and unknown account
continue to return today's byte-identical failure through `{ kind: 'rejected' }`.

`src/auth.ts` maps `ok` → the user, `rejected` → `null`, `unverified` → a thrown `CredentialsSignin`
subclass carrying `code: 'unverified'`.

> **Flagged unknown, to be resolved during implementation, not assumed.** Whether that `code`
> survives `signIn('credentials', { redirect: false })` in `next-auth@5.0.0-beta.31` is
> unverified. The implementing task must confirm it empirically.
>
> **Fallback if it does not:** treat `unverified` as `rejected`, and show *unconditional* static
> copy beneath the login error — "Just signed up? Check your inbox for a verification link.
> [Resend]". Being unconditional, it is never an oracle. The UX is slightly worse and the security
> properties are identical. Do not spend more than one task on the plumbing.

### 7.7 `savePassword` gains two responsibilities

Both are small and both close real holes:

- **Invalidate outstanding `password_reset` tokens.** Otherwise: an attacker requests a reset, the
  owner notices and changes their password from `/account`, and the attacker's link stays live for
  the rest of the hour.
- **Set `emailVerified` when null.** A GitHub account created after this ships has
  `emailVerified: null`; without this, setting a password on `/account` locks the user out of
  password sign-in immediately. They are demonstrably signed in and in control, and there is no
  self-registered address to have typo'd.

---

## §8 What `CREDENTIALS_SIGNUP_ENABLED` means now

It survives, with a changed meaning: **a master kill switch**, not the primary control. Invite
codes are the cap; the flag is how you close the door entirely without a deploy.

Its default stays "off unless exactly `true`", and `src/lib/auth/signup-flag.ts`'s doc comment
must be rewritten — its current text says the flag is off *because there is no password reset*,
which this spec makes false. Leaving a stale reason in place is how the next reader concludes the
flag can now be deleted.

Flipping it to `true` is the act this whole item exists to make safe, and it is a **human
decision, not a task in the plan.**

---

## §9 Mail

`src/lib/mail/`, three pieces, so the interesting half is pure:

| File | Responsibility |
| --- | --- |
| `transport.ts` | `MailTransport` interface. `resendTransport` — a plain `fetch` POST to `https://api.resend.com/emails`. `consoleTransport` — logs the message. |
| `templates.ts` | Pure functions → `{ subject, text, html }`. Unit-tested. |
| `send.ts` | Selects the transport; **never throws**. |

**No `resend` npm dependency.** Their API is one POST; wrapping it is about ten lines, keeps the
transport swappable, and avoids adding a package for it.

**`send.ts` must never throw.** It runs inside `after()`, where an exception is unhandled and
silently kills the callback. It logs with a distinctive prefix instead. The cost is that a broken
mail configuration is quiet, which the console transport and the live gate (§11) cover.

**The console transport is a design goal, not a dev convenience.** With `RESEND_API_KEY` absent,
verification and reset links print to the server log — so an agent can drive this entire feature
end to end locally by reading links out of stdout. That shrinks BUILD-QUEUE trap 6 again: after
this ships, the only thing that genuinely needs a human inbox is proving Resend delivers.

**Link origins come from env, never from the request.** `NEXTAUTH_URL`, falling back to
`https://$VERCEL_URL`. Building an absolute URL from the `Host` header is the classic poisoned-reset-link
bug: an attacker sets `Host: evil.com` and your server mails *your user* a link to their own valid
token, on the attacker's domain.

New environment variables, added to `.env.example` with placeholders only:

```
RESEND_API_KEY=""          # absent → console transport, links print to the server log
MAIL_FROM="Quizlet <noreply@yourdomain.example>"
```

---

## §10 Rate limiting — configuration, not code

Applied by the operator in the Vercel dashboard. **No test can assert any of this**; it is a
runbook plus a live-gate checkbox.

| Path | Limit | Why this path |
| --- | --- | --- |
| `POST /api/auth/callback/credentials` | 10/min/IP | The ~250ms bcrypt burner. CPU amplification as well as credential stuffing — and by design the unknown-account path costs the same, so an attacker does not even need real addresses. |
| `POST /signup` | 5/min/IP | Also the invite-code brute-force surface. |
| `POST /forgot` | 5/min/IP | Mail-send amplification; someone else pays for the sends. |
| `POST /reset/*` | 10/min/IP | Token brute force. |
| `POST /login` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /verify/*` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |
| `POST /signup/check-email` | 5/min/IP | `resendVerification` is mail-send amplification, same profile as `/forgot`; `/signup/check-email` takes the identifier from a query parameter. |

Server Actions dispatch on a `Next-Action` header and an action ID, not on the path, so a crafted
POST can invoke any action from any route. Path rules bound the browser flow only — pair them with
a broad `POST /*` limit if the invite pool is the thing being protected. **Verify this against
Vercel's current Server Actions dispatch behaviour before relying on it.**

---

## §11 Testing

### Guards that must be mutation-tested

The repo's standard is that a guard is shown to fail when broken, and two recent build memories
record guards that could not. These five get it explicitly:

1. `usesRemaining: { gt: 0 }` — remove it and an exhausted code must start admitting users.
2. `usedAt: null` — remove it and a reset link must become reusable.
3. The `purpose` clause — remove it and §4's hash binding must still reject the cross-purpose token.
4. `expiresAt: { gt: new Date() }` — remove it and an expired token must be accepted.
5. Reset's has-a-password condition — remove it and an OAuth-only account must start receiving links.

### Pure unit tests

- `hashToken('email_verify', s) !== hashToken('password_reset', s)` for the same raw string.
- `normalizeInviteCode` round-trips: lowercase, hyphens, spaces, and each of `I`/`l`/`L`/`O`/`o`.
- TTL arithmetic per purpose.
- Templates contain an absolute link and the correct route.

### Action tests

- `/forgot` produces an identical result for a known identifier, an unknown identifier, and an
  OAuth-only account.
- Sign-up against an exhausted, revoked, and expired code.
- Sign-up hitting P2002 **restores** the invite use.
- `authorizeCredentials` returns `unverified` only when the password was correct, and `rejected`
  for a wrong password on an unverified account.

### Not needed

`tests/auth/edge-safety.test.ts` requires no change — see §2.

---

## §12 Live gate

Some of it an agent can now run (that is the 6e win); real delivery cannot be faked.

**Agent-runnable, console transport, no API key:**

1. Mint a code with `--uses 1`; sign up with it; the link appears in the server log.
2. Sign in before verifying → refused.
3. Follow the verify link → sign in succeeds.
4. Reuse the same verify link → rejected as already used.
5. Sign up again with the same now-exhausted code → refused.
6. `/forgot` for a real account and for `nobody@example.invalid` → byte-identical responses.
7. Follow the reset link, set a new password → the old session is dead on the next request.
8. Reuse the reset link → rejected.

**Human-only:**

9. `RESEND_API_KEY` set: a real message arrives at a real inbox from the verified domain, and its
   link works against the deployed origin.
10. Vercel Firewall rules from §10 are configured and a burst of logins is actually throttled.

---

## §13 Task order

| # | Task | Verified by |
| --- | --- | --- |
| 1 | Schema: `UserToken`, `InviteCode`, `User.invitedByCodeId` + migration with the grandfather `UPDATE` | `migrate diff` empty; existing users still sign in |
| 2 | `src/lib/auth/tokens.ts` — generate, purpose-bound hash, atomic consume, sibling invalidation | pure unit tests + mutants 2–4 |
| 3 | `src/lib/mail/` — transport, templates, non-throwing send, env-derived origin | unit tests; console transport prints a usable link |
| 4 | `src/lib/invites/code.ts` + `scripts/mint-invite.ts` + `npm run invite` | round-trip tests; run the script |
| 5 | `signUp` gains invite redemption (§7.1 ordering) + verification mail | action tests + mutant 1 |
| 6 | `/signup/check-email` + `resendVerification` | component test; §5 invariant |
| 7 | `/verify/[token]` | route test; reuse rejected |
| 8 | `/forgot` + `requestPasswordReset` | identical-response tests + mutant 5 |
| 9 | `/reset/[token]` + consume (password, `emailVerified`, `sessionVersion`, siblings) | action tests |
| 10 | The sign-in gate + the `code` plumbing question (§7.6), fallback if it does not carry | `authorizeCredentials` outcome tests |
| 11 | `savePassword`: invalidate reset tokens, set `emailVerified` (§7.7) | action tests |
| 12 | `.env.example`, `signup-flag.ts` doc rewrite (§8), `CLAUDE.md` auth paragraph, §10 runbook into BUILD-QUEUE | grep; docs read back |

Tasks 2 and 5 are the security core and should be reviewed hardest.

---

## §14 Known limits, stated rather than discovered

- **A mail failure is silent to the user.** `send.ts` swallows to protect the `after()` callback,
  so a user whose mail bounced sees "check your inbox" and nothing arrives. There is no bounce
  handling and no delivery dashboard in-app. Resend's own dashboard is the only place to see it.
- **No account deletion, still.** Invite codes cap how many accounts *are created*, not how many
  exist. A pool that has been fully redeemed cannot be reclaimed.
- **`invitedByCodeId` is `SetNull`,** so deleting an `InviteCode` erases the audit trail for
  accounts that used it. Prefer `--revoke`, which preserves the row.
- **50 bits of code entropy assumes the Firewall rule exists.** Without §10's `POST /signup` limit,
  a determined attacker with a botnet has a materially better chance than the number suggests.
- **The stale comment in `credentials.ts`** ("unrecoverable with no password reset", justifying no
  password-policy check on sign-in) becomes half-false once this ships. The *behaviour* should not
  change — rejecting a legacy password at sign-in is still bad — but the comment needs rewording so
  the next reader does not act on a premise that no longer holds.
- **No admin UI.** Minting, listing, and revoking are terminal-only. Revisit when handing out codes
  is frequent enough to be annoying, not before.
- **Signup remains a bounded enumeration oracle.** A random handle plus a duplicate-details response
  implies the email is taken, and the P2002 rollback means probing costs nothing from the invite
  pool. This is unchanged from item 6e and is gated on holding a valid invite code.
