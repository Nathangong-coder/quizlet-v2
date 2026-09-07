import type { PrismaClient } from '@prisma/client'

/**
 * The token budget offered to one borrower on a shared credential, PER WEEK.
 *
 * 1,000,000 tokens. For scale: a 12-question diagnostic costs roughly 12-14k
 * output and ~5k input, so this is on the order of fifty diagnostics a week —
 * enough that a learner never meets the limit during normal study, and small
 * enough that a runaway or a scraper cannot bill the owner indefinitely.
 *
 * It is a TOKEN budget rather than a dollar one deliberately. Tokens are
 * recorded per attempt and are exact; dollars require a rate table that is
 * correct for every model in use, and `MODEL_RATES` is honest about being
 * incomplete. A cap that silently stops enforcing because a model has no price
 * is worse than one denominated in the unit we actually measure.
 */
export const DEFAULT_SHARED_TOKEN_BUDGET = 1_000_000

/**
 * Start of the budget week: the most recent Monday, 00:00 UTC.
 *
 * A FIXED window, not a rolling seven days. Both cap the same amount of
 * spend, but only a fixed one can answer "when do I get more?" with a date —
 * under a rolling window the allowance dribbles back hour by hour, and the
 * honest UI copy for that is "some of it, gradually, depending on when you
 * spent it", which tells a stuck learner nothing they can act on.
 *
 * UTC, not the viewer's zone, because the cap is enforced server-side against
 * rows stamped in UTC. Deriving the window from a browser's clock would let
 * the same spend fall inside the window for one user and outside it for
 * another, and would make the number the server enforces disagree with the
 * number the page shows.
 */
export function budgetWindowStart(now: Date = new Date()): Date {
  const start = new Date(now)
  // getUTCDay: 0 = Sunday .. 6 = Saturday. Sunday is 6 days after Monday,
  // not 1 day before it — the +6 %7 is what stops Sunday resetting early.
  const daysSinceMonday = (start.getUTCDay() + 6) % 7
  start.setUTCDate(start.getUTCDate() - daysSinceMonday)
  start.setUTCHours(0, 0, 0, 0)
  return start
}

/** When the current window ends and the allowance returns. */
export function budgetWindowEnd(now: Date = new Date()): Date {
  const end = budgetWindowStart(now)
  end.setUTCDate(end.getUTCDate() + 7)
  return end
}

/** Usage and allowance for one borrower on one shared credential, this week. */
export interface SharedBudgetStatus {
  credentialId: string
  label: string
  provider: string
  /** Tokens this borrower has spent on this credential SINCE the window start. */
  used: number
  /** NULL means no cap was set. */
  budget: number | null
  remaining: number | null
  exhausted: boolean
  /** When `used` returns to zero. */
  resetsAt: Date
}

/**
 * Is this borrower out of allowance on this credential?
 *
 * A null budget is unlimited — which is only reasonable on a credential that
 * is not shared, and the caller is responsible for not offering one.
 *
 * Pure, so the boundary condition is testable without a database: spending
 * EXACTLY the budget is exhausted, because the alternative reads as "one more
 * free call for everyone who lands on the boundary".
 */
export function isExhausted(used: number, budget: number | null): boolean {
  if (budget === null) return false
  return used >= budget
}

export function remaining(used: number, budget: number | null): number | null {
  if (budget === null) return null
  return Math.max(0, budget - used)
}

/**
 * Tokens a user has spent on each credential since `since`.
 *
 * INPUT + OUTPUT together, because both are billed and the owner is paying for
 * both. Reasoning tokens are already inside `outputTokens` and must not be
 * added again — see the `AiCallLog` doc comment.
 *
 * FAILED attempts count. A call that rambled to its output ceiling and
 * returned nothing parseable still consumed everything it generated, and a
 * budget that forgave failures would be most generous to exactly the runaway
 * it exists to stop.
 *
 * Rows with null token columns contribute 0 — those predate token accounting
 * (2026-09-06) and cannot be recovered. That makes the earliest budgets
 * slightly generous, which is the safe direction to be wrong in. Since the
 * window is a week, they age out on their own.
 */
export async function loadSpendByCredential(
  prisma: PrismaClient,
  userId: string,
  since: Date = budgetWindowStart(),
): Promise<Map<string, number>> {
  const rows = await prisma.aiCallLog.groupBy({
    by: ['credentialId'],
    where: { userId, credentialId: { not: null }, createdAt: { gte: since } },
    _sum: { inputTokens: true, outputTokens: true },
  })

  const out = new Map<string, number>()
  for (const row of rows) {
    if (!row.credentialId) continue
    out.set(row.credentialId, (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0))
  }
  return out
}

/**
 * Every shared credential this user may borrow, with their standing on each
 * for the current week.
 *
 * Excludes the user's OWN credentials: an owner spending their own key is not
 * borrowing, and metering them against a lending budget would be nonsense.
 */
export async function loadBorrowableCredentials(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<SharedBudgetStatus[]> {
  const resetsAt = budgetWindowEnd(now)
  const [credentials, spend] = await Promise.all([
    prisma.aiCredential.findMany({
      where: { shared: true, enabled: true, userId: { not: userId } },
      select: { id: true, label: true, provider: true, sharedTokenBudget: true },
    }),
    loadSpendByCredential(prisma, userId, budgetWindowStart(now)),
  ])

  return credentials.map((credential) => {
    const used = spend.get(credential.id) ?? 0
    const budget = credential.sharedTokenBudget
    return {
      credentialId: credential.id,
      label: credential.label,
      provider: credential.provider,
      used,
      budget,
      remaining: remaining(used, budget),
      exhausted: isExhausted(used, budget),
      resetsAt,
    }
  })
}
