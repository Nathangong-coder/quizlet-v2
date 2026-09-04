import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireAdmin } from '@/lib/staff/access'
import { DEFAULT_ROLE } from '@/lib/auth/roles'
import { StaffNav } from '../StaffNav'
import { RoleControls } from '@/components/staff/RoleControls'

/**
 * Who can read other people's work, and who gave them that.
 *
 * ADMIN ONLY — requireAdmin, not requireStaff. Reading the engine is not
 * granting access to it. Every mutation re-checks in its own action body; this
 * gate protects the page, not the writes.
 */
export default async function StaffRolesPage() {
  const admin = await requireAdmin()
  if (!admin) notFound()

  const holders = await prisma.user.findMany({
    where: { role: { not: DEFAULT_ROLE } },
    select: {
      id: true,
      handle: true,
      name: true,
      email: true,
      role: true,
      roleGrants: {
        where: { revokedAt: null },
        select: { createdAt: true, grantedBy: { select: { handle: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
    orderBy: { role: 'asc' },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Roles</h1>
        <p className="text-sm text-muted-foreground">
          Staff can read any learner&rsquo;s answers and diagnoses. Admins can also grant that.
        </p>
      </div>

      <StaffNav isAdmin />

      <ul className="divide-y rounded-lg border">
        {holders.length === 0 && (
          <li className="p-3 text-sm text-muted-foreground">Nobody holds a role above learner.</li>
        )}
        {holders.map((u) => {
          const grant = u.roleGrants[0]
          return (
            <li key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <span>
                {u.handle ?? u.name ?? u.email}
                {u.id === admin.userId && (
                  <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                )}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="font-mono">{u.role}</span>
                {grant && (
                  <>
                    {' · '}
                    {grant.createdAt.toISOString().slice(0, 10)}
                    {' · by '}
                    {grant.grantedBy?.handle ?? grant.grantedBy?.email ?? 'CLI'}
                  </>
                )}
              </span>
            </li>
          )
        })}
      </ul>

      <RoleControls selfId={admin.userId} />
    </div>
  )
}
