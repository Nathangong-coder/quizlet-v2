import { getSubject } from './taxonomy'

/**
 * Per-slug counts for a filter bar from `groupBy(subject)` rows: each leaf
 * count, and each group's count as the sum of its leaves. A slug the tree no
 * longer knows is dropped — it could not be filtered on anyway.
 *
 * Pure. The caller computes the rows under the FULL scope (no subject
 * filter), because a facet count that drops its own filter is the only kind
 * that stays useful once something is selected.
 */
export function countSubjects(rows: readonly { subject: string | null; count: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const r of rows) {
    const s = getSubject(r.subject)
    if (!s || r.count <= 0) continue
    out[s.slug] = (out[s.slug] ?? 0) + r.count
    out[s.group.slug] = (out[s.group.slug] ?? 0) + r.count
  }
  return out
}
