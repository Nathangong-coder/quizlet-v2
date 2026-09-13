import { describe, it, expect, vi } from 'vitest'
import { authorCard } from '@/lib/klp/authoring'
import { rebuildFindings, rebuildScores, REBUILD_PARITY_BAR } from '@/lib/klp/rebuild'
import { REVIEW_REFERENCE_PROMPT, REVISE_REFERENCE_PROMPT, referenceNeedsRewrite } from '@/lib/ai/prompts/review-reference'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const no: KlpVerdict = 'omission'
const card = { question: 'Q', definition: 'D', setTitle: 'S' }

function gen(over: Record<string, unknown> = {}) {
  const klps = Array.from({ length: 5 }, (_, i) => ({ text: `P${i}`, kind: 'mechanism' }))
  return {
    author: vi.fn().mockResolvedValue({
      referenceAnswer: 'ref v1',
      klps,
      definitionPoints: [{ point: 'dp0', klpsNeeded: 1 }, { point: 'dp1', klpsNeeded: 1 }],
      wrongAnswers: [{ kind: 'vague', text: 'w2' }, { kind: 'memorized_template', text: 'w3' }],
    }),
    grade: vi.fn().mockImplementation(({ candidateAnswer, klps: shown }: { candidateAnswer: string; klps: { text: string }[] }) => ({
      verdicts: shown.map((_, i) => ({ klpIndex: i, verdict: candidateAnswer.startsWith('ref') ? ok : no })),
    })),
    revise: vi.fn().mockImplementation(async ({ klps: k }: { klps: { text: string; kind: string }[] }) => ({ klps: k })),
    relate: vi.fn().mockResolvedValue({ relations: [] }),
    ...over,
  }
}

describe('referenceNeedsRewrite', () => {
  it('rewrites on anything but sound / tight / clear', () => {
    expect(referenceNeedsRewrite({ accuracy: 'sound', conciseness: 'tight', clarity: 'clear', issues: [] })).toBe(false)
    expect(referenceNeedsRewrite({ accuracy: 'hedged', conciseness: 'tight', clarity: 'clear', issues: [] })).toBe(true)
    expect(referenceNeedsRewrite({ accuracy: 'sound', conciseness: 'wordy', clarity: 'clear', issues: [] })).toBe(true)
    expect(referenceNeedsRewrite({ accuracy: 'sound', conciseness: 'tight', clarity: 'muddled', issues: [] })).toBe(true)
  })
})

describe('the communication check in authorCard', () => {
  it('reviews the reference with the grader, rewrites once with the writer, and grades the REWRITTEN points', async () => {
    const reviewReference = vi.fn().mockResolvedValue({ accuracy: 'hedged', conciseness: 'wordy', clarity: 'clear', issues: [{ kind: 'accuracy', text: '"if it clears" — the numbers settle it' }] })
    const reviseReference = vi.fn().mockResolvedValue({ referenceAnswer: 'ref v2', klps: [{ text: 'R0', kind: 'definition' }, { text: 'R1', kind: 'causal' }, { text: 'R2', kind: 'mechanism' }, { text: 'R3', kind: 'quantitative' }] })
    const g = gen({ reviewReference, reviseReference })
    const out = await authorCard(card, g as never)
    expect(reviewReference).toHaveBeenCalledTimes(1)
    expect(reviewReference.mock.calls[0][0]).toEqual({ question: 'Q', answer: 'ref v1', definition: 'D' })
    expect(reviseReference).toHaveBeenCalledTimes(1)
    expect(out.referenceAnswer).toBe('ref v2')
    expect(out.klps.map((k) => k.text)).toEqual(['R0', 'R1', 'R2', 'R3'])
    expect(out.referenceReview).toMatchObject({ accuracy: 'hedged', rewritten: true })
    // The grader saw the rewritten reference, never the first draft.
    for (const call of g.grade.mock.calls) expect(call[0].referenceAnswer).toBe('ref v2')
  })

  it('a sound, tight, clear reference is recorded and not rewritten', async () => {
    const reviewReference = vi.fn().mockResolvedValue({ accuracy: 'sound', conciseness: 'tight', clarity: 'clear', issues: [] })
    const reviseReference = vi.fn()
    const out = await authorCard(card, gen({ reviewReference, reviseReference }) as never)
    expect(reviseReference).not.toHaveBeenCalled()
    expect(out.referenceReview).toMatchObject({ rewritten: false })
    expect(out.referenceAnswer).toBe('ref v1')
  })

  it('a failed review keeps the draft and the card completes without a review', async () => {
    const out = await authorCard(card, gen({ reviewReference: vi.fn().mockRejectedValue(new Error('boom')), reviseReference: vi.fn() }) as never)
    expect(out.referenceReview).toBeUndefined()
    expect(out.status).toBe('separated')
  })
})

