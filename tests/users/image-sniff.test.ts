import { describe, it, expect } from 'vitest'
import { sniffImageType, verifyImageUpload } from '@/lib/users/image-sniff'

const png = (...tail: number[]) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...tail])
const jpeg = (...tail: number[]) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...tail])

/** "RIFF" + 4 size bytes + a 4-byte form type. */
const riff = (form: string) =>
  new Uint8Array([
    0x52, 0x49, 0x46, 0x46,
    0x00, 0x00, 0x00, 0x00,
    ...[...form].map((c) => c.charCodeAt(0)),
  ])

describe('sniffImageType', () => {
  it('recognises PNG, JPEG and WebP', () => {
    expect(sniffImageType(png())).toBe('image/png')
    expect(sniffImageType(jpeg())).toBe('image/jpeg')
    expect(sniffImageType(riff('WEBP'))).toBe('image/webp')
  })

  it('rejects a text file', () => {
    const text = new TextEncoder().encode('this is definitely not a png')
    expect(sniffImageType(text)).toBeNull()
  })

  it('rejects a RIFF container that is NOT WebP', () => {
    // "RIFF" alone is shared by .wav, .avi and .ani. Checking only the first
    // four bytes would admit an audio file while LOOKING like a real signature
    // check, which is the worst of both.
    expect(sniffImageType(riff('WAVE'))).toBeNull()
    expect(sniffImageType(riff('AVI '))).toBeNull()
  })

  it('rejects a near-miss PNG header rather than accepting the prefix', () => {
    const almost = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x00])
    expect(sniffImageType(almost)).toBeNull()
  })

  it('returns null for a truncated buffer instead of throwing', () => {
    expect(sniffImageType(new Uint8Array([]))).toBeNull()
    expect(sniffImageType(new Uint8Array([0x89, 0x50]))).toBeNull()
    // Long enough for "RIFF", too short to carry the form type at offset 8.
    expect(sniffImageType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0]))).toBeNull()
  })
})

describe('verifyImageUpload', () => {
  it('accepts bytes that match the declared type', () => {
    expect(verifyImageUpload(png(), 'image/png')).toEqual({ ok: true, type: 'image/png' })
  })

  it('REJECTS a text file renamed to .png', () => {
    // The whole reason this module exists. `file.type` on a browser File is
    // derived from the filename extension, so renaming payload.txt to
    // avatar.png is enough to make the client declare image/png.
    const text = new TextEncoder().encode('nope')
    const out = verifyImageUpload(text, 'image/png')
    expect(out.ok).toBe(false)
  })

  it('rejects real image bytes whose declared type is a different image type', () => {
    // Storing a PNG with a Content-Type of image/webp sets up a sniffing
    // mismatch downstream. Agreement is cheap to require.
    const out = verifyImageUpload(png(), 'image/webp')
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('image/png')
  })

  it('explains the refusal in terms a person can act on', () => {
    const out = verifyImageUpload(new TextEncoder().encode('x'), 'image/png')
    if (!out.ok) expect(out.reason.length).toBeGreaterThan(10)
  })
})
