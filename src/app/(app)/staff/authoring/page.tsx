import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/staff/access'
import { loadAuthoringRuns, loadAuthoringByModel } from '@/lib/staff/queries'
import { StaffNav } from '../StaffNav'

/**
 * Every KLP authoring run, per card.
 *
 * ADMIN ONLY, like the rest of /staff.
 *
 * The by-model summary on the AI history page answers "which model authored
 * well". It cannot answer "which cards were authored", and it actively hides
 * one thing worth seeing: a card authored three times counts three times
 * there, while only the run at the card's CURRENT klpVersion still backs any
 * live key point. On 2026-09-06, 43 of 95 runs on one set were redundant —
 * four concurrent processes re-authoring each other's work — and the aggregate
 * looked like healthy progress throughout. The `current` column is what makes
 * that visible.
 */
export default async function StaffAuthoringPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string }>
}) {
  const admin = await requireAdmin()
  if (!admin) notFound()

  const params = await searchParams
  const [runs, byModel] = await Promise.all([
    loadAuthoringRuns(params.set),
    loadAuthoringByModel(),
  ])

  const superseded = runs.filter((r) => !r.isCurrent).length
  const sets = [...new Map(runs.map((r) => [r.setId, r.setTitle])).entries()]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">KLP authoring runs</h1>
      <StaffNav isAdmin />

      <p className="max-w-prose text-sm leading-6 text-muted-foreground">
        One row per <strong>run</strong>, not per card. A card can be authored more than once —
        by a re-run, or because the legacy extractor superseded it afterwards — and only the run
        at the card&rsquo;s current version still backs live key points. Rows marked{' '}
        <span className="font-medium text-muted-foreground">superseded</span> did real work that
        nothing now depends on.
      </p>

      {runs.length === 0 ? (
        <p className="py-8 text-sm text-muted-foreground">
          No authoring runs recorded{params.set ? ' for this set' : ''} yet. Run{' '}
          <code>npm run author-klps -- --set &lt;id&gt; --direct</code>.
        </p>
      ) : (
        <>
          <section className="flex flex-wrap gap-4 text-sm">
            <Stat label="Runs" value={String(runs.length)} />
            <Stat label="Distinct cards" value={String(new Set(runs.map((r) => r.cardId)).size)} />
            <Stat
              label="Superseded"
              value={String(superseded)}
              tone={superseded > 0 ? 'warn' : undefined}
              hint="Runs whose version is no longer the card's current one — wasted budget."
            />
            <Stat
              label="Low discrimination"
              value={String(runs.filter((r) => r.status === 'low_discrimination').length)}
              hint="Authored anyway and flagged, rather than retried until it looked clean. That flag is the point of the loop."
            />
          </section>

          {sets.length > 1 && (
            <nav aria-label="Sets" className="flex flex-wrap gap-2 text-sm">
              <Link
                href="/staff/authoring"
                className={`rounded-md border px-3 py-1 ${!params.set ? 'border-primary font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
              >
                All sets
              </Link>
              {sets.map(([id, title]) => (
                <Link
                  key={id}
                  href={`/staff/authoring?set=${id}`}
                  className={`rounded-md border px-3 py-1 ${params.set === id ? 'border-primary font-medium' : 'border-border text-muted-foreground hover:bg-muted'}`}
                >
                  {title}
                </Link>
              ))}
            </nav>
          )}

          <section className="space-y-2">
            <h2 className="text-sm font-medium">By model</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-normal">Model</th>
                    <th className="pb-2 text-right font-normal">Runs</th>
                    <th className="pb-2 text-right font-normal">Mean separation</th>
                    <th className="pb-2 text-right font-normal">Low discrimination</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((m) => (
                    <tr key={m.model} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">{m.model}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{m.cards}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {m.meanSeparation === null ? '—' : m.meanSeparation.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {m.lowDiscrimination}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-2">
            <h2 className="text-sm font-medium">Every run</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left align-bottom text-muted-foreground">
                    <th className="pb-2 font-normal">Card</th>
                    <th className="pb-2 font-normal">Set</th>
                    <th className="pb-2 font-normal">Model</th>
                    <th className="pb-2 text-right font-normal">Separation</th>
                    <th className="pb-2 font-normal">Status</th>
                    <th className="pb-2 text-right font-normal">v</th>
                    <th className="pb-2 text-right font-normal">Live KLPs</th>
                    <th className="pb-2 text-right font-normal">Revisions</th>
                    <th className="pb-2 font-normal">When</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className={`border-b last:border-0 ${r.isCurrent ? '' : 'opacity-55'}`}
                    >
                      <td className="max-w-[22rem] py-2 pr-4">
                        <span className="line-clamp-2">{r.cardTerm}</span>
                        {!r.isCurrent && (
                          <span
                            className="ml-1 text-[11px] text-amber-600 dark:text-amber-400"
                            title="This run's version is no longer the card's current one, so nothing live depends on it."
                          >
                            superseded
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">{r.setTitle}</td>
                      <td className="py-2 pr-4 font-mono text-xs">
                        {r.model ?? (
                          <span title="Run predates model attribution (before 2026-09-06).">&mdash;</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">
                        {r.separationScore.toFixed(2)}
                      </td>
                      <td className="py-2 pr-4">
                        {r.status === 'low_discrimination' ? (
                          <span className="text-amber-600 dark:text-amber-400">{r.status}</span>
                        ) : (
                          <span className="text-muted-foreground">{r.status}</span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.klpVersion}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.liveKlps}</td>
                      <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.revisions}</td>
                      <td className="py-2 pr-4 text-xs text-muted-foreground">
                        {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string
  value: string
  tone?: 'warn'
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border px-4 py-3" title={hint}>
      <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-xl font-semibold tabular-nums ${tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : ''}`}
      >
        {value}
      </p>
    </div>
  )
}
