/**
 * FRAMING POINTS (2026-09-12, owner).
 *
 * Strict grading with independently written traps showed the same failure on
 * every "define X" / "walk me through" card: the memorized-template answer is
 * credited on the definition and the contrast points, and the card's
 * separation drops to 0.3-0.4 for a reason that is not a defect in the key
 * points. A prepared candidate ALWAYS has the definition — that is what
 * preparation is — so a point that says "X is Y" cannot tell a strong answer
 * from a rehearsed one, and asking the revise call to "tighten" it produces
 * either a contorted definition or a dropped one. Both are worse.
 *
 * The rule here is deterministic and cheap: a point whose `kind` is a framing
 * kind AND that the template trap was credited on is a FRAMING point. It is
 * kept — it still maps to a topic, it is still a claim a learner must be able
 * to make — but it is excluded from the separation the quality bar tests
 * (`substanceSeparation`), and its "accepted by the memorized_template answer"
 * finding is not sent to the revise call.
 *
 * What it feeds instead is the conditional COMMUNICATION dimension: a learner
 * who misses framing points on a card where they exist has a delivery gap
 * (they know the mechanism but cannot open the answer), which is a different
 * diagnosis from missing a substance point. The dimension is CONDITIONAL —
 * present only on cards that have framing points — so a card with none never
 * reports a communication score it has no evidence for. That dimension is
 * specified in docs/superpowers/specs/2026-09-12-framing-points-design.md and
 * not yet computed anywhere; this module records the role so it can be.
 *
 * Only `memorized_template` qualifies. A `vague` answer credited on a
 * definition means the definition is loose (a real defect); a
 * `confident_wrong` answer credited on it means the point does not pin the
 * term (also real). The template trap is the one whose passing is expected.
 *
 * A model override ("this is substance even though the template got it") was
 * discussed and deferred: it would put a model opinion into a number the
 * pipeline otherwise computes in TypeScript, and nothing measured yet says
 * the rule is wrong often enough to pay for that.
 */
import { VERDICT_CREDIT, type KlpVerdict } from '@/lib/klp/verdicts'
import { computeSeparation, type CandidateGrade, type SeparationResult } from '@/lib/klp/separation'

export const FRAMING_KINDS = ['definition', 'contrast'] as const
export const FRAMING_PROBE = 'memorized_template'

export type PointRole = 'framing' | 'substance'

export function isFramingKind(kind: string): boolean {
  return (FRAMING_KINDS as readonly string[]).includes(kind)
}

/**
 * One role per key point. `wrong` is the graded adversaries with their
 * `kind`; only the template trap's verdicts are read, and only 'correct'
 * (full credit) counts — a 'partial' on a definition is the template
 * gesturing, which the point still separates.
 */
export function classifyPointRoles(
  klps: { kind: string }[],
  wrong: { kind: string; verdicts: KlpVerdict[] }[],
): PointRole[] {
  const template = wrong.find((w) => w.kind === FRAMING_PROBE)
  return klps.map((k, i) => {
    if (!isFramingKind(k.kind)) return 'substance'
    return template?.verdicts[i] === 'correct' ? 'framing' : 'substance'
  })
}

/**
 * `computeSeparation` over the substance points only. A card whose every
 * point is framing falls back to the full computation: it is then measured
 * as-is and will read as low discrimination, which is the honest reading of
 * a card that is nothing but a definition the template can recite.
 */
export function substanceSeparation(
  reference: CandidateGrade,
  wrong: CandidateGrade[],
  roles: PointRole[],
): SeparationResult {
  const keep = roles.map((r, i) => (r === 'substance' ? i : -1)).filter((i) => i >= 0)
  if (keep.length === 0 || keep.length === roles.length) return computeSeparation(reference, wrong)
  const pick = (g: CandidateGrade): CandidateGrade => ({ kind: g.kind, verdicts: keep.map((i) => g.verdicts[i]) })
  const sub = computeSeparation(pick(reference), wrong.map(pick))
  // Re-index `perKlp` to the card's own indices so callers can still address
  // a point by position; framing points get a non-discriminating entry that
  // says so, rather than vanishing from the list.
  const perKlp = roles.map((r, i) => {
    if (r === 'framing') return { index: i, passesReference: VERDICT_CREDIT[reference.verdicts[i]] > 0, failsSomeWrong: false, discriminates: false }
    const j = keep.indexOf(i)
    return { ...sub.perKlp[j], index: i }
  })
  return { ...sub, perKlp }
}
