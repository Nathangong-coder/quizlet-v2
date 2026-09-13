import { describe, it, expect } from 'vitest'
import {
  necessityOrder,
  atFloor,
  summarizeNecessity,
  formatNecessityReport,
  NECESSITY_FLOOR,
  type NecessityCandidate,
  type NecessityResult,
} from '@/lib/klp/necessity'
import { MIN_KLPS_PER_CARD } from '@/lib/klp/authoring-config'
import { OMIT_KLP_PROMPT } from '@/lib/ai/prompts/omit-klp'
import { OmitKlpSchema } from '@/lib/ai/schemas'

const cand = (index: number, weight: number): NecessityCandidate => ({
  index, weight, text: `point ${index}`,
})
const res = (index: number, verdict: NecessityResult['verdict']): NecessityResult => ({
  index, text: `point ${index}`, verdict, answerWithout: '', judgeOverall: null, reason: '',
})

describe('necessityOrder', () => {
  it('considers the WEAKEST points first', () => {
    // Order is part of the algorithm. Testing the spine of the card while every
    // peripheral point is still there to prop it up is exactly when a central
    // point looks droppable.
    expect(necessityOrder([cand(0, 5), cand(1, 2), cand(2, 4)]).map((c) => c.index))
      .toEqual([1, 2, 0])
  })

  it('breaks ties by index, so a run is reproducible', () => {
    expect(necessityOrder([cand(3, 2), cand(1, 2)]).map((c) => c.index)).toEqual([1, 3])
  })

  it('does not mutate its input', () => {
    const input = [cand(0, 5), cand(1, 1)]
    necessityOrder(input)
    expect(input.map((c) => c.index)).toEqual([0, 1])
  })
})

describe('the floor', () => {
  it('agrees with the authoring sizer about what a viable card is', () => {
    // Two floors that could disagree would let necessity reduce a card below
    // what authoring considers viable.
    expect(NECESSITY_FLOOR).toBe(MIN_KLPS_PER_CARD)
  })

  it('stops the loop at the floor, not below it', () => {
    expect(atFloor(NECESSITY_FLOOR)).toBe(true)
    expect(atFloor(NECESSITY_FLOOR + 1)).toBe(false)
  })
})

describe('summarizeNecessity', () => {
  it('counts what the card would keep if every proposal were accepted', () => {
    const s = summarizeNecessity(
      [res(0, 'unnecessary'), res(1, 'necessary'), res(2, 'unnecessary')],
      7,
    )
    expect(s).toMatchObject({ unnecessary: 2, necessary: 1, survivingCount: 5, examined: 3 })
  })

  it('does NOT count an unexamined point as either outcome', () => {
    // A failed probe must never read as a deletion proposal.
    const s = summarizeNecessity([res(0, 'unexamined')], 5)
    expect(s).toMatchObject({ unnecessary: 0, necessary: 0, unexamined: 1, survivingCount: 5 })
  })

  it('flags when accepting every proposal would land on the floor', () => {
    const results = Array.from({ length: 9 - NECESSITY_FLOOR }, (_, i) => res(i, 'unnecessary'))
    expect(summarizeNecessity(results, 9).hitFloor).toBe(true)
  })
})

describe('formatNecessityReport', () => {
  const out = formatNecessityReport(summarizeNecessity([res(0, 'unnecessary')], 6))

  it('states the greedy rule and the trap it avoids', () => {
    expect(out).toContain('GREEDY-SEQUENTIAL, never batch')
    expect(out).toContain('half of one idea')
  })

  it('says plainly that nothing was deleted', () => {
    expect(out).toContain('NOTHING WAS DELETED')
  })
})

describe('OMIT_KLP_PROMPT', () => {
  const built = OMIT_KLP_PROMPT.build({
    question: 'Walk me through a $10 depreciation increase.',
    keep: [{ text: 'EBIT falls by 10.' }, { text: 'Cash rises by 4.' }],
    omit: 'Net income falls by 6 at a 40% tax rate.',
  })

  it('asks for a CONSTRUCTION, never whether the point matters', () => {
    // A model asked whether a carefully-authored proposition matters says yes.
    expect(built).toContain('Write the strongest answer')
    expect(built.toLowerCase()).not.toContain('is this point necessary')
  })

  it('never reveals that the point might be deleted', () => {
    // A model that knows it is justifying a deletion writes a deliberately poor
    // answer; one that knows it is defending the point writes a suspiciously
    // complete one.
    for (const leak of ['delete', 'unnecessary', 'quality check', 'redundant']) {
      expect(built.toLowerCase()).not.toContain(leak)
    }
  })

  it('forbids working around the omission with a paraphrase', () => {
    expect(built).toContain('must not work around it with a paraphrase')
  })

  it('forbids flagging the omission, so the judge sees a natural answer', () => {
    expect(built).toContain('Do not flag the omission')
  })

  it('makes impossibility an explicit outcome', () => {
    expect(built).toContain('That is a real outcome')
  })

  it('shows only the points still standing, which is what makes it greedy', () => {
    expect(built).toContain('[0] EBIT falls by 10.')
    expect(built).not.toContain('Net income falls by 6 at a 40% tax rate.\n[')
  })
})

describe('OmitKlpSchema', () => {
  it('accepts an EMPTY answer — the correct output when omission is impossible', () => {
    expect(OmitKlpSchema.safeParse({ answer: '', impossible: true, note: 'x' }).success).toBe(true)
  })
})
