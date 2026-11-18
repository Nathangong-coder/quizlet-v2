// Server-only: mints one InviteCode row. Shared by `npm run invite` and the
// admin waitlist action so both write codes the same way.
import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'
import { generateInviteCode } from './code'

/** The slice of a Prisma client (or transaction client) minting needs. */
export type InviteDb = {
  inviteCode: { create: (args: { data: Prisma.InviteCodeUncheckedCreateInput }) => PromiseLike<unknown> }
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Create an invite code and return it in its normalised (hyphen-free) form.
 * Pass a transaction client as `db` to make the mint part of a larger write.
 */
export async function mintInvite(
  input: { uses: number; days?: number; label?: string | null },
  db: InviteDb = prisma,
): Promise<{ code: string }> {
  const code = generateInviteCode()
  await db.inviteCode.create({
    data: {
      code,
      label: input.label ?? null,
      maxUses: input.uses,
      // Both counters start equal; maxUses never moves again, so
      // `maxUses - usesRemaining` is always the used count.
      usesRemaining: input.uses,
      expiresAt: input.days === undefined ? null : new Date(Date.now() + input.days * DAY_MS),
    },
  })
  return { code }
}
