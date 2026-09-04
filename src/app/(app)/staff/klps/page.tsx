import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import { requireStaff } from '@/lib/staff/access'
import { loadStaffKlps } from '@/lib/staff/queries'
import { isAdmin } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'
import { KlpTable } from '@/components/staff/KlpTable'

/**
 * Set-scoped by default, with a search across text and label.
 *
 * Install-wide LISTING with no filter is deliberately not offered: the corpus
 * is in the thousands and a page rendering all of them is a page nobody reads.
 * `take: 500` in loadStaffKlps is the backstop.
 */
export default async function StaffKlpsPage({
  searchParams,
}: {
  searchParams: Promise<{ set?: string; q?: string; superseded?: string }>
}) {
  const staff = await requireStaff()
  if (!staff) notFound()

  const params = await searchParams
  const sets = await prisma.set.findMany({
    select: { id: true, title: true },
    orderBy: { updatedAt: 'desc' },
  })

  const setId = params.set ?? sets[0]?.id
  const rows = await loadStaffKlps({
    setId: params.q ? undefined : setId,
    search: params.q,
    includeSuperseded: params.superseded === '1',
  })

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Key points</h1>
      <StaffNav isAdmin={isAdmin(staff.role)} />

      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Set</span>
          <select name="set" defaultValue={setId} className="rounded-md border px-2 py-1.5 text-sm">
            {sets.map((s) => (
              <option key={s.id} value={s.id}>{s.title}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted-foreground">Search all sets</span>
          <input
            name="q"
            defaultValue={params.q ?? ''}
            placeholder="text or label"
            className="rounded-md border px-2 py-1.5 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="superseded" value="1" defaultChecked={params.superseded === '1'} />
          Show superseded
        </label>
        <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">Apply</button>
      </form>

      <KlpTable rows={rows} />
    </div>
  )
}
