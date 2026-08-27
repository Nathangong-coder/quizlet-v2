/**
 * Who may edit ONE SET's concept structure.
 *
 * Structure lives on `SetKltNode`, one row per (set, concept), so — unlike
 * the global tree this replaced — there IS an owner to compare against. The
 * rule is therefore "the set's owner, OR a `KLT_EDITORS` operator": the
 * per-set editor is for a power user tending their own deck, the admin view
 * is how the operator helps someone else and authors presets (spec Decision
 * 3, both editors kept).
 *
 * Decision 4 is what makes handing this to any owner safe: an admin edit is
 * not a broader edit, only a reachable one. This helper returns the ONE
 * `setId` every subsequent write must be scoped to, resolved from the
 * database rather than echoed back from the argument, so a caller physically
 * cannot widen its own scope — there is no code path that writes more than
 * one set's structure.
 *
 * NOT `readableSetWhere`. That fragment answers "may this viewer READ this
 * set", and a link-shared set is readable by anyone holding the id. Editing
 * its hierarchy is not a read.
 */
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { isKltEditor } from '@/lib/klt/editors'
import { readableSetWhere } from '@/lib/sets/visibility'

export interface SetKltAccess {
  userId: string
  /** The verified set id. Every write scopes to THIS, never to the argument. */
  setId: string
  /** The set's title — what pre-fills the AI seeding subject. */
  setTitle: string
  /** True when access came from the operator allowlist, not from ownership. */
  viaAllowlist: boolean
}

/**
 * Resolve edit access to one set's structure, or null.
 *
 * Null covers every failure identically — signed out, set does not exist,
 * set exists but belongs to someone else — and callers turn all of them into
 * the SAME not-found `ActionResult`. Never "forbidden": distinguishing
 * "not yours" from "does not exist" tells a stranger that a set id is real,
 * which is exactly the leak `readableSetWhere` exists to close on the read
 * side.
 *
 * The ownership rule is embedded in the QUERY (`userId` in the `where`) for
 * a non-operator, following `readableSetWhere`'s argument: a call site that
 * loses the guard returns nothing, which is a visible bug, rather than
 * everything, which is a silent one.
 */
export async function requireSetKltAccess(setId: string): Promise<SetKltAccess | null> {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return null

  const viaAllowlist = isKltEditor(userId)
  const set = await prisma.set.findFirst({
    where: viaAllowlist ? { id: setId } : { id: setId, userId },
    select: { id: true, title: true },
  })
  if (!set) return null

  return { userId, setId: set.id, setTitle: set.title, viaAllowlist }
}

export interface SetKltView {
  /** Null for an anonymous visitor holding the link. */
  viewerId: string | null
  /** The verified set id. */
  setId: string
  setTitle: string
  /** True exactly when `requireSetKltAccess` would also have succeeded. */
  canEdit: boolean
  /** True when edit access came from the operator allowlist, not ownership. */
  viaAllowlist: boolean
}

/**
 * Resolve READ access to one set's structure, or null.
 *
 * The doc comment above says `requireSetKltAccess` must not use
 * `readableSetWhere` because "editing its hierarchy is not a read". That
 * reasoning is unchanged and this helper is its other half: reading the
 * hierarchy IS a read, so it uses the same fragment the set page itself uses.
 * A link-shared set's tree is viewable by anyone holding the id — including,
 * deliberately, a signed-out visitor, because that same visitor can already
 * read every card the tree organizes. Refusing here would hide the map while
 * handing over the territory.
 *
 * `canEdit` is computed by the SAME rule the write gate applies (owner, or
 * operator), not by re-deriving a looser one — but it is only a UI hint.
 * Every write still calls `requireSetKltAccess` itself; nothing trusts this
 * flag to authorize anything.
 *
 * Null again covers every failure identically, for the reason
 * `requireSetKltAccess` documents: a distinguishable "forbidden" tells a
 * stranger a set id is real.
 */
export async function requireSetKltView(setId: string): Promise<SetKltView | null> {
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const viaAllowlist = viewerId !== null && isKltEditor(viewerId)
  const set = await prisma.set.findFirst({
    // An operator reaches any set, exactly as on the edit gate. Everyone else
    // goes through the read fragment, so a forgotten guard here returns
    // nothing rather than everything.
    where: viaAllowlist ? { id: setId } : { id: setId, ...readableSetWhere(viewerId) },
    select: { id: true, title: true, userId: true },
  })
  if (!set) return null

  return {
    viewerId,
    setId: set.id,
    setTitle: set.title,
    canEdit: viaAllowlist || (viewerId !== null && set.userId === viewerId),
    viaAllowlist,
  }
}
