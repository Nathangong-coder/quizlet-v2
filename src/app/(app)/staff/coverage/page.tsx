import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffCoverage } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'

/**
 * How much of the corpus the engine has actually seen.
 *
 * Audit finding G2 was that 166 of 291 cards had never been extracted, with
 * ZERO recorded failures, because extraction was demand-driven — a number
 * invisible from the code and from every existing screen. This page is where
 * Spec 2's backfill is watched.
 *
 * REPORTS ONLY. Retry controls are deliberately out of scope: retryKlpExtraction
 * is owner-scoped, making it staff-callable across other people's sets is a
 * write capability, and Spec 2 changes how extraction works anyway.
 *
 * klpStatus and kltStatus get SEPARATE columns because the two passes fail
 * independently — a card can have good key points and no topics. One merged
 * column would offer the wrong retry for the wrong failure.
 */
export default async function StaffCoveragePage() {
  const staff = await requireStaff()
  if (!staff) notFound()

  const rows = await loadStaffCoverage()
  const totals = rows.reduce(
    (acc, r) => ({
      cards: acc.cards + r.total,
      ready: acc.ready + (r.byKlpStatus.ready ?? 0),
    }),
    { cards: 0, ready: 0 },
  )

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Coverage</h1>
        <p className="text-sm text-muted-foreground">
          {totals.ready} of {totals.cards} cards have key points
          {totals.cards > 0 && ` — ${Math.round((totals.ready / totals.cards) * 100)}%`}.
        </p>
      </div>

      <StaffNav isAdmin={isAdmin(staff.role)} />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left">
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Set</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Owner</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Key points</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground text-right">Topics</th>
              <th scope="col" className="pb-2 font-normal text-muted-foreground">Failures</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.setId} className="border-b last:border-0 align-top">
                <td className="py-2 pr-4">
                  <Link href={`/staff/klps?set=${r.setId}`} className="hover:underline">
                    {r.setTitle}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-muted-foreground">{r.ownerLabel}</td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {r.byKlpStatus.ready ?? 0}/{r.total}
                </td>
                <td className="py-2 pr-4 text-right font-mono tabular-nums">
                  {r.byKltStatus.ready ?? 0}/{r.total}
                </td>
                <td className="py-2 text-xs text-muted-foreground">
                  {r.failures.length === 0
                    ? '—'
                    : r.failures.map((f) => (
                        <div key={f.cardId} title={f.klpError ?? undefined}>
                          {f.term}
                        </div>
                      ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
