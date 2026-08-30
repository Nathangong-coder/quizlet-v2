export const POSTMORTEM_FORMATS = [
  'paper_test',
  'mock_interview',
  'real_interview',
  'case_study',
  'technical_test',
  'other',
] as const

export type PostmortemFormat = (typeof POSTMORTEM_FORMATS)[number]

export const POSTMORTEM_FORMAT_LABELS: Record<PostmortemFormat, string> = {
  paper_test: 'Paper test',
  mock_interview: 'Mock interview',
  real_interview: 'Real interview',
  case_study: 'Case study',
  technical_test: 'Technical test',
  other: 'Other',
}

export function postmortemFormatLabel(format: string): string {
  return POSTMORTEM_FORMAT_LABELS[format as PostmortemFormat] ?? 'Offline session'
}
