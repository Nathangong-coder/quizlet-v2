'use server'

/**
 * Granting and revoking roles.
 *
 * A SEPARATE module from src/actions/staff.ts because these are WRITES on the
 * admin gate, and the read module is on the staff gate. Mixing them would mean
 * one file where some exports need requireAdmin and others requireStaff, which
 * is exactly the shape a reviewer misreads.
 *
 * Every export gates in its own body — each is an RPC endpoint.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAdmin, type StaffSession } from '@/lib/staff/access'
import { isKnownRole, DEFAULT_ROLE, USER_ROLES } from '@/lib/auth/roles'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }
const SELF_TARGET: ActionResult<never> = {
  success: false,
  error: 'You cannot revoke your own role. Use npm run grant-role.',
}

/**
 * Refuse any write that targets the caller's own role.
 *
 * The last admin demoting themselves locks the install out of /staff/roles
 * permanently, recoverable only from `npm run grant-role`. revokeRole and
 * grantRole are two doors to that same state, so the check lives in one
 * place both must pass through — a second copy is a second thing to forget.
 *
 * ALL self-targeting is refused, not merely self-demotion: an admin granting
 * themselves 'admin' is a no-op, so every self-grant that changes anything is
 * a downgrade. Deliberately NOT exported — an exported helper in a
 * 'use server' module is itself an RPC endpoint, and the structural guard
 * (tests/actions/klt-gated-exports-guard.test.ts) treats an exported,
 * non-gated function as a violation.
 */
function refuseSelfTarget(admin: StaffSession, userId: string): ActionResult<never> | null {
  return userId === admin.userId ? SELF_TARGET : null
}

/**
 * Existence check ahead of the write, not a catch around it. `user.update`
 * inside the transaction throws P2025 on a missing row, and grantRole's
 * roleGrant.create would additionally hit a foreign-key violation (P2003) on
 * the same missing id — two different Prisma error shapes to translate for
 * one outcome. Checking first keeps both callers returning the same
 * ActionResult shape every other failure here uses, instead of leaking a
 * raw Prisma error message out of the action.
 */
async function userExists(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  return user !== null
}

export async function grantRole(input: {
  userId: string
  role: string
}): Promise<ActionResult<null>> {
  const admin = await requireAdmin()
  if (!admin) return NOT_FOUND

  const selfTarget = refuseSelfTarget(admin, input.userId)
  if (selfTarget) return selfTarget

  if (!isKnownRole(input.role)) {
    return { success: false, error: `Role must be one of: ${USER_ROLES.join(', ')}` }
  }

  if (!(await userExists(input.userId))) return NOT_FOUND

  await prisma.$transaction([
    // Close any open grant first, so the history reads as a sequence of states.
    prisma.roleGrant.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({ where: { id: input.userId }, data: { role: input.role } }),
    prisma.roleGrant.create({
      data: { userId: input.userId, role: input.role, grantedById: admin.userId },
    }),
  ])

  revalidatePath('/staff/roles')
  return { success: true, data: null }
}

export async function revokeRole(input: { userId: string }): Promise<ActionResult<null>> {
  const admin = await requireAdmin()
  if (!admin) return NOT_FOUND

  // The last admin revoking themselves locks the install out of this page
  // permanently. Refuse it here rather than trusting a disabled button.
  const selfTarget = refuseSelfTarget(admin, input.userId)
  if (selfTarget) return selfTarget

  if (!(await userExists(input.userId))) return NOT_FOUND

  await prisma.$transaction([
    prisma.user.update({ where: { id: input.userId }, data: { role: DEFAULT_ROLE } }),
    prisma.roleGrant.updateMany({
      where: { userId: input.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ])

  revalidatePath('/staff/roles')
  return { success: true, data: null }
}

export async function searchUsers(input: {
  q: string
}): Promise<ActionResult<{ id: string; label: string; role: string }[]>> {
  if (!(await requireAdmin())) return NOT_FOUND

  const q = input.q.trim()
  if (q.length < 2) return { success: true, data: [] }

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { handle: { contains: q, mode: 'insensitive' } },
        { name: { contains: q, mode: 'insensitive' } },
      ],
    },
    select: { id: true, handle: true, name: true, email: true, role: true },
    take: 10,
  })

  return {
    success: true,
    data: users.map((u) => ({ id: u.id, label: u.handle ?? u.name ?? u.email, role: u.role })),
  }
}
