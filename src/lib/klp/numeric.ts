/**
 * R6 — numeric consistency, in TypeScript, with no model in the loop.
 *
 * THE POINT OF DOING IT IN CODE. A model that got the arithmetic wrong while
 * authoring will confidently confirm it while verifying: the same weights that
 * produced "EBIT falls 10, so net income falls 5" will happily agree that 5 is
 * right when asked. Arithmetic is the one class of error where a second opinion
 * from the same kind of system is worth nothing, and where a check costs a
 * microsecond. The spec calls it the cheapest high-value check available and
 * that is exactly why.
 *
 * ## Scope, and why it is narrow on purpose
 *
 * This does NOT try to verify every number on a card. It fires only where the
 * card's own key points name BOTH sides of a relationship the corpus uses
 * constantly and gets wrong in a recognisable way: a pre-tax quantity, a
 * post-tax quantity, and the tax rate connecting them.
 *
 * A false positive here is worse than a miss. A flag that fires on correct
 * authoring teaches the operator to ignore the flag, and then it catches
 * nothing at all — the same reasoning that keeps `isCompound` in
 * `validate.ts` deliberately narrow. A miss is merely a defect that survives to
 * the discrimination test, which is where it would have been caught anyway.
 */

/** A number found in a key point, with the sign of its role. */
export interface NumericFact {
  klpIndex: number
  /** The bare magnitude. `40%` yields 40 with `isPercent` true. */
  value: number
  isPercent: boolean
  /** The phrase it was found in, for the defect message. */
  context: string
}

/**
 * Words placing a quantity ABOVE the tax line. `EBT`/`pre-tax income` are the
 * immediate pre-tax figure; `EBIT`/`operating income` sit above interest too,
 * but on the walkthrough cards this check targets they are the quantity a tax
 * rate is applied to.
 */
const PRE_TAX_ANCHORS =
  /\b(ebit|ebt|operating income|operating profit|pre-?tax|pretax|before tax|earnings before)\b/i

/** Words placing a quantity BELOW the tax line. */
const POST_TAX_ANCHORS = /\b(net income|after-?tax|net of tax|bottom line|net earnings)\b/i

/** The rate itself. Requires the word, so a stray percentage is not a tax rate. */
const TAX_RATE_ANCHORS = /\b(tax rate|taxed at|tax of|effective tax)\b/i

/**
 * Tolerance on the after-tax identity, as a fraction of the expected value.
 *
 * Non-zero because key points round: a card may legitimately say "EBIT falls
 * 10" and "net income falls about 6" at a 40.5% rate. 2% is tight enough to
 * catch a wrong tax rate or a transposed digit and loose enough to accept
 * ordinary rounding.
 */
export const NUMERIC_TOLERANCE = 0.02

/**
 * Pulls numbers out of one key point.
 *
 * Handles `$1,000`, `10`, `40%`, `0.4`. Deliberately ignores years (a bare
 * four-digit number in 1900-2100) — a card mentioning "the 2008 crisis" must
 * not contribute 2008 as a magnitude.
 */
export function extractNumbers(text: string, klpIndex: number): NumericFact[] {
  const out: NumericFact[] = []
  const re = /(\$?\s?-?\d[\d,]*(?:\.\d+)?)\s*(%|percent)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const raw = m[1].replace(/[$,\s]/g, '')
    const value = Number.parseFloat(raw)
    if (!Number.isFinite(value)) continue
    const isPercent = Boolean(m[2])
    // A bare year is not a magnitude.
    if (!isPercent && Number.isInteger(value) && value >= 1900 && value <= 2100 && !/[$.]/.test(m[1])) {
      continue
    }
    const start = Math.max(0, m.index - 30)
    out.push({
      klpIndex,
      value,
      isPercent,
      context: text.slice(start, Math.min(text.length, m.index + m[0].length + 30)).trim(),
    })
  }
  return out
}

/** A tax rate as a fraction (0.4), from either `40%` or `0.4`. */
function asFraction(fact: NumericFact): number | null {
  if (fact.isPercent) return fact.value > 1 ? fact.value / 100 : fact.value
  if (fact.value > 0 && fact.value < 1) return fact.value
  return null
}

export interface NumericDefect {
  /** The key point carrying the post-tax figure — where the wrong number lives. */
  index: number
  detail: string
}

/**
 * Checks the after-tax identity across ONE CARD's key points.
 *
 * Fires only when all three are present: a stated tax rate, a pre-tax
 * magnitude, and a post-tax magnitude. Then `post === pre x (1 - rate)` must
 * hold for SOME pairing, within tolerance.
 *
 * "For some pairing" and not "for every pairing" is load-bearing. A card can
 * legitimately carry several numbers — a revenue figure, a depreciation
 * figure, a margin — and demanding that every pre/post pair satisfy the
 * identity would flag correct cards constantly. The check asks whether the set
 * is CONSISTENT, i.e. whether a reading exists under which the arithmetic
 * works, and only reports when none does.
 */
export function findNumericDefects(klps: { text: string }[]): NumericDefect[] {
  const facts = klps.flatMap((k, i) => extractNumbers(k.text, i))
  if (facts.length === 0) return []

  // THE RATE MUST BE NAMED AS A TAX RATE. An earlier version also accepted any
  // bare percentage, and that was a false-positive generator: measured against
  // the live corpus, it fired on a non-controlling-interest card where 80%,
  // 50% and 20% are OWNERSHIP STAKES and there is no tax arithmetic anywhere —
  // "operating income" matched the pre-tax anchor, "net income" the post-tax
  // one, and a stray stake played the part of the rate. A finance corpus is
  // full of percentages that are not tax rates.
  const rates = facts
    .filter((f) => TAX_RATE_ANCHORS.test(klps[f.klpIndex].text))
    .map((f) => ({ fact: f, rate: asFraction(f) }))
    .filter((r): r is { fact: NumericFact; rate: number } => r.rate !== null && r.rate > 0 && r.rate < 1)

  // No stated rate means nothing to check against. NOT a defect — most cards
  // have no tax arithmetic at all.
  if (rates.length === 0) return []

  const preTax = facts.filter(
    (f) => !f.isPercent && PRE_TAX_ANCHORS.test(klps[f.klpIndex].text),
  )
  const postTax = facts.filter(
    (f) => !f.isPercent && POST_TAX_ANCHORS.test(klps[f.klpIndex].text),
  )
  if (preTax.length === 0 || postTax.length === 0) return []

  for (const { rate } of rates) {
    for (const pre of preTax) {
      for (const post of postTax) {
        const expected = pre.value * (1 - rate)
        if (expected === 0) continue
        if (Math.abs(post.value - expected) / Math.abs(expected) <= NUMERIC_TOLERANCE) {
          // A consistent reading exists. The set is fine.
          return []
        }
      }
    }
  }

  // Report against the FIRST rate and the first pre/post pair, which is the
  // reading a human will check by hand.
  const rate = rates[0].rate
  const pre = preTax[0]
  const post = postTax[0]
  const expected = pre.value * (1 - rate)
  return [
    {
      index: post.klpIndex,
      detail:
        `after-tax arithmetic does not hold: ${pre.value} x (1 - ${rate}) = ` +
        `${expected.toFixed(2)}, but this point says ${post.value}`,
    },
  ]
}
