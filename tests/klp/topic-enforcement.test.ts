import { describe, it, expect } from 'vitest'
import { enforcementReport, intendedShape, mintedShape, renderLinks, buildMintRepairPrompt, applyRepair } from '@/lib/klp/topic-enforcement'
import { buildTopicMintingPrompt } from '@/lib/klp/topic-minting'

const klps = [
  { kind: 'definition' }, // 0
  { kind: 'causal' }, // 1
  { kind: 'mechanism' }, // 2
  { kind: 'quantitative' }, // 3
  { kind: 'condition' }, // 4
]
const links = [{ from: 2, to: 3, type: 'requires' }, { from: 0, to: 1, type: 'confused_with' }]
const proposal = {
  parent: 'p',
  leaves: [{ name: 'gaap', klpRefs: [0] }, { name: 'comparability', klpRefs: [1] }, { name: 'matching principle', klpRefs: [2] }, { name: 'ten percent', klpRefs: [3] }],
  contexts: [{ klpRef: 4, concept: 'audit' }],
  relations: [],
}

describe('intention', () => {
  it('a point that is the source of a directed link is an edge regardless of kind; otherwise the kind prior', () => {
    expect(intendedShape('mechanism', 2, links)).toEqual({ intended: 'edge', basis: 'link-source' })
    expect(intendedShape('definition', 0, links)).toEqual({ intended: 'leaf', basis: 'kind' }) // confused_with is not directed
    expect(intendedShape('causal', 1, links)).toEqual({ intended: 'edge', basis: 'kind' })
    expect(intendedShape('mechanism', 4, [])).toEqual({ intended: 'either', basis: 'kind' })
  })
})

describe('enforcementReport — klpKltEnforcement', () => {
  it('counts violations over judged points only', () => {
    const r = enforcementReport(klps, links, proposal)
    expect(r.rows.map((x) => x.minted)).toEqual(['leaf', 'leaf', 'leaf', 'leaf', 'context-only'])
    // judged: 0 leaf ok, 1 causal→edge VIOLATION, 2 link-source→edge VIOLATION, 3 leaf ok, 4 condition→edge VIOLATION
    expect(r.judged).toBe(5)
    expect(r.violations).toBe(3)
    expect(r.klpKltEnforcement).toBeCloseTo(0.4)
    expect(mintedShape({ ...proposal, relations: [{ klpRef: 0, from: 'a', to: 'b', type: 'causes' }] }, 0)).toBe('both')
  })
  it('is 1 with nothing judged', () => {
    expect(enforcementReport([{ kind: 'mechanism' }], [], { parent: 'p', leaves: [], contexts: [], relations: [] }).klpKltEnforcement).toBe(1)
  })
})

describe('the prompt carries the card graph and the repair asks only for the violating points', () => {
  it('renderLinks lists the links and the rule; the minting prompt embeds it', () => {
    const block = renderLinks(links)
    expect(block).toContain('[2] —requires→ [3]')
    expect(buildTopicMintingPrompt('T', [{ ref: 0, text: 'x', kind: 'definition' }], block)).toContain('KNOWN LINKS BETWEEN THESE POINTS')
    expect(renderLinks([])).toBe('')
  })
  it('repair prompt names the violating points with their current leaf and the known link', () => {
    const r = enforcementReport(klps, links, proposal)
    const p = buildMintRepairPrompt('T', klps.map((k, ref) => ({ ref, kind: k.kind, text: `point ${ref}` })), links, proposal, r)
    expect(p).toContain('[1] (causal) point 1')
    expect(p).toContain('minted as leaf "comparability"')
    expect(p).toContain('[2] —requires→ [3]')
    expect(p).not.toContain('[0] (definition)')
  })
  it('applyRepair moves a repaired point from leaf to relation and leaves the rest alone', () => {
    const r = enforcementReport(klps, links, proposal)
    const fixed = applyRepair(proposal, { relations: [{ klpRef: 1, from: 'gaap', to: 'comparability', type: 'causes' }, { klpRef: 9, from: 'x', to: 'y', type: 'causes' }], leaves: [] }, r)
    expect(fixed.leaves.map((l) => l.name)).toEqual(['gaap', 'matching principle', 'ten percent'])
    expect(fixed.relations).toEqual([{ klpRef: 1, from: 'gaap', to: 'comparability', type: 'causes' }])
    expect(enforcementReport(klps, links, fixed).klpKltEnforcement).toBeCloseTo(0.6)
  })
})
