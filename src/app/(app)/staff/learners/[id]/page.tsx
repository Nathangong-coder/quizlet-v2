import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadLearnerRecord } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../../StaffNav'

/**
 * One learner's engine record.
 *
 * An unknown id 404s rather than rendering an empty record — an empty page for
 * a real learner and an empty page for a typo would be indistinguishable.
 */
export default async function StaffLearnerPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const staff = await requireStaff()
  if (!staff) notFound()

  const { id } = await params
  const record = await loadLearnerRecord(id)
  if (!record) notFound()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{record.label}</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Analysed answers</h2>
        <p className="text-xs text-muted-foreground">
          Error rates need a denominator of <em>analysed</em> answers. Zero tags means
          &ldquo;clean&rdquo; only for the analysed ones.
        </p>
        <ul className="flex flex-wrap gap-3 text-sm">
          {Object.entries(record.analysisStatusCounts).map(([status, n]) => (
            <li key={status} className="rounded border px-2 py-1">
              <span className="font-mono">{status}</span>{' '}
              <span className="font-mono tabular-nums text-muted-foreground">{n}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Weakest key points</h2>
        <ul className="divide-y rounded-lg border">
          {record.weakest.map((w) => (
            <li key={w.klpId} className="flex items-baseline justify-between gap-4 p-3 text-sm">
              <span>{w.text}</span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {Math.round(w.pKnown * 100)}% · {w.observations} obs
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Recent answers</h2>
        <ul className="divide-y rounded-lg border">
          {record.recentAnswers.map((a) => (
            <li key={a.id} className="space-y-1 p-3 text-sm">
              <div className="flex items-baseline justify-between gap-4">
                <span className="font-medium">{a.cardTerm}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {a.mode} · {a.analysisStatus}
                </span>
              </div>
              {a.verdicts.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.verdicts.map((v) => `${v.status}: ${v.klpText}`).join(' · ')}
                </p>
              )}
              {a.tags.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {a.tags.map((t) => `${t.dimension}/${t.type} (${t.significance})`).join(' · ')}
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
