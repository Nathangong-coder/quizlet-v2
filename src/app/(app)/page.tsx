import Link from 'next/link'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadRecommendations } from '@/lib/sets/recommend'
import { loadHomeRecentItems } from '@/lib/home/recent-items'
import { RecommendedStrip } from '@/components/home/RecommendedStrip'
import { JumpBackStrip } from '@/components/home/JumpBackStrip'
import { RecentItems } from '@/components/home/RecentItems'
import { redirect } from 'next/navigation'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'

/**
 * The homepage is a content shelf: resume something large, scan the mixed
 * recent stream, then discover a quiet set recommendation. The Library owns
 * the complete catalogue, so the home surface does not repeat a second grid
 * of the learner's sets below it.
 * `loadHomeRecentItems` delegates set reads to `loadRecentSets`, which applies
 * `readableSetWhere` again at read time before a set can reach this page.
 */
export default async function Home() {
  const session = await auth()
  // The middleware rewrites a signed-out `/` to /welcome before this runs, so
  // reaching here without a session means the middleware SAW a session cookie
  // that the server then refused — a JWT whose `sessionVersion` no longer
  // matches (password changed or reset on another device). The edge cannot
  // check the version, so it keeps sending `/welcome` back to `/`; a redirect
  // to `/welcome` here therefore LOOPED (found 2026-09-14 with a stale dev
  // cookie). Send them to sign in instead, which is what a revoked session
  // needs anyway.
  if (!session?.user?.id) redirect('/login')

  const [recentItems, recommended] = await Promise.all([
    loadHomeRecentItems(session.user.id, 8, readableSetWhere(session.user.id)),
    loadRecommendations(session.user.id),
  ])
  const hasRecommended = recommended.recommendations.length > 0 || recommended.emptyReason !== null

  if (recentItems.length === 0) {
    return (
      <div className="mt-8">
        <p className="lede">Nothing here yet. Make a set of your own, or find one someone has published.</p>
        <div className="mt-6 flex gap-4 text-sm"><Link href="/sets/new" className="underline underline-offset-4">Create a set</Link><Link href="/browse" className="underline underline-offset-4">Browse published sets</Link></div>
      </div>
    )
  }

  return <div>
    <Section className="mt-8" rule={false}>
      <SectionHeader title="Jump Back In" />
      <SectionBody><JumpBackStrip items={recentItems.slice(0, 4)} /></SectionBody>
    </Section>

    <Section rule={false}>
      <SectionHeader title="Recents" />
      <SectionBody><RecentItems items={recentItems} /></SectionBody>
    </Section>

    {hasRecommended && <Section rule>
      <SectionHeader title="Recommended" action={<Link href="/browse" className="underline underline-offset-4">Browse all</Link>} />
      <SectionBody><RecommendedStrip recommendations={recommended.recommendations} emptyReason={recommended.emptyReason} /></SectionBody>
    </Section>}
  </div>
}
