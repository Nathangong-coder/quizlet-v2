/**
 * Why a public set was reported.
 *
 * A closed `as const` vocabulary for the same reason `SET_VISIBILITIES` is one:
 * `SetReport.reason` is a String column, so a typo compiles cleanly and
 * silently never matches. Import this rather than writing a literal.
 *
 * These strings are PERSISTED. Renaming one strands every existing row — the
 * same constraint `CORRUPTIONS` carries in the analysis layer.
 */
export const REPORT_REASONS = [
  'spam',
  'abusive',
  'copyright',
  'misleading',
  'other',
] as const

export type ReportReason = (typeof REPORT_REASONS)[number]

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: 'Spam or advertising',
  abusive: 'Abusive or hateful content',
  copyright: "Copies someone else's material",
  misleading: 'Deliberately wrong or misleading',
  other: 'Something else',
}

/** A detail note longer than this is not read by an operator; it is a payload. */
export const REPORT_DETAIL_MAX = 2000

/**
 * Narrow a submitted reason, or NULL.
 *
 * Deliberately does NOT fail closed to a default the way `toSetVisibility`
 * does. There is no safe default: coercing an unrecognised value to `other`
 * files a report the reporter did not make under a category they did not
 * choose, and the row is what an operator later acts on. A malformed
 * submission is rejected, not reinterpreted.
 *
 * Checked against the ARRAY, not against `REPORT_REASON_LABELS` keys — an
 * object lookup answers truthily for `toString` and every other inherited
 * prototype key, and the value reaching here came off the wire.
 */
export function toReportReason(raw: string): ReportReason | null {
  return (REPORT_REASONS as readonly string[]).includes(raw) ? (raw as ReportReason) : null
}
