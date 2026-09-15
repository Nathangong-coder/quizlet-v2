import { describe, it, expect, vi } from 'vitest'
import { mintCardLoop, topicFindings, barsMissed, buildTopicRevisePrompt, TOPIC_BARS } from '@/lib/klp/topic-loop'
import { kltSettings, withRoundTrip, roundTripLabels } from '@/lib/klp/topic-settings'
import { enforcementReport } from '@/lib/klp/topic-enforcement'
import { toV1 } from '@/lib/klp/topic-minting-v2'
import { ROUNDTRIP_ASSIGN_PROMPT, shuffleLabels } from '@/lib/ai/prompts/roundtrip-assign'

const klps = [
  { text: 'Deferred revenue is a liability for cash collected before delivery.', kind: 'definition' },
  { text: 'Historically the buyer wrote acquired deferred revenue down to fair value.', kind: 'definition' },
  { text: 'Less revenue was recognized after close because the liability covered only cost plus margin.', kind: 'causal' },
  { text: 'The write-down increased goodwill.', kind: 'mechanism' },
]
const good = {
  anchor: 'deferred revenue', domain: 'mergers and acquisitions',
  leaves: [
    { name: 'deferred revenue', klpRefs: [0], under: 'deferred revenue' },
    { name: 'historical deferred revenue treatment', klpRefs: [1], under: 'deferred revenue' },
    { name: 'fair value write-down', klpRefs: [1], under: 'historical deferred revenue treatment' },
    { name: 'goodwill', klpRefs: [3], under: 'deferred revenue' },
  ],
  contexts: [],
  relations: [{ klpRef: 2, from: 'fair value write-down', to: 'post-close revenue', type: 'causes' as const, causeKlpRef: 1 }],
}
const bad = { ...good, leaves: [{ name: 'deferred revenue', klpRefs: [0], under: 'deferred revenue' }, { name: 'acquired deferred revenue fair value write-down', klpRefs: [1, 2], under: 'deferred revenue' }], relations: [] }

describe('round trip', () => {
  it('labels are leaves plus "from → to" for relations; recovery counts points filed back where they were minted', () => {
    const { labels, mintedLabelOf } = roundTripLabels(good)
    expect(labels).toContain('fair value write-down → post-close revenue')
    expect(mintedLabelOf.get(2)).toEqual(['fair value write-down → post-close revenue'])
    const base = kltSettings({ klps, proposal: good })
    const r = withRoundTrip(base, good, [{ klpRef: 0, label: 'deferred revenue' }, { klpRef: 1, label: 'historical deferred revenue treatment' }, { klpRef: 2, label: 'fair value write-down → post-close revenue' }, { klpRef: 3, label: null }])
    expect(r.roundTrip).toBeCloseTo(3 / 4)
    expect(r.detail.wandered).toEqual([[3, 'goodwill', null]])
    expect(shuffleLabels(['a', 'b', 'c'], 7)).toHaveLength(3)
    expect(ROUNDTRIP_ASSIGN_PROMPT.build({ question: 'Q', klps, labels })).not.toContain('klpRefs')
  })
})

describe('findings and bars', () => {
  it('names every miss with a fix, and the bars flag the misses', () => {
    const s = kltSettings({ klps, proposal: bad })
    const e = enforcementReport(klps, [], toV1(bad))
    const f = topicFindings(klps, s, e)
    expect(f.some((x) => x.where === '[3]' && x.issue.includes('not covered'))).toBe(true)
    expect(f.some((x) => x.where === '[2]' && x.issue.includes('intended edge'))).toBe(true)
    expect(f.some((x) => x.where === 'acquired deferred revenue fair value write-down' && x.issue.includes('longer than'))).toBe(true)
    expect(barsMissed(s, e)).toEqual(expect.arrayContaining(['coverage', 'enforcement', 'causalEdges', 'brevity']))
    expect(TOPIC_BARS.coverage).toBe(1)
    const p = buildTopicRevisePrompt('Q', 'S', klps.map((k, ref) => ({ ref, ...k })), '', bad, f)
    expect(p).toContain('YOU ALREADY PRODUCED THIS MAP')
    expect(p).toContain('[3]: not covered')
  })
  it('a good proposal has no findings and misses no bar', () => {
    const s = kltSettings({ klps, proposal: good })
    expect(topicFindings(klps, s, enforcementReport(klps, [], toV1(good)))).toEqual([])
    expect(barsMissed(s, enforcementReport(klps, [], toV1(good)))).toEqual([])
  })
})

describe('mintCardLoop', () => {
  it('mints, measures, revises against findings, and keeps the best round', async () => {
    const gen = {
      mint: vi.fn().mockResolvedValue(bad),
      assign: vi.fn().mockImplementation(async () => ({ assignments: klps.map((_, i) => ({ klpRef: i, label: null })) })),
      revise: vi.fn().mockResolvedValue(good),
    }
    const o = await mintCardLoop({ term: 'Q', setTitle: 'M&A', klps, links: [] }, gen)
    expect(gen.mint).toHaveBeenCalledTimes(1)
    // The round-trip grader files everything under nothing, so the wandered findings keep firing: two revisions, three rounds.
    expect(gen.revise).toHaveBeenCalledTimes(2)
    expect(o.rounds).toHaveLength(3)
    expect(o.keptRound).toBe(1) // rounds 1 and 2 tie on bars and overall; the earlier one is kept
    expect(o.anchor).toBe('deferred revenue')
    // round-trip filed everything under nothing → roundTrip 0 → still flagged on that bar
    expect(o.flags).toEqual(['roundTrip'])
    expect(o.status).toBe('flagged')
  })
  it('the veto keeps round 0 when the revision made things worse', async () => {
    const gen = { mint: vi.fn().mockResolvedValue({ ...good, leaves: good.leaves.slice(0, 3) }), assign: vi.fn().mockRejectedValue(new Error('no')), revise: vi.fn().mockResolvedValue(bad) }
    const o = await mintCardLoop({ term: 'Q', setTitle: 'M&A', klps, links: [] }, gen)
    expect(o.keptRound).toBe(0)
    expect(o.rounds[0].barsMissed).toEqual(['coverage'])
  })
})
