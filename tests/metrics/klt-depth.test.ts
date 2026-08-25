import { describe, it, expect } from 'vitest'
import { selectDisplayDepth, MIN_TOPICS_AT_DEPTH } from '@/lib/metrics/klt-depth'

describe('selectDisplayDepth', () => {
  it('picks the DEEPEST level with enough measured topics', () => {
    const m = new Map([[0, 1], [1, 5], [2, 4], [3, 1]])
    expect(selectDisplayDepth(m, [0, 1, 2, 3])).toBe(2)
  })

  it(`requires at least ${MIN_TOPICS_AT_DEPTH} measured topics at a level`, () => {
    const m = new Map([[0, 5], [1, MIN_TOPICS_AT_DEPTH - 1]])
    expect(selectDisplayDepth(m, [0, 1])).toBe(0)
  })

  it('falls back to the shallowest POPULATED level when nothing is measured', () => {
    // A thin corpus must still show something, and the broadest level is the
    // one most likely to have any evidence at all.
    expect(selectDisplayDepth(new Map(), [2, 3])).toBe(2)
  })

  it('returns null when there is no tree at all', () => {
    expect(selectDisplayDepth(new Map(), [])).toBeNull()
  })

  it('ignores a measured level that is not populated', () => {
    expect(selectDisplayDepth(new Map([[7, 9]]), [0, 1])).toBe(0)
  })
})
