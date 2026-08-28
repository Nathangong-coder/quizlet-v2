import { buildGlyph, type GlyphNode } from '@/lib/sets/glyph'

/**
 * A user's mark, and which of the three sources supplies it.
 *
 * Pure. The precedence below is the part that breaks silently — an OAuth image
 * quietly winning over an uploaded one looks like the upload failed — so it is
 * a function with tests rather than a ternary inside a component.
 */

export interface AvatarGlyph {
  nodes: GlyphNode[]
  /** OKLCH hue, 0–360. */
  hue: number
}

export type ResolvedAvatar =
  | { kind: 'url'; url: string; source: 'upload' | 'oauth' }
  | { kind: 'glyph'; glyph: AvatarGlyph }

/** Hard cap. Larger is not a better avatar; it is a slower page. */
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/**
 * The only types accepted. Deliberately no SVG: an SVG is a script-bearing
 * document, and one served from a blob host and rendered in an <img> is a
 * needless XSS surface for a decorative 32px circle.
 */
export const AVATAR_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export type AvatarMimeType = (typeof AVATAR_MIME_TYPES)[number]

/** How many nodes an avatar glyph gets, independent of the set-glyph floor. */
const AVATAR_GLYPH_NODES = 5

/**
 * FNV-1a, the same mixer `glyph.ts` uses. Duplicated rather than exported from
 * there because it is four lines and exporting it would make an internal of a
 * working module part of its contract.
 */
function hash(seed: string): number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A user's generated mark: the set-glyph constellation plus a hue.
 *
 * THE HUE IS THE ONE DIFFERENCE FROM `SetGlyph`, and it is not decoration. A
 * set's glyph renders in `currentColor` because it always sits beside its own
 * title — the mark distinguishes, the title identifies. An avatar in the topbar
 * has no title next to it, so colour is doing identification work that nothing
 * else on screen is doing. Two users' constellations in one colour are far
 * harder to tell apart than two sets' are.
 *
 * A SEPARATE MODULE, not a parameter on `buildGlyph`: that function's
 * `categoryCount` has no meaning for a user, and threading a nullable count
 * through a working pure function to serve a second caller is how a readable
 * module stops being one.
 *
 * `>>> 8` before the modulo, because the low bits of an FNV-1a hash are the
 * least mixed — taking `% 360` off the raw value clusters hues for seeds that
 * share a suffix, and cuid()s share a great deal of structure.
 */
export function buildAvatarGlyph(seed: string): AvatarGlyph {
  return {
    nodes: buildGlyph(seed, AVATAR_GLYPH_NODES),
    hue: (hash(seed) >>> 8) % 360,
  }
}

/**
 * Which image to draw, in precedence order: the user's own upload, then the
 * OAuth profile picture, then the generated glyph.
 *
 * Upload beats OAuth because the upload is the only one of the two the user
 * actually chose. `image` is written by the Auth.js adapter from the GitHub
 * profile on every sign-in; if it won, uploading a photo would appear to work
 * and then revert on next sign-in, which is the failure this precedence exists
 * to prevent.
 *
 * Blank strings are treated as absent. An empty-string column is what a form
 * that submits an untouched field produces, and `''` is truthy enough to pass a
 * bare `avatarUrl ?? image` and then render a broken-image icon.
 */
export function resolveAvatar(input: {
  avatarUrl?: string | null
  image?: string | null
  seed: string
}): ResolvedAvatar {
  const uploaded = input.avatarUrl?.trim()
  if (uploaded) return { kind: 'url', url: uploaded, source: 'upload' }

  const oauth = input.image?.trim()
  if (oauth) return { kind: 'url', url: oauth, source: 'oauth' }

  return { kind: 'glyph', glyph: buildAvatarGlyph(input.seed) }
}
