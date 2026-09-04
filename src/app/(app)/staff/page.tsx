import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffOverview } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from './StaffNav'

/**
 * The engine at a glance.
 *
 * notFound() — a real 404 — for anyone below staff, never a redirect and never
 * a "you are not allowed" message: someone who should not know this route
 * exists must not learn that it does. Same posture as /concepts.
 */
export default async function StaffPage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const o = await loadStaffOverview()

  const tiles: { label: string; value: number; hint?: string }[] = [
    { label: 'Live key points', value: o.liveKlps },
    { label: 'Superseded', value: o.supersededKlps, hint: 'kept — history stays truthful' },
    { label: 'Cards awaiting extraction', value: o.cardsByKlpStatus.pending ?? 0 },
    { label: 'Cards extracted', value: o.cardsByKlpStatus.ready ?? 0 },
    { label: 'Extraction failures', value: o.cardsByKlpStatus.failed ?? 0 },
    { label: 'Learners with evidence', value: o.learnersWithEvidence },
    { label: 'Sets', value: o.sets },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Engine</h1>
        <p className="text-sm text-muted-foreground">
          What the extraction, mastery and diagnosis passes have actually produced.
        </p>
      </div>

      <StaffNav isAdmin={isAdmin(staff.role)} />

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border p-4">
            <dt className="text-xs text-muted-foreground">{t.label}</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{t.value}</dd>
            {t.hint && <p className="mt-1 text-[11px] text-muted-foreground">{t.hint}</p>}
          </div>
        ))}
      </dl>
    </div>
  )
}
