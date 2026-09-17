import { describe, it, expect } from 'vitest'
import { KLP_STATUSES, STATUS_CREDIT, isKlpStatus, klpCredit } from '@/lib/errors/klp-credit'
import { KLP_VERDICTS, VERDICT_CREDIT, RUNTIME_VERDICTS } from '@/lib/klp/verdicts'
import { CORRUPTIONS } from '@/lib/quiz/options'
import { stepBkt } from '@/lib/metrics/bkt'
import { GRADED_KLP_MODES } from '@/lib/errors/klp-credit'

describe('STATUS_CREDIT is total over KLP_STATUSES', () => {
  it('has a finite entry in [0,1] for every status', () => {
    for (const s of KLP_STATUSES) {
      expect(Number.isFinite(STATUS_CREDIT[s]), s).toBe(true)
      expect(STATUS_CREDIT[s]).toBeGreaterThanOrEqual(0)
      expect(STATUS_CREDIT[s]).toBeLessThanOrEqual(1)
    }
  })
  it('agrees with VERDICT_CREDIT on every verdict, and passed === correct', () => {
    for (const v of KLP_VERDICTS) expect(STATUS_CREDIT[v]).toBe(VERDICT_CREDIT[v])
    expect(STATUS_CREDIT.passed).toBe(STATUS_CREDIT.correct)
  })
  it('every corruption is a verdict (CORRUPTIONS ⊂ KLP_VERDICTS)', () => {
    for (const c of CORRUPTIONS) expect((KLP_VERDICTS as readonly string[]).includes(c), c).toBe(true)
  })
  it('RUNTIME_VERDICTS omits the two whole-answer labels and nothing else', () => {
    expect(RUNTIME_VERDICTS).not.toContain('fabrication')
    expect(RUNTIME_VERDICTS).not.toContain('unsupported_leap')
    expect(RUNTIME_VERDICTS.length).toBe(KLP_VERDICTS.length - 2)
  })
  it('isKlpStatus accepts the alias, rejects garbage', () => {
    expect(isKlpStatus('passed')).toBe(true)
    expect(isKlpStatus('inversion')).toBe(true)
    expect(isKlpStatus('missing_response')).toBe(false)
  })
  it('stepBkt is finite for every status × mode (the NaN guard)', () => {
    for (const s of KLP_STATUSES) for (const m of GRADED_KLP_MODES) {
      const p = stepBkt(0.5, { status: s, mode: m } as never)
      expect(Number.isFinite(p), `${s}/${m}`).toBe(true)
      expect(p).toBeGreaterThanOrEqual(0); expect(p).toBeLessThanOrEqual(1)
    }
  })
  it('klpCredit on a zero-credit label is 0 in every mode', () => {
    for (const m of GRADED_KLP_MODES) expect(klpCredit('inversion', m)).toBe(0)
  })
})
