'use server'

/**
 * Minting an invite for a waitlist request. Admin only; gated in the body
 * because every export of a 'use server' module is an RPC endpoint.
 */
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/staff/access'
import { mintInvite } from '@/lib/invites/mint'
import { formatInviteCode } from '@/lib/invites/code'
import { sendInviteEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }
const ALREADY: ActionResult<never> = { success: false, error: 'Already invited' }

class AlreadyInvited extends Error {}

export async function inviteFromWaitlist(
  requestId: string,
): Promise<ActionResult<{ code: string; emailed: boolean }>> {
  if (!(await requireAdmin())) return NOT_FOUND
  if (typeof requestId !== 'string' || requestId === '') return NOT_FOUND

  const request = await prisma.inviteRequest.findUnique({
    where: { id: requestId },
    select: { id: true, email: true, invitedAt: true },
  })
  if (!request) return NOT_FOUND
  if (request.invitedAt) return ALREADY

  let code: string
  try {
    // Mint and stamp in one transaction. The stamp is conditional on
    // invitedAt still being null, so a double click loses the race here and
    // the throw rolls its freshly minted code back: no orphan code.
    code = await prisma.$transaction(async (tx) => {
      const minted = await mintInvite(
        { uses: 1, days: 14, label: `waitlist: ${request.email}` },
        tx,
      )
      const { count } = await tx.inviteRequest.updateMany({
        where: { id: request.id, invitedAt: null },
        data: { invitedAt: new Date(), inviteCode: minted.code },
      })
      if (count === 0) throw new AlreadyInvited()
      return minted.code
    })
  } catch (error) {
    if (error instanceof AlreadyInvited) return ALREADY
    throw error
  }

  const formatted = formatInviteCode(code)
  const sent = await sendInviteEmail(request.email, formatted)
  const emailed = sent && Boolean(process.env.RESEND_API_KEY?.trim())

  revalidatePath('/staff/waitlist')
  return { success: true, data: { code: formatted, emailed } }
}
