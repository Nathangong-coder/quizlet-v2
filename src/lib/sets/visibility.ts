/**
 * Who can read a set.
 *
 * A single `as const` with the type DERIVED from it, following
 * `CARD_KLP_STATUSES` (`src/lib/cards/klp-status.ts`) and `AI_TASKS`
 * (`src/lib/ai/model-routing.ts`). `Set.visibility` is a `String` column, so a
 * typo compiles cleanly and silently never matches — import this const rather
 * than writing a literal.
 *
 * Three states. `private` is owner-only; `link` means "anyone holding the id
 * may read it, and it is listed NOWHERE"; `public` means readable AND listed
 * in /browse.
 *
 * `link` and `public` are deliberately NOT collapsed. They answer different
 * questions — "may this be read?" and "should this be advertised?" — and a
 * learner who shared a study-group link did not thereby ask to be published.
 * Collapsing them would silently publish every already-shared set on deploy.
 */
export const SET_VISIBILITIES = ['private', 'link', 'public'] as const

export type SetVisibility = (typeof SET_VISIBILITIES)[number]

/**
 * The visibilities that are readable by someone who is not the owner.
 *
 * Derived by exclusion rather than written out, so adding a fourth visibility
 * cannot leave this list silently stale — the one way this module goes wrong
 * without any test noticing.
 */
export const READABLE_VISIBILITIES = SET_VISIBILITIES.filter(
  (v): v is Exclude<SetVisibility, 'private'> => v !== 'private',
)

/**
 * Narrow a value read from the database.
 *
 * FAILS CLOSED: an unrecognised value resolves to `private`, never `link` and
 * above all never `public`. The cost of wrongly hiding a set is an annoyed
 * owner; the cost of wrongly exposing one is the bug this module exists to
 * close. Note this differs in REASON from `toCardKlpStatus`, which degrades to
 * the column default because that default is harmless — here the safe value
 * and the column default happen to coincide, and the safety is why, not the
 * coincidence.
 */
export function toSetVisibility(raw: string): SetVisibility {
  return (SET_VISIBILITIES as readonly string[]).includes(raw)
    ? (raw as SetVisibility)
    : 'private'
}

/**
 * Can this viewer read this set? For callers that ALREADY hold the row.
 *
 * Only two legitimately do: the asset route, which reaches the set through a
 * join from the asset, and the UI, which needs to know whether to render the
 * owner-only visibility control. Everything else must use `readableSetWhere`
 * — see its doc comment for why that distinction matters.
 *
 * `viewerId` is `null` for an anonymous visitor. Pass an explicit
 * `session?.user?.id ?? null`, never a possibly-undefined id: `undefined ===
 * undefined` would make two signed-out visitors "the same user" and match a
 * set whose `userId` was somehow nullish.
 */
export function canReadSet(
  set: { userId: string; visibility: string },
  viewerId: string | null,
): boolean {
  if (viewerId !== null && set.userId === viewerId) return true
  // `!== 'private'` rather than `=== 'link'`. Written positively against the
  // readable list, this is the one line that has to change every time a
  // visibility is added; written negatively it never does.
  return toSetVisibility(set.visibility) !== 'private'
}

/**
 * A Prisma `where` fragment for "sets this viewer may read". Spread it into an
 * existing `where` alongside the id.
 *
 * THE FRAGMENT IS THE POINT, not a convenience over `canReadSet`. Every one of
 * the ten pre-existing leaks had the same shape: `findUnique({ where: { id } })`
 * followed by an ownership check that was absent, or present but gating only
 * the UI. A post-hoc predicate reproduces exactly that hazard — it is one
 * forgotten line away from a leak, and the forgotten line looks like working
 * code.
 *
 * Embedding the rule in the query inverts the failure mode: a call site that
 * forgets it returns NOTHING, which is a visible bug, rather than EVERYTHING,
 * which is a silent one. Same argument `buildCardScopeWhere`
 * (`src/lib/memory/scope.ts`) makes for scope semantics.
 *
 * Note this forces `findFirst` over `findUnique` at every call site, since
 * `findUnique` accepts only unique fields. That is a feature: a surviving
 * `prisma.set.findUnique` on a read path is visible proof the guard was never
 * applied, and a test asserts there are none.
 *
 * Returns a bare `OR` for a signed-in viewer, so spreading this into a `where`
 * that already has its own `OR` REPLACES it. Use `composeSetWhere` for every
 * read that carries a predicate of its own.
 */
export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  // `in`, NOT a second OR. Making this branch an OR would give BOTH branches
  // the replace-my-OR hazard at exactly the moment the directory arrives as
  // the first call site with an OR of its own. See spec §3.1.
  const readable = { visibility: { in: READABLE_VISIBILITIES } }
  if (viewerId === null) return readable
  return { OR: [{ userId: viewerId }, readable] }
}

/**
 * A Prisma `where` fragment for "sets that may be ADVERTISED in the directory".
 *
 * Separate from `readableSetWhere` because listing and reading are different
 * questions. `listingBlocked` is an OPERATOR decision (spec §10) and is
 * checked here rather than in `readableSetWhere` on purpose: an unlisted set
 * stays readable by anyone holding its id — moderation removes it from the
 * shop window, it does not retroactively break every link already shared.
 *
 * ALWAYS compose this with `readableSetWhere` via `composeSetWhere`, never
 * alone. `visibility: 'public'` looks like it makes the readable fragment
 * redundant; the day someone adds "also show my own private sets here" is the
 * day a hand-rolled filter leaks and a composed one does not.
 */
export function listableSetWhere(): Record<string, unknown> {
  return { visibility: 'public', listingBlocked: false }
}

/**
 * Compose the readable fragment with additional clauses under an explicit
 * `AND`.
 *
 * THE REASON THIS EXISTS: `readableSetWhere` returns a bare `OR` for a
 * signed-in viewer, and JavaScript object spread makes a second `OR` REPLACE
 * it rather than combine with it. The directory's title/description search is
 * an `OR`. Spreading both at one level widens the query to every set in the
 * database — and it still returns plausible-looking results while doing it,
 * which is why the failure cannot be caught by looking at the page.
 *
 * Use this for every set read that carries a predicate of its own. A read with
 * nothing but an id may still spread the fragment directly.
 */
export function composeSetWhere(
  viewerId: string | null,
  ...clauses: Record<string, unknown>[]
): Record<string, unknown> {
  return { AND: [readableSetWhere(viewerId), ...clauses] }
}
