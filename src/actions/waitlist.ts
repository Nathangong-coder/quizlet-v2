'use server'

/**
 * Minting an invite for a waitlist request. Admin only; gated in the body
 * because every export of a 'use server' module is an RPC endpoint.
 */
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/staff/access'
import { inviteRequestTx } from '@/lib/demo/waitlist'
import { formatInviteCode } from '@/lib/invites/code'
import { sendInviteEmail } from '@/lib/mail/send'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }
const ALREADY: ActionResult<never> = { success: false, error: 'Already invited' }

export async function inviteFromWaitlist(
  requestId: string,
): Promise<ActionResult<{ code: string; emailed: boolean }>> {
  if (!(await requireAdmin())) return NOT_FOUND
  if (typeof requestId !== 'string' || requestId === '') return NOT_FOUND

  // Mint and stamp in one transaction; a concurrent invite loses the
  // conditional stamp and its code is rolled back (see inviteRequestTx).
  const result = await inviteRequestTx(requestId)
  if (result === 'not_found') return NOT_FOUND
  if (result === 'already_invited') return ALREADY

  const formatted = formatInviteCode(result.code)
  const emailed = await sendInviteEmail(result.email, formatted)

  revalidatePath('/staff/waitlist')
  return { success: true, data: { code: formatted, emailed } }
}
