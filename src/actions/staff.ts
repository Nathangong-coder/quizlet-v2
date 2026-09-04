'use server'

/**
 * The staff surface's server actions.
 *
 * EVERY export here is a callable RPC endpoint, not only the ones a page
 * imports — the finding tests/actions/klt-gated-exports-guard.test.ts exists to
 * enforce. So every export calls a gate in its OWN body, no helper is exported
 * for reuse (shared internals live in src/lib/staff/queries.ts, a plain
 * module), and nothing is re-exported by name.
 */
import { requireStaff } from '@/lib/staff/access'
import {
  loadStaffKlps,
  loadStaffCoverage,
  loadStaffOverview,
  loadLearnerIndex,
  type StaffKlpRow,
  type StaffKlpQuery,
  type StaffCoverageRow,
  type StaffOverview,
} from '@/lib/staff/queries'
import type { ActionResult } from '@/types/action'

const NOT_FOUND: ActionResult<never> = { success: false, error: 'Not found' }

export async function listStaffKlps(input: StaffKlpQuery): Promise<ActionResult<StaffKlpRow[]>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffKlps(input ?? {}) }
}

export async function listStaffCoverage(): Promise<ActionResult<StaffCoverageRow[]>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffCoverage() }
}

export async function listStaffOverview(): Promise<ActionResult<StaffOverview>> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadStaffOverview() }
}

export async function listStaffLearners(): Promise<
  ActionResult<Awaited<ReturnType<typeof loadLearnerIndex>>>
> {
  if (!(await requireStaff())) return NOT_FOUND
  return { success: true, data: await loadLearnerIndex() }
}
