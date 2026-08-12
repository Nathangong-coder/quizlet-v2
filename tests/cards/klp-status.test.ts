import { describe, it, expect } from 'vitest'
import {
  CARD_KLP_STATUSES,
  toCardKlpStatus,
  type CardKlpStatus,
} from '@/lib/cards/klp-status'

/**
 * Spec 2a listed `Card.klpStatus` under "Known drift risks, deliberately out of
 * scope": four literals scattered across two actions, a component, and a Prisma
 * comment, with nothing tying them together. The column is a `String`, so type
 * checking could not catch a typo — hence this file.
 */
describe('CARD_KLP_STATUSES', () => {
  it('pins the vocabulary the Prisma column documents', () => {
    // If this fails, prisma/schema.prisma's `klpStatus` comment and any row
    // already written are now out of step with the code. Update both together
    // or revert — a status the DB contains but the union omits renders as
    // 'pending' and silently offers the user an extraction they already have.
    expect([...CARD_KLP_STATUSES]).toEqual(['pending', 'ready', 'failed', 'skipped'])
  })

  it('does not collide with the learner-outcome KlpStatus vocabulary', async () => {
    // `@/lib/errors/klp-credit` exports a different `KlpStatus`
    // (passed|partial|failed) for how a learner did on one key point. The two
    // share `failed` and nothing else; conflating them would let a card's
    // extraction state be written where a grading outcome belongs.
    const { STATUS_CREDIT } = await import('@/lib/errors/klp-credit')
    const outcomes = Object.keys(STATUS_CREDIT)
    expect(outcomes).not.toContain('pending')
    expect(outcomes).not.toContain('ready')
    expect(outcomes).not.toContain('skipped')
  })
})

describe('toCardKlpStatus', () => {
  it('passes every known status through unchanged', () => {
    for (const s of CARD_KLP_STATUSES) expect(toCardKlpStatus(s)).toBe(s)
  })

  it('degrades an unrecognised stored value to pending rather than throwing', () => {
    // A row written by hand, or before the vocabulary settled. 'pending' is the
    // column default and the one status whose UI offers extraction, so the
    // degradation is both true and actionable. Throwing would take down the set
    // builder over one bad row.
    expect(toCardKlpStatus('nonsense')).toBe('pending')
    expect(toCardKlpStatus('')).toBe('pending')
  })

  it('is not fooled by a value that only differs in case', () => {
    // The comparison must be exact: Prisma writes what it is given, and
    // 'Ready' would never match the `status === 'ready'` the editor renders on.
    expect(toCardKlpStatus('Ready')).toBe('pending')
  })

  it('returns a value assignable to CardKlpStatus', () => {
    const narrowed: CardKlpStatus = toCardKlpStatus('ready')
    expect(narrowed).toBe('ready')
  })
})
