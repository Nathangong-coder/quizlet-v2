# App Shell, Navigation & Settings — Design

**Date:** 2026-08-28
**Status:** **BUILT 2026-08-28** (queue item 6f), commits `2d66302..94152e1` on `spec3b-tunable-scoring`, not merged. **Live gate owed — see §13.** One deviation: only 3 of the 13 `shadow-*` utilities were removed; the rest sit on floating layers where elevation is correct (§9 item 3 assumed all 13 were decoration).
**Branch:** `spec3b-tunable-scoring`
**Precedes:** `2026-08-28-set-views-and-atlas-design.md` (Spec C), written and BUILT the
same day. Together the two complete the request made on 2026-08-27.

---

## 1. What this is, and what it is not

The user asked for two things on 2026-08-27: sharing/discovery (shipped, see
`2026-08-27-public-sets-and-discovery-design.md`) and "revamp the entire UI". On
2026-08-28 they added a specific navigation shape: the three top-nav items should
become one persistent left column, and the top-right should be a profile picture
that opens a vertical menu of settings sections.

**This spec is the chassis and every page that hangs on it.** A left rail, a profile
menu, a settings reorganization, an avatar, a feedback channel — and a visual pass over
**every page the rail touches**, so nothing ships as an old page in a new frame.

**This spec is NOT the set-page restructure.** Study / Knowledge / Analysis tabs, the
concept tree moving into a Knowledge view, and the Atlas spatial surfaces are Spec C.
That is an information-architecture change with its own route group, its own data
questions, and its own gate. The set detail page here gets the rail and the visual pass
and nothing more.

### 1.1 Why the shell comes first

The set views render *inside* the shell. A tab strip designed against a centered
`max-w-6xl` column is the wrong width the day a 240px rail takes the left edge. Building
Spec C first means laying out the set views twice.

---

## 2. The layout bug this uncovers, and why it blocks the rail

`src/app/layout.tsx:73` wraps every page in:

```tsx
<main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
```

and then **17 page files add their own** `max-w-5xl mx-auto px-4 py-10` (or `-3xl`, or
`-6xl`). Centered inside centered; `px-4` applied twice; two competing vertical rhythms.

This is invisible today only because both wrappers center on the same axis. The moment a
fixed-width rail takes the left edge, it is not: the inner wrapper would center inside
the *remaining* space while the outer one centers inside the viewport, and every page
would sit off-axis by half the rail's width.

**The rail cannot be added without reconciling these.** The shell layout owns the
measure and the padding exactly once; pages own their content and nothing else. This is
not incidental cleanup — it is a precondition, and it is why this spec touches every
page rather than only the frame.

---

## 3. Route structure

One route group, `src/app/(app)/`, holds everything that gets the shell. Everything left
outside it renders bare.

| Inside `(app)` — shelled | Outside — bare |
| --- | --- |
| `page.tsx` (home) | `sets/[id]/quiz` |
| `browse` | `sets/[id]/quiz/print` |
| `sets` (library), `sets/new` | `sets/[id]/match` |
| `sets/[id]`, `sets/[id]/edit` | `sets/[id]/review` |
| `sets/[id]/concepts` | `sets/[id]/print` |
| `profile`, `profile/learner`, `profile/memory`, `profile/activity/[id]` | `login`, `signup`, `signup/check-email` |
| `account`, `settings/ai`, `settings/ai/[provider]`, `settings/study`, `help` | `forgot`, `reset/[token]`, `verify/[token]` |
| `concepts` | |

Route groups do not affect URLs, so `(app)/sets/[id]/page.tsx` resolves to `/sets/[id]`
and `sets/[id]/quiz/page.tsx` resolves to `/sets/[id]/quiz` with no conflict. This is
the documented Next.js pattern for exactly this case.

**Root `layout.tsx` keeps only** `<html>`, `<body>`, `ThemeProvider`, `Toaster`. It
loses `Navbar` and it loses `<main>`. `(app)/layout.tsx` supplies rail, topbar, and the
single content wrapper.

### 3.1 Why activities are bare

A timed matching game with a navigation column beside it is a game inviting you to
leave. `/print` and `/quiz/print` must be chrome-free for the PDF export to be usable at
all. Auth pages are pre-session and have nothing to navigate to.

`Navbar.tsx` is **deleted**, not left orphaned. Auth pages currently get it and lose it;
that is correct — a sign-in form does not need a Library link.

---

## 4. The left rail

`src/components/shell/SideRail.tsx` (server) + `RailNav.tsx` (client, active state).

