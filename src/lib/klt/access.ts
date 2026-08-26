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
