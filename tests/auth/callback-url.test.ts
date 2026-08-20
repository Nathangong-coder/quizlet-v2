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

  // Round two's escape class: parsing the INPUT against the sentinel isn't
  // enough, because dot-segments can normalise away against the sentinel's
  // root so the parsed pathname itself comes back starting with "//" — which
  // the real sink (next/navigation's router) re-parses as protocol-relative
  // and leaves the site. safeCallbackUrl must re-parse its own OUTPUT through
  // the same parser before returning it.
  describe('escapes the parsed-input-only guard via dot-segment normalisation', () => {
    it.each([
      ['/..//evil.com', '/sets'],
      ['/.//\\evil.com', '/sets'],
      ['/a/..//evil.com', '/sets'],
      ['/%2e%2e//evil.com', '/sets'],
      ['/..//evil.com:8080', '/sets'],
      ['/..//user:pass@evil.com', '/sets'],
    ])('resolves %s to a same-origin value, never to evil.com', (payload, expected) => {
      const result = safeCallbackUrl(payload)
      expect(result).toBe(expected)
      expect(new URL(result, 'https://this-site.example').origin).toBe('https://this-site.example')
    })

    // The fix must not overcorrect into rejecting every dot-segment: a
    // legitimate same-origin path that merely contains ".." and normalises
    // back to itself should still resolve, not fall back to /sets.
    it('resolves a legitimate dot-segment path instead of rejecting it outright', () => {
      expect(safeCallbackUrl('/sets/../sets/abc')).toBe('/sets/abc')
    })
  })

  // Round three's guard re-parsed the OUTPUT against the SAME sentinel it was
  // built from, so it was structurally blind to escapes that land back on
  // that exact sentinel host: "/..//x.invalid" produces output "//x.invalid",
  // and "//x.invalid" re-parsed against "https://x.invalid" reports origin
  // "https://x.invalid" — an exact match, so the same-sentinel check waved it
  // through. This only worked by accident because ".invalid" is IANA-reserved
  // and unregistrable; the guard becomes a genuine open redirect the moment
  // the sentinel is pointed at a real (e.g. the site's own) origin. These
  // exist because the sentinel host was previously invisible to its own
  // guard — they would look arbitrary without that context. Fixed by
  // validating the output against a DIFFERENT origin (CHECK_ORIGIN) than the
  // one used to parse the input (PARSE_ORIGIN), plus a belt-and-braces
  // startsWith check on the output that also catches opaque-path schemes
  // like "blob:" where the "output" is an absolute URL, not a path.
  describe('escapes the same-sentinel guard by landing back on the sentinel host', () => {
    it.each([
      ['/..//x.invalid', '/sets'],
      ['..//x.invalid', '/sets'],
      ['/..//x.invalid/p?q=1#f', '/sets'],
      ['/..//X.INVALID', '/sets'],
      ['blob:https://x.invalid/uuid', '/sets'],
      ['blob:https://x.invalid/..//evil.com', '/sets'],
    ])('resolves %s to a same-origin value, never to the sentinel host', (payload, expected) => {
      const result = safeCallbackUrl(payload)
      expect(result).toBe(expected)
      expect(new URL(result, 'https://this-site.example').origin).toBe('https://this-site.example')
    })

    // The origin recheck above validates the output against CHECK_ORIGIN
    // ("https://y.invalid"), not PARSE_ORIGIN — but CHECK_ORIGIN is itself
    // just another string baked into the source, nameable by anyone who can
    // read this file. A payload that targets CHECK_ORIGIN's own host would
    // sail through the origin recheck by construction (its re-parsed origin
    // IS CHECK_ORIGIN). Only the belt-and-braces startsWith("/") &&
    // !startsWith("//") check on the output catches this, which is why that
    // check is not optional decoration on top of the origin recheck — it is
    // the one guard with no origin it can be tricked into agreeing with.
    it('resolves a payload targeting CHECK_ORIGIN itself, not just PARSE_ORIGIN', () => {
      expect(safeCallbackUrl('/..//y.invalid')).toBe('/sets')
    })
  })
})