describe('the parity bar inside the loop', () => {
  const rebuildGen = (parityByRound: ('present' | 'absent')[][]) => {
    let round = 0
    return {
      rebuild: vi.fn().mockResolvedValue({ rebuiltAnswer: 'rebuilt' }),
      gradeCoverage: vi.fn().mockResolvedValue({ points: [{ index: 0, verdict: 'correct' }, { index: 1, verdict: 'correct' }], disputes: [] }),
      gradeParity: vi.fn().mockImplementation(async () => {
        const verdicts = parityByRound[Math.min(round, parityByRound.length - 1)]
        round += 1
        return { claims: verdicts.map((v, i) => ({ claim: `claim ${i}`, verdict: v })) }
      }),
    }
  }

  it('runs the rebuild test every round and sends the lost claims to the SAME revise call as the separation findings', async () => {
    // Round 0: parity 0.5 (below 0.7) -> revise with the two lost claims; round 1: parity 1.0.
    const rg = rebuildGen([['present', 'absent', 'present', 'absent'], ['present', 'present', 'present', 'present']])
    const revise = vi.fn().mockImplementation(async ({ klps }: { klps: { text: string; kind: string }[] }) => ({ klps: [...klps, { text: 'claim 1 as a point', kind: 'mechanism' }] }))
    const g = gen({ ...rg, revise })
    const out = await authorCard(card, g as never)
    expect(revise).toHaveBeenCalledTimes(1)
    const findings = revise.mock.calls[0][0].findings as { index: number | null; issue: string }[]
    expect(findings.some((f) => f.index === null && f.issue.includes(`below the ${REBUILD_PARITY_BAR.toFixed(2)} bar`))).toBe(true)
    expect(findings.filter((f) => f.issue.includes('reference claim not carried')).map((f) => f.issue)).toEqual([
      'reference claim not carried by the key points: "claim 1"',
      'reference claim not carried by the key points: "claim 3"',
    ])
    expect(rg.rebuild).toHaveBeenCalledTimes(2)
    expect(out.rebuild?.referenceParity).toBe(1)
    expect(out.rebuild?.clearsParityBar).toBe(true)
    expect(out.revisions).toBe(1)
  })

  it('parity at the bar clears it and adds no finding', async () => {
    const rg = rebuildGen([['present', 'present', 'present', 'absent', 'present', 'present', 'present', 'absent', 'present', 'present']]) // 0.8
    const revise = vi.fn()
    const out = await authorCard(card, gen({ ...rg, revise }) as never)
    expect(revise).not.toHaveBeenCalled()
    expect(out.rebuild?.clearsParityBar).toBe(true)
  })

  it('the rebuilt-answer reviewer runs every round and its per-point issues reach the same revise call', async () => {
    const rg = rebuildGen([['present']])
    let n = 0
    const reviewRebuilt = vi.fn().mockImplementation(async () => {
      n += 1
      return n === 1
        ? { conciseness: 'wordy', clarity: 'clear', issues: [{ kind: 'restatement', points: [0, 4], text: 'P0 and P4 both state the conclusion' }, { kind: 'transition', points: [], text: 'roadmap sentence' }] }
        : { conciseness: 'tight', clarity: 'clear', issues: [] }
    })
    const revise = vi.fn().mockImplementation(async ({ klps }: { klps: { text: string; kind: string }[] }) => ({ klps: klps.filter((k) => k.text !== 'P4') }))
    const out = await authorCard(card, gen({ ...rg, reviewRebuilt, revise }) as never)
    expect(reviewRebuilt).toHaveBeenCalledTimes(2)
    const findings = revise.mock.calls[0][0].findings as { index: number | null; issue: string }[]
    expect(findings.filter((f) => f.issue.startsWith('restatement')).map((f) => f.index)).toEqual([0, 4])
    expect(findings.some((f) => f.issue.includes('roadmap'))).toBe(false)
    expect(out.rebuild?.review?.conciseness).toBe('tight')
    expect(out.klps.map((k) => k.text)).not.toContain('P4')
  })
})

describe('rebuildFindings', () => {
  it('names every lost claim under a failed parity bar and every missing card point under a failed coverage bar', () => {
    const scores = rebuildScores({
      coverage: [{ index: 0, verdict: 'correct' }, { index: 1, verdict: 'missing' }, { index: 2, verdict: 'missing' }],
      definitionPointCount: 3,
      parity: [{ verdict: 'present' }, { verdict: 'partial' }, { verdict: 'absent' }],
    })
    const f = rebuildFindings({
      scores,
      parity: [{ claim: 'a', verdict: 'present' }, { claim: 'b', verdict: 'partial' }, { claim: 'c', verdict: 'absent' }],
      definitionPoints: ['p0', 'p1', 'p2'],
    })
    expect(f.every((x) => x.index === null)).toBe(true)
    expect(f.map((x) => x.issue)).toEqual([
      'parity 0.50 is below the 0.70 bar — an answer rebuilt from the key points alone lost claims the reference makes',
      'reference claim only gestured at by the key points: "b"',
      'reference claim not carried by the key points: "c"',
      'card point not covered by the key points: "p1"',
      'card point not covered by the key points: "p2"',
    ])
    expect(f[0].fix).toContain('count may exceed the target')
  })
})

describe('the review prompts', () => {
  it('review: shows the definition as the accuracy anchor and asks for the three categorical labels', () => {
    const p = REVIEW_REFERENCE_PROMPT.build({ question: 'Q', answer: 'A', definition: 'DEF' })
    expect(p).toContain('DEF')
    for (const w of ['sound', 'hedged', 'wrong', 'tight', 'wordy', 'bloated', 'clear', 'muddled']) expect(p).toContain(`"${w}"`)
  })
  it('revise: carries the verdicts and issues and asks to re-derive the points from the rewrite', () => {
    const p = REVISE_REFERENCE_PROMPT.build({
      question: 'Q', definition: 'D', referenceAnswer: 'A', klps: [{ text: 'k', kind: 'causal' }],
      review: { accuracy: 'hedged', conciseness: 'wordy', clarity: 'clear', issues: [{ kind: 'accuracy', text: 'says "if" where the numbers decide' }] },
    })
    expect(p).toContain('accuracy hedged, conciseness wordy, clarity clear')
    expect(p).toContain('ACCURACY: says "if" where the numbers decide')
    expect(p).toContain('re-derive the key points FROM the rewritten answer')
  })
})