```
+--------------+---------------------------+
|  Quizlet v2  |                       (o) |
|              |                           |
|  Home        |   Jump back in            |
|  Browse      |   +-----+ +-----+ +-----+ |
|  Library     |   |     | |     | |     | |
|  New set     |   +-----+ +-----+ +-----+ |
| ------------ |                           |
| RECENTS      |   Recommended             |
|  DCF Drills  |   +-----+ +-----+         |
|  Accounting  |   |     | |     |         |
|  LBO Basics  |   +-----+ +-----+         |
+--------------+---------------------------+
```

**Width 240px at `lg`+.** Below `lg` it is a drawer behind a hamburger in the topbar.

**Recents in the rail is the point.** Quizlet's rail is not a moved navbar — it is a
workspace, and what makes it one is the live list of what you were just working on.
`loadRecentSets` already exists, already re-applies `readableSetWhere` at read time, and
already returns `RecentSet[]` with `isOwn` and `ownerHandle`. The rail takes 6 (the
homepage strip keeps 8); a rail longer than that competes with the page.

**A set that goes private disappears from your rail** for free, because the read is
re-authorized rather than trusting the stored `SetView` row. That behaviour is inherited,
not re-implemented.

### 4.1 Active state — the one non-obvious rule

`/sets` must **not** light up when you are on `/sets/abc123`. A `startsWith` test marks
Library current on every set page, every edit page, and every activity.

`ProfileNav.isCurrentTab` already documents this exact trap for the profile tabs. Same
rule here, extracted as a pure exported function so it is testable without a router:

```ts
export function isRailItemCurrent(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href
}
```

Exact match, with `/` special-cased because every path starts with it. A recents row is
current when the pathname equals that set's own URL.

### 4.2 Signed out

The rail still renders: Home, Browse, and Sign in. No recents section, no avatar.
`/browse` exists specifically to convince a stranger the app is worth an account, and
showing them the workspace is that argument. A bare `/browse` for visitors would make
the product look smaller than it is at the exact moment it is being judged.

---

## 5. Avatar

### 5.1 Default: a generated glyph

Reuses the FNV-1a + xorshift32 generator behind `SetGlyph` (`src/lib/sets/glyph.ts`),
which already draws deterministic node-and-edge marks on `/browse`.

**One deliberate difference: a seed-derived hue.** Set glyphs render in `currentColor`,
which is right when they sit in a list of sets — the mark distinguishes, the title
identifies. An avatar has no title beside it in the topbar, so two users' marks in the
same color are far harder to tell apart than two sets' are. `src/lib/users/avatar.ts`
derives an OKLCH hue from the same seed and returns it alongside the nodes.

New module rather than a parameter on `buildGlyph`: the set glyph's `categoryCount`
input has no meaning for a user, and threading a nullable count through a working
function to serve a second caller is how a pure module stops being readable.

### 5.2 Upload: a new column, NOT `User.image`

`User.image` is owned by the Auth.js Prisma adapter and repopulated from the GitHub
profile on sign-in. Storing an uploaded photo there means GitHub silently overwrites it
on the next OAuth sign-in — a bug that would present as "my picture keeps reverting" and
would be very hard to attribute.

```prisma
/// OUR avatar. Deliberately not `image`, which the Auth.js adapter owns and
/// refreshes from the OAuth profile on sign-in. A photo stored there is
/// silently reverted by GitHub; this column is never written by the adapter.
avatarUrl String?
```

Resolution order, as a pure function so the precedence is tested:

```ts
resolveAvatar({ avatarUrl, image, seed }) // uploaded -> OAuth -> glyph
```

### 5.3 Storage: public blob, deliberately

`access: 'public'`, with the reason written at the call site. An avatar sits beside a
published set and is seen by strangers; a private blob would add a proxy hop to every
render and buy no privacy, because the image is by definition public-facing.

**This is the same word that was a security bug in the fork copier last session**, where
`access: 'public'` would have made forked card assets fetchable without authentication,
routing around `/api/assets/[id]`. The distinction is that a card asset is private
content and an avatar is not. Because the two call sites now disagree, the enforcement
suite must assert **both** directions: avatars public *on purpose*, fork copies still
private. A future reader "fixing" the inconsistency in either direction breaks the build.

### 5.4 Limits

- **<= 2 MB.** Larger is not a better avatar; it is a slower page.
- **`image/png`, `image/jpeg`, `image/webp` only.**
- **Validated by magic bytes, not the declared `Content-Type`.** The declared type is
  client-controlled and is not evidence of anything. A pure `sniffImageType(bytes)`
  returns the real type or null; a mismatch with the declared type is a rejection.
- **The old blob is deleted on replace**, so a user swapping their picture ten times
  leaves one object rather than ten.

---

## 6. Profile menu

`src/components/shell/ProfileMenu.tsx`, client, on the existing Base UI popover
(`src/components/ui/popover.tsx`).

