/**
 * Who can read a set.
 *
 * A single `as const` with the type DERIVED from it, following
 * `CARD_KLP_STATUSES` (`src/lib/cards/klp-status.ts`) and `AI_TASKS`
 * (`src/lib/ai/model-routing.ts`). `Set.visibility` is a `String` column, so a
 * typo compiles cleanly and silently never matches — import this const rather
 * than writing a literal.
 *
 * Two states only. There is no public directory and no discovery: `link` means
 * "anyone holding the id may read it", nothing more.
 */
export const SET_VISIBILITIES = ['private', 'link'] as const

export type SetVisibility = (typeof SET_VISIBILITIES)[number]

/**
 * Narrow a value read from the database.
 *
 * FAILS CLOSED: an unrecognised value resolves to `private`, never `link`. The
 * cost of wrongly hiding a set is an annoyed owner; the cost of wrongly
 * exposing one is the bug this module exists to close. Note this differs in
 * REASON from `toCardKlpStatus`, which degrades to the column default because
 * that default is harmless — here the safe value and the column default happen
 * to coincide, and the safety is why, not the coincidence.
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
  return toSetVisibility(set.visibility) === 'link'
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
 * that already has its own `OR` REPLACES it. No current call site has one; if
 * that changes, combine under an explicit `AND: [...]`.
 */
export function readableSetWhere(viewerId: string | null): Record<string, unknown> {
  if (viewerId === null) return { visibility: 'link' }
  return { OR: [{ userId: viewerId }, { visibility: 'link' }] }
}
