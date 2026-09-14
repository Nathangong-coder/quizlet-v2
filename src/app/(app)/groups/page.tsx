import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Users, Plus } from 'lucide-react'
import { auth } from '@/auth'
import { loadMyGroups } from '@/lib/groups/load'
import { buttonVariants } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/page-header'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Study groups', description: 'Study the same sets with people you choose.' }

/**
 * `/groups` — the groups you belong to. Private only: there is no directory
 * of groups, so this page and an invite link are the only ways in.
 */
export default async function GroupsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fgroups')
  const groups = await loadMyGroups(session.user.id)

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Study groups"
        lede="Study the same sets with people you choose, and see who has which cards down."
        action={
          <Link href="/groups/new" className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New group
          </Link>
        }
      />

      {groups.length === 0 ? (
        <div className="flex min-h-[32vh] flex-col items-center justify-center rounded-2xl border border-dashed border-border px-6 py-16 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground"><Users className="h-6 w-6" aria-hidden="true" /></div>
          <h2 className="mt-4 text-xl font-semibold">No groups yet</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Make one and send the invite link, or ask a friend for theirs. A group only ever sees your progress on the sets it studies.
          </p>
          <Link href="/groups/new" className={cn(buttonVariants(), 'mt-6')}>Create a group</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id}>
              <Link href={`/groups/${g.id}`} className="flex h-full flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)] transition-colors hover:border-primary/60">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="truncate font-heading text-lg font-bold">{g.name}</h2>
                  {g.role === 'owner' && <span className="label shrink-0">owner</span>}
                </div>
                {g.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{g.description}</p>}
                <p className="mt-3 text-xs text-muted-foreground">
                  <span className="metric">{g.memberCount}</span> {g.memberCount === 1 ? 'member' : 'members'}
                  <span aria-hidden="true"> · </span>
                  <span className="metric">{g.setCount}</span> {g.setCount === 1 ? 'set' : 'sets'}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
