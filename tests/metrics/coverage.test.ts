import { describe, it, expect, vi } from 'vitest'
import { diagnoseEmptyState, loadCoverage, type DashboardCoverage } from '@/lib/metrics/coverage'
import { EMPTY_SCOPE } from '@/lib/memory/scope'

/** A library where everything works — each test breaks exactly one thing. */
const HEALTHY: DashboardCoverage = {
  klpStates: 20,
  klpStatesClearingFloor: 12,
  cardsWithLiveKlps: 30,
  cardsWithLiveKlpsInScope: 30,
  categorizedCards: 25,
  topicCapableCards: 25,
  pendingExtraction: 0,
}

const FLOOR = 3

describe('diagnoseEmptyState', () => {
  it('returns null when nothing is wrong', () => {
    expect(diagnoseEmptyState(HEALTHY, false, FLOOR)).toBeNull()
  })

  it('names no_klps when no card has key points, and reports what is pending', () => {
    // Pending extraction means WAIT, not act — a different instruction from
    // every other cause here.
    const cause = diagnoseEmptyState(
      { ...HEALTHY, cardsWithLiveKlps: 0, cardsWithLiveKlpsInScope: 0, pendingExtraction: 7 },
      false,
      FLOOR,
    )
    expect(cause).toEqual({ kind: 'no_klps', blocking: true, pendingExtraction: 7 })
  })

  it('names scope_too_narrow when the library has candidates but the view does not', () => {
    const cause = diagnoseEmptyState({ ...HEALTHY, cardsWithLiveKlpsInScope: 0 }, true, FLOOR)
    expect(cause?.kind).toBe('scope_too_narrow')
  })

  it('does NOT name scope_too_narrow when no scope is in force', () => {
    // Unreachable unscoped: with no filter, in-scope and library counts are the
    // same query. Reporting it would tell the learner to widen a scope they
    // never set.
    const cause = diagnoseEmptyState({ ...HEALTHY, cardsWithLiveKlpsInScope: 0 }, false, FLOOR)
    expect(cause?.kind).not.toBe('scope_too_narrow')
  })

  it('names no_history when key points exist but nothing has been studied', () => {
    const cause = diagnoseEmptyState(
      { ...HEALTHY, klpStates: 0, klpStatesClearingFloor: 0 },
      false,
      FLOOR,
    )
    expect(cause?.kind).toBe('no_history')
  })

  it('names below_floor with the LEARNER\'S floor, not a constant', () => {
    const cause = diagnoseEmptyState({ ...HEALTHY, klpStatesClearingFloor: 0 }, false, 1)
    expect(cause).toEqual({ kind: 'below_floor', blocking: false, measured: 20, floor: 1 })
  })

  it('names nothing_categorized when no card can produce a topic', () => {
    const cause = diagnoseEmptyState({ ...HEALTHY, topicCapableCards: 0 }, false, FLOOR)
    expect(cause).toEqual({
      kind: 'nothing_categorized',
      blocking: false,
      cardsWithLiveKlps: 30,
    })
  })

  it('treats nothing_categorized as NON-blocking since Task 4B', () => {
    // Uncategorized KLPs are study candidates now, so the ranked list renders
    // and only the topic sections are empty. Blocking copy here would describe
    // the pre-4B app.
    const cause = diagnoseEmptyState({ ...HEALTHY, topicCapableCards: 0 }, false, FLOOR)
    expect(cause!.blocking).toBe(false)
  })

  it('prefers scope_too_narrow over nothing_categorized when BOTH hold', () => {
    // The ordering assertion. Both read as "nothing is here" and the remedies
    // are opposite — widen versus categorize — so a merged message would send
    // half of these learners to the wrong fix.
    const cause = diagnoseEmptyState(
      { ...HEALTHY, cardsWithLiveKlpsInScope: 0, topicCapableCards: 0 },
      true,
      FLOOR,
    )
    expect(cause?.kind).toBe('scope_too_narrow')
  })

  it('prefers no_klps over everything, including a narrow scope', () => {
    const cause = diagnoseEmptyState(
      {
        klpStates: 0, klpStatesClearingFloor: 0, cardsWithLiveKlps: 0,
        cardsWithLiveKlpsInScope: 0, categorizedCards: 4, topicCapableCards: 0,
        pendingExtraction: 0,
      },
      true,
      FLOOR,
    )
    expect(cause?.kind).toBe('no_klps')
  })

  it('reproduces the 3B live gate: 68 KLP cards, 4 categorized, zero overlap', () => {
    // The real library that produced an empty dashboard. Post-4B it is an
    // advisory beside a working study list, not a blocking empty page.
    const cause = diagnoseEmptyState(
      {
        klpStates: 26, klpStatesClearingFloor: 2, cardsWithLiveKlps: 68,
        cardsWithLiveKlpsInScope: 68, categorizedCards: 4, topicCapableCards: 0,
        pendingExtraction: 0,
      },
      false,
      1,
    )
    expect(cause?.kind).toBe('nothing_categorized')
    expect(cause!.blocking).toBe(false)
  })
})

describe('loadCoverage', () => {
  function mockPrisma(counts: number[]) {
    const klpCount = vi.fn()
    const cardCount = vi.fn()
    klpCount.mockResolvedValueOnce(counts[0]).mockResolvedValueOnce(counts[1])
    cardCount
      .mockResolvedValueOnce(counts[2]).mockResolvedValueOnce(counts[3])
      .mockResolvedValueOnce(counts[4]).mockResolvedValueOnce(counts[5])
      .mockResolvedValueOnce(counts[6])
    return {
      prisma: { klpState: { count: klpCount }, card: { count: cardCount } },
      klpCount,
      cardCount,
    }
  }

  it('filters EVERY count by owner', async () => {
    // tuning-check.ts counted cardKlp and card globally, which is wrong the
    // moment a second user exists — and this helper backs a page.
    const { prisma, klpCount, cardCount } = mockPrisma([1, 2, 3, 4, 5, 6, 7])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadCoverage(prisma as any, 'u1', EMPTY_SCOPE, [], 3)

    for (const call of klpCount.mock.calls) expect(call[0].where.userId).toBe('u1')
    for (const call of cardCount.mock.calls) expect(call[0].where.set).toEqual({ userId: 'u1' })
  })

  it('applies the learner\'s floor to the clearing count', async () => {
    const { prisma, klpCount } = mockPrisma([1, 2, 3, 4, 5, 6, 7])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await loadCoverage(prisma as any, 'u1', EMPTY_SCOPE, [], 7)
    expect(klpCount.mock.calls[1][0].where.observations).toEqual({ gte: 7 })
  })

  it('narrows only the in-scope count, leaving the library totals whole', async () => {
    // The two must come from different populations or scope_too_narrow can
    // never be distinguished from nothing_categorized.
    const { prisma, cardCount } = mockPrisma([1, 2, 3, 4, 5, 6, 7])
    await loadCoverage(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prisma as any,
      'u1',
      { ...EMPTY_SCOPE, setIds: ['s1'] },
      [],
      3,
    )
    expect(cardCount.mock.calls[0][0].where).not.toHaveProperty('setId')
    expect(cardCount.mock.calls[1][0].where.setId).toEqual({ in: ['s1'] })
  })
})
