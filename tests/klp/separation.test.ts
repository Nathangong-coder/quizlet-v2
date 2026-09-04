import { describe, it, expect } from 'vitest'
import { scoreCandidate, evaluateKlps, computeSeparation } from '@/lib/klp/separation'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const half: KlpVerdict = 'incomplete'
const no: KlpVerdict = 'omission'

describe('scoreCandidate', () => {
  it('is the mean credit over the KLPs', () => {
    expect(scoreCandidate([ok, ok, ok, ok])).toBe(1)
    expect(scoreCandidate([no, no])).toBe(0)
    expect(scoreCandidate([ok, no])).toBe(0.5)
    expect(scoreCandidate([ok, half])).toBe(0.75)
  })

  it('is 0 for no KLPs rather than NaN', () => {
    expect(scoreCandidate([])).toBe(0)
  })
})

describe('evaluateKlps', () => {
  it('marks a KLP discriminating when it passes the reference and fails some wrong answer', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [ok, ok] },
      [{ kind: 'vague', verdicts: [no, ok] }],
    )
    expect(out[0]).toMatchObject({ index: 0, passesReference: true, failsSomeWrong: true, discriminates: true })
  })

  /**
   * The core rule. A KLP that fires identically on the strong and every weak
   * answer carries no information — it is true of everyone, so it separates
   * nobody.
   */
  it('marks a KLP NOT discriminating when every wrong answer also passes it', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [ok] },
      [{ kind: 'vague', verdicts: [ok] }, { kind: 'confident_wrong', verdicts: [ok] }],
    )
    expect(out[0].discriminates).toBe(false)
  })

  /**
   * A KLP the REFERENCE fails was hallucinated past the artifact it was
   * supposed to be derived from. It must not count as discriminating however
   * badly the wrong answers do on it.
   */
  it('marks a KLP NOT discriminating when the reference itself fails it', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [no] },
      [{ kind: 'vague', verdicts: [no] }],
    )
    expect(out[0]).toMatchObject({ passesReference: false, discriminates: false })
  })

  it('treats a partial credit on the reference as passing', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [half] },
      [{ kind: 'vague', verdicts: [no] }],
    )
    expect(out[0].discriminates).toBe(true)
  })

  /**
   * MUTATION GUARD for `.some()` vs `.every()`. Two wrong answers that
   * DISAGREE at this index: one fails the KLP, one passes it. The rule is
   * "at least one wrong answer fails it" — `.some()` — so this must still
   * discriminate. Every other test in this file uses either one wrong answer
   * or several with identical verdicts at each index, so none of them would
   * catch `.some()` silently becoming `.every()`.
   */
  it('discriminates when wrong answers DISAGREE — one failing it is enough', () => {
    const out = evaluateKlps(
      { kind: 'reference', verdicts: [ok] },
      [{ kind: 'vague', verdicts: [no] }, { kind: 'confident_wrong', verdicts: [ok] }],
    )
    expect(out[0].discriminates).toBe(true)
  })
})

describe('computeSeparation', () => {
  /**
   * THE USER'S OWN FAILURE CASE, verbatim: a vague answer scoring 6 of 7.
   */
  it('fails the card when the vague answer scores 6 of 7', () => {
    const seven = Array<KlpVerdict>(7).fill(ok)
    const sixOfSeven: KlpVerdict[] = [ok, ok, ok, ok, ok, ok, no]
    const res = computeSeparation(
      { kind: 'reference', verdicts: seven },
      [{ kind: 'vague', verdicts: sixOfSeven }],
    )
    expect(res.referenceScore).toBe(1)
    expect(res.bestWrongScore).toBeCloseTo(6 / 7, 5)
    expect(res.separated).toBe(false)
  })

  it('passes a card where the best wrong answer is far enough back', () => {
    const res = computeSeparation(
      { kind: 'reference', verdicts: [ok, ok, ok, ok] },
      [
        { kind: 'vague', verdicts: [ok, no, no, no] },
        { kind: 'confident_wrong', verdicts: [ok, ok, no, no] },
      ],
    )
    expect(res.bestWrongScore).toBe(0.5)
    expect(res.separation).toBe(0.5)
    expect(res.separated).toBe(true)
  })

  /**
   * The BEST wrong answer is the bar, not the average. Averaging lets one
   * hopeless adversary mask a near-miss that the KLPs genuinely fail to catch.
   */
  it('measures against the best wrong answer, never their mean', () => {
    const res = computeSeparation(
      { kind: 'reference', verdicts: [ok, ok] },
      [{ kind: 'vague', verdicts: [no, no] }, { kind: 'confident_wrong', verdicts: [ok, ok] }],
    )
    expect(res.bestWrongScore).toBe(1)
    expect(res.separated).toBe(false)
  })

  it('fails a card when no wrong answers were produced at all', () => {
    const res = computeSeparation({ kind: 'reference', verdicts: [ok] }, [])
    expect(res.separated).toBe(false)
  })

  /**
   * `perKlp` with mixed adversaries, checked directly — no existing
   * multi-adversary test looks at `perKlp` at all. KLP 0 is passed by both
   * wrong answers (not discriminating); KLP 1 is failed only by the vague
   * answer; KLP 2 is failed only by the confident-wrong answer. Each of the
   * latter two must still discriminate — one failure among several wrong
   * answers is enough, per `.some()`.
   */
  it('reports perKlp correctly when wrong answers disagree KLP-by-KLP', () => {
    const res = computeSeparation(
      { kind: 'reference', verdicts: [ok, ok, ok] },
      [
        { kind: 'vague', verdicts: [ok, no, ok] },
        { kind: 'confident_wrong', verdicts: [ok, ok, no] },
      ],
    )
    expect(res.perKlp).toEqual([
      { index: 0, passesReference: true, failsSomeWrong: false, discriminates: false },
      { index: 1, passesReference: true, failsSomeWrong: true, discriminates: true },
      { index: 2, passesReference: true, failsSomeWrong: true, discriminates: true },
    ])
  })
})
