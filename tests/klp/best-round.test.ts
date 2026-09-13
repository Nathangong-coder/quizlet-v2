import { describe, it, expect, vi } from 'vitest'
import { pickBestRound, barsMissed, describeChoice } from '@/lib/klp/best-round'
import { authorCard } from '@/lib/klp/authoring'
import { REVISE_KLPS_PROMPT } from '@/lib/ai/prompts/revise-klps'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const R = (o: Partial<Parameters<typeof barsMissed>[0]> & { round: number }) => ({
  substanceSeparation: 0.5, separated: true, referenceParity: 0.8, clearsParityBar: true, clearsCoverageBar: true, ...o,
})

describe('pickBestRound', () => {
  it('keeps the last round when it is the best', () => {
    expect(pickBestRound([R({ round: 0, substanceSeparation: 0.3, separated: false }), R({ round: 1, substanceSeparation: 0.7 })])).toBe(1)
  })
  it('vetoes a later round that misses a bar the earlier one cleared', () => {
    expect(pickBestRound([R({ round: 0, substanceSeparation: 0.6 }), R({ round: 1, substanceSeparation: 0.9, referenceParity: 0.5, clearsParityBar: false })])).toBe(0)
  })
  it('among rounds clearing every bar, the higher substance separation wins, then parity, then the earlier round', () => {
    expect(pickBestRound([R({ round: 0, substanceSeparation: 0.6 }), R({ round: 1, substanceSeparation: 0.8 })])).toBe(1)
    expect(pickBestRound([R({ round: 0, substanceSeparation: 0.8, referenceParity: 0.7 }), R({ round: 1, substanceSeparation: 0.8, referenceParity: 0.9 })])).toBe(1)
    expect(pickBestRound([R({ round: 0 }), R({ round: 1 })])).toBe(0)
    // ...unless the later round is the tighter one — compression is the point of the round.
    expect(pickBestRound([R({ round: 0, rebuiltTight: false, wordRatio: 1.1 }), R({ round: 1, rebuiltTight: true, wordRatio: 0.8 })])).toBe(1)
    expect(pickBestRound([R({ round: 0, rebuiltTight: true, wordRatio: 1.0 }), R({ round: 1, rebuiltTight: true, wordRatio: 0.8 })])).toBe(1)
  })
  it('with no round clearing every bar, the fewest misses wins', () => {
    expect(pickBestRound([R({ round: 0, separated: false, clearsParityBar: false, referenceParity: 0.4 }), R({ round: 1, separated: false, substanceSeparation: 0.2 })])).toBe(1)
  })
  it('describes a veto and says nothing when the last round is kept', () => {
    const rounds = [R({ round: 0, substanceSeparation: 0.6 }), R({ round: 1, substanceSeparation: 0.9, referenceParity: 0.5, clearsParityBar: false })]
    expect(describeChoice(rounds, 0)).toContain('kept round 0 over the last (1)')
    expect(describeChoice(rounds, 1)).toBe('')
  })
})

describe('the veto in authorCard', () => {
  const ok: KlpVerdict = 'correct'
  const no: KlpVerdict = 'omission'
  const card = { question: 'Q', definition: 'D', setTitle: 'S' }
  const klps = Array.from({ length: 5 }, (_, i) => ({ text: `P${i}`, kind: 'mechanism' }))

  it('restores the earlier round when the revision loses parity, and passes the parity claims as mustKeep on a compressing round', async () => {
    let parityRound = 0
    const revise = vi.fn().mockImplementation(async ({ klps: k }: { klps: { text: string; kind: string }[] }) => ({ klps: k.filter((x) => x.text !== 'P4').map((x) => ({ ...x, text: `${x.text}!` })) }))
    const g = {
      author: vi.fn().mockResolvedValue({ referenceAnswer: 'ref', klps, definitionPoints: [{ point: 'dp', klpsNeeded: 1 }], wrongAnswers: [{ kind: 'vague', text: 'w2' }, { kind: 'memorized_template', text: 'w3' }] }),
      // Round 0: template passes P0 (separation 0.8, clears every bar but a compression finding fires). Round 1: all fail.
      grade: vi.fn().mockImplementation(({ candidateAnswer, klps: shown }: { candidateAnswer: string; klps: { text: string }[] }) => ({
        verdicts: shown.map((k, i) => ({ klpIndex: i, verdict: candidateAnswer === 'ref' ? ok : candidateAnswer === 'w3' && k.text === 'P0' ? ok : no })),
      })),
      revise,
      relate: vi.fn().mockResolvedValue({ relations: [] }),
      rebuild: vi.fn().mockResolvedValue({ rebuiltAnswer: 'rebuilt' }),
      gradeCoverage: vi.fn().mockResolvedValue({ points: [{ index: 0, verdict: 'correct' }], disputes: [] }),
      gradeParity: vi.fn().mockImplementation(async () => {
        parityRound += 1
        // Round 0: parity 1.0. Round 1: the cut dropped a claim -> 0.5, below the bar.
        return { claims: [{ claim: 'c0', verdict: 'present' }, { claim: 'c1', verdict: parityRound === 1 ? 'present' : 'absent' }] }
      }),
      reviewRebuilt: vi.fn().mockResolvedValueOnce({ conciseness: 'wordy', clarity: 'clear', issues: [{ kind: 'clause_bloat', points: [4], text: 'P4 has a clause' }] }).mockResolvedValue({ conciseness: 'tight', clarity: 'clear', issues: [] }),
    }
    const out = await authorCard(card, g as never)
    // Round 1's parity miss triggers a second revise; neither later round beats round 0.
    expect(revise).toHaveBeenCalledTimes(2)
    expect(revise.mock.calls[0][0].mustKeep).toEqual(['c0', 'c1'])
    expect(out.revisions).toBe(2)
    expect(out.keptRound).toBe(0)
    expect(out.keptRoundReason).toContain('kept round 0')
    expect(out.klps.map((k) => k.text)).toEqual(['P0', 'P1', 'P2', 'P3', 'P4'])
    expect(out.rebuild?.referenceParity).toBe(1)
  })

  it('the revise prompt renders the must-keep claims', () => {
    const p = REVISE_KLPS_PROMPT.build({ question: 'Q', klps: [{ text: 'a', kind: 'causal' }], discrimination: [{ index: 0, passesReference: true, failsSomeWrong: true, discriminates: true }], targetCount: 3, mustKeep: ['claim one', 'claim two'] })
    expect(p).toContain('EVERY one must still be stated')
    expect(p).toContain('  - claim one')
    expect(p).toContain('  - claim two')
  })
})
