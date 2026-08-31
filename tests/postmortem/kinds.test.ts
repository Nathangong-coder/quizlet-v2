import { describe, expect, it } from 'vitest'
import {
  POSTMORTEM_FORMATS,
  POSTMORTEM_FORMAT_LABELS,
  postmortemFormatLabel,
} from '@/lib/postmortem/kinds'

describe('postmortem format vocabulary', () => {
  it('has a readable label for every persisted format', () => {
    expect(POSTMORTEM_FORMATS.every((format) => Boolean(POSTMORTEM_FORMAT_LABELS[format]))).toBe(true)
  })

  it('degrades safely for an old or unknown stored value', () => {
    expect(postmortemFormatLabel('new-format')).toBe('Offline session')
  })
})
