/**
 * R4 — the abstraction axis, kept strictly separate from `CardKlp.kind`.
 *
 * ## Why the rename was necessary
 *
 * The design first proposed a `grain` scale of `claim / mechanism /
 * disposition`. But `mechanism` is ALREADY a `CardKlp.kind` value
 * (`definition|mechanism|causal|condition|quantitative|contrast|example`), and
 * it means something different there: `kind` says WHAT TYPE of proposition this
 * is, while the new axis says HOW ABSTRACT it is. One string carrying both
 * would make every query against it ambiguous.
 *
 * This project has made exactly this mistake once already — user categories
 * pressed into service as concept nodes — and it is still recorded as an open
 * limit in CLAUDE.md, where a "label the image" category aggregates mastery
 * across unrelated biology. Two axes collapsed into one field is fine for
 * filtering and wrong for measurement.
 *
 * So the axis is `abstraction`, its levels are `concrete / relational /
 * dispositional`, and `kind` is untouched.
 *
 * ## The rule that earns its place
 *
 * **A DISPOSITION IS NEVER A KEY POINT.** "Understands the relationship between
 * leverage and risk" is not a proposition about the world; it is a claim about
 * a person, and it cannot be true or false of an ANSWER. Grading an answer
 * against it produces a judgment with nothing to check, which is how a KLP set
 * ends up looking rigorous while measuring an assessor's impression. Those
 * belong on the concept graph as nodes, not in a card's key points.
 */

export const ABSTRACTION_LEVELS = ['concrete', 'relational', 'dispositional'] as const

export type AbstractionLevel = (typeof ABSTRACTION_LEVELS)[number]

export function isAbstractionLevel(value: unknown): value is AbstractionLevel {
  return typeof value === 'string' && (ABSTRACTION_LEVELS as readonly string[]).includes(value)
}

/** Ordered, so "spread" and "outlier" mean something. */
const RANK: Record<AbstractionLevel, number> = {
  concrete: 0,
  relational: 1,
  dispositional: 2,
}

export interface AbstractionDefect {
  index: number | null
  rule: 'disposition' | 'abstraction_spread'
  detail: string
}

/**
 * Judges ONE CARD's abstraction levels. Never compares across cards.
 *
 * **THE WITHIN-CARD RULE IS NOT A DETAIL, IT IS THE WHOLE SCOPE.** Different
 * cards legitimately sit at different specificity: a definitional card and a
 * three-statement walkthrough are not supposed to match, and a cross-card
 * comparison would flag correct authoring as a defect on the cards that are
 * most obviously fine. The check is variance INSIDE one card's set, nothing
 * more — the same reasoning that keeps every hygiene check bounded to a single
 * card's key points.
 *
 * Two findings, with different causes:
 *
 * - `disposition` — a point that is a claim about a PERSON rather than about
 *   the world. Always a defect, at any count, because such a point cannot be
 *   true or false of an answer.
 * - `abstraction_spread` — the card's remaining points span both `concrete` and
 *   `relational` while being lopsided enough that one lone point sits at a
 *   different level from all the others. A card entirely at one level is fine;
 *   a card genuinely mixing both is fine; ONE point out of six at a different
 *   level usually means that point was written to a different brief.
 */
export function findAbstractionDefects(
  levels: (AbstractionLevel | undefined)[],
): AbstractionDefect[] {
  const defects: AbstractionDefect[] = []

  levels.forEach((level, index) => {
    if (level === 'dispositional') {
      defects.push({
        index,
        rule: 'disposition',
        detail:
          'a disposition ("understands X") is a claim about a person, not a proposition ' +
          'about the world — it cannot be true or false of an answer. Belongs on the ' +
          'concept graph, not in a card\'s key points.',
      })
    }
  })

  // Spread is judged over the non-dispositional remainder: a disposition is
  // already reported, and letting it also drag the spread statistic would
  // report one defect twice.
  // An UNCLASSIFIED point is dropped from the spread statistic, never counted
  // as anything. A point the model skipped is unexamined, not concrete, and
  // letting it stand in for a level would let a truncated reply change the
  // shape of the card.
  const remaining = levels.filter((l): l is AbstractionLevel => l !== undefined && l !== 'dispositional')
  if (remaining.length >= 4) {
    const counts = new Map<AbstractionLevel, number>()
    for (const l of remaining) counts.set(l, (counts.get(l) ?? 0) + 1)
    for (const [level, n] of counts) {
      if (n === 1 && remaining.length - n >= 3) {
        const index = levels.findIndex((l) => l === level)
        defects.push({
          index,
          rule: 'abstraction_spread',
          detail:
            `one point is ${level} while the other ${remaining.length - n} are not — ` +
            `on a card this size that usually means it was written to a different brief. ` +
            `Judged WITHIN this card only; cards legitimately differ from each other.`,
        })
      }
    }
  }

  return defects
}

/** Convenience for reporting: the levels present, in order. */
export function abstractionSpread(levels: (AbstractionLevel | undefined)[]): AbstractionLevel[] {
  return [...new Set(levels.filter((l): l is AbstractionLevel => l !== undefined))].sort(
    (a, b) => RANK[a] - RANK[b],
  )
}

/**
 * Turns a classifier's index-keyed reply into levels in KLP order.
 *
 * A MISSING entry stays `undefined` and the caller drops it, rather than being
 * defaulted to `concrete`. Defaulting would be the flattering direction twice
 * over: it invents a level nobody judged, and `concrete` is the level least
 * likely to trigger any finding — so a model that skipped a point would make
 * that point look clean rather than unexamined. Same reasoning as
 * `toOrderedVerdicts` filling gaps with an explicit `failed` instead of
 * silence, inverted for a check where absence must not read as health.
 */
export function toOrderedLevels(
  reply: { levels: { klpIndex: number; level: AbstractionLevel }[] },
  count: number,
): (AbstractionLevel | undefined)[] {
  const byIndex = new Map(reply.levels.map((l) => [l.klpIndex, l.level]))
  return Array.from({ length: count }, (_, i) => byIndex.get(i))
}
