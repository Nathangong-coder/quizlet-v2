import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/staff/access'
import { listWaitlist, type WaitlistFilter } from '@/lib/demo/waitlist'
import { formatInviteCode } from '@/lib/invites/code'
import { StaffNav } from '../StaffNav'
import { WaitlistTable } from '@/components/staff/WaitlistTable'

const FILTERS: WaitlistFilter[] = ['pending', 'invited', 'all']

/**
 * Everyone who asked for an invite from the demo. ADMIN ONLY; notFound() for
 * everyone else so the route's existence is not revealed. The invite action
 * re-checks the gate itself.
 */
export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>
}) {
  const admin = await requireAdmin()
  if (!admin) notFound()

  const { filter: raw } = await searchParams
  const filter: WaitlistFilter = FILTERS.find((f) => f === raw) ?? 'pending'
  const rows = await listWaitlist(filter)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Waitlist</h1>
        <p className="text-sm text-muted-foreground">
          Guests who asked for an invite. One click mints a single-use code that works for 14 days.
        </p>
      </div>

      <StaffNav isAdmin />

      <div className="flex gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/staff/waitlist?filter=${f}`}
            aria-current={f === filter ? 'page' : undefined}
            className={
              f === filter
                ? 'rounded-md border bg-muted px-3 py-1 font-medium capitalize'
                : 'rounded-md border px-3 py-1 capitalize text-muted-foreground hover:text-foreground'
            }
          >
            {f}
          </Link>
        ))}
      </div>

      <WaitlistTable
        rows={rows.map((r) => ({
          id: r.id,
          email: r.email,
          note: r.note,
          requestedAt: r.createdAt.toISOString().slice(0, 10),
          lastRequestedAt: r.lastRequestedAt.toISOString().slice(0, 10),
          invitedAt: r.invitedAt ? r.invitedAt.toISOString().slice(0, 10) : null,
          inviteCode: r.inviteCode ? formatInviteCode(r.inviteCode) : null,
        }))}
      />
    </div>
  )
}
