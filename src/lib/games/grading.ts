import { STATUS_CREDIT } from '@/lib/errors/klp-credit'
import type { KlpVerdict } from './hot-seat'

/**
 * Game grading arithmetic, shared by the signed-in game actions
 * (`src/actions/games.ts`) and the guest demo (`src/actions/demo.ts`). Pure:
 * the AI returns categorical verdicts, TypeScript turns them into numbers.
 */

/** Weighted share of the points the answer earned, by STATUS_CREDIT (passed/correct = 1, partial/incomplete = ½, everything else = 0). Computed in TS. */
export function accuracyOf(verdicts: KlpVerdict[]): number {
  const total = verdicts.reduce((n, v) => n + v.weight, 0)
  if (total === 0) return 0
  const earned = verdicts.reduce((n, v) => n + v.weight * (STATUS_CREDIT[v.status] ?? 0), 0)
  return Math.round((earned / total) * 100) / 100
}

/** Hit = every substance key point with weight ≥ 4 is full credit. Computed in TS. */
export function isHit(verdicts: KlpVerdict[], roles: Map<string, string | null>): boolean {
  const heavy = verdicts.filter((v) => v.weight >= 4 && (roles.get(v.klpId) ?? 'substance') !== 'framing')
  if (heavy.length === 0) return verdicts.every((v) => (STATUS_CREDIT[v.status] ?? 0) > 0)
  return heavy.every((v) => (STATUS_CREDIT[v.status] ?? 0) >= 1)
}
