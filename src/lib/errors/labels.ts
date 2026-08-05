import type { KlpStatus } from './klp-credit'

const ERROR_TYPE_LABELS: Record<string, string> = {
  omission: 'Omission',
  incomplete: 'Incomplete',
  conflation: 'Conflation',
  inversion: 'Inversion',
  misapplication: 'Misapplication',
  factual_error: 'Factual error',
  overgeneralization: 'Overgeneralization',
  unsupported_leap: 'Unsupported leap',
  fabrication: 'Fabrication',
  disorganized: 'Disorganized',
  no_thesis: 'No clear thesis',
  ambiguous_referent: 'Ambiguous referent',
  undefined_jargon: 'Undefined jargon',
  hedging: 'Hedging',
  incoherent_syntax: 'Incoherent syntax',
  rambling: 'Rambling',
  padding: 'Padding',
  redundancy: 'Redundancy',
  over_qualification: 'Over-qualification',
  kitchen_sink: 'Kitchen sink',
  too_terse: 'Too terse',
}

/**
 * De-slugs an unrecognized type rather than throwing — the vocabulary can
 * grow. `.charAt(0)` rather than `[0]`: an empty (or leading/repeated-
 * underscore) word's first "character" must be `''`, not `undefined` —
 * `undefined.toUpperCase()` throws, and `undefined + rest` silently produces
 * the literal string `"undefined"`, both worse than leaving the word as-is.
 */
function deSlug(s: string): string {
  const words = s.split('_')
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ')
}

export function labelForErrorType(type: string): string {
  return ERROR_TYPE_LABELS[type] ?? deSlug(type)
}

const KLP_STATUS_LABELS: Record<KlpStatus, string> = {
  passed: 'Covered',
  partial: 'Partially covered',
  failed: 'Missed',
}

export function labelForKlpStatus(status: KlpStatus): string {
  return KLP_STATUS_LABELS[status]
}
