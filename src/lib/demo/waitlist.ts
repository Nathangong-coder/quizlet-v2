// The demo's "Request an invite" waitlist — the one table a guest writes to.
// Server-only (Prisma). The public endpoint is `requestInvite` in src/actions/demo.ts.
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { utcDayStart } from './identity'

/** Requests one hashed IP may add per UTC day. */
export const INVITE_REQUESTS_PER_IP_PER_DAY = 5

export const EMAIL_MAX = 254

const Email = z.email().max(EMAIL_MAX)

/** Trimmed and lower-cased, or null when it isn't an address (or is over 254 characters). */
export function normalizeEmail(raw: string): string | null {
  if (typeof raw !== 'string') return null
  const parsed = Email.safeParse(raw.trim().toLowerCase())
  return parsed.success ? parsed.data : null
}

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002'
}

/**
 * Put one email on the waitlist.
 *
 * - `rate_limited` once this `ipHash` has added INVITE_REQUESTS_PER_IP_PER_DAY
 *   rows since the start of the UTC day. The check is a count followed by an
 *   insert, so concurrent requests from one IP can slip a few rows past the
 *   limit. Accepted: the worst case is a few extra waitlist rows — no AI spend,
 *   no mail beyond one owner notification each.
 * - `already` when the email is on the list: the row's `lastRequestedAt` moves;
 *   its note and first requester's `ipHash` are kept.
 * - `added` otherwise.
 *
 * The insert goes first and a unique violation (P2002) means "already", so two
 * concurrent requests for the same new email give one `added` and one
 * `already` rather than a thrown error.
 *
 * `email` must already be normalized (`normalizeEmail`).
 */
export async function recordInviteRequest(
  input: { email: string; note: string | null; ipHash: string },
  now: Date = new Date(),
): Promise<{ status: 'added' | 'already' } | { status: 'rate_limited' }> {
  const today = await prisma.inviteRequest.count({ where: { ipHash: input.ipHash, createdAt: { gte: utcDayStart(now) } } })
  if (today >= INVITE_REQUESTS_PER_IP_PER_DAY) return { status: 'rate_limited' }

  try {
    await prisma.inviteRequest.create({
      data: { email: input.email, note: input.note, ipHash: input.ipHash, source: 'demo', createdAt: now, lastRequestedAt: now },
    })
    return { status: 'added' }
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
  }
  await prisma.inviteRequest.update({ where: { email: input.email }, data: { lastRequestedAt: now } })
  return { status: 'already' }
}

export type WaitlistFilter = 'pending' | 'invited' | 'all'

export interface WaitlistRow {
  id: string
  email: string
  note: string | null
  source: string
  createdAt: Date
  lastRequestedAt: Date
  invitedAt: Date | null
  inviteCode: string | null
}

const FILTER_WHERE = {
  pending: { invitedAt: null },
  invited: { invitedAt: { not: null } },
  all: {},
} as const

/** Waitlist rows, newest request first. Admin pages only: callers gate. */
export async function listWaitlist(filter: WaitlistFilter): Promise<WaitlistRow[]> {
  return prisma.inviteRequest.findMany({
    where: FILTER_WHERE[filter] ?? FILTER_WHERE.all,
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, email: true, note: true, source: true,
      createdAt: true, lastRequestedAt: true, invitedAt: true, inviteCode: true,
    },
  })
}

/** Requests nobody has invited yet. */
export async function countPendingWaitlist(): Promise<number> {
  return prisma.inviteRequest.count({ where: { invitedAt: null } })
}
