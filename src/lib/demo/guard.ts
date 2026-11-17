// The guest-demo guard: the only thing between an anonymous visitor and the
// operator's AI bill. Every guest AI call reserves through `reserveCall` first.
// No next/headers here (the caller's identity comes from ./guest-context), so
// this module is testable against a fake table.
//
// Concurrency. Nothing here reads a count and then acts on it unchecked:
// - The per-feature ceiling is ONE conditional `updateMany`
//   (`calls < ceiling` → increment), so a double click on a one-shot feature
//   reserves exactly once.
// - The per-IP limit is write-first: the ticket is created, then RANKED among
//   the IP's tickets for that feature that day (`createdAt <=` its own). A
//   ticket ranked past the limit is never served — by any request, not only the
//   one that created it — and its creator deletes it. Ranking (rather than a
//   plain count) means a later burst can never displace an earlier guest; a
//   burst sharing one instant is refused as a whole (fails closed).
// - The global cap is pre-checked, then re-checked after the increment; a
//   reservation that took the day past the cap is handed back in full and
//   refused. Concurrent callers near the cap may all be refused (fails closed),
//   but the day never spends past it.
// - Release is a conditional decrement (`calls > 0`) and never deletes.
//
// `calls` vs `spent`. `calls` is what a ticket holds now — refunded on a
// provider failure, so the guest can retry. `spent` is every reservation ever
// made — never refunded, because a failed provider call may still bill. The
// daily cap sums `spent`.
//
// Known bound: the cap counts tickets CREATED today (UTC). A ticket created on
// an earlier day can spend what is left of its ceiling uncounted by today's
// cap. That leak is bounded per ticket by FEATURE_CEILING (and run tickets
// expire after RUN_WINDOW_MS anyway).
import { prisma } from '@/lib/db'
import { FEATURE_CEILING, RUN_FEATURES, RUN_WINDOW_MS, type DemoConfig, type DemoFeature } from './config'
import { utcDayStart } from './identity'

export type DemoRefusal = 'demo_off' | 'demo_cap' | 'quota_used' | 'run_not_started'
export type GuestCtx = { guestId: string; ipHash: string; config: DemoConfig }

type Refused = { ok: false; refusal: DemoRefusal }
const refuse = (refusal: DemoRefusal): Refused => ({ ok: false, refusal })

type Ticket = { id: string; ipHash: string; feature: string; createdAt: Date }

function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string } | null)?.code === 'P2002'
}

function findTicket(ctx: GuestCtx, feature: DemoFeature) {
  return prisma.demoTicket.findUnique({ where: { guestId_feature: { guestId: ctx.guestId, feature } } })
}

/** Creates the guest's ticket; null when one already exists (P2002). */
async function createTicket(ctx: GuestCtx, feature: DemoFeature, now: Date): Promise<Ticket | null> {
  try {
    return await prisma.demoTicket.create({
      data: { guestId: ctx.guestId, ipHash: ctx.ipHash, feature, calls: 0, spent: 0, createdAt: now },
    })
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }
}

/**
 * Is this ticket among the first `perIpFeatureLimit` its IP opened for this
 * feature on the ticket's own UTC day? Earlier tickets decide; later ones
 * cannot change the answer.
 */
async function withinIpLimit(ticket: Ticket, ctx: GuestCtx): Promise<boolean> {
  const rank = await prisma.demoTicket.count({
    where: {
      ipHash: ticket.ipHash,
      feature: ticket.feature,
      createdAt: { gte: utcDayStart(ticket.createdAt), lte: ticket.createdAt },
    },
  })
  return rank <= ctx.config.perIpFeatureLimit
}

/** Removes a ticket this request created that ranked past the IP limit — only if nothing was ever reserved on it. */
async function discard(ticket: Ticket): Promise<void> {
  await prisma.demoTicket.deleteMany({ where: { id: ticket.id, spent: 0 } })
}

async function spentToday(now: Date): Promise<number> {
  const agg = await prisma.demoTicket.aggregate({
    _sum: { spent: true },
    where: { createdAt: { gte: utcDayStart(now) } },
  })
  return agg._sum.spent ?? 0
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
  const ticket = await createTicket(ctx, feature, now)
  if (!ticket) return refuse('quota_used')
  if (!(await withinIpLimit(ticket, ctx))) {
    await discard(ticket)
    return refuse('quota_used')
  }
  return { ok: true }
}

/** Reserves one AI call. On a provider failure the caller must `releaseCall`. */
export async function reserveCall(
  ctx: GuestCtx,
  feature: DemoFeature,
  now: Date = new Date(),
): Promise<{ ok: true; ticketId: string } | Refused> {
  // 1. Global cap (pre-check; re-checked after the increment in step 6).
  if ((await spentToday(now)) >= ctx.config.dailyCap) return refuse('demo_cap')

  // 2. The guest's ticket for this feature.
  const isRun = RUN_FEATURES.has(feature)
  let ticket: Ticket | null = await findTicket(ctx, feature)
  let created = false

  // 3. No ticket: a run must be started first; anything else opens one here.
  if (!ticket) {
    if (isRun) return refuse('run_not_started')
    ticket = await createTicket(ctx, feature, now)
    if (ticket) created = true
    // A concurrent request created it first: use theirs.
    else ticket = await findTicket(ctx, feature)
    if (!ticket) return refuse('quota_used')
  }

  // Per-IP limit, on every reservation: a ticket ranked past the limit is never served.
  if (!(await withinIpLimit(ticket, ctx))) {
    if (created) await discard(ticket)
    return refuse('quota_used')
  }

  // 4. Run window.
  if (isRun && now.getTime() - ticket.createdAt.getTime() > RUN_WINDOW_MS) return refuse('quota_used')

  // 5. Atomic increment: succeeds only while under the ceiling.
  const { count } = await prisma.demoTicket.updateMany({
    where: { id: ticket.id, calls: { lt: FEATURE_CEILING[feature] } },
    data: { calls: { increment: 1 }, spent: { increment: 1 } },
  })
  if (count === 0) return refuse('quota_used')

  // 6. Cap re-check: if this reservation took the day past the cap, hand it back in full.
  if ((await spentToday(now)) > ctx.config.dailyCap) {
    await prisma.demoTicket.updateMany({
      where: { id: ticket.id, calls: { gt: 0 }, spent: { gt: 0 } },
      data: { calls: { decrement: 1 }, spent: { decrement: 1 } },
    })
    return refuse('demo_cap')
  }
  return { ok: true, ticketId: ticket.id }
}

/**
 * Hands back a reserved call after a provider failure, so the guest isn't
 * charged against their quota: `calls` drops (never below 0) and the guest may
 * retry. `spent` is untouched — the failed call may still bill — and the
 * ticket is never deleted, so it keeps counting toward the per-IP limit and a
 * run can't be restarted.
 */
export async function releaseCall(ticketId: string, feature: DemoFeature): Promise<void> {
  void feature // the same for every feature now; kept so callers needn't change if that ever differs
  await prisma.demoTicket.updateMany({
    where: { id: ticketId, calls: { gt: 0 } },
    data: { calls: { decrement: 1 } },
  })
}
