# Public profiles & sharing — design

**Date:** 2026-09-13 · **Status:** built on `study-platform` (sub-project 4 of 6)
**Builds on:** `2026-08-27-public-sets-and-discovery-design.md` (which cut profile pages),
`src/lib/users/handle.ts`
**Migration:** `20260913130000_user_bio` (applied to the dev database 2026-09-13)

## §0 Decisions

1. **`/u/<handle>`, not `/<handle>`.** `RESERVED_HANDLES` protects today's routes, but every
   top-level route added later (this branch added `/features`) would silently shadow the
   handle of anyone who had already chosen that word. A prefix makes the namespaces disjoint.
   `u` itself needs no reservation — a handle is at least three characters.
2. **Sets only.** A profile shows handle, avatar, one-line bio, member-since, and the user's
   public sets. No study numbers: streaks, answers and mastery are private evidence, and
   publishing them would be a decision the learner makes explicitly, through a control that
   does not exist yet. `User.name` (the OAuth real-name field) never reaches the page.
3. **A moderation-unlisted set does not resurface on its owner's profile.** The set list is
   `composeSetWhere(viewer, listableSetWhere(), { userId })` — readable AND listable AND
   owner, composed, never spread. Both the loader and the page are on the visibility
   enforcement list.
4. **Share lives on the set page.** A `ShareButton` in the header: for the owner, the three
   visibility options inline (same `setSetVisibility`, same optimistic-with-revert as the Edit
   screen's `VisibilityMenu`) plus **Copy link**, disabled while private; for a reader on a
   link/public set, Copy link only. The Edit screen keeps its menu.

## §1 Pieces

- `User.bio String?` — one line, `BIO_MAX_LENGTH` 160, `checkBio` collapses whitespace and
  turns empty into null. `saveBio` in `src/actions/account.ts`; `BioPanel` on `/account`,
  shown only once a handle exists (the bio renders nowhere else).
- `src/lib/users/public-profile.ts` — `loadPublicProfile(handle)` by **normalized** handle
  (so `/u/Alice` and `/u/alice` are one page, as they are one account); null for an unknown
  handle or a handle-less user. `loadProfileSets` returns `DirectoryEntry`s so the profile
  reuses `DirectoryCard`.
- `DirectoryCard` — the meta line moved OUT of the title link so `@handle` can be a real link
  to `/u/<handle>` (a link inside a link is invalid HTML; the parser drops the inner one).
  `showAuthor={false}` on the profile page itself.
- Set page header — "by @handle" under the card count, linking to the profile; handle only,
  and only when one exists.

## §2 Tests

`tests/users/public-profile.test.tsx` (composed where, unlisted excluded, bio rules, author
link outside the title link, no credit for a handle-less owner, unknown handle 404s before
any set read) and `tests/components/share-button.test.tsx` (reader copy, reader+private
renders nothing, owner sees three options with the current one selected).

## §3 Out of scope

Following; study stats on the profile (opt-in toggle — revisit with study groups' scoped
sharing); public folders; a profile link in the rail (reachable from `/account` and from
every `@handle`).
