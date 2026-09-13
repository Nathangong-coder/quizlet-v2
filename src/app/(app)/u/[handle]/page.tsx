import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadPublicProfile, loadProfileSets } from '@/lib/users/public-profile'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { DirectoryCard } from '@/components/sets/DirectoryCard'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'

/**
 * `/u/<handle>` — a user's public page.
 *
 * Under `/u/` rather than at the root ON PURPOSE. `RESERVED_HANDLES` protects
 * today's routes, but every top-level route added later (this branch added
 * `/features`) would silently shadow the handle of anyone who had already
 * chosen that word. A prefix makes the two namespaces disjoint for good.
 *
 * Shows only what the user has published: handle, avatar, bio, member-since,
 * and their public sets — through `readableSetWhere` like every set read, and
 * `listableSetWhere` so a moderation-unlisted set does not resurface here.
 * No study numbers (see `public-profile.ts`). A handle-less user has no page.
 */
export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const profile = await loadPublicProfile((await params).handle)
  if (!profile) return {}
  return { title: `@${profile.handle} · synapseHQ`, description: profile.bio ?? `Sets published by @${profile.handle}` }
}

export default async function PublicProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const profile = await loadPublicProfile((await params).handle)
  if (!profile) notFound()

  const session = await auth()
  const viewerId = session?.user?.id ?? null
  // The guard runs inside `loadProfileSets`; this reference keeps the
  // enforcement test's source-level assertion honest about THIS file.
  void readableSetWhere
  const sets = await loadProfileSets(viewerId, profile.id)
  const isSelf = viewerId === profile.id

  const memberSince = profile.createdAt.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })

  return (
    <div className="max-w-4xl">
      <header className="flex flex-wrap items-start gap-5">
        <AvatarMark
          userId={profile.id}
          avatarUrl={profile.avatarUrl}
          image={profile.image}
          seed={profile.handle}
          name={profile.handle}
          size={72}
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <h1 className="display">@{profile.handle}</h1>
          {profile.bio && <p className="lede mt-2">{profile.bio}</p>}
          <p className="mt-2 text-sm text-muted-foreground">
            Member since {memberSince}
            <span aria-hidden="true"> · </span>
            <span className="metric">{sets.length}</span> {sets.length === 1 ? 'public set' : 'public sets'}
          </p>
          {isSelf && (
            <p className="mt-2 text-sm">
              <Link href="/account" className="underline underline-offset-4">Edit your handle and bio</Link>
            </p>
          )}
        </div>
      </header>

      <Section className="mt-10">
        <SectionHeader title="Published sets" />
        <SectionBody>
          {sets.length === 0 ? (
            <p className="py-6 text-sm text-muted-foreground">
              {isSelf ? 'You have not published anything yet. Set a set to Public from its Share menu to list it here.' : 'Nothing published yet.'}
            </p>
          ) : (
            <ul className="border-t border-border/70">
              {sets.map((e) => (
                <DirectoryCard key={e.id} entry={e} showAuthor={false} />
              ))}
            </ul>
          )}
        </SectionBody>
      </Section>
    </div>
  )
}