```
                    +----------------+
                    |     ( o )      |
                    |  Change photo  |
                    |  @alice_ng     |
                    | -------------- |
                    |  Settings      |
                    |  Learning      |
                    |  AI settings   |
                    |  Other         |
                    |  Help          |
                    | -------------- |
                    |  Sign out      |
                    +----------------+
```

| Row | Icon (lucide) | Destination |
| --- | --- | --- |
| Settings | `Settings` (gear) | `/account` |
| Learning | `GraduationCap` (hat) | `/profile` |
| AI settings | `Bot` (robot) | `/settings/ai` |
| Other settings | `SlidersHorizontal` | `/settings/study` |
| Help & feedback | `LifeBuoy` | `/help` |
| Sign out | `LogOut` | `handleSignOut` |

The avatar at the top of the menu is itself a button; it opens the change-photo dialog.
That is the "click the profile picture after expanding" the user asked for — the topbar
avatar opens the menu, the menu's avatar changes the picture. Two different targets, so
neither action can be taken by accident.

`ThemeToggle` stays in the topbar rather than moving into this menu. It is a control you
use, not a setting you visit, and burying a one-click toggle two clicks deep is a
downgrade.

---

## 7. Settings reorganization

Today `/settings/ai` holds credentials + task routing **and** four scoring panels
(`SeverityBandPanel`, `MetricThresholdPanel`, `TargetingStrategyPanel`,
`StudyScopePanel`). Its own source comments already flag this as provisional: *"they
live here because this is where the learner already comes to tune how the app judges
them. If this route ever narrows to strict credential management, they move rather than
go."* It is now narrowing, so they move.

- **`/settings/ai`** — `CredentialList` + `TaskRoutingPanel`. Nothing else.
- **`/settings/study`** (new) — the four scoring panels. "Other settings" in the menu.

**`/settings/ai` keeps its URL.** All 8 existing links to it — from `/account`,
`/profile/learner`, the quiz error state, `StudyNext`, `ScopeLine`, and the credential
components — are error-state deep links about *credentials*, and every one of them still
lands correctly with no redirect to maintain.

---

## 8. Help & feedback

### 8.1 Data first, mail second

```prisma
model Feedback {
  id        String   @id @default(cuid())
  userId    String?
  name      String
  email     String
  subject   String
  message   String   @db.Text
  delivered Boolean  @default(false)
  createdAt DateTime @default(now())
  user      User?    @relation(fields: [userId], references: [id], onDelete: SetNull)
  @@index([userId, createdAt])
}
```

The row is written **before** mail is attempted; `after()` then sends and flips
`delivered`. This ordering is the whole design, and the reason is written into
`src/lib/mail/send.ts` already:

> **MUST NEVER THROW.** [...] The cost, stated plainly: a broken mail configuration is
> QUIET. A user whose message bounced sees "check your inbox" and nothing arrives.

With email-only delivery, a missing or expired `RESEND_API_KEY` means the submitter sees
"thanks, sent" and the message exists nowhere. `RESEND_API_KEY` is absent in this
environment right now, so that is the *default* state, not an edge case.

`userId` is `SetNull` on delete: a feedback message is a record of something that
happened, and deleting the account should not erase the report.

### 8.2 Destination

`FEEDBACK_TO` env var, defaulting to `ngong7053@gmail.com`. Env rather than a literal
because the address is an operator's personal inbox and this repo's `.env.example`
convention exists for exactly this.

### 8.3 The reply-to trap

The message must be **from** the verified sender with **reply-to** the submitter. Resend
rejects an unverified from-address outright, so "from: the user" bounces every single
message — and `sendQuietly` swallows the bounce, so it bounces *silently*.

`MailMessage` has no `replyTo` field today. Three-line addition to
`src/lib/mail/transport.ts`, optional, passed through to Resend's `reply_to`.

### 8.4 Rate limiting

Counted from the user's own recent `Feedback` rows — max 5 per hour. No new table, no
new store. Pure predicate (`withinFeedbackRate(recentCount)`) so the rule is tested
without a clock or a database.

### 8.5 Signed in only

The menu that reaches it is behind the avatar. A signed-out feedback form is an
unauthenticated write endpoint that emails an operator's personal inbox, which is a spam
relay with extra steps.

---

## 9. The visual pass

The Task 3 agent's diagnosis from the last session, which this spec accepts:

> "Generic AI CRUD app" is mostly a **layout and density** problem, not a token problem.
> Every surface is a centered `max-w-6xl` column of equal-weight cards where nothing is
> more important than anything else.

Phase 0 (the "Instrument" chassis — tokens, type scale, `Section`, `Metric`) shipped
with the sharing work. This spec spends that chassis on every shelled page:

