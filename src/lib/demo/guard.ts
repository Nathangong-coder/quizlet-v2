// The guest-demo guard: the only thing between an anonymous visitor and the
// operator's AI bill. Every guest AI call reserves through `reserveCall` first.
//
// Atomicity: the reservation itself is ONE conditional `updateMany`
// (`calls < ceiling` → increment), so two concurrent requests can never both
// pass a one-shot feature. Release is the mirror image (`calls > 0` →
// decrement, then delete only a zero-call non-run ticket) — never
// read-then-write.
import { cookies, headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { FEATURE_CEILING, RUN_FEATURES, RUN_WINDOW_MS, readDemoConfig, type DemoConfig, type DemoFeature } from './config'
import { DEMO_COOKIE, clientIp, hashIp, newGuestId, signGuestId, utcDayStart, verifyGuestCookie } from './identity'

export type DemoRefusal = 'demo_off' | 'demo_cap' | 'quota_used' | 'run_not_started'
export type GuestCtx = { guestId: string; ipHash: string; config: DemoConfig }

type Refused = { ok: false; refusal: DemoRefusal }
const refuse = (refusal: DemoRefusal): Refused => ({ ok: false, refusal })

const COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002'
}

/** Has this IP already opened `perIpFeatureLimit` tickets for this feature today (UTC)? */
async function ipLimitReached(ctx: GuestCtx, feature: DemoFeature, now: Date): Promise<boolean> {
  const opened = await prisma.demoTicket.count({
    where: { ipHash: ctx.ipHash, feature, createdAt: { gte: utcDayStart(now) } },
  })
  return opened >= ctx.config.perIpFeatureLimit
}

function createTicket(ctx: GuestCtx, feature: DemoFeature, now: Date) {
  return prisma.demoTicket.create({
    data: { guestId: ctx.guestId, ipHash: ctx.ipHash, feature, calls: 0, createdAt: now },
  })
}

function findTicket(ctx: GuestCtx, feature: DemoFeature) {
  return prisma.demoTicket.findUnique({
    where: { guestId_feature: { guestId: ctx.guestId, feature } },
  })
}

/** Opens a run (Gauntlet, Hot Seat). One run per guest per feature, ever. */
export async function startRun(
  ctx: GuestCtx,
  feature: DemoFeature,
  now: Date = new Date(),
): Promise<{ ok: true } | Refused> {
  // Only run features have a start; anything else has nothing to open.
  if (!RUN_FEATURES.has(feature)) return refuse('quota_used')
  if (await findTicket(ctx, feature)) return refuse('quota_used')
  if (await ipLimitReached(ctx, feature, now)) return refuse('quota_used')
  try {
    await createTicket(ctx, feature, now)
  } catch (e) {
    if (isUniqueViolation(e)) return refuse('quota_used')
    throw e
  }
  return { ok: true }
}

/** Reserves one AI call. On a provider failure the caller must `releaseCall`. */
export async function reserveCall(
  ctx: GuestCtx,
  feature: DemoFeature,
  now: Date = new Date(),
): Promise<{ ok: true; ticketId: string } | Refused> {
  // 1. Global cap: every guest call made today, across features.
  const spent = await prisma.demoTicket.aggregate({
    _sum: { calls: true },
    where: { createdAt: { gte: utcDayStart(now) } },
  })
  if ((spent._sum.calls ?? 0) >= ctx.config.dailyCap) return refuse('demo_cap')

  // 2. The guest's ticket for this feature.
  const isRun = RUN_FEATURES.has(feature)
  let ticket = await findTicket(ctx, feature)

  // 3. No ticket: a run must be started first; anything else opens one here.
  if (!ticket) {
    if (isRun) return refuse('run_not_started')
    if (await ipLimitReached(ctx, feature, now)) return refuse('quota_used')
    try {
      ticket = await createTicket(ctx, feature, now)
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
      // A concurrent request created it first: use theirs.
      ticket = await findTicket(ctx, feature)
      if (!ticket) return refuse('quota_used')
    }
  }

  // 4. Run window.
  if (isRun && now.getTime() - ticket.createdAt.getTime() > RUN_WINDOW_MS) return refuse('quota_used')

  // 5. Atomic increment: succeeds only while under the ceiling.
  const { count } = await prisma.demoTicket.updateMany({
    where: { id: ticket.id, calls: { lt: FEATURE_CEILING[feature] } },
    data: { calls: { increment: 1 } },
  })
  if (count === 0) return refuse('quota_used')
  return { ok: true, ticketId: ticket.id }
}

/**
 * Hands back a reserved call after a provider failure, so the guest isn't
 * charged. A one-shot ticket that falls to zero is deleted (a full refund: the
 * guest may retry and the per-IP count drops). A run ticket is never deleted —
 * deleting it would let the guest start a fresh run.
 */
export async function releaseCall(ticketId: string, feature: DemoFeature): Promise<void> {
  const { count } = await prisma.demoTicket.updateMany({
    where: { id: ticketId, calls: { gt: 0 } },
    data: { calls: { decrement: 1 } },
  })
  if (count === 0 || RUN_FEATURES.has(feature)) return
  await prisma.demoTicket.deleteMany({ where: { id: ticketId, calls: 0 } })
}

/**
 * The calling guest, from the signed cookie (issued if missing or forged) and
 * the hashed client IP. Server actions only — it may set a cookie. `null` when
 * the demo is off.
 */
export async function guestContext(): Promise<GuestCtx | null> {
  const config = readDemoConfig()
  if (!config.enabled || !config.secret) return null
  const jar = await cookies()
  const hdrs = await headers()
  let guestId = verifyGuestCookie(jar.get(DEMO_COOKIE)?.value, config.secret)
  if (!guestId) {
    guestId = newGuestId()
    jar.set(DEMO_COOKIE, signGuestId(guestId, config.secret), {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_S,
      path: '/',
    })
  }
  return { guestId, ipHash: hashIp(clientIp(hdrs), config.secret), config }
}
