import type { AvatarMimeType } from '@/lib/users/avatar'

/**
 * What a file ACTUALLY is, read from its first bytes.
 *
 * THE DECLARED CONTENT-TYPE IS NOT EVIDENCE. It is a string the client chose,
 * and on a `File` from an `<input type="file">` the browser derives it from the
 * filename extension — so renaming `payload.txt` to `avatar.png` is enough to
 * make `file.type` say `image/png`. Trusting it means the upload endpoint
 * accepts arbitrary bytes and hands back a public blob URL for them.
 *
 * Returns null for anything not recognised, including a buffer too short to
 * carry a header. Null is a refusal, never a default: a "probably fine" branch
 * here would reinstate exactly the trust this module exists to remove.
 */

/** \x89 P N G \r \n \x1a \n — the full 8-byte signature, not a prefix of it. */
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** SOI marker. Every JPEG variant (JFIF, Exif, raw) opens with these three. */
const JPEG = [0xff, 0xd8, 0xff]

/** "RIFF" at offset 0. */
const RIFF = [0x52, 0x49, 0x46, 0x46]

/** "WEBP" at offset 8. */
const WEBP = [0x57, 0x45, 0x42, 0x50]

function matchesAt(bytes: Uint8Array, offset: number, signature: number[]): boolean {
  if (bytes.length < offset + signature.length) return false
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false
  }
  return true
}

export function sniffImageType(bytes: Uint8Array): AvatarMimeType | null {
  if (matchesAt(bytes, 0, PNG)) return 'image/png'
  if (matchesAt(bytes, 0, JPEG)) return 'image/jpeg'
  // BOTH checks, and that is the whole point of this branch. "RIFF" alone is a
  // container marker shared by .wav, .avi and .ani; accepting it would let an
  // audio file through as an image while looking like a real signature check.
  if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) return 'image/webp'
  return null
}

/**
 * The upload gate: the bytes must be a supported image, AND must be the type
 * the client claimed.
 *
 * The second half is not redundant. Without it a client could declare
 * `image/webp` while uploading a PNG; the blob would then be stored and served
 * with a Content-Type that does not match its content, which is the setup for a
 * content-sniffing mismatch downstream. Agreement is cheap to require.
 */
export function verifyImageUpload(
  bytes: Uint8Array,
  declaredType: string,
): { ok: true; type: AvatarMimeType } | { ok: false; reason: string } {
  const actual = sniffImageType(bytes)
  if (actual === null) {
    return { ok: false, reason: 'That file is not a PNG, JPEG or WebP image.' }
  }
  if (actual !== declaredType) {
    return {
      ok: false,
      reason: `That file says it is ${declaredType} but its contents are ${actual}.`,
    }
  }
  return { ok: true, type: actual }
}
