import { describe, it, expect, afterEach } from 'vitest'
import { parseKltEditors, isKltEditor } from '@/lib/klt/editors'

const original = process.env.KLT_EDITORS
afterEach(() => { process.env.KLT_EDITORS = original })

describe('parseKltEditors', () => {
  it('splits a comma-separated list and trims each entry', () => {
    expect(parseKltEditors('a, b ,c')).toEqual(['a', 'b', 'c'])
  })

  it('returns NOBODY when unset — the safe default for a global structure', () => {
    // An unset allowlist must not mean "everyone". This gate protects a tree
    // whose every edit moves other accounts' mastery.
    expect(parseKltEditors(undefined)).toEqual([])
    expect(parseKltEditors('')).toEqual([])
  })

  it('drops empty entries from sloppy input rather than admitting an empty id', () => {
    // ',,' would otherwise yield [''] and an unauthenticated caller whose id
    // resolved to '' would match it.
    expect(parseKltEditors('a,,b,')).toEqual(['a', 'b'])
  })
})

describe('isKltEditor', () => {
  it('admits a listed id and refuses an unlisted one', () => {
    process.env.KLT_EDITORS = 'user-1,user-2'
    expect(isKltEditor('user-1')).toBe(true)
    expect(isKltEditor('user-3')).toBe(false)
  })

  it('refuses everyone when unset', () => {
    delete process.env.KLT_EDITORS
    expect(isKltEditor('user-1')).toBe(false)
  })

  it('refuses an empty id even if the list is sloppy', () => {
    process.env.KLT_EDITORS = 'a,,b'
    expect(isKltEditor('')).toBe(false)
  })
})
