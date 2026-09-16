/**
 * Bio rules, shared by the account panel (client) and `saveBio` (server).
 * Pure; no Prisma.
 */
export const BIO_MAX_LENGTH = 160

export type BioCheck = { ok: true; bio: string | null } | { ok: false; reason: 'too_long' }

/**
 * One line, trimmed, internal whitespace collapsed. Empty becomes null —
 * "no bio" is a state, not an empty string to render.
 */
export function checkBio(raw: string): BioCheck {
  const bio = raw.replace(/\s+/g, ' ').trim()
  if (bio.length > BIO_MAX_LENGTH) return { ok: false, reason: 'too_long' }
  return { ok: true, bio: bio.length === 0 ? null : bio }
}
