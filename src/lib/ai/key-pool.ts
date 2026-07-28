// src/lib/ai/key-pool.ts

/** The minimal credential shape rotation needs. */
export interface PoolCredential {
  id: string;
  role: 'primary' | 'backup';
  enabled: boolean;
  lastUsedAt: Date | null;
}

/**
 * Orders credentials for a generation attempt.
 *
 * Rotation is least-recently-used rather than a counter: a counter cannot be
 * shared across serverless instances, whereas `lastUsedAt` already lives in the
 * database. Stamping a credential after use naturally sends the next request to
 * its sibling, which is what "run both keys together" means in practice.
 *
 * Pure: same input, same output, no mutation of the argument.
 */
export function selectAttemptOrder<T extends PoolCredential>(credentials: T[]): T[] {
  const rank = (c: T) => (c.role === 'backup' ? 1 : 0);
  const used = (c: T) => (c.lastUsedAt === null ? -1 : c.lastUsedAt.getTime());

  return credentials
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => {
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      if (used(a) !== used(b)) return used(a) - used(b);
      return a.id.localeCompare(b.id);
    });
}
