import { randomBytes } from 'node:crypto'

/**
 * Crockford Base32 — no I, L, O or U.
 *
 * I/L look like 1, O looks like 0, and U is excluded so a random draw cannot
 * spell something unfortunate. 5 bits per symbol.
 */
export const INVITE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** 10 symbols x 5 bits = 50 bits. */
export const INVITE_CODE_LENGTH = 10

/**
 * A fresh code in its normalised (hyphen-free) form.
 *
 * No rejection sampling is needed and its absence is not an oversight: the
 * alphabet is exactly 32 symbols and 256 % 32 === 0, so `byte % 32` is already
 * uniform over the alphabet. With a non-power-of-two alphabet this would be
 * biased and would need a redraw loop.
 */
export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let out = ''
  for (const byte of bytes) out += INVITE_ALPHABET[byte % INVITE_ALPHABET.length]
  return out
}

/**
 * Crockford's decoding rules, so a code survives being read aloud, written
 * down, or typed with the hyphen the display form adds.
 *
 * Order matters: uppercase first, THEN substitute the ambiguous characters
 * (so lowercase `l` and `o` are covered by the same two rules), THEN drop
 * everything still outside the alphabet. Dropping first would delete the very
 * characters the substitution exists to rescue.
 */
export function normalizeInviteCode(raw: string): string {
  const upper = raw.toUpperCase()
  const substituted = upper.replace(/[IL]/g, '1').replace(/O/g, '0')
  let out = ''
  for (const ch of substituted) {
    if (INVITE_ALPHABET.includes(ch)) out += ch
  }
  return out
}

/** Display only. `XXXXX-XXXXX` is easier to read back over a phone. */
export function formatInviteCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)}-${code.slice(half)}`
}
