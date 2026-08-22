import { createHash, randomBytes } from 'node:crypto'
import type { Prisma } from '@prisma/client'

/**
 * The only place raw bearer tokens are generated, hashed, minted, or consumed.
 *
 * A token in a database is a bearer credential exactly like a password, so
 * nothing here ever persists a raw value — only sha256(purpose + ':' + raw).
 */

/**
 * The closed vocabulary for `UserToken.purpose`.
 *
 * A `String` column plus a shared `as const`, following
 * `src/lib/cards/klp-status.ts`; this schema has no Prisma enums.
 */
export const TOKEN_PURPOSES = ['password_reset', 'email_verify'] as const

export type TokenPurpose = (typeof TOKEN_PURPOSES)[number]

/** Reset is short because a live reset link is an account takeover waiting to happen. */
export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  password_reset: 60 * 60 * 1000, // 1 hour
  email_verify: 24 * 60 * 60 * 1000, // 24 hours
}

/**
 * 32 bytes from a CSPRNG, base64url.
 *
 * base64url specifically — the value goes into a URL path segment, and
 * standard base64's `+` and `/` would need escaping that a mail client's link
 * detection will get wrong. Not a UUID: a v4 UUID is 122 bits and some
 * generators are not cryptographically seeded.
 */
export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * sha256(`${purpose}:${raw}`), hex.
 *
 * Fast on purpose: the input is already 256 bits of CSPRNG output, so slow
 * hashing buys nothing and costs a request.
 *
 * WHY THE PURPOSE IS INSIDE THE HASH. The alternative is a `purpose` clause in
 * every `where`, which is a guard someone can forget. Binding it in means the
 * same raw string produces two different stored values, so a verification
 * token *cannot* be presented at the reset endpoint even if every query filter
 * is dropped. It costs about twenty characters and removes a whole class of
 * confused-deputy bug.
 */
export function hashToken(purpose: TokenPurpose, raw: string): string {
  return createHash('sha256').update(`${purpose}:${raw}`).digest('hex')
}

export function expiresAtFor(purpose: TokenPurpose, now: Date = new Date()): Date {
  return new Date(now.getTime() + TOKEN_TTL_MS[purpose])
}

/**
 * Structural, so the same functions work against `prisma` and against a `tx`
 * inside `prisma.$transaction`. A type-only import — nothing from Prisma
 * exists at runtime in this module.
 */
export type TokenDb = Pick<Prisma.TransactionClient, 'userToken'>

/** Kill every outstanding token of one purpose for one user. */
export async function invalidateTokens(
  db: TokenDb,
  input: { userId: string; purpose: TokenPurpose },
): Promise<void> {
  await db.userToken.updateMany({
    where: { userId: input.userId, purpose: input.purpose, usedAt: null },
    data: { usedAt: new Date() },
  })
}

/**
 * Mint a token and return the RAW value — the only moment it exists outside a
 * URL. Minting invalidates the user's other outstanding tokens of the same
 * purpose, so a second "resend" does not leave the first link live.
 */
export async function mintToken(
  db: TokenDb,
  input: { userId: string; purpose: TokenPurpose },
): Promise<string> {
  await invalidateTokens(db, input)
  const raw = generateRawToken()
  await db.userToken.create({
    data: {
      userId: input.userId,
      purpose: input.purpose,
      tokenHash: hashToken(input.purpose, raw),
      expiresAt: expiresAtFor(input.purpose),
    },
  })
  return raw
}

/**
 * Is this token currently valid? Reads only.
 *
 * Exists so `/reset/[token]` can render a form on GET without burning the
 * token — the POST is what consumes it.
 */
export async function peekToken(
  db: TokenDb,
  input: { purpose: TokenPurpose; raw: string },
): Promise<boolean> {
  const row = await db.userToken.findUnique({
    where: { tokenHash: hashToken(input.purpose, input.raw) },
    select: { usedAt: true, expiresAt: true },
  })
  if (!row) return false
  if (row.usedAt) return false
  return row.expiresAt.getTime() > Date.now()
}

export type ConsumeResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'invalid_or_expired' }

/**
 * Claim a token, atomically. THE SINGLE MOST IMPORTANT GUARD IN THIS FEATURE.
 *
 * NOT findFirst-then-update. Two concurrent clicks on the same emailed link
 * would both read `usedAt: null` and both succeed. One conditional update
 * asserting `count === 1` cannot be raced: Postgres serialises the row.
 *
 * The `findUnique` afterwards is safe precisely BECAUSE the claim already
 * fired — this caller now owns the row, so reading its userId is not a
 * check-then-act.
 */
export async function consumeToken(
  db: TokenDb,
  input: { purpose: TokenPurpose; raw: string },
): Promise<ConsumeResult> {
  const tokenHash = hashToken(input.purpose, input.raw)
  const { count } = await db.userToken.updateMany({
    where: {
      tokenHash,
      purpose: input.purpose,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  })
  if (count !== 1) return { ok: false, reason: 'invalid_or_expired' }

  const row = await db.userToken.findUnique({ where: { tokenHash }, select: { userId: true } })
  if (!row) return { ok: false, reason: 'invalid_or_expired' }
  return { ok: true, userId: row.userId }
}
