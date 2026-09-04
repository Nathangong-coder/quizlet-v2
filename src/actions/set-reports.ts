'use server'

import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { revalidatePath } from 'next/cache'
import { requireAdmin } from '@/lib/staff/access'
import { toReportReason, REPORT_DETAIL_MAX } from '@/lib/sets/moderation'
import { composeSetWhere } from '@/lib/sets/visibility'
import type { ActionResult } from '@/types/action'

/**
 * Report a PUBLIC set.
 *
 * Only public sets are reportable: a link-shared set was handed to you
 * personally, and a report queue that accepts them turns a private share into
 * something an operator reviews.
 *
 * Idempotent by `@@unique([setId, reporterId])`, so the button cannot be used
 * to flood the table. A second report from the same person UPDATES their
 * existing row rather than erroring — the reporter should not be told "you
 * already did that" and left unsure whether it registered.
 */
export async function reportSet(
  setId: string,
  reason: string,
  detail?: string,
): Promise<ActionResult<void>> {
  try {
    const session = await auth()
    if (!session?.user?.id) return { success: false, error: 'Authentication required' }

    const parsed = toReportReason(reason)
    if (parsed === null) return { success: false, error: 'Unrecognised report reason' }

    // `{ visibility: 'public' }` rather than `listableSetWhere()`, which also
    // requires `listingBlocked: false`.
    //
    // The difference is whether an ALREADY-UNLISTED set stays reportable, and
    // it must. Unlisting is not always the end of the matter — for spam it is,
    // for content that should never have been hosted it is only the first
    // step. The count of people who reported a set AFTER an operator acted is
    // precisely the signal that says the action taken was not enough, and
    // gating on `listingBlocked` throws that signal away to save a duplicate
    // row that `@@unique([setId, reporterId])` already prevents.
    //
    // Still composed and never hand-rolled — the reporter must be someone who
    // can actually read the set.
    const set = await prisma.set.findFirst({
      where: {
        AND: [{ id: setId }, composeSetWhere(session.user.id, { visibility: 'public' })],
      },
      select: { id: true },
    })
    if (!set) return { success: false, error: 'Set not found' }

    // Trim BEFORE truncating, so 2000 spaces followed by nothing is stored as
    // no detail rather than as a wall of whitespace an operator has to scroll.
    const trimmed = detail?.trim().slice(0, REPORT_DETAIL_MAX) || null

    await prisma.setReport.upsert({
      where: { setId_reporterId: { setId: set.id, reporterId: session.user.id } },
      create: {
        setId: set.id,
        reporterId: session.user.id,
        reason: parsed,
        detail: trimmed,
      },
      // `status` is reset to 'open' on a re-report on purpose: a set an
      // operator already dismissed, reported again with a new reason, is a new
      // decision to make and not a settled one.
      update: { reason: parsed, detail: trimmed, status: 'open' },
    })

    return { success: true, data: undefined }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}

/**
 * Unlist (or relist) a set. OPERATOR ONLY.
 *
 * Writes `Set.listingBlocked`, NOT `Set.visibility`. Spec §10: visibility is
 * something the owner can change back in one click and silently, so it cannot
 * carry a decision made ABOUT the owner. A separate column makes the decision
 * stick and makes it visible to the owner on their own set page.
 *
 * The set stays READABLE by anyone holding its id. Moderation removes it from
 * the shop window; it does not retroactively break every link already shared.
 *
 * Gated by `requireAdmin` — the admin role, which already has the right
 * posture: an unrecognised or absent role means NOBODY, never everybody.
 */
export async function setListingBlocked(
  setId: string,
  blocked: boolean,
): Promise<ActionResult<void>> {
  try {
    // Not-found rather than forbidden, for the same reason every read path
    // 404s: a distinguishable error tells a stranger the operator gate exists.
    if (!(await requireAdmin())) return { success: false, error: 'Not found' }

    // `updateMany`, not `update`. `update` throws P2025 on a missing row, and
    // the catch below would surface Prisma's own message — which names the
    // model and the constraint — to whoever called this.
    const updated = await prisma.set.updateMany({
      where: { id: setId },
      data: { listingBlocked: blocked },
    })
    if (updated.count === 0) return { success: false, error: 'Not found' }

    revalidatePath('/browse')
    revalidatePath(`/sets/${setId}`)
    return { success: true, data: undefined }
  } catch (error) {
    return { success: false, error: (error as Error).message }
  }
}
