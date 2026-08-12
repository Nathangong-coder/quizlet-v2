import { describe, it, expect, vi, beforeEach } from 'vitest'
import { attemptsNeedingRescore, rescoreSetAttempts } from '@/lib/quiz/rescore'

describe('attemptsNeedingRescore', () => {
  it('omits rows whose recomputed score already matches the stored one', () => {
    expect(
      attemptsNeedingRescore([
        { id: 'a', score: 50, answers: [{ score: 100 }, { score: 0 }] },
        { id: 'b', score: 100, answers: [{ score: 100 }] },
      ]),
    ).toEqual([])
  })

  it('emits 100 -> null when every scored answer is gone', () => {
    // The whole point: an attempt that keeps a score after losing all of its
    // evidence is the defect rescoreSetAttempts exists to prevent.
    expect(attemptsNeedingRescore([{ id: 'a', score: 100, answers: [] }])).toEqual([
      { id: 'a', score: null },
    ])
  })

  it('emits null even when answers survive but none of them carries a score', () => {
    expect(
      attemptsNeedingRescore([{ id: 'a', score: 99, answers: [{ score: null }] }]),
    ).toEqual([{ id: 'a', score: null }])
  })

  it('omits null -> null', () => {
    expect(
      attemptsNeedingRescore([
        { id: 'a', score: null, answers: [] },
        { id: 'b', score: null, answers: [{ score: null }] },
      ]),
    ).toEqual([])
  })

  it('emits a partial loss: 96 -> 95', () => {
    // Stored 96 was the mean of four answers (100, 100, 100, 85 -> 96.25).
    // Deleting the 100 leaves 100, 100, 85 -> 95.
    expect(
      attemptsNeedingRescore([
        { id: 'a', score: 96, answers: [{ score: 100 }, { score: 100 }, { score: 85 }] },
      ]),
    ).toEqual([{ id: 'a', score: 95 }])
  })

  it('rounds via storedScore rather than truncating', () => {
    // Mean of [100, 0, 0] is 33.33 -> 33; mean of [100, 100, 0] is 66.67 -> 67.
    expect(
      attemptsNeedingRescore([
        { id: 'a', score: 0, answers: [{ score: 100 }, { score: 0 }, { score: 0 }] },
        { id: 'b', score: 0, answers: [{ score: 100 }, { score: 100 }, { score: 0 }] },
      ]),
    ).toEqual([
      { id: 'a', score: 33 },
      { id: 'b', score: 67 },
    ])
  })

  it('returns an empty list for an empty input', () => {
    expect(attemptsNeedingRescore([])).toEqual([])
  })
})

describe('rescoreSetAttempts', () => {
  const findMany = vi.fn()
  const update = vi.fn()
  const tx = { quizAttempt: { findMany, update } } as never

  beforeEach(() => {
    vi.clearAllMocks()
    update.mockResolvedValue({})
  })

  it('queries the set WITHOUT a userId filter', async () => {
    // Deliberate: sets are link-shareable, so the owner's edit strands OTHER
    // learners' scores. A userId scope here would silently defeat the feature.
    findMany.mockResolvedValue([])

    await rescoreSetAttempts(tx, 'set-1')

    expect(findMany).toHaveBeenCalledWith({
      where: { setId: 'set-1' },
      select: { id: true, score: true, answers: { select: { score: true } } },
    })
    const where = findMany.mock.calls[0][0].where
    expect(where).not.toHaveProperty('userId')
  })

  it('writes null — no `if (score !== null)` guard', async () => {
    findMany.mockResolvedValue([{ id: 'attempt-1', score: 100, answers: [] }])

    await rescoreSetAttempts(tx, 'set-1')

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ where: { id: 'attempt-1' }, data: { score: null } })
  })

  it('updates only the rows that actually changed', async () => {
    findMany.mockResolvedValue([
      { id: 'unchanged', score: 50, answers: [{ score: 100 }, { score: 0 }] },
      { id: 'changed', score: 96, answers: [{ score: 100 }, { score: 100 }, { score: 85 }] },
    ])

    await rescoreSetAttempts(tx, 'set-1')

    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ where: { id: 'changed' }, data: { score: 95 } })
  })
})
