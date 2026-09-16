'use server'

import { revalidatePath } from 'next/cache'
import { requireSetKltAccess } from '@/lib/klt/access'
import { buildSetStep, setBuildStatus, type SetBuildStatus, type SetBuildStep } from '@/lib/klp/build-set'
import type { ActionResult } from '@/types/action'

/**
 * The owner's "build key points" endpoints (2026-09-16). Both are gated by
 * `requireSetKltAccess` — the set's owner, or an admin — because a step
 * SPENDS the caller's AI budget on the set's cards: the calls run on the
 * session user's credentials and lent keys, never on the owner's when an
 * admin presses the button. Reads and writes of the tree itself stay in
 * `klt-tree.ts`; this file only advances the pipeline.
 */
export async function getSetBuildStatus(setId: string): Promise<ActionResult<SetBuildStatus>> {
  const access = await requireSetKltAccess(setId)
  if (!access) return { success: false, error: 'Not found' }
  return { success: true, data: await setBuildStatus(access.setId) }
}

export async function runSetBuildStep(setId: string): Promise<ActionResult<SetBuildStep>> {
  const access = await requireSetKltAccess(setId)
  if (!access) return { success: false, error: 'Not found' }
  const step = await buildSetStep(access.userId, access.setId)
  if (step.did === 'rebuild' || step.status.ready) {
    revalidatePath(`/sets/${access.setId}`)
    revalidatePath(`/sets/${access.setId}/concepts`)
  }
  return { success: true, data: step }
}
