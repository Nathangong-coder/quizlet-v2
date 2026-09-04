/**
 * Grant, list and revoke install-wide roles.
 *
 * Terminal-first, deliberately: this is the BOOTSTRAP. /staff/roles can grant
 * once someone is already an admin, and this is how the first one exists — and
 * how an operator who revoked themselves gets back in without a redeploy.
 *
 * The migration does NOT seed any admin from the old operator allowlist, so
 * after deploying, run this once.
 *
 * Run:
 *   npm run grant-role -- --list
 *   npm run grant-role -- --user <userId> --role admin
 *   npm run grant-role -- --email someone@example.com --role staff
 *   npm run grant-role -- --user <userId> --revoke
 */
import { prisma } from '../src/lib/db'
import { USER_ROLES, isKnownRole, DEFAULT_ROLE } from '../src/lib/auth/roles'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function resolveUserId(): Promise<string> {
  const id = flag('user')
  if (id) return id
  const email = flag('email')
  if (!email) throw new Error('Pass --user <userId> or --email <address>')
  const row = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!row) throw new Error(`No user with email ${email}`)
  return row.id
}

async function main() {
  if (has('list')) {
    const users = await prisma.user.findMany({
      where: { role: { not: DEFAULT_ROLE } },
      select: { id: true, email: true, handle: true, role: true },
      orderBy: { role: 'asc' },
    })
    if (users.length === 0) {
      console.log('Nobody holds a role above learner.')
      console.log('Bootstrap with: npm run grant-role -- --email you@example.com --role admin')
      return
    }
    for (const u of users) {
      console.log(`${u.role.padEnd(8)} ${u.handle ?? u.email}  (${u.id})`)
    }
    return
  }

  const userId = await resolveUserId()

  if (has('revoke')) {
    await prisma.$transaction([
      prisma.user.update({ where: { id: userId }, data: { role: DEFAULT_ROLE } }),
      prisma.roleGrant.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ])
    console.log(`${userId} is now a ${DEFAULT_ROLE}.`)
    return
  }

  const role = flag('role')
  if (!isKnownRole(role)) {
    throw new Error(`--role must be one of: ${USER_ROLES.join(', ')}`)
  }

  await prisma.$transaction([
    // Close any open grant first, so the history reads as a sequence of
    // states rather than two simultaneous ones.
    prisma.roleGrant.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
    prisma.user.update({ where: { id: userId }, data: { role } }),
    // grantedById is null: the CLI has no actor. That is the honest record.
    prisma.roleGrant.create({ data: { userId, role, grantedById: null } }),
  ])

  console.log(`${userId} is now a ${role}.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
