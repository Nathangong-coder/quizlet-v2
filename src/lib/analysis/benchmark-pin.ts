import type { ShortAnswerGrade } from '@/lib/ai/schemas'
import type { BenchGrader } from '@/lib/analysis/benchmark-run'

/**
 * Per-CARD pinning for `bench-grader --direct`.
 *
 * THE UNIT OF PINNING IS THE CARD, not the call — `src/lib/klp/direct-pool.ts`
 * states why for authoring, and the benchmark has the identical shape: rank
 * agreement SUBTRACTS one card's four coverage scores, so grading those four
 * answers on different models puts the difference between two graders
 * inside the number meant to measure the difference between a strong and a
 * weak answer. `regrade.ts` rotates per call because its answers are
 * independent; that was the wrong precedent here (Task 11 review).
 *
 * `pinPerCard` takes one combo from the pool when a card STARTS and grades
 * every answer of that card on it. A per-day quota hit mid-card retires the
 * combo and ABANDONS the card's remaining answers for this run — never
 * re-pins within the card. The next run picks them up idempotently on
 * whatever combo is then pinned; and because results are keyed by model,
 * `selectCardResults` refuses to score a card across two models (`mixed`).
 *
 * Generic over the combo and injected with the call and the quota
 * predicate so it is testable without a provider, a pacer or the pool.
 */
export interface PinnedPool<C> {
  /** The next combo to pin — LRU over the pool — or undefined when every combo is retired. */
  next(): C | undefined
  /** Retire a combo that hit its daily quota. */
  retire(combo: C): void
}

export type ComboCall<C> = (
  combo: C,
  input: Parameters<BenchGrader>[0],
) => Promise<ShortAnswerGrade>

export class CardAbandonedError extends Error {
  constructor(
    public readonly cardId: string,
    public readonly model: string,
  ) {
    super(`card ${cardId}: pinned model ${model} is out of daily quota; remaining answers abandoned for this run`)
    this.name = 'CardAbandonedError'
  }
}

export interface PinnedGrader<C> {
  combo: C
  grade: BenchGrader
}

export function pinPerCard<C extends { model: string }>(
  pool: PinnedPool<C>,
  call: ComboCall<C>,
  isQuotaHalt: (err: unknown) => boolean,
): (cardId: string) => PinnedGrader<C> | null {
  return (cardId) => {
    const combo = pool.next()
    if (!combo) return null
    let abandoned = false
    const grade: BenchGrader = async (input) => {
      if (abandoned) throw new CardAbandonedError(cardId, combo.model)
      try {
        const value = await call(combo, input)
        return { value, model: combo.model }
      } catch (err) {
        if (!isQuotaHalt(err)) throw err
        abandoned = true
        pool.retire(combo)
        throw new CardAbandonedError(cardId, combo.model)
      }
    }
    return { combo, grade }
  }
}
