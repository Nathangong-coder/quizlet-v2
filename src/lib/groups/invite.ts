import { randomBytes } from 'node:crypto'

/**
 * Invite codes: the bearer secret in a group's join link.
 *
 * 16 characters of a 32-symbol alphabet (no 0/O/1/I, so a code read aloud or
 * off a screenshot survives) is 80 bits — unguessable, and short enough to
 * type. Rotating the code is the owner's revocation: the old link 404s.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const INVITE_CODE_LENGTH = 16
export const INVITE_CODE_PATTERN = new RegExp(`^[${ALPHABET}]{${INVITE_CODE_LENGTH}}$`)

export function generateInviteCode(): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH)
  let out = ''
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length]
  return out
}

/** Reject anything that is not shaped like a code before it reaches a query. */
export function isInviteCode(v: string): boolean {
  return INVITE_CODE_PATTERN.test(v)
}

export function inviteUrl(code: string, origin: string): string {
  return `${origin}/groups/join/${code}`
}
