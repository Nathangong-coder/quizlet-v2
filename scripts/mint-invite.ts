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
 *   npm run invite -- --requests             (pending waitlist requests)
 *   npm run invite -- --for ann@example.com  (single-use, 14-day code for that request)
 */

import { prisma } from '../src/lib/db'
import { formatInviteCode, normalizeInviteCode } from '../src/lib/invites/code'
import { mintInvite } from '../src/lib/invites/mint'
import { normalizeEmail } from '../src/lib/demo/waitlist'

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

  if (has('requests')) {
    const pending = await prisma.inviteRequest.findMany({ where: { invitedAt: null }, orderBy: { createdAt: 'desc' } })
    if (pending.length === 0) {
      console.log('No pending requests.')
      return
    }
    for (const r of pending) {
      console.log(`${r.email}  ${r.createdAt.toISOString().slice(0, 10)}` + (r.note ? `  "${r.note}"` : ''))
    }
    return
  }

  const forEmail = flag('for')
  if (forEmail !== undefined) {
    const email = normalizeEmail(forEmail)
    if (!email) throw new Error('--for needs a valid email address')
    const request = await prisma.inviteRequest.findUnique({ where: { email } })
    if (!request) throw new Error(`No waitlist request for ${email}`)
    if (request.invitedAt) throw new Error(`${email} was already invited`)
    // One transaction with a conditional stamp: a concurrent invite (admin page
    // or another terminal) rolls the mint back instead of leaving an orphan code.
    const { code } = await prisma.$transaction(async (tx) => {
      const minted = await mintInvite({ uses: 1, days: 14, label: `waitlist: ${email}` }, tx)
      const { count } = await tx.inviteRequest.updateMany({
        where: { id: request.id, invitedAt: null },
        data: { invitedAt: new Date(), inviteCode: minted.code },
      })
      if (count === 0) throw new Error(`${email} was already invited`)
      return minted
    })
    console.log(`Invite code for ${email}:`)
    console.log(`  ${formatInviteCode(code)}`)
    console.log('  uses:    1')
    console.log('  expires: 14 days')
    console.log('Not emailed from the terminal; send it yourself.')
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

  const { code } = await mintInvite({ uses, days, label: flag('label') ?? null })

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
