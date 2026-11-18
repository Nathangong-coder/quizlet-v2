/**
 * Live-DB concurrency check for the guest demo's two race-prone writes.
 *
 *   1. Double click on a one-shot AI feature: two `reserveCall(guest, 'grade')`
 *      in parallel for one fresh guest → exactly one ok, one quota_used.
 *   2. Double click on "Invite" in /staff/waitlist: two copies of
 *      inviteFromWaitlist's transaction (src/actions/waitlist.ts — mint, then
 *      stamp `invitedAt` conditionally on it still being null) in parallel for
 *      one throwaway request → exactly one InviteCode row, one refusal.
 *
 * The action itself needs an admin session (and would send mail), so step 2
 * reproduces its transaction from the same shared piece, `mintInvite`. Keep the
 * two in step if the action's transaction ever changes.
 *
 * Every row it creates is deleted in `finally`. It prints counts only — never
 * an invite code, a guest id or an env value.
 *
 * Run: npx tsx --env-file=.env scripts/verify-demo-guard.ts
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '../src/lib/db'
import { readDemoConfig } from '../src/lib/demo/config'
import { reserveCall } from '../src/lib/demo/guard'
import { newGuestId } from '../src/lib/demo/identity'
import { mintInvite } from '../src/lib/invites/mint'

class AlreadyInvited extends Error {}

async function checkReserveCall(): Promise<boolean> {
  const guestId = newGuestId()
  // A random ipHash, so this run's ticket never counts against a real IP.
  const ctx = { guestId, ipHash: `verify-${randomBytes(16).toString('hex')}`, config: readDemoConfig() }
  try {
    const results = await Promise.all([reserveCall(ctx, 'grade'), reserveCall(ctx, 'grade')])
    const ok = results.filter((r) => r.ok).length
    const refusals = results.flatMap((r) => (r.ok ? [] : [r.refusal]))
    const quotaUsed = refusals.filter((r) => r === 'quota_used').length
    console.log(`reserveCall x2 (grade, one fresh guest): ${ok} ok, ${quotaUsed} quota_used` +
      (refusals.length > quotaUsed ? `, other refusals: ${refusals.filter((r) => r !== 'quota_used').join(', ')}` : ''))
    const tickets = await prisma.demoTicket.findMany({ where: { guestId }, select: { calls: true, spent: true, admitted: true } })
    console.log(`  tickets for the guest: ${tickets.length} (calls=${tickets.map((t) => t.calls).join(',')}, spent=${tickets.map((t) => t.spent).join(',')}, admitted=${tickets.map((t) => t.admitted).join(',')})`)
    return ok === 1 && quotaUsed === 1 && tickets.length === 1 && tickets[0].calls === 1
  } finally {
    const { count } = await prisma.demoTicket.deleteMany({ where: { guestId } })
    console.log(`  cleanup: deleted ${count} DemoTicket row(s)`)
  }
}

/** inviteFromWaitlist's transaction, verbatim in shape. */
function inviteTransaction(request: { id: string; email: string }) {
  return prisma.$transaction(async (tx) => {
    const minted = await mintInvite({ uses: 1, days: 14, label: `waitlist: ${request.email}` }, tx)
    const { count } = await tx.inviteRequest.updateMany({
      where: { id: request.id, invitedAt: null },
      data: { invitedAt: new Date(), inviteCode: minted.code },
    })
    if (count === 0) throw new AlreadyInvited()
    return minted.code
  })
}

async function checkInviteFromWaitlist(): Promise<boolean> {
  const email = `verify-demo-guard+${randomBytes(8).toString('hex')}@example.invalid`
  const label = `waitlist: ${email}`
  const request = await prisma.inviteRequest.create({
    data: { email, source: 'verify-script', ipHash: `verify-${randomBytes(16).toString('hex')}` },
    select: { id: true, email: true },
  })
  try {
    const outcomes = await Promise.allSettled([inviteTransaction(request), inviteTransaction(request)])
    const minted = outcomes.filter((o) => o.status === 'fulfilled').length
    const already = outcomes.filter((o) => o.status === 'rejected' && o.reason instanceof AlreadyInvited).length
    const other = outcomes.filter((o) => o.status === 'rejected' && !(o.reason instanceof AlreadyInvited))
    const codes = await prisma.inviteCode.count({ where: { label } })
    const stamped = await prisma.inviteRequest.findUnique({ where: { id: request.id }, select: { invitedAt: true, inviteCode: true } })
    console.log(`invite transaction x2 (one request): ${minted} minted, ${already} "Already invited"` +
      (other.length ? `, ${other.length} other error(s): ${other.map((o) => (o as PromiseRejectedResult).reason?.constructor?.name ?? 'unknown').join(', ')}` : ''))
    console.log(`  InviteCode rows for the request: ${codes}; request stamped: ${stamped?.invitedAt ? 'yes' : 'no'}, code recorded: ${stamped?.inviteCode ? 'yes' : 'no'}`)
    return minted === 1 && already === 1 && other.length === 0 && codes === 1 && !!stamped?.invitedAt
  } finally {
    const codes = await prisma.inviteCode.deleteMany({ where: { label } })
    const requests = await prisma.inviteRequest.deleteMany({ where: { id: request.id } })
    console.log(`  cleanup: deleted ${codes.count} InviteCode row(s), ${requests.count} InviteRequest row(s)`)
  }
}

async function main() {
  try {
    const guard = await checkReserveCall()
    const invite = await checkInviteFromWaitlist()
    console.log(`\nreserveCall: ${guard ? 'PASS' : 'FAIL'}; inviteFromWaitlist: ${invite ? 'PASS' : 'FAIL'}`)
    if (!guard || !invite) process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? `${e.constructor.name}: ${e.message}` : 'unknown error')
  process.exitCode = 1
})
