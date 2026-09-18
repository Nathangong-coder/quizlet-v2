import { describe, it, expect, vi } from 'vitest'
import { pinPerCard, CardAbandonedError, type PinnedPool } from '@/lib/analysis/benchmark-pin'
import type { ShortAnswerGrade } from '@/lib/ai/schemas'
import { ShortAnswerGradeSchema } from '@/lib/ai/schemas'

/**
 * THE UNIT OF PINNING IS THE CARD (`src/lib/klp/direct-pool.ts`): rank
 * agreement subtracts one card's four coverage scores, so all four must be
 * graded by ONE model or the gap between two graders lands inside the gap
 * between levels. `pinPerCard` takes the combo once per card and grades
 * every answer on it; a per-day quota hit mid-card retires the combo and
 * abandons the card's remaining answers for this run.
 */
interface Combo {
  id: string
  model: string
}

function fakePool(combos: Combo[]): PinnedPool<Combo> & { next: ReturnType<typeof vi.fn>; retired: Combo[] } {
  const queue = [...combos]
  const retired: Combo[] = []
  const next = vi.fn(() => queue.shift())
  return { next, retire: (c: Combo) => retired.push(c), retired }
}

const grade = {} as ShortAnswerGrade
const input = { prompt: 'p', schema: ShortAnswerGradeSchema, maxOutputTokens: 100 }

describe('pinPerCard', () => {
  it('takes one combo per card and grades every answer of the card on it', async () => {
    const pool = fakePool([{ id: 'k1', model: 'm1' }, { id: 'k2', model: 'm2' }])
    const seen: string[] = []
    const call = vi.fn(async (combo: Combo) => {
      seen.push(combo.model)
      return grade
    })
    const pin = pinPerCard(pool, call, () => false)

    const card1 = pin('card-a')!
    for (let i = 0; i < 4; i++) await card1.grade(input)
    expect(pool.next).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['m1', 'm1', 'm1', 'm1'])

    const card2 = pin('card-b')!
    await card2.grade(input)
    expect(pool.next).toHaveBeenCalledTimes(2)
    expect(seen[4]).toBe('m2')
  })

  it('reports the pinned model on every result so the row records it', async () => {
    const pool = fakePool([{ id: 'k1', model: 'm1' }])
    const pin = pinPerCard(pool, async () => grade, () => false)
    const r = await pin('card-a')!.grade(input)
    expect(r).toEqual({ value: grade, model: 'm1' })
  })

  it('returns null when every combo is retired', () => {
    const pool = fakePool([])
    expect(pinPerCard(pool, async () => grade, () => false)('card-a')).toBeNull()
  })

  it('a quota hit mid-card retires the combo and abandons the card, never re-pins within it', async () => {
    const pool = fakePool([{ id: 'k1', model: 'm1' }, { id: 'k2', model: 'm2' }])
    const quota = new Error('daily quota')
    const call = vi.fn(async () => grade)
    call.mockResolvedValueOnce(grade).mockRejectedValueOnce(quota)
    const pin = pinPerCard(pool, call, (err) => err === quota)

    const card = pin('card-a')!
    await card.grade(input)
    await expect(card.grade(input)).rejects.toBeInstanceOf(CardAbandonedError)
    expect(pool.retired).toEqual([{ id: 'k1', model: 'm1' }])
    // The abandoned card's grader is dead: it never silently moves to k2.
    await expect(card.grade(input)).rejects.toBeInstanceOf(CardAbandonedError)
    expect(pool.next).toHaveBeenCalledTimes(1)
    // The NEXT card pins fresh.
    expect(pin('card-b')!.combo.model).toBe('m2')
  })

  it('a non-quota failure is the answer\'s own and leaves the pin in place', async () => {
    const pool = fakePool([{ id: 'k1', model: 'm1' }])
    const boom = new Error('schema_invalid')
    const call = vi.fn(async () => grade)
    call.mockRejectedValueOnce(boom).mockResolvedValueOnce(grade)
    const card = pinPerCard(pool, call, () => false)('card-a')!
    await expect(card.grade(input)).rejects.toBe(boom)
    expect((await card.grade(input)).model).toBe('m1')
    expect(pool.retired).toEqual([])
  })

  it('CardAbandonedError names the card and the retired model', () => {
    const e = new CardAbandonedError('card-a', 'm1')
    expect(e.cardId).toBe('card-a')
    expect(e.model).toBe('m1')
    expect(e.message).toMatch(/card-a.*m1/)
  })
})
