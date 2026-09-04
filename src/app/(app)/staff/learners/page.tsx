import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadLearnerIndex } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'

export default async function StaffLearnersPage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const learners = await loadLearnerIndex()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Learners</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />
      {learners.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody has answered anything yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {learners.map((l) => (
            <li key={l.userId} className="flex items-center justify-between gap-3 p-3">
              <Link href={`/staff/learners/${l.userId}`} className="font-medium hover:underline">
                {l.label}
              </Link>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {l.klpStates} key points measured
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
