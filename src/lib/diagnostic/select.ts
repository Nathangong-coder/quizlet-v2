import { BKT_PRIOR } from '@/lib/metrics/bkt'

/**
 * How many of a run's questions re-ask a key point the same run already asked.
 * Matches the floor the old free-text generator was told to hit.
 *
 * Two observations of one key point in one sitting, phrased two ways, is the
 * recognition-versus-production signal at no extra AI cost.
 */
export const FOLLOW_UP_COUNT = 2

/**
 * The fewest live key points a set needs before a diagnostic is worth running.
 *
 * TWELVE, not the generator schema's `.min(8)`: `DiagnosticStartSchema` floors
 * `questionCount` at 12, so a set with 8 key points would cap the count at 8
 * and then fail its own input validation.
 */
export const MIN_DIAGNOSTIC_KLPS = 12

export interface DiagnosticKlpInput {
  id: string
  cardId: string
  /** `CardKlp.index` — the last tie-break, so ordering is stable across runs. */
  index: number
  weight: number
}

export interface DiagnosticKlpStateInput {
  klpId: string
  pKnown: number
}

export interface DiagnosticProbe {
  klpId: string
  cardId: string
  kind: 'core' | 'follow-up'
}

/**
 * Choose what a diagnostic asks. Pure, deterministic, and the ONLY place the
 * decision is made — so a bad diagnostic is a unit-test failure rather than a
 * mystery about what the model felt like generating.
 *
 * REGIME IS READ OFF THE DATA, NOT CONFIGURED. With no `KlpState` rows for
 * this set the learner has no history here, so the run is a BASELINE and
 * spread is what matters: a cold-start map of the set. With history it is
 * TARGETED and priority takes over. A setting would be one more thing to get
 * wrong, and the database already answers the question.
 *
 * Both regimes ROUND-ROBIN ACROSS CARDS: every eligible card contributes a
 * probe before any card contributes a second. In the targeted regime that is
 * the guard against one badly-known card consuming the entire run — a
 * diagnostic that only asks about the thing you already failed tells you
 * nothing you did not know.
 *
 * Never-observed key points need NO special case. `BKT_PRIOR` (0.25) sits
 * below most observed posteriors, so `(1 - pKnown) x weight` floats them
 * naturally — and a point observed once and FAILED outranks an unseen one,
 * which is the correct priority rather than an accident of the formula.
 */
export function selectDiagnosticProbes(input: {
  klps: DiagnosticKlpInput[]
  states: DiagnosticKlpStateInput[]
  count: number
}): DiagnosticProbe[] {
  if (input.klps.length === 0 || input.count <= 0) return []

  const pKnownById = new Map(input.states.map((s) => [s.klpId, s.pKnown]))
  const priority = (klp: DiagnosticKlpInput) =>
    (1 - (pKnownById.get(klp.id) ?? BKT_PRIOR)) * klp.weight

  const targeted = input.states.length > 0

  // Group by card, preserving the order cards first appear. Callers pass KLPs
  // ordered by card position then klp index, so the baseline regime walks the
  // set the way the learner sees it.
  const groups = new Map<string, DiagnosticKlpInput[]>()
  for (const klp of input.klps) {
    const bucket = groups.get(klp.cardId)
    if (bucket) bucket.push(klp)
    else groups.set(klp.cardId, [klp])
  }

  const ordered = [...groups.values()].map((bucket) =>
    [...bucket].sort((a, b) =>
      targeted
        ? priority(b) - priority(a) || b.weight - a.weight || a.index - b.index
        : b.weight - a.weight || a.index - b.index,
    ),
  )

  // In the targeted regime the CARDS are ordered by their best key point too.
  // Without this, a run shorter than the card count walks cards in set order
  // and the targeting is invisible — the first pass would take card 1's top
  // point before card 7's much weaker one.
  if (targeted) ordered.sort((a, b) => priority(b[0]) - priority(a[0]))

  // A quarter of the run at most, and never more than FOLLOW_UP_COUNT.
  //
  // A flat budget of two is wrong at the short end: on a two-question run it
  // consumes both slots, so the diagnostic asks one key point twice and never
  // reaches a second card. Re-asking is only worth a slot once there are
  // enough slots that spending one costs nothing.
  const followUpBudget = Math.min(FOLLOW_UP_COUNT, Math.floor(input.count / 4))
  const coreTarget = Math.max(1, input.count - followUpBudget)
  const core: DiagnosticProbe[] = []
  const depth = Math.max(...ordered.map((bucket) => bucket.length))
  outer: for (let round = 0; round < depth; round++) {
    for (const bucket of ordered) {
      const klp = bucket[round]
      if (!klp) continue
      core.push({ klpId: klp.id, cardId: klp.cardId, kind: 'core' })
      if (core.length === coreTarget) break outer
    }
  }

  // Follow-ups re-ask what this run already asked — NEVER a fresh key point.
  // A follow-up on an unprobed point would just be another core question with
  // a misleading label, and the second-observation signal would be lost.
  // Highest weight first, earliest core position as the tie-break.
  const weightById = new Map(input.klps.map((k) => [k.id, k.weight]))
  const followUpRoom = Math.min(followUpBudget, Math.max(0, input.count - core.length))
  const followUps = core
    .map((probe, position) => ({ probe, position }))
    .sort(
      (a, b) =>
        (weightById.get(b.probe.klpId) ?? 0) - (weightById.get(a.probe.klpId) ?? 0) ||
        a.position - b.position,
    )
    .slice(0, followUpRoom)
    .map(({ probe }) => ({ ...probe, kind: 'follow-up' as const }))

  return [...core, ...followUps]
}
