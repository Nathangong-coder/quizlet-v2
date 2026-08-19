import { describe, it, expect } from 'vitest'
import { safeCallbackUrl } from '@/lib/auth/callback-url'

describe('safeCallbackUrl', () => {
  it('defaults to /sets when nothing is given', () => {
    expect(safeCallbackUrl(undefined)).toBe('/sets')
  })

  it('passes through a plain relative path', () => {
    expect(safeCallbackUrl('/sets/abc/quiz')).toBe('/sets/abc/quiz')
  })

  it('preserves query string and fragment', () => {
    expect(safeCallbackUrl('/sets/abc/quiz?mode=mc&cat=x')).toBe('/sets/abc/quiz?mode=mc&cat=x')
    expect(safeCallbackUrl('/sets/abc#section')).toBe('/sets/abc#section')
  })

  // The three payloads the naive `raw.startsWith('/') && !raw.startsWith('//')`
  // string check let through, because it inspected the RAW string while the
  // real sinks (next/navigation's router, @auth/core's redirect callback) run
  // it through the WHATWG URL parser first, which folds backslashes into
  // slashes and strips tab/CR/LF *before* parsing.
  describe('escapes the naive string-test guard, caught by parsing', () => {
    it('rejects a leading backslash that the parser folds into //', () => {
      expect(safeCallbackUrl('/\\evil.com')).toBe('/sets')
    })

    it('rejects an embedded tab that the parser strips', () => {
      expect(safeCallbackUrl('/\t/evil.com')).toBe('/sets')
    })

    it('rejects an embedded line feed that the parser strips', () => {
      expect(safeCallbackUrl('/\n/evil.com')).toBe('/sets')
    })

    it('rejects an embedded carriage return that the parser strips', () => {
      expect(safeCallbackUrl('/\r/evil.com')).toBe('/sets')
    })
  })

  // Everything the naive `raw.startsWith('/') && !raw.startsWith('//')` guard
  // already caught (for various string-level reasons), kept as a regression
  // net now that rejection is parser-driven instead. "%2F%2Fevil.com" is the
  // one exception: the percent signs are never decoded by the URL parser
  // during relative-path resolution, so it stays a same-origin PATH
  // ("/%2F%2Fevil.com"), not a host change — safeCallbackUrl legitimately
  // keeps it rather than discarding it. The invariant that matters is not
  // "equals /sets", it's "origin never leaves this site", asserted below.
  describe('already-caught absolute/scheme-relative payloads', () => {
    it.each([
      ['//evil.com', '/sets'],
      ['https://evil.com', '/sets'],
      ['http:/evil.com', '/sets'],
      ['\\\\evil.com', '/sets'], // two literal backslashes, no leading "/" — folds to "//evil.com"
      ['\\/evil.com', '/sets'], // one backslash + one slash — folds to "//evil.com"
      ['%2F%2Fevil.com', '/%2F%2Fevil.com'],
      [' //evil.com', '/sets'],
      ['javascript:alert(1)', '/sets'],
    ])('resolves %s to a same-origin value, never to evil.com', (payload, expected) => {
      const result = safeCallbackUrl(payload)
      expect(result).toBe(expected)
      // The invariant: whatever comes back, a browser resolving it against
      // this site's origin never leaves that origin.
      expect(new URL(result, 'https://this-site.example').origin).toBe('https://this-site.example')
    })
  })
})
