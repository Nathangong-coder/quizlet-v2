import { describe, it, expect } from 'vitest'
import {
  coFiringPairs,
  classifyPair,
  pairRelationship,
  readProbe,
  summarizeIndependence,
  confirmedRedundancyRate,
  formatIndependenceReport,
  PAIR_VERDICTS,
  type PairResult,
  type VerdictRow,
} from '@/lib/klp/independence'
import {
  smokeTest,
  formatSmokeResult,
  SMOKE_WEAK_CEILING,
  SMOKE_REFERENCE_FLOOR,
} from '@/lib/klp/smoke'
import { PROBE_INDEPENDENCE_PROMPT } from '@/lib/ai/prompts/probe-independence'
import { IndependenceProbeSchema } from '@/lib/ai/schemas'

const rows = (...vs: Record<string, string>[]) => vs as VerdictRow[]

describe('coFiringPairs — the free shortlist', () => {
  it('shortlists a pair that never came apart across candidates', () => {
    expect(coFiringPairs(rows(
      { '0': 'correct', '1': 'correct' },
      { '0': 'omission', '1': 'omission' },
    ), 2)).toEqual([{ a: 0, b: 1 }])
  })

  it('does not shortlist a pair that came apart even once', () => {
    expect(coFiringPairs(rows(
      { '0': 'correct', '1': 'correct' },
      { '0': 'omission', '1': 'correct' },
    ), 2)).toEqual([])
  })

  it('compares CREDIT, not the label — omission and failed are the same outcome', () => {
    // Two points that both went unearned on every candidate are co-firing
    // regardless of which word the grader reached for. Comparing labels would
    // report a cleaner corpus than exists.
    expect(coFiringPairs(rows(
      { '0': 'omission', '1': 'failed' },
      { '0': 'correct', '1': 'correct' },
    ), 2)).toEqual([{ a: 0, b: 1 }])
  })

  it('treats a MISSING verdict as its own value, not as a zero', () => {
    // Otherwise two points look identical because the grader skipped both.
    expect(coFiringPairs(rows(
      { '0': 'omission' },
      { '0': 'correct', '1': 'correct' },
    ), 2)).toEqual([])
  })

  it('refuses to shortlist on too little evidence', () => {
    // With one candidate, every pair that happened to score alike is
    // "identical", which is no evidence whatsoever.
    expect(coFiringPairs(rows({ '0': 'correct', '1': 'correct' }), 2)).toEqual([])
  })

  it('finds every co-firing pair on a larger set', () => {
    const out = coFiringPairs(rows(
      { '0': 'correct', '1': 'correct', '2': 'omission' },
      { '0': 'omission', '1': 'omission', '2': 'correct' },
    ), 3)
    expect(out).toEqual([{ a: 0, b: 1 }])
  })
})

describe('classifyPair', () => {
  it('is independent when both directions can be constructed', () => {
    // The EXPECTED outcome for most shortlisted pairs — the shortlist is a
    // candidate list, not a finding.
    expect(classifyPair({ aWithoutB: true, bWithoutA: true })).toBe('independent')
  })

  it('names which point is entailed by the other', () => {
    expect(classifyPair({ aWithoutB: true, bWithoutA: false })).toBe('entails_b')
    expect(classifyPair({ aWithoutB: false, bWithoutA: true })).toBe('entails_a')
  })

  it('is equivalent only when neither direction can be constructed', () => {
    expect(classifyPair({ aWithoutB: false, bWithoutA: false })).toBe('equivalent')
  })
})

describe('pairRelationship — entailment is NOT redundancy', () => {
  it('points the implication the right way round', () => {
    // THE BUG THIS REPLACES, found by reading the first real confirmed result:
    //   A "the $100 deposit increases cash and equity by the same amount"
    //   B "because the cash rise is offset by lower Net Debt, EV is unchanged"
    // A stands alone; B presupposes it. So B IMPLIES A. The first version
    // reported B as "the redundant one" — backwards, and the wrong frame:
    // B carries information A does not.
    expect(pairRelationship({ a: 0, b: 3 }, 'entails_b'))
      .toEqual({ mergeCandidate: false, implier: 3, implied: 0 })
    expect(pairRelationship({ a: 0, b: 3 }, 'entails_a'))
      .toEqual({ mergeCandidate: false, implier: 0, implied: 3 })
  })

  it('never proposes a merge for an entailment — deleting either loses information', () => {
    expect(pairRelationship({ a: 0, b: 1 }, 'entails_b').mergeCandidate).toBe(false)
    expect(pairRelationship({ a: 0, b: 1 }, 'entails_a').mergeCandidate).toBe(false)
  })

  it('proposes a merge ONLY for an equivalent pair, and picks no survivor', () => {
    // Which of two interchangeable propositions a card keeps is a judgment
    // about what it teaches.
    expect(pairRelationship({ a: 0, b: 1 }, 'equivalent'))
      .toEqual({ mergeCandidate: true, implier: null, implied: null })
  })

  it('finds nothing in an independent pair', () => {
    expect(pairRelationship({ a: 0, b: 1 }, 'independent'))
      .toEqual({ mergeCandidate: false, implier: null, implied: null })
  })
})

