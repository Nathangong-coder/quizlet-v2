import Link from 'next/link'
import type { StaffKlpRow } from '@/lib/staff/queries'

/**
 * Every key point, with the evidence standing behind it.
 *
 * TWO COLUMNS SHIP DELIBERATELY THIN. `Relations` is empty until Spec 3 and
 * renders an em dash; `Verdicts` reads whatever statuses exist rather than a
 * hardcoded three, so Spec 5's widening to thirteen labels needs no change
 * here. A column added later would move every other column and re-open layout
 * decisions already made — which is the whole reason this page is built first.
 */
export function KlpTable({ rows }: { rows: StaffKlpRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-sm text-muted-foreground">
        No key points match. A set whose cards are all still <code>pending</code> has none yet —
        check Coverage.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left align-bottom">
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Key point</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Card</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Kind</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Weight</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Topics</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Learners</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Mean known</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Verdicts</th>
            <th scope="col" className="pb-2 font-normal text-muted-foreground">Relations</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0 align-top">
              <td className="py-2 pr-4 max-w-xs">
                <span title={r.text}>{r.label ?? r.text}</span>
                {r.supersededAt && (
                  <span className="ml-2 rounded bg-muted px-1 text-[10px] uppercase tracking-wide">
                    superseded
                  </span>
                )}
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">v{r.version}</span>
              </td>
              <td className="py-2 pr-4">
                <Link href={`/sets/${r.setId}/edit`} className="hover:underline">
                  {r.cardTerm}
                </Link>
              </td>
              <td className="py-2 pr-4 text-muted-foreground">{r.kind}</td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.weight}</td>
              <td className="py-2 pr-4 text-muted-foreground">
                {r.topics.length === 0
                  ? '—'
                  : r.topics
                      .slice()
                      .sort((a, b) => a.rank - b.rank)
                      .map((t) => t.name)
                      .join(', ')}
              </td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">{r.learnerCount}</td>
              <td className="py-2 pr-4 text-right font-mono tabular-nums">
                {/* Null is NO EVIDENCE. 0% would read as "nobody knows this",
                    which is a different and much stronger claim. */}
                {r.meanPKnown === null ? '—' : `${Math.round(r.meanPKnown * 100)}%`}
              </td>
              <td className="py-2 pr-4 text-xs text-muted-foreground">
                {Object.keys(r.verdicts).length === 0
                  ? '—'
                  : Object.entries(r.verdicts)
                      .sort((a, b) => b[1] - a[1])
                      .map(([status, n]) => `${status} ${n}`)
                      .join(' · ')}
              </td>
              <td className="py-2 text-xs text-muted-foreground" title="Filled by Spec 3 — relations">
                —
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
