import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Globe, Search } from 'lucide-react'
import { auth } from '@/auth'
import { loadPublicGroups } from '@/lib/groups/discover'
import { PageHeader } from '@/components/ui/page-header'
import { RequestToJoinButton } from '@/components/groups/Membership'

export const metadata: Metadata = { title: 'Find a study group' }

/**
 * `/groups/browse` — public groups (owner, 2026-09-14). A signed-in user
 * sees each group's name, description, size and shared set titles, and asks
 * to join; the owner decides. Nothing about members' progress is shown here.
 */
export default async function BrowseGroupsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fgroups%2Fbrowse')
  const { q = '' } = await searchParams
  const groups = await loadPublicGroups(session.user.id, q)

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Find a study group"
        lede="Public groups anyone can ask to join. The owner says yes or no; if yes, members see your progress on the group’s sets and nothing else."
        action={<Link href="/groups" className="text-sm underline underline-offset-4">Your groups</Link>}
      />
      <form className="mb-6 flex max-w-md items-center gap-2 rounded-full border border-border px-4 py-2 text-sm" role="search">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <input name="q" defaultValue={q} placeholder="Search groups" aria-label="Search groups" className="w-full bg-transparent outline-none placeholder:text-muted-foreground" />
      </form>

      {groups.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-border px-6 py-14 text-center">
          <div className="rounded-full bg-muted p-3 text-muted-foreground"><Globe className="h-6 w-6" aria-hidden="true" /></div>
          <h2 className="mt-4 text-xl font-semibold">{q ? 'No public groups match' : 'No public groups yet'}</h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">Make one and set it to public in its settings, and it will be listed here.</p>
          <Link href="/groups/new" className="mt-5 text-sm font-semibold text-primary underline-offset-4 hover:underline">Create a group</Link>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((g) => (
            <li key={g.id} className="flex flex-col rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-sm)]">
              <div className="flex items-start justify-between gap-3">
                <h2 className="font-heading text-lg font-bold">{g.name}</h2>
                <span className="shrink-0 text-xs text-muted-foreground"><span className="metric">{g.memberCount}</span> {g.memberCount === 1 ? 'member' : 'members'}</span>
              </div>
              {g.description && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{g.description}</p>}
              <p className="mt-2 text-xs text-muted-foreground">
                {g.ownerHandle && <>by <Link href={`/u/${g.ownerHandle}`} className="underline-offset-4 hover:underline">@{g.ownerHandle}</Link></>}
                {g.setTitles.length > 0 && <>{g.ownerHandle ? ' · ' : ''}studying {g.setTitles.join(', ')}</>}
              </p>
              <div className="mt-4 flex items-center justify-between gap-3">
                <RequestToJoinButton groupId={g.id} groupName={g.name} state={g.state} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
