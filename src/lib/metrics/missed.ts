/**
 * Shapes the "What you're getting wrong" panel (spec §8).
 *
 * Leads with AGGREGATE weakness and carries the EPISODIC misses that produced
 * it, because either alone is unusable: an aggregate nobody can check is not
 * trustworthy, and a feed of individual misses cannot tell one unlucky answer
 * from a real gap.
 *
 * Pure. The AI never sees this and never computes any part of it — the same
 * rule that governs significance and mastery.
 */

/** Bucket for KLPs the summarizer gave no topic. */
export const UNTOPICED_KEY = '__untopiced__'

export interface MissedAnswer {
  klpId: string
  mode: string
  status: string
  createdAt: Date
  errorTypes: string[]
}

export interface MissedKlp {
  klpId: string
  /** Null until the KLT pass has run; callers fall back to `text`. */
  label: string | null
  text: string
  term: string
  misses: MissedAnswer[]
  /** Null below the learner's floor. NEVER rendered as a zero. */
  pKnown: number | null
  observations: number
}

export interface MissedTopic {
  key: string
  name: string
  knowledge: number | null
  klps: MissedKlp[]
  missCount: number
}

export interface ShapeMissedWorkInput {
  klps: { klpId: string; label: string | null; text: string; term: string; topicKeys: string[] }[]
  topicNames: Record<string, string>
  knowledge: Record<string, { pKnown: number; observations: number }>
  results: MissedAnswer[]
  /** The learner's own observation floor, never a constant. */
  floor: number
}

/**
 * `partial` counts as a miss: half-right is still not right, and a learner
 * who half-answers a point repeatedly has a gap worth showing them.
 */
const MISS_STATUSES = new Set(['failed', 'partial'])

export function shapeMissedWork(input: ShapeMissedWorkInput): MissedTopic[] {
  const missesByKlp = new Map<string, MissedAnswer[]>()
  for (const r of input.results) {
    if (!MISS_STATUSES.has(r.status)) continue
    const list = missesByKlp.get(r.klpId)
    if (list) list.push(r)
    else missesByKlp.set(r.klpId, [r])
  }

  const byTopic = new Map<string, MissedKlp[]>()
  for (const klp of input.klps) {
    const misses = missesByKlp.get(klp.klpId)
    if (!misses || misses.length === 0) continue

    const k = input.knowledge[klp.klpId]
    const shaped: MissedKlp = {
      klpId: klp.klpId,
      label: klp.label,
      text: klp.text,
      term: klp.term,
      misses: [...misses].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      // Below the floor, pKnown is mostly the BKT prior. Reporting it would
      // state a confidence the evidence does not support — which is the
      // floor's entire purpose. Null renders its own state; NEVER a zero.
      pKnown: k && k.observations >= input.floor ? k.pKnown : null,
      observations: k?.observations ?? 0,
    }

    // A KLP carries up to three topics and appears under EACH: one point can
    // honestly belong to several subjects, and hiding it under only the first
    // would make the other topics look cleaner than they are.
    const keys = klp.topicKeys.length > 0 ? klp.topicKeys : [UNTOPICED_KEY]
    for (const key of keys) {
      const list = byTopic.get(key)
      if (list) list.push(shaped)
      else byTopic.set(key, [shaped])
    }
  }

  const out: MissedTopic[] = []
  for (const [key, klps] of byTopic) {
    const scored = klps.filter((k) => k.pKnown !== null)
    out.push({
      key,
      name: key === UNTOPICED_KEY ? 'Uncategorized' : (input.topicNames[key] ?? key),
      knowledge:
        scored.length === 0
          ? null
          : scored.reduce((sum, k) => sum + (k.pKnown ?? 0), 0) / scored.length,
      klps: [...klps].sort((a, b) => b.misses.length - a.misses.length),
      missCount: klps.reduce((sum, k) => sum + k.misses.length, 0),
    })
  }

  return out.sort((a, b) => b.missCount - a.missCount)
}
