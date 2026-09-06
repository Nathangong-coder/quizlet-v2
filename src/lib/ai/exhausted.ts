import type { PrismaClient } from '@prisma/client'
import { comboKey } from '@/lib/ai/credential-pool'

/**
 * The (credential x model) pairs that already returned `quota_exhausted` today.
 *
 * Read from `AiCallLog` rather than cached on the credential, for three
 * reasons. The log already records exactly this fact, so nothing new has to be
 * kept in step. It is shared across serverless instances, which an in-memory
 * set is not. And it self-expires: "today" is a `where` clause, so no job has
 * to clear a flag when the cap resets.
 *
 * WHY DAY BOUNDARIES ARE APPROXIMATE, and why that is acceptable. The Google
 * free-tier cap is `GenerateRequestsPerDayPerProjectPerModel-FreeTier` and
 * resets on the provider's clock, not this server's. A UTC midnight can
 * therefore keep a combo excluded for a few hours after it actually recovered,
 * or re-admit one shortly before it does. The cost of being wrong is one
 * wasted call in one direction and slightly conservative routing in the other
 * — both far cheaper than the twelve doomed retries that not doing this
 * produced on 2026-09-06.
 *
 * The exclusion is per credential AND model, not per model. The real cap is
 * per PROJECT per model, and two keys in one project share it — but project
 * identity is not knowable from an API key. Excluding only the exact pair that
 * failed costs at most one call to discover a sibling in the same project,
 * whereas excluding by model alone would disable a healthy key in a different
 * project on someone else's evidence.
 */
export async function loadExhaustedCombos(
  prisma: PrismaClient,
  userId: string,
  now: Date = new Date(),
): Promise<Set<string>> {
  const since = new Date(now)
  since.setUTCHours(0, 0, 0, 0)

  const rows = await prisma.aiCallLog.findMany({
    where: {
      userId,
      ok: false,
      failureKind: 'quota_exhausted',
      createdAt: { gte: since },
      credentialId: { not: null },
    },
    select: { credentialId: true, model: true },
    distinct: ['credentialId', 'model'],
  })

  return new Set(
    rows
      .filter((r): r is { credentialId: string; model: string } => r.credentialId !== null)
      .map((r) => comboKey(r.credentialId, r.model)),
  )
}
