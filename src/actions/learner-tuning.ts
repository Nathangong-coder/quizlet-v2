'use server'

import { auth } from '@/auth'
import { revalidatePath } from 'next/cache'
import type { ActionResult } from '@/types/action'
import {
  BandOverridesSchema, ThresholdOverridesSchema, parseStrategy, shapeTuning,
  TUNING_VERSION, type BandOverrides, type ThresholdOverrides, type TuningRow,
} from '@/lib/tuning/schema'

export async function loadTuning(): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }

  const { prisma } = await import('@/lib/db')
  const row = await prisma.learnerTuning.findUnique({
    where: { userId: session.user.id },
    select: { strategy: true, bands: true, thresholds: true, studyScope: true },
  })
  // SPARSE, deliberately: the panel shows "your override" next to "the shipped
  // default", so it needs to know which keys the learner actually edited.
  // `getUserTuning` is the resolved-table reader for the scoring paths.
  return { success: true, data: shapeTuning(row) }
}

/**
 * PARTIAL by design (spec §5). An ABSENT field means "leave unchanged"; a
 * present one is written. Three panels edit this one row, and a
 * write-all-three action forces each panel to echo back values it read at
 * mount — so the ordinary sequence "change a threshold, change a band, save
 * both" reverts one of them. That bug is invisible to a single-panel test.
 *
 * `bandOverrides: {}` is NOT the same as absent: it is the global reset, and
 * it must stay expressible.
 */
export async function saveTuning(input: {
  strategy?: string
  bandOverrides?: unknown
  thresholdOverrides?: unknown
}): Promise<ActionResult<TuningRow>> {
  const session = await auth()
  if (!session?.user?.id) return { success: false, error: 'Not signed in' }
  const userId = session.user.id

  // Reject rather than salvage: a save is an explicit user act, so invalid
  // input must surface as an error instead of being silently discarded the way
  // a corrupt STORED blob is. Validate everything BEFORE writing anything.
  const data: {
    strategy?: string
    bands?: BandOverrides
    thresholds?: ThresholdOverrides
    version: number
  } = { version: TUNING_VERSION }

  if (input.bandOverrides !== undefined) {
    const bands = BandOverridesSchema.safeParse(input.bandOverrides)
    if (!bands.success) {
      return {
        success: false,
        error: 'Each band must be two whole numbers from 1 to 5, with the first no larger than the second.',
      }
    }
    data.bands = bands.data as BandOverrides
  }
  if (input.thresholdOverrides !== undefined) {
    const thresholds = ThresholdOverridesSchema.safeParse(input.thresholdOverrides)
    if (!thresholds.success) {
      return {
        success: false,
        error: 'Thresholds must be within range: evidence floor 1-50, articulation confidence 0-1, readiness weight above 0.',
      }
    }
    data.thresholds = thresholds.data as ThresholdOverrides
  }
  if (input.strategy !== undefined) data.strategy = parseStrategy(input.strategy)

  const { prisma } = await import('@/lib/db')
  // `create` needs the full row; `update` writes only the named fields, which
  // is what makes an absent field a no-op rather than a null.
  const row = await prisma.learnerTuning.upsert({
    where: { userId },
    create: {
      userId,
      strategy: data.strategy ?? 'balanced',
      bands: data.bands ?? {},
      thresholds: data.thresholds ?? {},
      version: TUNING_VERSION,
    },
    update: data,
    select: { strategy: true, bands: true, thresholds: true, studyScope: true },
  })

  revalidatePath('/settings/ai')
  // Returned from the ROW, not from the input, so the caller sees what the
  // other panels' fields actually hold rather than the blanks it sent.
  return { success: true, data: shapeTuning(row) }
}
