import { prisma } from '@/lib/db'
import { DEFAULT_ROLE } from '@/lib/auth/roles'

/**
 * The token claim holding `User.sessionVersion`.
 *
 * Short because it rides in every request's cookie.
 */
export const SESSION_VERSION_CLAIM = 'sv' as const

type TokenLike = {
  sub?: string
  [SESSION_VERSION_CLAIM]?: number
  role?: string
  [key: string]: unknown
}

/**
 * The `user` argument, as loosely as it can honestly be described.
 *
 * It is whatever a provider's `authorize` or an adapter's `getUser` returned,
 * so the only field this code may rely on is `id`. It is a type PARAMETER
 * rather than this type directly so that a caller handing over a richer object
 * (a full `AdapterUser`, a row with extra columns) type-checks — widening here
 * is what keeps the wiring in `src/auth.ts` cast-free.
 */
type UserLike = { id?: string }

/**
 * The session's `user`, as Auth.js's default shape has it: an id plus the
 * display fields. The non-id fields are `unknown` because nothing here reads
 * them — they exist so that a session object which carries only, say, a name
 * still satisfies the constraint.
 */
type SessionUserLike = { id?: string; role?: string; name?: unknown; email?: unknown; image?: unknown }

/**
 * Revocation for a strategy that has none.
 *
 * Sessions are JWT (`src/auth.ts`), so there is no row to delete: a stolen or
 * stale token stays valid until it expires. Every resolution therefore
 * re-reads the user's `sessionVersion` and drops the token if it has moved.
 *
 * The cost is one primary-key lookup per session resolution. That was accepted
 * rather than optimised with a TTL claim, because a server component cannot
 * set cookies — so a "last checked at" stamp written here would frequently
 * fail to persist, and the optimisation would be unreliable in exactly the
 * places it was meant to help. Correct and predictable beats clever here.
 *
 * NOTE ON MIDDLEWARE: `src/middleware.ts` builds its own Auth.js instance from
 * `authConfig`, which does NOT carry these callbacks — it cannot, since Prisma
 * does not run on the edge. Middleware therefore accepts a revoked-but-unexpired
 * token for its is-signed-in check; every page, action and route that calls
 * `auth()` still rejects it. Revocation is enforced where data is reached, not
 * at the redirect.
 */
export async function jwtCallback<U extends UserLike>({
  token,
  user,
}: {
  token: TokenLike
  user?: U | null
}): Promise<TokenLike | null> {
  if (user?.id) {
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { sessionVersion: true, role: true },
    })
    // Read from the database rather than from `user`: the argument's shape
    // depends on the provider and adapter, and a missing field would silently
    // stamp `undefined`.
    return {
      ...token,
      sub: user.id,
      [SESSION_VERSION_CLAIM]: row?.sessionVersion ?? 0,
      role: row?.role ?? DEFAULT_ROLE,
    }
  }

  if (!token.sub) return null

  const current = await prisma.user.findUnique({
    where: { id: token.sub },
    select: { sessionVersion: true, role: true },
  })
  if (!current) return null

  // Strict equality, so an ABSENT claim invalidates. Tokens issued before this
  // shipped carry no `sv`; treating absent as "fine" would leave every one of
  // them permanently unrevokable.
  if (token[SESSION_VERSION_CLAIM] !== current.sessionVersion) return null

  // REWRITTEN every resolution, never trusted from the incoming token. The
  // token is a cache the browser holds; the database is the answer. A revoked
  // admin must stop being an admin on their next request, not when their token
  // expires.
  return { ...token, role: current.role ?? DEFAULT_ROLE }
}

/**
 * Copies the token's subject onto the session the client sees.
 *
 * Generic in the session so the id survives into the return type without this
 * module having to restate Auth.js's `Session` (and without an index-signature
 * constraint that a real `Session` cannot satisfy).
 */
export async function sessionCallback<S extends { user?: SessionUserLike }>({
  session,
  token,
}: {
  session: S
  token: TokenLike
}): Promise<S & { user?: { id?: string; role?: string } }> {
  if (session.user && token.sub) {
    session.user.id = token.sub
  }
  if (session.user) {
    session.user.role = typeof token.role === 'string' ? token.role : DEFAULT_ROLE
  }
  // `sv` is deliberately not copied across: it is a revocation mechanism, not
  // information the browser has any use for.
  return session
}
