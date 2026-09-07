import { describe, it, expect } from 'vitest'
import {
  buildCredentialPool,
  comboKey,
  MAX_ATTEMPTS_PER_CALL,
  type PoolInput,
} from '@/lib/ai/credential-pool'

const cred = (over: Partial<PoolInput> = {}): PoolInput => ({
  id: 'c1',
  label: 'Key 1',
  provider: 'google',
  defaultModel: 'm-default',
  tier: 'free',
  role: 'primary',
  enabled: true,
  lastUsedAt: null,
  ...over,
})

const extras = () => ['m-a', 'm-b']

describe('buildCredentialPool — free credentials fan out across models', () => {
  it('tries the owner-configured model first', () => {
    // The substitute exists to survive an exhausted cap, not to override a
    // choice somebody made deliberately.
    const pool = buildCredentialPool({ credentials: [cred()], extraModels: extras })
    expect(pool[0].model).toBe('m-default')
  })

  it('then tries the other approved models for that provider', () => {
    const pool = buildCredentialPool({ credentials: [cred()], extraModels: extras })
    expect(pool.map((a) => a.model)).toEqual(['m-default', 'm-a', 'm-b'])
  })

  it('never repeats the default as though it were an alternate', () => {
    const pool = buildCredentialPool({
      credentials: [cred({ defaultModel: 'm-a' })],
      extraModels: extras,
    })
    expect(pool.map((a) => a.model)).toEqual(['m-a', 'm-b'])
  })
})

describe('buildCredentialPool — paid credentials do not fan out', () => {
  it('contributes exactly one attempt, on the configured model', () => {
    // A billed key has no daily cap to route around, and every extra model is
    // another price to reason about and another quality profile to verify.
    const pool = buildCredentialPool({
      credentials: [cred({ tier: 'paid' })],
      extraModels: extras,
    })
    expect(pool).toHaveLength(1)
    expect(pool[0].model).toBe('m-default')
  })

  it('treats an unrecognised tier as free — the safe side', () => {
    // A paid key wrongly widened is merely rotated more than it needed to be.
    // A free key wrongly narrowed gets hammered into its daily cap.
    const pool = buildCredentialPool({
      credentials: [cred({ tier: 'nonsense' })],
      extraModels: extras,
    })
    expect(pool.length).toBeGreaterThan(1)
  })
})

describe('buildCredentialPool — ordering across credentials', () => {
  it('gives every credential its own default before any substitute', () => {
    // Interleaving by rank keeps a configured model ahead of a substitute on
    // a sibling key.
    const pool = buildCredentialPool({
      credentials: [
        cred({ id: 'c1', defaultModel: 'd1', lastUsedAt: new Date(1) }),
        cred({ id: 'c2', defaultModel: 'd2', lastUsedAt: new Date(2) }),
      ],
      extraModels: () => ['x'],
    })
    expect(pool.slice(0, 2).map((a) => a.model)).toEqual(['d1', 'd2'])
  })

  it('still honours least-recently-used across credentials', () => {
    const pool = buildCredentialPool({
      credentials: [
        cred({ id: 'newer', lastUsedAt: new Date(2000) }),
        cred({ id: 'older', lastUsedAt: new Date(1000) }),
      ],
      extraModels: () => [],
    })
    expect(pool[0].credentialId).toBe('older')
  })

  it('still puts primaries before backups', () => {
    const pool = buildCredentialPool({
      credentials: [
        cred({ id: 'backup', role: 'backup', lastUsedAt: null }),
        cred({ id: 'primary', role: 'primary', lastUsedAt: new Date(9999) }),
      ],
      extraModels: () => [],
    })
    expect(pool[0].credentialId).toBe('primary')
  })

  it('drops disabled credentials, as selectAttemptOrder always has', () => {
    const pool = buildCredentialPool({
      credentials: [cred({ id: 'off', enabled: false })],
      extraModels: extras,
    })
    expect(pool).toEqual([])
  })
})

describe('buildCredentialPool — exhausted combos', () => {
  it('drops a combo that already hit its daily cap today', () => {
    // Not sorted last — DROPPED. A combo whose daily cap is gone fails every
    // time until reset, so trying it is a guaranteed wasted round-trip.
    // Measured: six questions x two credentials = twelve doomed calls at ~6s
    // each, inside a single diagnostic submit.
    const pool = buildCredentialPool({
      credentials: [cred()],
      extraModels: extras,
      exhausted: new Set([comboKey('c1', 'm-default')]),
    })
    expect(pool.map((a) => a.model)).toEqual(['m-a', 'm-b'])
  })

  it('returns nothing when every combo is exhausted', () => {
    // An empty pool is the honest answer, and the caller turns it into a real
    // error rather than a doomed attempt.
    const pool = buildCredentialPool({
      credentials: [cred()],
      extraModels: extras,
      exhausted: new Set([
        comboKey('c1', 'm-default'),
        comboKey('c1', 'm-a'),
        comboKey('c1', 'm-b'),
      ]),
    })
    expect(pool).toEqual([])
  })

  it('exhausts per credential+model, not per model', () => {
    // The cap is really per PROJECT per model, but project identity is not
    // knowable from a key. Excluding only the exact pair that failed costs at
    // most one wasted call to discover a sibling in the same project, instead
    // of wrongly disabling a key in a different one.
    const pool = buildCredentialPool({
      credentials: [cred({ id: 'c1' }), cred({ id: 'c2' })],
      extraModels: () => [],
      exhausted: new Set([comboKey('c1', 'm-default')]),
    })
    expect(pool.map((a) => a.credentialId)).toEqual(['c2'])
  })
})

describe('buildCredentialPool — attempt cap', () => {
  it('never returns more attempts than the limit', () => {
    // Two credentials across four models is sixteen possible attempts; at ~10s
    // each a learner would wait nearly three minutes to be told it failed.
    const pool = buildCredentialPool({
      credentials: [cred({ id: 'c1' }), cred({ id: 'c2' }), cred({ id: 'c3' })],
      extraModels: () => ['a', 'b', 'c', 'd'],
    })
    expect(pool).toHaveLength(MAX_ATTEMPTS_PER_CALL)
  })

  it('spends the budget on breadth before depth', () => {
    // With a limited budget, a different CREDENTIAL is a better next guess
    // than a different model on the same one — a dead key is dead for every
    // model, but a capped model may work on another key.
    const pool = buildCredentialPool({
      credentials: [cred({ id: 'c1', defaultModel: 'd' }), cred({ id: 'c2', defaultModel: 'd' })],
      extraModels: () => ['x', 'y'],
      limit: 2,
    })
    expect(pool.map((a) => a.credentialId)).toEqual(['c1', 'c2'])
  })
})
