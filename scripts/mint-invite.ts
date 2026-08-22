/**
 * Mint, list and revoke invite codes.
 *
 * Terminal-only, deliberately: no admin role, no admin page, no new privilege
 * concept. Revisit when handing out codes is frequent enough to be annoying.
 *
 * Run:
 *   npm run invite -- --uses 5 --days 30 --label "discord launch"
 *   npm run invite -- --list
 *   npm run invite -- --revoke ABCDE-FG234
 */

import { prisma } from '../src/lib/db'
import { generateInviteCode, formatInviteCode, normalizeInviteCode } from '../src/lib/invites/code'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  return process.argv[i + 1]
}

function has(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  // First statement in main(), matching scripts/seed-dev-user.ts. Minting a
  // code against production from a dev shell hands out real accounts.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('mint-invite refuses to run with NODE_ENV=production')
  }

  if (has('list')) {
    const codes = await prisma.inviteCode.findMany({ orderBy: { createdAt: 'desc' } })
    if (codes.length === 0) {
      console.log('No invite codes yet.')
      return
    }
    for (const c of codes) {
      const used = c.maxUses - c.usesRemaining
      const state = c.revokedAt
        ? 'REVOKED'
        : c.expiresAt && c.expiresAt.getTime() <= Date.now()
          ? 'EXPIRED'
          : c.usesRemaining === 0
            ? 'EXHAUSTED'
            : 'live'
      console.log(
        `${formatInviteCode(c.code)}  ${used} of ${c.maxUses} used  ${state}` +
          (c.label ? `  "${c.label}"` : ''),
      )
    }
    return
  }

  const revoke = flag('revoke')
  if (revoke) {
    const code = normalizeInviteCode(revoke)
    const { count } = await prisma.inviteCode.updateMany({
      where: { code, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    console.log(count === 1 ? `Revoked ${formatInviteCode(code)}.` : 'No live code matched.')
    return
  }

  const uses = Number(flag('uses') ?? 1)
  if (!Number.isInteger(uses) || uses < 1) {
    throw new Error('--uses must be a positive integer')
  }
  const days = flag('days') ? Number(flag('days')) : undefined
  if (days !== undefined && (!Number.isFinite(days) || days <= 0)) {
    throw new Error('--days must be a positive number')
  }

  const code = generateInviteCode()
  await prisma.inviteCode.create({
    data: {
      code,
      label: flag('label') ?? null,
      maxUses: uses,
      // Both counters start equal; maxUses never moves again, so
      // `maxUses - usesRemaining` is always the used count.
      usesRemaining: uses,
      expiresAt: days === undefined ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    },
  })

  console.log('Invite code:')
  console.log(`  ${formatInviteCode(code)}`)
  console.log(`  uses:    ${uses}`)
  console.log(`  expires: ${days === undefined ? 'never' : `${days} days`}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