describe('readProbe — a claim without an example is not a demonstration', () => {
  it('accepts a direction backed by an example', () => {
    expect(readProbe({
      aWithoutB: true, exampleAWithoutB: 'EBIT falls by 10.',
      bWithoutA: true, exampleBWithoutA: 'Net income falls by 6.',
    })).toEqual({ aWithoutB: true, bWithoutA: true })
  })

  it('REJECTS a direction claimed possible with no example written', () => {
    // The prompt asks for a construction precisely so the claim is checkable.
    // Trusting the boolean alone degrades the check into the opinion it was
    // designed to avoid — and it degrades in the flattering direction, since
    // `independent` is the outcome that reports no defect.
    expect(readProbe({
      aWithoutB: true, exampleAWithoutB: '   ',
      bWithoutA: true, exampleBWithoutA: 'something',
    })).toEqual({ aWithoutB: false, bWithoutA: true })
  })

  it('turns an unbacked double claim into `equivalent`, not `independent`', () => {
    const d = readProbe({
      aWithoutB: true, exampleAWithoutB: '', bWithoutA: true, exampleBWithoutA: '',
    })
    expect(classifyPair(d)).toBe('equivalent')
  })
})

function result(over: Partial<PairResult> = {}): PairResult {
  return {
    cardId: 'c1', term: 'T', pair: { a: 0, b: 1 }, textA: 'A', textB: 'B',
    verdict: 'independent', exampleAWithoutB: '', exampleBWithoutA: '', ...over,
  }
}

describe('summarizeIndependence', () => {
  it('counts merge candidates and dependencies SEPARATELY — different fixes', () => {
    // A merge candidate is one proposition written twice. A dependency is two
    // real propositions that are not independent evidence; the fix for that is
    // in the scoring, not in deleting a point.
    const s = summarizeIndependence([
      result({ verdict: 'entails_b' }),
      result({ verdict: 'equivalent' }),
      result(),
    ], 1, 3, 3)
    expect(s.dependencies).toBe(1)
    expect(s.mergeCandidates).toBe(1)
    expect(s.cardsWithRedundancy).toBe(1)
  })

  it('ignores independent pairs entirely', () => {
    const s = summarizeIndependence([result()], 1, 1, 1)
    expect(s.mergeCandidates).toBe(0)
    expect(s.dependencies).toBe(0)
    expect(s.cardsWithRedundancy).toBe(0)
  })
})

describe('confirmedRedundancyRate', () => {
  it('is computed over pairs ACTUALLY EXAMINED, not the whole pair space', () => {
    // The shortlist is not a random sample of pairs, so projecting this rate
    // onto every pair would be wrong in an unknown direction.
    const s = summarizeIndependence([
      result({ verdict: 'entails_b' }), result(), result(), result(),
    ], 1, 100, 4)
    expect(confirmedRedundancyRate(s)).toBeCloseTo(0.25)
  })

  it('is null rather than 0 when nothing was confirmed', () => {
    expect(confirmedRedundancyRate(summarizeIndependence([], 5, 100, 20))).toBeNull()
  })
})

describe('formatIndependenceReport', () => {
  const out = formatIndependenceReport(summarizeIndependence([result()], 1, 10, 3))

  it('states that the shortlist is a candidate rate, not a redundancy rate', () => {
    expect(out).toContain('CANDIDATE RATE, NOT A REDUNDANCY RATE')
  })

  it('says plainly that nothing was merged', () => {
    expect(out).toContain('NOTHING WAS MERGED')
  })

  it('distinguishes a merge candidate from a dependency in the output', () => {
    const s = summarizeIndependence([
      result({ verdict: 'entails_b' }), result({ verdict: 'equivalent' }),
    ], 1, 2, 2)
    const text = formatIndependenceReport(s)
    expect(text).toContain('merge candidate')
    expect(text).toContain('one point implies the other')
    expect(text).toContain('NOT a merge')
  })
})

