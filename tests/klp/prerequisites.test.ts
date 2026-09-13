import { describe, it, expect } from 'vitest'
import {
  attributeBlame,
  blockedIndexes,
  explainBlocked,
  summarizeBlame,
  type KlpOutcome,
} from '@/lib/klp/prerequisites'
import { RELATION_PROVENANCES, type RelationEdge } from '@/lib/klp/relations'

/** `from: X, to: Y` typed `requires` reads "Y cannot hold without X". */
const requires = (prerequisite: number, dependent: number): RelationEdge => ({
  from: prerequisite,
  to: dependent,
  type: 'requires',
})

const outcomes = (...passed: boolean[]): KlpOutcome[] =>
  passed.map((p, index) => ({ index, passed: p }))

describe('attributeBlame', () => {
  it('calls an unexplained failure a ROOT', () => {
    const out = attributeBlame(outcomes(false), [])
    expect(out).toEqual([{ index: 0, kind: 'root', blockedBy: [] }])
  })

  it('BLOCKS a failure whose prerequisite also failed', () => {
    // THE MOTIVATING CASE. A = "the deposit raises cash and equity";
    // B = "so EV is unchanged once Net Debt falls". B presupposes A, so a
    // learner without A cannot demonstrate B — recording both as independent
    // failures counts one gap twice.
    const out = attributeBlame(outcomes(false, false), [requires(0, 1)])
    expect(out.find((b) => b.index === 1)).toEqual({
      index: 1, kind: 'blocked', blockedBy: [0],
    })
    expect(out.find((b) => b.index === 0)!.kind).toBe('root')
  })

  it('does NOT block when the prerequisite was passed', () => {
    // The learner had A and still missed B: that is a real, unexplained failure
    // of B, which is exactly the observation worth keeping.
    const out = attributeBlame(outcomes(true, false), [requires(0, 1)])
    expect(out).toEqual([{ index: 1, kind: 'root', blockedBy: [] }])
  })

  it('never blocks a point the learner got RIGHT', () => {
    // Stating B correctly while fumbling A demonstrates B regardless of what
    // the entailment says — and only failures are attributed at all.
    const out = attributeBlame(outcomes(false, true), [requires(0, 1)])
    expect(out.map((b) => b.index)).toEqual([0])
  })

  it('never turns a failure into a pass', () => {
    // Not knowing whether the learner holds B is not evidence that they do.
    // Every blocked entry is still a failure; it is only unattributed.
    const out = attributeBlame(outcomes(false, false), [requires(0, 1)])
    expect(out).toHaveLength(2)
    expect(out.every((b) => b.index === 0 || b.index === 1)).toBe(true)
  })

  it('walks a chain, so a failure two hops downstream is still blocked', () => {
    const out = attributeBlame(outcomes(false, false, false), [requires(0, 1), requires(1, 2)])
    const two = out.find((b) => b.index === 2)!
    expect(two.kind).toBe('blocked')
    expect(two.blockedBy).toEqual([1, 0])
  })

  it('stops the walk at a prerequisite the learner PASSED', () => {
    // 0 failed, 1 passed, 2 failed with 2 requiring 1 requiring 0. The chain is
    // broken at 1: the learner had it, so 2's failure is its own.
    const out = attributeBlame(outcomes(false, true, false), [requires(0, 1), requires(1, 2)])
    expect(out.find((b) => b.index === 2)).toEqual({ index: 2, kind: 'root', blockedBy: [] })
  })

  it('ignores `causes` edges — only `requires` licenses the excuse', () => {
    // "X drives Y" says how the world works; it does not say a learner cannot
    // state Y without stating X. Accepting a weaker edge would silently stop
    // crediting real failures.
    const out = attributeBlame(outcomes(false, false), [{ from: 0, to: 1, type: 'causes' }])
    expect(out.every((b) => b.kind === 'root')).toBe(true)
  })

  it('terminates on a cycle rather than hanging', () => {
    // Authoring prunes cycles, but this reads whatever is in the database, and
    // hanging is worse than a wrong answer.
    const out = attributeBlame(outcomes(false, false), [requires(0, 1), requires(1, 0)])
    expect(out).toHaveLength(2)
    expect(out.every((b) => b.kind === 'blocked')).toBe(true)
  })

  it('handles a point with several failed prerequisites', () => {
    const out = attributeBlame(outcomes(false, false, false), [requires(0, 2), requires(1, 2)])
    expect(out.find((b) => b.index === 2)!.blockedBy.sort()).toEqual([0, 1])
  })
})

describe('blockedIndexes', () => {
  it('names only the failures something upstream explains', () => {
    const blame = attributeBlame(outcomes(false, false, false), [requires(0, 1)])
    expect(blockedIndexes(blame)).toEqual([1])
  })
})

describe('explainBlocked', () => {
  const text = (i: number) => ['cash and equity rise', 'net debt offsets it', 'so EV is unchanged'][i]

  it('names the ROOT of the chain, not the nearest link', () => {
    // "You missed the EV conclusion because you never had the cash step" is
    // actionable; naming the intermediate inference sends them to the wrong
    // place. blockedBy is nearest-first, so the root is last.
    const blame = attributeBlame(outcomes(false, false, false), [requires(0, 1), requires(1, 2)])
    const line = explainBlocked(blame.find((b) => b.index === 2)!, text)
    expect(line).toContain('cash and equity rise')
    expect(line).toContain('so EV is unchanged')
    expect(line).not.toContain('net debt offsets it')
  })

  it('says the failure was not counted separately', () => {
    const blame = attributeBlame(outcomes(false, false), [requires(0, 1)])
    expect(explainBlocked(blame.find((b) => b.index === 1)!, text))
      .toContain('Not counted against you separately')
  })

  it('returns nothing for a root failure — there is no excuse to offer', () => {
    const blame = attributeBlame(outcomes(false), [])
    expect(explainBlocked(blame[0], text)).toBeNull()
  })
})

describe('summarizeBlame', () => {
  it('splits failures into root and blocked', () => {
    const blame = attributeBlame(outcomes(false, false, true, false), [requires(0, 1)])
    expect(summarizeBlame(blame)).toEqual({ failures: 3, root: 2, blocked: 1 })
  })
})

describe('the entailment provenance', () => {
  it('is its own value, not folded into perturbation', () => {
    // The two answer different questions and can disagree: perturbation asks
    // how the subject matter hangs together, entailment asks what a learner
    // cannot say in isolation. Keeping them apart lets a later pass ask which
    // method finds the edges that matter.
    expect(RELATION_PROVENANCES).toContain('entailment')
    expect(RELATION_PROVENANCES).toContain('perturbation')
  })
})
