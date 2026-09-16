# Subject taxonomy — design

**Date:** 2026-09-13 · **Status:** built on `study-platform` (sub-project 3 of 6)
**Migration:** `20260913120000_set_subject` (applied to the dev database 2026-09-13)

## §0 Decision

A set's subject is a **fixed two-level tree in code** (`src/lib/subjects/taxonomy.ts`): nine
groups (Business & Finance, Science, Maths, Languages, Arts & Humanities, Social Science,
Medicine & Health, Technology, Other), each with 3–8 leaves. `Set.subject` stores **one leaf
slug**, nullable; the group is derived, never stored, so a leaf can be moved between groups
by editing the file. Slugs are persisted, so a slug rename strands rows — add a leaf and
migrate instead. Labels are free to change.

Not user-defined, on purpose: the per-card **categories** are already the user-defined axis
(set-scoped, coloured, "which of my cards are talking points"), and this axis answers a
different question ("is this an accounting set") that Browse and the Library filter on, so it
has to mean the same thing for every user.

## §1 Surfaces

- **Set form** — `SubjectSelect`: a native `<select>` with an optgroup per group. `''` is
  "no subject". Persisted by `createSet` / `updateSet`; the Zod schema **fails closed** on an
  unknown or group slug (rejects, never coerces to null — a stale client's mistyped slug would
  otherwise silently drop the subject the owner thought they set). `SetInput` is now
  `z.input<…>` so the field stays optional for callers.
- **Fork** inherits the source's subject (a copy of an accounting set is an accounting set).
- **Set page** — `SubjectChip` ("Business & Finance · Accounting") above the title, linking
  to `/browse?subject=<leaf>`. Renders nothing for a null or unrecognised slug.
- **Browse** — `SubjectFilterBar`: a row of group chips and, once one is chosen, its leaves.
  URL-driven (`?subject=`), no client state. `loadDirectory` / `buildDirectoryWhere` take the
  value; `expandSubjectFilter` narrows a leaf to itself, a group to its leaves, and an
  **unknown value to nothing** (`{ in: [] }`) rather than everything. The search form carries
  the subject as a hidden field; the "More" cursor link carries it too. Directory rows show
  the subject path as plain text (the row is already a link).
- **Library** — the same bar on the Sets tab with **facet counts computed under the full
  scope** (a `groupBy(subject)` over the owner's sets with no subject filter), so choosing a
  subject does not zero out the others. Rows show the subject path in their meta line.

## §2 Tests

`tests/subjects/taxonomy.test.ts` (unique slugs, ≥3 leaves per group, leaf/group resolution,
filter expansion incl. unknown → nothing, path rendering) and
`tests/subjects/set-subject.test.ts` (action persists a leaf, stores null for empty/omitted,
rejects unknown and group slugs; directory where narrows leaf/group/unknown and keeps the
search OR as its own AND member; `countSubjects` rolls leaves into groups and drops unknown
slugs).

## §3 Out of scope

Backfilling subjects on existing sets (a subject is a claim the owner makes); AI-suggested
subjects on the form; subject landing pages beyond the filtered Browse; sub-subjects deeper
than two levels; Hot Seat's persona table (sub-project 6 reads `Set.subject`).
