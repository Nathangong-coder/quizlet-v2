# Study groups — design

**Date:** 2026-09-13 · **Status:** built on `study-platform` (sub-project 5 of 6); **signed-in
live gate owed** (§5)
**Builds on:** `src/lib/sets/study-summary.ts` (the per-set summary shape), `CardProgress`,
`StudySession`, `2026-09-13-public-profiles-and-sharing-design.md` (handles)
**Migration:** `20260913140000_study_groups` (applied to the dev database 2026-09-13)

## §0 The privacy contract

Joining a group lets its members see **your progress on the group's sets, and nothing
else**: cards studied and mastered, mean confidence, last studied, time studied, and — card by
card — whether you have it down. Not your other sets, not your written answers, not your
memory history, not your email or name (handle only).

**There is no snapshot.** Every number a member sees is computed live by the pure
`shapeSetLeaderboard` (`src/lib/groups/progress.ts`) from `CardProgress` and `StudySession`
rows the loader filtered to (member of THIS group) × (card of THIS group's sets readable by
the viewer). Leaving ends the sharing at once and there is nothing to erase.

**Consent is enforced in the action, not only on the page.** `joinGroup(code, acknowledged)`
refuses unless `acknowledged === true` (a truthy string does not pass). The join page
(`/groups/join/<code>`) is the contract in prose — what they see, what they do not, that
leaving stops it — with a checkbox that enables Join. The group page reminds the owner that
every joiner has accepted this.

## §1 Decisions

1. **Private only.** A group is reached by its invite link (`/groups/join/<code>`, a 16-char
   80-bit code the owner can rotate; the old link 404s). No directory.
2. **Only link/public sets can be attached.** Membership grants NO read rights;
   `readableSetWhere` is untouched by this feature. Attaching a private set is refused with
   the fix in the message. A set that later goes private stays attached but renders "no
   longer shared" and is excluded from every number.
3. **Leaderboard, explicit.** Ranked by mastered (confidence ≥ `MASTERED_CONFIDENCE` = 7),
   then studied, then mean confidence; ties share a rank (1, 1, 3); a member with no rows sits
   last with zeros and a **null** average, never 0. Breakdown per member: mastered / learning /
   not started as a stacked bar, mean confidence, time, last studied. Confidence, not KLP
   mastery, because it exists on every card in every mode and KLP state only where key
   points were authored.
4. **Card by card** (`/groups/[id]/sets/[setId]`): every card with who has it mastered ("ask
   @alice") and how many are still learning it.
5. **The owner is also a member row**, so "everyone in the group" is one query and the
   owner's own progress ranks. The owner cannot leave (delete instead) or remove themself.
   Any member may attach a set; the owner or whoever attached it may detach.

## §2 Schema

`StudyGroup` (name, description, ownerId, `inviteCode @unique`), `StudyGroupMember`
(`@@unique([groupId, userId])`, role `owner | member` — `GROUP_ROLES`), `StudyGroupSet`
(`@@unique([groupId, setId])`, `addedById`). All cascade from their parents; a deleted set
drops out of every group.

## §3 Surfaces

`/groups` (yours; rail item "Groups"), `/groups/new`, `/groups/[id]` (invite link, members
with remove-for-owner, sets with a compact leaderboard each and an "add a set" picker of the
caller's shared sets, settings for the owner, leave/delete), `/groups/[id]/sets/[setId]`
(full leaderboard + card coverage), `/groups/join/[code]`. All signed-in; membership failures
are 404 not 403 so a stranger cannot probe ids. Loader and action files, and both group
pages, are on the visibility enforcement list.

## §4 Tests

`tests/groups/progress.test.ts` (threshold, unstudied → null average and last, shared ranks,
session time and last-studied, stranger/out-of-set rows ignored, per-card coverage sorted,
invite code shape/rejection), `tests/groups/actions.test.ts` (consent gate incl. truthy
non-boolean, malformed code rejected pre-query, membership as credential across six actions,
member vs owner rights, owner cannot leave/remove self, private set refused, unreadable set
"not found", detach rights), `tests/groups/components.test.tsx` (leaderboard render, join
card gate, existing-member branch). Route-structure and enforcement guards extended.

## §5 Live gate owed

The signed-out probes redirect correctly; the signed-in flow (create → invite → join on a
second account → attach a set → leaderboard → card view → leave) has not been walked in a
browser, because the agent cannot sign in. Walk it once.

## §6 Out of scope

Public/discoverable groups; group chat or comments; per-member privacy toggles inside a
group (the contract is all-or-nothing by design — join or don't); showing game activity
(games write nothing, so there is nothing to show); notifications.
