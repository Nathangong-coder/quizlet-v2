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
      <p className="text-sm text-muted-foreground">
        Every account, whether or not they have studied anything yet &mdash;{' '}
        {learners.length} total, {learners.filter((l) => l.active).length} active,{' '}
        {learners.filter((l) => l.klpStates > 0).length} with measured knowledge.{' '}
        <span className="text-xs">
          Active means activity in the last year. The app has not been live that long, so every
          inactive account today is one that has never studied at all.
        </span>
      </p>

      {learners.length === 0 ? (
        <p className="text-sm text-muted-foreground">No accounts yet.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {learners.map((l) => (
            <li key={l.userId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 p-3">
              <div className="min-w-0">
                <Link href={`/staff/learners/${l.userId}`} className="font-medium hover:underline">
                  {l.label}
                </Link>
                {/* The email is shown whenever it is not already the label, so a
                    row can be found by either identity. Staff searching for a
                    person know one or the other, rarely both. */}
                {l.email && l.email !== l.label && (
                  <span className="ml-2 text-xs text-muted-foreground">{l.email}</span>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span
                    className={
                      l.active
                        ? 'rounded border border-emerald-600/40 px-1.5 font-mono text-emerald-600 dark:text-emerald-400'
                        : 'rounded border px-1.5 font-mono'
                    }
                    title={
                      l.lastActiveAt
                        ? `Last activity ${l.lastActiveAt.toISOString().slice(0, 10)}`
                        : 'Has never answered anything'
                    }
                  >
                    {l.active ? 'active' : 'inactive'}
                  </span>
                  <span className="font-mono">{l.signIn}</span>
                  {l.role !== 'learner' && (
                    <span className="rounded border px-1.5 font-mono">{l.role}</span>
                  )}
                  {l.handle && l.handle !== l.label && <span>@{l.handle}</span>}
                </div>
              </div>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {/* "0 key points measured" reads as a measurement that came back
                    zero. It is not — nothing has been measured at all, and those
                    are different claims about the same person. */}
                {l.klpStates > 0
                  ? `${l.klpStates} key points measured`
                  : l.answers > 0
                    ? `${l.answers} answers, nothing measured yet`
                    : 'no activity yet'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
