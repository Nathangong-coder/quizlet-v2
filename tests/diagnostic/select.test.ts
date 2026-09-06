import { describe, it, expect } from 'vitest'
import {
  selectDiagnosticProbes,
  FOLLOW_UP_COUNT,
  MIN_DIAGNOSTIC_KLPS,
  type DiagnosticKlpInput,
} from '@/lib/diagnostic/select'

/** Three cards, three key points each, descending weight within a card. */
function corpus(): DiagnosticKlpInput[] {
  const out: DiagnosticKlpInput[] = []
  for (const card of ['a', 'b', 'c']) {
    for (let i = 0; i < 3; i++) {
      out.push({ id: `${card}${i}`, cardId: card, index: i, weight: 5 - i })
    }
  }
  return out
}

describe('selectDiagnosticProbes — baseline regime (no prior observations)', () => {
  it('spreads across cards before returning to any card', () => {
    const core = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
      .filter((p) => p.kind === 'core')
    expect(core.map((p) => p.cardId)).toEqual(['a', 'b', 'c', 'a', 'b', 'c'])
  })

  it('takes the highest-weight key point on a card first', () => {
    const core = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
      .filter((p) => p.kind === 'core')
    expect(core.slice(0, 3).map((p) => p.klpId)).toEqual(['a0', 'b0', 'c0'])
  })

  it('ignores weight order in the input, not just in the output', () => {
    const shuffled: DiagnosticKlpInput[] = [
      { id: 'a2', cardId: 'a', index: 2, weight: 1 },
      { id: 'a0', cardId: 'a', index: 0, weight: 5 },
      { id: 'a1', cardId: 'a', index: 1, weight: 3 },
    ]
    const probes = selectDiagnosticProbes({ klps: shuffled, states: [], count: 1 })
    expect(probes[0].klpId).toBe('a0')
  })
})

describe('selectDiagnosticProbes — targeted regime (has observations)', () => {
  it('prefers a key point the learner has failed over one never seen', () => {
    // (1 - pKnown) x weight. A failed point sits below BKT_PRIOR, so it wins
    // with no special case for "never observed".
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 3 }, // unobserved -> prior 0.25
      { id: 'a1', cardId: 'a', index: 1, weight: 3 }, // failed -> 0.05
    ]
    const probes = selectDiagnosticProbes({
      klps, states: [{ klpId: 'a1', pKnown: 0.05 }], count: 1,
    })
    expect(probes[0].klpId).toBe('a1')
  })

  it('prefers a never-observed key point over a well-known one', () => {
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 3 }, // unobserved -> prior 0.25
      { id: 'a1', cardId: 'a', index: 1, weight: 3 }, // known -> 0.92
    ]
    const probes = selectDiagnosticProbes({
      klps, states: [{ klpId: 'a1', pKnown: 0.92 }], count: 1,
    })
    expect(probes[0].klpId).toBe('a0')
  })

  it('still spreads across cards — one weak card cannot eat the run', () => {
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 5 },
      { id: 'a1', cardId: 'a', index: 1, weight: 5 },
      { id: 'b0', cardId: 'b', index: 0, weight: 5 },
    ]
    const probes = selectDiagnosticProbes({
      klps,
      states: [
        { klpId: 'a0', pKnown: 0.01 },
        { klpId: 'a1', pKnown: 0.02 },
        { klpId: 'b0', pKnown: 0.9 },
      ],
      count: 2,
    })
    expect(probes.map((p) => p.cardId)).toEqual(['a', 'b'])
  })

  it('visits the weakest card first, so a short run shows its targeting', () => {
    // Without ordering the CARDS by priority too, a run shorter than the card
    // count walks them in set order and the targeting is invisible.
    const klps: DiagnosticKlpInput[] = [
      { id: 'a0', cardId: 'a', index: 0, weight: 5 },
      { id: 'b0', cardId: 'b', index: 0, weight: 5 },
    ]
    const probes = selectDiagnosticProbes({
      klps,
      states: [{ klpId: 'a0', pKnown: 0.95 }, { klpId: 'b0', pKnown: 0.05 }],
      count: 1,
    })
    expect(probes[0].cardId).toBe('b')
  })
})

describe('selectDiagnosticProbes — follow-ups', () => {
  it('re-asks key points already probed in this run, never a fresh one', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const core = probes.filter((p) => p.kind === 'core')
    const follow = probes.filter((p) => p.kind === 'follow-up')
    expect(follow).toHaveLength(FOLLOW_UP_COUNT)
    for (const f of follow) {
      expect(core.some((c) => c.klpId === f.klpId)).toBe(true)
    }
  })

  it('spends no slot re-asking on a run too short to spread', () => {
    // A flat budget of two consumed both slots of a two-question run, so the
    // diagnostic asked one key point twice and never reached a second card.
    // Re-asking earns a slot only once spending one is free.
    expect(selectDiagnosticProbes({ klps: corpus(), states: [], count: 2 })
      .filter((p) => p.kind === 'follow-up')).toHaveLength(0)
    expect(selectDiagnosticProbes({ klps: corpus(), states: [], count: 4 })
      .filter((p) => p.kind === 'follow-up')).toHaveLength(1)
    expect(selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
      .filter((p) => p.kind === 'follow-up')).toHaveLength(2)
  })

  it('places follow-ups last', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    expect(probes.slice(-FOLLOW_UP_COUNT).every((p) => p.kind === 'follow-up')).toBe(true)
  })

  it('re-asks the highest-weight points first', () => {
    const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const follow = probes.filter((p) => p.kind === 'follow-up')
    expect(follow.map((p) => p.klpId)).toEqual(['a0', 'b0'])
  })
})

describe('selectDiagnosticProbes — bounds', () => {
  it('never returns more probes than requested', () => {
    for (const count of [1, 2, 3, 5, 8, 12]) {
      const probes = selectDiagnosticProbes({ klps: corpus(), states: [], count })
      expect(probes.length).toBeLessThanOrEqual(count)
    }
  })

  it('caps core probes at the number of key points that exist', () => {
    const klps = corpus().slice(0, 3)
    const probes = selectDiagnosticProbes({ klps, states: [], count: 12 })
    expect(probes.filter((p) => p.kind === 'core')).toHaveLength(3)
  })

  it('returns nothing when there are no key points', () => {
    expect(selectDiagnosticProbes({ klps: [], states: [], count: 12 })).toEqual([])
  })

  it('returns nothing for a non-positive count', () => {
    expect(selectDiagnosticProbes({ klps: corpus(), states: [], count: 0 })).toEqual([])
  })

  it('never returns the same key point twice as a core probe', () => {
    const core = selectDiagnosticProbes({ klps: corpus(), states: [], count: 12 })
      .filter((p) => p.kind === 'core')
    expect(new Set(core.map((p) => p.klpId)).size).toBe(core.length)
  })

  it('is deterministic', () => {
    const a = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    const b = selectDiagnosticProbes({ klps: corpus(), states: [], count: 8 })
    expect(a).toEqual(b)
  })

  it('exposes the floor below which a diagnostic is not worth running', () => {
    // Twelve, not the generator schema's 8: DiagnosticStartSchema already
    // floors questionCount at 12, so an 8-key-point set would cap the count at
    // 8 and then fail its own input validation.
    expect(MIN_DIAGNOSTIC_KLPS).toBe(12)
  })
})
