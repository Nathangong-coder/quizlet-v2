/**
 * Create (or re-password) a local development account.
 *
 * This is the script that ends the live-gate bottleneck. Auth was GitHub-only
 * and `.env` carries no GITHUB_ID, so no signed-in page was reachable from an
 * agent session and EVERY live gate on this project was owed to a human
 * (BUILD-QUEUE trap 6). With a credentials provider plus this account, an
 * agent can sign in against a dev database and run its own.
 *
 * Run:  npm run seed:dev-user
 * Reads DEV_USER_EMAIL, DEV_USER_HANDLE, DEV_USER_PASSWORD from the env file.
 */

import { prisma } from '../src/lib/db'
import { hashPassword, checkPassword } from '../src/lib/auth/password'
import { checkHandle } from '../src/lib/users/handle'

async function main() {
  // First line of the script, before anything is read or written. A seeded
  // account with a known password in production is a back door, and "I was
  // sure it was dev" is exactly how one gets created.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-dev-user refuses to run with NODE_ENV=production')
  }

  const email = (process.env.DEV_USER_EMAIL ?? 'dev@localhost.test').toLowerCase()
  const rawHandle = process.env.DEV_USER_HANDLE ?? 'dev_user'
  const password = process.env.DEV_USER_PASSWORD

  if (!password) {
    throw new Error('Set DEV_USER_PASSWORD in your env file (12+ characters)')
  }
  const policy = checkPassword(password)
  if (!policy.ok) {
    throw new Error(`DEV_USER_PASSWORD is rejected by the password policy: ${policy.reason}`)
  }
  const handle = checkHandle(rawHandle)
  if (!handle.ok) {
    throw new Error(`DEV_USER_HANDLE is rejected: ${handle.reason}`)
  }

  const passwordHash = await hashPassword(password)

  // Upsert, so re-running it resets the password of an account that already
  // exists rather than failing on the unique constraint.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordSetAt: new Date() },
    create: {
      email,
      handle: handle.handle,
      normalizedHandle: handle.normalized,
      passwordHash,
      passwordSetAt: new Date(),
    },
    select: { id: true, email: true, handle: true },
  })

  console.log('Seeded dev user:')
  console.log(`  id:     ${user.id}`)
  console.log(`  email:  ${user.email}`)
  console.log(`  handle: ${user.handle}`)
  console.log('Sign in at /login with that email or handle and DEV_USER_PASSWORD.')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
