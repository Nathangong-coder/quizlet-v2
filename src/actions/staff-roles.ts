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
import { requireAdmin } from '@/lib/staff/access'
import { isKnownRole, DEFAULT_ROLE, USER_ROLES } from '@/lib/auth/roles'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }

export async function grantRole(input: {
  userId: string
  role: string
}): Promise<ActionResult<null>> {
  const admin = await requireAdmin()
  if (!admin) return NOT_FOUND

  if (!isKnownRole(input.role)) {
    return { success: false, error: `Role must be one of: ${USER_ROLES.join(', ')}` }
  }

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
  if (input.userId === admin.userId) {
    return { success: false, error: 'You cannot revoke your own role. Use npm run grant-role.' }
  }

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
