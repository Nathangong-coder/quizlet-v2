/**
 * THE MECHANICAL GRADING RUBRIC (2026-09-18, owner's ask).
 *
 * The grader is an instrument: the model answers CHECKABLE questions and
 * TypeScript computes every number. The content axis already works that way
 * (per-point verdicts × weights → `answerScore`). This module does the same
 * for the COMMUNICATION axis, which until now was the model's 1-10 opinion:
 * the model answers each item below true/false with a quote, and the weight
 * table here turns the answers into clarity and conciseness out of 100.
 *
 * Why a weight table: it is what makes the rubric TUNABLE without touching a
 * prompt, and FITTABLE — the benchmark's band hit rate and the reconciliation
 * corpus can adjust these numbers autonomously later (`npm run bench-grader`
 * reports per-item agreement so a weight that never moves a score is visible).
 * Any change to the weights or the items bumps `RUBRIC_VERSION`, persisted
 * beside the scores; a score from one rubric version is never compared to
 * another's.
 *
 * Items are phrased so a model can answer them from the answer text alone —
 * no taste words ("clear", "well written"), only things a reader could point
 * at. `computed: true` items are answered by TypeScript, never the model.
 */
export const RUBRIC_VERSION = 2

export interface RubricItem {
  id: string
  /** What the model (or TS, when `computed`) checks. */
  text: string
  /** Points earned when the item is met. Weights within a dimension sum to 100. */
  weight: number
  /** TypeScript answers this one from the text; the model is not asked. */
  computed?: boolean
}

export const CLARITY_ITEMS: readonly RubricItem[] = [
  { id: 'lede', text: 'The first or second sentence directly answers the question asked, rather than opening with background or definitions.', weight: 30 },
  { id: 'followable', text: 'Every claim follows from the one before it; the reader never has to supply a missing step to see why one sentence leads to the next.', weight: 25 },
  { id: 'terms', text: 'Technical terms are used with their standard meaning and consistently; nothing is called by the wrong name.', weight: 20 },
  { id: 'coherent', text: 'The answer never contradicts itself — no sentence undoes an earlier one.', weight: 25 },
]

export const CONCISENESS_ITEMS: readonly RubricItem[] = [
  { id: 'no_restatement', text: 'No point is made twice in different words.', weight: 30 },
  { id: 'no_padding', text: 'Every sentence adds a claim, a mechanism, a condition or a figure; no sentence exists only to sound thorough.', weight: 30 },
  { id: 'no_hedging', text: 'Claims are stated as claims; there is no hedging beyond what the question genuinely leaves uncertain.', weight: 20 },
  { id: 'proportionate', text: 'Length is proportionate to the question: at most 1.5× the reference answer\'s word count.', weight: 20, computed: true },
]

export const RUBRIC_ITEMS: readonly RubricItem[] = [...CLARITY_ITEMS, ...CONCISENESS_ITEMS]
export const MODEL_RUBRIC_ITEMS: readonly RubricItem[] = RUBRIC_ITEMS.filter((i) => !i.computed)

/**
 * Ratio of answer words to the YARDSTICK's words above which `proportionate`
 * fails. RUBRIC v2 (2026-09-18): the yardstick is the card's own definition —
 * a spoken answer to a terse note runs a few times its length and no more.
 * v1 measured against the authored reference, and the reference was the
 * bloat: on the LBO set references ran 3-11x the definitions, so a 130-word
 * answer to a 38-word card scored conciseness 100 and the owner's 38-word
 * answer earned nothing for being the right length. The reference is the
 * fallback only when a card has no definition text.
 */
export const PROPORTIONATE_MAX_RATIO = 2.5

export interface RubricAnswer {
  id: string
  met: boolean
  /** Verbatim excerpt that decided it — required when `met` is false, so a fail is inspectable. */
  quote?: string
}

export interface ExpressionScores {
  rubricVersion: number
  /** Out of 100 — the content axis (`answerScore` × 100), so all three numbers share a scale. */
  accuracy: number
  clarity: number
  conciseness: number
  /** Every item with its outcome; `answered: false` when the model skipped it (scored as not met, and warned). */
  items: { id: string; met: boolean; answered: boolean; quote?: string }[]
  warnings: string[]
}

export function wordCount(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * Pure. `modelAnswers` are the model's true/false items; the computed items
 * are decided here from the texts. A missing item is NOT met — the model was
 * asked and did not answer — and is warned as `rubric_unanswered:<id>` so a
 * grader that stops answering an item is visible in the benchmark, not
 * silently scored as passing.
 */
export function scoreExpression(input: {
  contentScore: number
  modelAnswers: readonly RubricAnswer[]
  answerText: string
  /** The card's own definition — the length yardstick from rubric v2. */
  definitionText?: string | null
  /** Fallback yardstick when the card has no definition text. */
  referenceText: string | null
}): ExpressionScores {
  const yardstick = input.definitionText?.trim() ? { text: input.definitionText, name: 'the definition' } : input.referenceText ? { text: input.referenceText, name: 'the reference' } : null
  const byId = new Map(input.modelAnswers.map((a) => [a.id, a]))
  const warnings: string[] = []
  const items: ExpressionScores['items'] = []
  const evaluate = (item: RubricItem): boolean => {
    if (item.computed) {
      if (item.id === 'proportionate') {
        if (!yardstick) { items.push({ id: item.id, met: true, answered: true }); return true }
        const ratio = wordCount(input.answerText) / Math.max(1, wordCount(yardstick.text))
        const met = ratio <= PROPORTIONATE_MAX_RATIO
        items.push({ id: item.id, met, answered: true, quote: met ? undefined : `${wordCount(input.answerText)} words vs ${wordCount(yardstick.text)} in ${yardstick.name}` })
        return met
      }
      throw new Error(`rubric: no computation for item ${item.id}`)
    }
    const a = byId.get(item.id)
    if (!a) {
      warnings.push(`rubric_unanswered:${item.id}`)
      items.push({ id: item.id, met: false, answered: false })
      return false
    }
    items.push({ id: item.id, met: a.met, answered: true, quote: a.quote })
    return a.met
  }
  const score = (list: readonly RubricItem[]) => list.reduce((n, item) => n + (evaluate(item) ? item.weight : 0), 0)
  const clarity = score(CLARITY_ITEMS)
  const conciseness = score(CONCISENESS_ITEMS)
  for (const a of input.modelAnswers) if (!RUBRIC_ITEMS.some((i) => i.id === a.id)) warnings.push(`rubric_unknown_item:${a.id}`)
  return {
    rubricVersion: RUBRIC_VERSION,
    accuracy: Math.round(Math.max(0, Math.min(1, input.contentScore)) * 100),
    clarity,
    conciseness,
    items,
    warnings,
  }
}

/** The checklist as the prompt lists it — ids the model must echo back. */
export function rubricPromptBlock(): string {
  const line = (i: RubricItem) => `  - "${i.id}": ${i.text}`
  return `Communication checklist. For EACH item below return { "id", "met": true|false, "quote" } — "quote" is a verbatim excerpt (at most 20 words) that decided it, required when "met" is false. Judge the answer's own text only; do not score it — the score is computed from your answers.
Clarity:
${CLARITY_ITEMS.filter((i) => !i.computed).map(line).join('\n')}
Conciseness:
${CONCISENESS_ITEMS.filter((i) => !i.computed).map(line).join('\n')}`
}
