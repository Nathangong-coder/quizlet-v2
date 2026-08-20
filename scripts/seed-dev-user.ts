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
import { hashPassword, checkPassword, PASSWORD_REJECTION_MESSAGES } from '../src/lib/auth/password'
import { checkHandle, HANDLE_REJECTION_MESSAGES } from '../src/lib/users/handle'

async function main() {
  // The NODE_ENV check below is the first statement in main(), but not the
  // first code the process runs: the `import { prisma } from '../src/lib/db'`
  // above executes module-load side effects first — reading DATABASE_URL and
  // constructing the Prisma client — before this function body even starts.
  // That is safe: the Neon adapter connects lazily, so constructing the
  // client issues no query. With DATABASE_URL unset you'll see "DATABASE_URL
  // environment variable is not set" instead of the production-refusal
  // message, but either way nothing reaches the database before the guard
  // below runs. Do not read this as a write-before-check hole.
  //
  // First line of the function body, before anything is read or written. A
  // seeded account with a known password in production is a back door, and
  // "I was sure it was dev" is exactly how one gets created.
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
    throw new Error(`DEV_USER_PASSWORD is rejected: ${PASSWORD_REJECTION_MESSAGES[policy.reason]}`)
  }
  const handle = checkHandle(rawHandle)
  if (!handle.ok) {
    throw new Error(`DEV_USER_HANDLE is rejected: ${HANDLE_REJECTION_MESSAGES[handle.reason]}`)
  }

  const passwordHash = await hashPassword(password)

  // Upsert, so re-running it resets the password of an account that already
  // exists rather than failing on the unique constraint. sessionVersion is
  // bumped on the update branch too, matching the one production password
  // write (src/actions/password.ts) — otherwise a re-seed leaves any old
  // token still valid against a password that is no longer the account's.
  const user = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, passwordSetAt: new Date(), sessionVersion: { increment: 1 } },
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
