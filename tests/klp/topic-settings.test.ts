import { describe, it, expect } from 'vitest'
import { kltSettings, isCausalPoint } from '@/lib/klp/topic-settings'
import { buildTopicMintingPromptV2, toV1, CardTopicProposalV2Schema } from '@/lib/klp/topic-minting-v2'

const klps = [
  { text: 'Deferred revenue is a liability for cash collected before delivery.', kind: 'definition' },
  { text: 'Historically the buyer wrote acquired deferred revenue down to fair value.', kind: 'definition' },
  { text: 'Under the old treatment less revenue was recognized after close because the liability covered only cost plus margin.', kind: 'causal' },
  { text: 'The write-down increased goodwill.', kind: 'mechanism' },
]

describe('isCausalPoint', () => {
  it('is the causal kind, or a "because" claim of any kind', () => {
    expect(isCausalPoint(klps[2])).toBe(true)
    expect(isCausalPoint({ text: 'X rose, so Y fell', kind: 'mechanism' })).toBe(false)
    expect(isCausalPoint({ text: 'X happens because of Y', kind: 'mechanism' })).toBe(true)
    expect(isCausalPoint(klps[0])).toBe(false)
  })
})

describe('kltSettings', () => {
  it('scores a well-shaped v2 proposal high and names what is missing', () => {
    const p = {
      anchor: 'deferred revenue',
      leaves: [
        { name: 'deferred revenue', klpRefs: [0], under: 'deferred revenue' },
        { name: 'historical deferred revenue treatment', klpRefs: [1], under: 'deferred revenue' },
        { name: 'fair value write-down', klpRefs: [1], under: 'historical deferred revenue treatment' },
        { name: 'goodwill', klpRefs: [3], under: 'deferred revenue' },
      ],
      contexts: [{ klpRef: 2, concept: 'historical deferred revenue treatment' }],
      relations: [{ klpRef: 2, from: 'fair value write-down', to: 'post-close revenue', type: 'causes', causeKlpRef: 1 }],
    }
    const s = kltSettings({ klps, proposal: p })
    expect(s.coverage).toBe(1)
    expect(s.anchored).toBe(1)
    expect(s.causalEdges).toBe(1)
    expect(s.causalTargets).toBe(1)
    expect(s.brevity).toBe(1)
    expect(s.noContainers).toBe(1)
    expect(s.overall).toBeGreaterThan(0.9)
    expect(s.detail.uncovered).toEqual([])
  })

  it('a v1 proposal scores 0 on anchored and causalTargets by construction, and reports the causal point minted as a leaf and the uncovered one', () => {
    const p = {
      leaves: [{ name: 'deferred revenue', klpRefs: [0] }, { name: 'acquired deferred revenue fair value write-down', klpRefs: [1, 2] }],
      contexts: [{ klpRef: 3, concept: 'goodwill' }],
      relations: [],
    }
    const s = kltSettings({ klps, proposal: p })
    expect(s.anchored).toBe(0)
    expect(s.causalTargets).toBe(1) // no causal edges at all → nothing to judge → 1, while causalEdges is 0
    expect(s.causalEdges).toBe(0)
    expect(s.detail.causalAsLeaf).toEqual([2])
    expect(s.detail.uncovered).toEqual([3])
    expect(s.brevity).toBe(0.5)
    expect(s.detail.longNames).toEqual(['acquired deferred revenue fair value write-down'])
  })

  it('an `under` chain that never reaches the anchor is unanchored; cycles do not loop', () => {
    const s = kltSettings({ klps, proposal: { anchor: 'a', leaves: [{ name: 'x', klpRefs: [0], under: 'y' }, { name: 'y', klpRefs: [1], under: 'x' }], contexts: [], relations: [] } })
    expect(s.anchored).toBe(0)
    expect(s.detail.unanchored).toEqual(['x', 'y'])
  })
})

describe('prompt v2 and the v1 view', () => {
  it('carries the domain, the anchor rule, the split example and the causal ownership rule', () => {
    const p = buildTopicMintingPromptV2('Q', 'M&A', [{ ref: 0, text: 't', kind: 'definition' }], 'LINKS\n')
    for (const s of ['Study set (the domain): M&A', 'THE ANCHOR', 'LEAVES BRANCH FROM THE ANCHOR', 'sub-leaf', 'CAUSAL POINTS OWN THEIR EDGE', 'causeKlpRef', 'EVERY POINT IS COVERED', 'LINKS']) expect(p).toContain(s)
  })
  it('toV1 maps anchor to parent and drops the v2-only fields', () => {
    const v2 = CardTopicProposalV2Schema.parse({ anchor: 'a', domain: 'd', leaves: [{ name: 'l', klpRefs: [0], under: 'a' }], contexts: [], relations: [{ klpRef: 1, from: 'x', to: 'y', type: 'causes', causeKlpRef: 0 }] })
    expect(toV1(v2)).toEqual({ parent: 'a', leaves: [{ name: 'l', klpRefs: [0] }], contexts: [], relations: [{ klpRef: 1, from: 'x', to: 'y', type: 'causes' }] })
  })
})