describe('PROBE_INDEPENDENCE_PROMPT', () => {
  const built = PROBE_INDEPENDENCE_PROMPT.build({
    question: 'Walk me through a $10 depreciation increase.',
    textA: 'EBIT falls by 10.',
    textB: 'Net income falls by 6 at a 40% tax rate.',
  })

  it('asks for a CONSTRUCTION rather than an opinion', () => {
    // "Are these independent?" gets a plausible yes. "Write one that does X"
    // either can or cannot be done, and the attempt is checkable by a human.
    expect(built).toContain('Write a short answer')
    expect(built.toLowerCase()).not.toContain('are these two statements independent')
  })

  it('makes impossibility an explicit, expected answer', () => {
    expect(built).toContain('Impossibility is a real and useful answer')
  })

  it('blocks the easy false positive — "incomplete" is not "impossible"', () => {
    expect(built).toContain('do not claim impossibility merely because')
  })

  it('labels the directions neutrally, not by position on the card', () => {
    expect(built).toContain('FIRST statement')
    expect(built).toContain('SECOND statement')
  })

  it('ties the boolean to the example actually being written', () => {
    expect(built).toContain('ONLY if you actually wrote the corresponding example')
  })
})

describe('IndependenceProbeSchema', () => {
  it('accepts an EMPTY example — that is the correct output for an impossible direction', () => {
    expect(IndependenceProbeSchema.safeParse({
      aWithoutB: false, exampleAWithoutB: '',
      bWithoutA: true, exampleBWithoutA: 'x', note: 'A entails B',
    }).success).toBe(true)
  })

  it('covers every pair verdict in the vocabulary', () => {
    expect(PAIR_VERDICTS).toHaveLength(4)
  })
})

describe('the discrimination smoke test', () => {
  const base = { referenceScore: 1, weakScores: [0.2], offTargetScore: 0 }

  it('passes a set where a weak answer earns little and the strong one earns most', () => {
    expect(smokeTest(base).passed).toBe(true)
    expect(formatSmokeResult(smokeTest(base))).toBe('SMOKE OK')
  })

  it('fires on ANY credit at all for an off-target answer', () => {
    // The worst case: an answer to a different question earning anything means
    // the points are matching surface keywords, which makes every number they
    // produce noise rather than merely generous.
    const out = smokeTest({ ...base, offTargetScore: 0.1 })
    expect(out.failures.map((f) => f.code)).toContain('accepts_off_target')
  })

  it('tolerates a weak answer earning SOME credit', () => {
    // A vague answer to a seven-point card legitimately gestures at two of
    // them. A smoke test that fires on that is one nobody reads.
    expect(smokeTest({ ...base, weakScores: [SMOKE_WEAK_CEILING] }).passed).toBe(true)
  })

  it('fires once a weak answer earns more than the ceiling', () => {
    const out = smokeTest({ ...base, weakScores: [SMOKE_WEAK_CEILING + 0.01] })
    expect(out.failures.map((f) => f.code)).toContain('accepts_weak')
  })

  it('reads a rejected reference as a FIDELITY alarm', () => {
    // A set the strong answer cannot satisfy was not derived from the card.
    const out = smokeTest({ ...base, referenceScore: SMOKE_REFERENCE_FLOOR - 0.01 })
    expect(out.failures.map((f) => f.code)).toContain('rejects_reference')
    expect(out.failures.find((f) => f.code === 'rejects_reference')!.detail).toContain('FIDELITY')
  })

  it('separates an inversion from mere looseness — the fixes differ', () => {
    const out = smokeTest({ referenceScore: 0.7, weakScores: [0.8] })
    expect(out.failures.map((f) => f.code)).toContain('inverted')
  })

  it('treats NO weak candidate as a failure, never a pass', () => {
    // The test did not run. Same posture computeSeparation takes toward an
    // empty adversary list.
    const out = smokeTest({ referenceScore: 1, weakScores: [] })
    expect(out.passed).toBe(false)
    expect(out.worstWeak).toBeNull()
  })

  it('takes the WORST weak candidate, never a mean', () => {
    // One hopeless adversary must not mask the near-miss a mean would average
    // away.
    expect(smokeTest({ ...base, weakScores: [0, 0, 0.9] }).passed).toBe(false)
  })

  it('works without an off-target score, so legacy cards can be tested', () => {
    // The panel is off by default; the legacy three adversaries have no
    // off-topic member. A check that only runs on the newest cards cannot tell
    // you about the corpus.
    expect(smokeTest({ referenceScore: 1, weakScores: [0.1] }).passed).toBe(true)
  })
})
