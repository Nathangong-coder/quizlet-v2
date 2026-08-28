import { describe, it, expect } from 'vitest'
import {
  REPORT_REASONS, REPORT_REASON_LABELS, toReportReason,
} from '@/lib/sets/moderation'

describe('REPORT_REASONS', () => {
  it('is a closed vocabulary', () => {
    expect([...REPORT_REASONS]).toEqual([
      'spam', 'abusive', 'copyright', 'misleading', 'other',
    ])
  })

  it('labels every reason', () => {
    // A reason with no label renders as a raw enum string in the UI.
    for (const r of REPORT_REASONS) {
      expect(REPORT_REASON_LABELS[r], r).toBeTruthy()
    }
    expect(Object.keys(REPORT_REASON_LABELS).sort()).toEqual([...REPORT_REASONS].sort())
  })
})

describe('toReportReason', () => {
  it('passes known reasons through', () => {
    for (const r of REPORT_REASONS) expect(toReportReason(r)).toBe(r)
  })

  it('returns NULL for an unknown value rather than a default', () => {
    // Unlike `toSetVisibility`, there is NO safe default here. Coercing an
    // unrecognised reason to 'other' would file a report the reporter did not
    // make, under a category they did not choose — and the row is what an
    // operator later acts on. Reject instead.
    expect(toReportReason('')).toBeNull()
    expect(toReportReason('Spam')).toBeNull()
    expect(toReportReason('harassment')).toBeNull()
  })

  it('rejects inherited Object.prototype keys', () => {
    // `includes` on the array is what makes this safe; an object-keyed lookup
    // would answer truthily for 'toString' and file a report under a reason
    // that does not exist.
    expect(toReportReason('toString')).toBeNull()
    expect(toReportReason('constructor')).toBeNull()
  })
})
