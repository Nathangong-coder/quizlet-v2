import { describe, it, expect } from 'vitest'
import { reconcileCards } from '@/lib/cards/reconcile'

const card = (id: string | undefined, term: string) => ({ id, term })

describe('reconcileCards', () => {
  it('updates cards whose id already belongs to the set', () => {
    const plan = reconcileCards(['a', 'b'], [card('a', 'WACC'), card('b', 'CAPM')])
    expect(plan.toUpdate).toEqual([
      { id: 'a', card: card('a', 'WACC') },
      { id: 'b', card: card('b', 'CAPM') },
    ])
    expect(plan.toCreate).toEqual([])
    expect(plan.toDeleteIds).toEqual([])
  })

  it('creates cards that arrive with no id', () => {
    const plan = reconcileCards(['a'], [card('a', 'WACC'), card(undefined, 'Beta')])
    expect(plan.toCreate).toEqual([card(undefined, 'Beta')])
    expect(plan.toUpdate).toHaveLength(1)
  })

  it('deletes cards the payload no longer mentions', () => {
    const plan = reconcileCards(['a', 'b', 'c'], [card('a', 'WACC')])
    expect(plan.toDeleteIds).toEqual(['b', 'c'])
  })

  it('does NOT adopt a card id belonging to another set', () => {
    // A foreign id must never be honoured: honouring it would let a caller
    // graft another user's card into their own set. It is created fresh
    // instead, which is both safe and forgiving of a stale editor tab.
    const plan = reconcileCards(['a'], [card('someone-elses-card', 'WACC')])
    expect(plan.toUpdate).toEqual([])
    expect(plan.toCreate).toEqual([card('someone-elses-card', 'WACC')])
    expect(plan.toDeleteIds).toEqual(['a'])
  })

  it('ignores a duplicated id rather than updating the same row twice', () => {
    const plan = reconcileCards(['a'], [card('a', 'first'), card('a', 'second')])
    expect(plan.toUpdate).toEqual([{ id: 'a', card: card('a', 'first') }])
    expect(plan.toCreate).toEqual([card('a', 'second')])
  })

  it('treats an empty existing set as all-creates', () => {
    const plan = reconcileCards([], [card(undefined, 'Beta')])
    expect(plan.toCreate).toHaveLength(1)
    expect(plan.toDeleteIds).toEqual([])
  })
})
