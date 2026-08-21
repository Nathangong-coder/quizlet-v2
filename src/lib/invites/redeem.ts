import type { Prisma } from '@prisma/client'
import { normalizeInviteCode } from '@/lib/invites/code'

export type InviteDb = Pick<Prisma.TransactionClient, 'inviteCode'>

/**
 * Invite-code errors are EXEMPT from the enumeration rule and may be specific.
 * A code is not a user; saying it is dead enumerates nothing about people, and
 * guessing codes is bounded by 50 bits plus the Firewall rule on POST /signup.
 */
export const INVITE_UNAVAILABLE_MESSAGE =
  'That invite code isn’t valid, has expired, or has been used up.'

export class InviteUnavailableError extends Error {
  readonly kind = 'invite_unavailable'
  constructor() {
    super(INVITE_UNAVAILABLE_MESSAGE)
    this.name = 'InviteUnavailableError'
  }
}

/**
 * A COST FILTER, NOT THE GATE.
 *
 * It exists so an obviously dead code is rejected BEFORE ~250ms of bcrypt —
 * otherwise /signup is a CPU amplifier anyone can fire with random codes. It
 * is TOCTOU by construction and that is fine: `redeemInviteCode` decides.
 */
export async function previewInviteCode(db: InviteDb, raw: string): Promise<boolean> {
  const code = normalizeInviteCode(raw)
  if (!code) return false

  const row = await db.inviteCode.findUnique({
    where: { code },
    select: { usesRemaining: true, revokedAt: true, expiresAt: true },
  })
  if (!row) return false
  if (row.usesRemaining <= 0) return false
  if (row.revokedAt) return false
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return false
  return true
}

/**
 * THE GATE. Claim one slot, atomically, and return the invite's id.
 *
 * `count === 0` means the code was dead, revoked, expired, or its last use was
 * taken by someone else between the pre-check and here. Two people racing for
 * the final slot cannot both get in — Postgres serialises the row.
 *
 * MUST be called inside the same transaction as `user.create`, so a P2002 on a
 * duplicate email or handle rolls the decrement back. A typo must not burn
 * someone's code.
 */
export async function redeemInviteCode(db: InviteDb, raw: string): Promise<string> {
  const code = normalizeInviteCode(raw)
  const { count } = await db.inviteCode.updateMany({
    where: {
      code,
      usesRemaining: { gt: 0 },
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    data: { usesRemaining: { decrement: 1 } },
  })
  if (count !== 1) throw new InviteUnavailableError()

  const row = await db.inviteCode.findFirst({ where: { code }, select: { id: true } })
  if (!row) throw new InviteUnavailableError()
  return row.id
}
