/**
 * Per-item timing is measured client-side (render -> submit), so it is
 * untrusted input: a user who walks away mid-question produces a 40-minute
 * "answer". Every latency is funnelled through here before it reaches the
 * database so one such value cannot distort medians, pacing, or outliers.
 */

/** Above this, the measurement is treated as "unknown" rather than real. */
export const MAX_LATENCY_MS = 10 * 60 * 1000

export function normalizeLatency(ms: number | null | undefined): number | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  if (ms < 0 || ms > MAX_LATENCY_MS) return null
  return Math.round(ms)
}