1. **One measure, set by the shell.** Content column is `max-w-[72rem]`; pages that are
   genuinely single-column forms (`/account`, `/settings/*`, `/help`) opt into a
   narrower measure via a shared `PageHeader` + `prose`-width wrapper rather than
   re-centering themselves.
2. **`Section` replaces `Card` as the page-level unit.** A hairline rule and a header,
   not a shadowed box. `Card` survives for things that are genuinely objects — set
   tiles, directory rows — and stops being the wrapper for every heading on every page.
3. **Elevation goes.** 13 hardcoded `shadow-*` utilities across components. Noted as
   unbuilt in Phase 0 because it is not token-expressible; done here as component edits.
4. **The settings pages get a shared two-column form layout** — label and description on
   the left, control on the right — instead of a vertical stack of full-width cards. This
   is the single biggest density win available and it costs one component.

Pages in scope: home, browse, library, set detail (frame only), account, both settings
pages, help, all three profile pages, concepts.

---

## 10. Testing

**Pure functions, unit tested:**

| Function | Module | What must not regress |
| --- | --- | --- |
| `isRailItemCurrent` | `lib/shell/nav.ts` | `/sets` is not current on `/sets/abc` |
| `railItems` | `lib/shell/nav.ts` | signed-out set omits Library and New |
| `buildAvatarGlyph` | `lib/users/avatar.ts` | deterministic per seed; hue in range |
| `resolveAvatar` | `lib/users/avatar.ts` | `avatarUrl` beats `image` beats glyph |
| `sniffImageType` | `lib/users/image-sniff.ts` | a lying `Content-Type` is rejected |
| `feedbackSchema` | `lib/feedback/schema.ts` | every field bounded; email shape |
| `withinFeedbackRate` | `lib/feedback/rate.ts` | boundary at exactly 5 |

**Guards that must be proven red by mutation** (this repo has shipped five guards that
could not fail; two of them last session):

- Avatar upload rejects a PNG-declared file whose bytes are not a PNG. *Mutate:* make
  `sniffImageType` return the declared type. Must go red.
- `submitFeedback` writes the row **before** attempting mail. *Mutate:* reorder. Must go
  red. This is not a source-level `includes()` — the test drives a fake mail transport
  that throws, and asserts the row exists afterwards.
- `submitFeedback` ignores a client-supplied `userId`. *Mutate:* trust the input.
- Avatar blobs are `access: 'public'` **and fork copies are still `access: 'private'`**.
  Both directions, in `tests/sets/visibility-enforcement.test.ts`. *Mutate:* swap either.
  The mock must capture the options argument — last session's fork mock took `(from, to)`
  and discarded options, which is precisely why the real bug stayed green.

**Route structure:** a test asserts every path in the bare list has no `(app)` ancestor,
so a later file move cannot quietly put a nav rail on the print view.

---

## 11. Migration

One migration, `20260829000000_app_shell`:

- `User.avatarUrl String?`
- `Feedback` table + index

Both additive and nullable. No backfill; no existing row changes meaning.

---

## 12. Out of scope, stated so it is not re-litigated

- **Study / Knowledge / Analysis tabs and the Atlas set surfaces.** Spec C.
- **Notifications.** Quizlet's rail has one; there is nothing to notify about yet.
- **Collaborators / "Editable by".** Cut from 6c, still designed, still unbuilt.
- **Moving `/profile/*` to `/learning/*`.** 23 call sites including `revalidatePath`
  strings and scope query params. Its own change, as `ProfileNav` already records.
- **Signed-out feedback.** §8.5.
- **i18n / language selector.** `/account` already documents why: there is no i18n at
  all, and a selector with one entry is a promise the app cannot keep.

---

## 13. Live gate

Not agent-runnable here — `.env` holds only `DATABASE_URL`, so `auth()` throws
`MissingSecret`. Owed to the user, in order:

1. Rail renders on `/`, `/browse`, `/sets`, `/sets/[id]`, `/account`, `/settings/*`.
2. Rail is **absent** on `/sets/[id]/quiz`, `/match`, `/review`, `/print`.
3. `/sets/[id]/print` still produces a clean PDF via browser print.
4. On `/sets/abc`, the rail's **Library row is not highlighted**. (§4.1)
5. A set opened once appears in the rail's Recents; made private by its owner, it
   disappears from a *different* account's rail on reload.
6. Signed out, the rail shows Home / Browse / Sign in and no avatar.
7. Upload an avatar; sign out; sign in **with GitHub**; the uploaded picture survives.
   (§5.2 — this is the failure mode `User.image` would have caused.)
8. Rename a `.txt` to `.png` and upload it. Rejected.
9. Submit feedback with `RESEND_API_KEY` unset. `Feedback` row exists with
   `delivered: false`; the message body is in the server log. (§8.1)
10. Every one of the 8 existing `/settings/ai` deep links still lands on credentials.
