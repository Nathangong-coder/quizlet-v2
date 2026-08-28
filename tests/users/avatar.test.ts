import { describe, it, expect } from 'vitest'
import {
  buildAvatarGlyph,
  avatarSrc,
  resolveAvatar,
  AVATAR_MAX_BYTES,
  AVATAR_MIME_TYPES,
} from '@/lib/users/avatar'

describe('buildAvatarGlyph', () => {
  it('is deterministic for a seed', () => {
    // A mark that changes between renders is noise, not an identity.
    expect(buildAvatarGlyph('user_abc')).toEqual(buildAvatarGlyph('user_abc'))
  })

  it('gives different seeds different hues', () => {
    // The hue is the ONLY thing distinguishing two avatars at 32px in a
    // topbar, where there is no title beside the mark to identify it.
    const hues = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => buildAvatarGlyph(s).hue)
    expect(new Set(hues).size).toBeGreaterThan(1)
  })

  it('keeps the hue inside the OKLCH range', () => {
    for (const seed of ['', 'x', 'cm123456789', 'a'.repeat(200)]) {
      const { hue } = buildAvatarGlyph(seed)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(Number.isInteger(hue)).toBe(true)
    }
  })

  it('spreads hues evenly across cuid-shaped seeds', () => {
    // cuid()s share a long timestamp-derived prefix and vary only in the tail,
    // and the LOW bits of an FNV-1a hash are its least mixed — so `% 360` taken
    // off the raw value clusters colours for accounts created near each other.
    //
    // THIS ASSERTION IS CALIBRATED AGAINST MEASUREMENT, not intuition. An
    // earlier version of this test used seeds that varied mid-string and passed
    // under BOTH formulas, i.e. it could not fail. Over these 200 seeds the raw
    // formula gives a bucket spread of 24 and 141 distinct hues; the shifted one
    // gives 7 and 162. Everything is deterministic, so these numbers are stable.
    const seeds = Array.from({ length: 200 }, (_, i) => `cmf8x2a0q000${i.toString(36).padStart(4, '0')}`)
    const hues = seeds.map((s) => buildAvatarGlyph(s).hue)

    const buckets = new Array(12).fill(0)
    for (const h of hues) buckets[Math.floor(h / 30)]++
    const spread = Math.max(...buckets) - Math.min(...buckets)

    expect(spread, `hue buckets: ${JSON.stringify(buckets)}`).toBeLessThanOrEqual(15)
    expect(new Set(hues).size).toBeGreaterThan(150)
  })

  it('always produces a drawable constellation', () => {
    const { nodes } = buildAvatarGlyph('anything')
    expect(nodes.length).toBeGreaterThan(1)
    for (const n of nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0)
      expect(n.x).toBeLessThanOrEqual(1)
      expect(n.y).toBeGreaterThanOrEqual(0)
      expect(n.y).toBeLessThanOrEqual(1)
      expect(n.r).toBeGreaterThan(0)
    }
  })
})

describe('resolveAvatar', () => {
  it('prefers the upload over the OAuth image', () => {
    // If OAuth won, uploading a photo would appear to work and then revert on
    // the next GitHub sign-in — the exact failure this precedence prevents.
    const out = resolveAvatar({ avatarUrl: 'https://blob/me.png', image: 'https://gh/me.png', seed: 's' })
    expect(out).toEqual({ kind: 'url', url: 'https://blob/me.png', source: 'upload' })
  })

  it('falls back to the OAuth image when there is no upload', () => {
    const out = resolveAvatar({ avatarUrl: null, image: 'https://gh/me.png', seed: 's' })
    expect(out).toEqual({ kind: 'url', url: 'https://gh/me.png', source: 'oauth' })
  })

  it('falls back to the generated glyph when there is neither', () => {
    const out = resolveAvatar({ avatarUrl: null, image: null, seed: 'user_1' })
    expect(out.kind).toBe('glyph')
    if (out.kind === 'glyph') expect(out.glyph).toEqual(buildAvatarGlyph('user_1'))
  })

  it('treats a blank string as absent, not as a url', () => {
    // An empty-string column is what an untouched form field persists, and ''
    // passes a bare `avatarUrl ?? image` — then renders a broken-image icon.
    expect(resolveAvatar({ avatarUrl: '', image: 'https://gh/me.png', seed: 's' })).toEqual({
      kind: 'url',
      url: 'https://gh/me.png',
      source: 'oauth',
    })
    expect(resolveAvatar({ avatarUrl: '   ', image: '  ', seed: 's' }).kind).toBe('glyph')
  })

  it('handles both fields being undefined rather than null', () => {
    expect(resolveAvatar({ seed: 's' }).kind).toBe('glyph')
  })
})

describe('avatar limits', () => {
  it('caps uploads at 2MB', () => {
    expect(AVATAR_MAX_BYTES).toBe(2 * 1024 * 1024)
  })

  it('does not accept SVG', () => {
    // An SVG is a script-bearing document. Serving one from a blob host for a
    // decorative 32px circle is a needless XSS surface.
    expect(AVATAR_MIME_TYPES).not.toContain('image/svg+xml')
  })
})

describe('avatarSrc', () => {
  it('points at the proxy route, not the stored blob URL', () => {
    // The store is configured private, so the blob URL is not fetchable from a
    // browser at all — rendering it directly is a broken image on every page
    // with a topbar.
    expect(avatarSrc('u1', 'https://blob.example/avatars/abc-123.png')).toMatch(
      /^\/api\/avatar\/u1\?/,
    )
  })

  it('busts the cache on the blob id, so a new upload is a new URL', () => {
    // Without this the path is byte-identical before and after a change, and a
    // browser holding the old picture for a week keeps showing it — the upload
    // looks like it silently failed.
    const before = avatarSrc('u1', 'https://blob.example/avatars/aaa.png')
    const after = avatarSrc('u1', 'https://blob.example/avatars/bbb.png')
    expect(before).not.toBe(after)
  })

  it('drops a query string already on the stored URL rather than nesting one', () => {
    expect(avatarSrc('u1', 'https://blob.example/avatars/abc.png?download=1')).toBe(
      '/api/avatar/u1?v=abc.png',
    )
  })

  it('degrades to the bare path for a malformed stored value', () => {
    // A broken image, never a 500 on every page that renders a topbar.
    expect(avatarSrc('u1', '')).toBe('/api/avatar/u1')
  })
})
