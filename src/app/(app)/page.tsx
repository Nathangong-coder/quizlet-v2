import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import Link from 'next/link'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadRecentSets } from '@/lib/sets/recents'
import { loadRecommendations } from '@/lib/sets/recommend'
import { RecommendedStrip } from '@/components/home/RecommendedStrip'
import { loadSetStudySummaries } from '@/lib/sets/study-summary'
import { SetCard } from '@/components/sets/SetCard'
import { SetStrip } from '@/components/home/SetStrip'
import { Landing } from '@/components/home/Landing'
import { Section, SectionHeader, SectionBody } from '@/components/ui/section'

/** How many of your own sets the homepage shows before "See all". */
const OWN_SETS_PREVIEW = 6

/**
 * The homepage.
 *
 * Was a bare `redirect('/sets')`. Recents is keyed on VIEWING, not studying:
 * the case this page exists for is opening a set someone shared, reading it,
 * never answering a question, and losing the link forever.
 *
 * On the ENFORCED_PATHS checklist — every set read here goes through
 * `readableSetWhere`, including `loadRecentSets`, which re-authorizes at read
 * time so a set that has since gone private disappears.
 */
export default async function Home() {
  const session = await auth()
  if (!session?.user?.id) return <Landing />
  const userId = session.user.id

  const [recents, recommended, ownSets] = await Promise.all([
    loadRecentSets(userId),
    // Read-only. Recommendations never write to the learner model — they are a
    // recommendation surface, not evidence.
    loadRecommendations(userId),
    prisma.set.findMany({
      // `readableSetWhere` alongside `{ userId }` is redundant AS A FILTER —
      // an owner reads their own sets at every visibility. It is here as the
      // structural guard: `tests/sets/visibility-enforcement.test.ts` asserts
      // source-level that every `prisma.set.findMany` on a read path composes
      // the fragment, and a query that opts out "because it is already
      // owner-scoped" is indistinguishable, in a diff, from one that forgot.
      where: { AND: [{ userId }, readableSetWhere(userId)] },
      orderBy: { updatedAt: 'desc' },
      take: OWN_SETS_PREVIEW,
      include: { _count: { select: { cards: true } } },
    }),
  ])
  // DEDUPE AT RENDER, never at write. Reported by Task 5: the strip is
  // `viewedAt desc take 8` and this preview is `updatedAt desc take 6`, so for
  // any account with six or fewer sets and nothing shared to them — which is
  // this account today — the two blocks render THE SAME TILES in a slightly
  // different order. Two blocks with identical content, different sort keys and
  // no stated reason for differing is the specific thing that reads as
  // unfinished.
  //
  // Subtracting this way round and not the other: excluding own sets from the
  // STRIP would leave a solo account's strip empty until they open somebody
  // else's set, so the flagship feature would look broken on day one, when
  // there are no public sets to have opened yet.
  const recentIds = new Set(recents.map((r) => r.id))
  const otherOwnSets = ownSets.filter((s) => !recentIds.has(s.id))

  // ONE query for BOTH blocks. The strip renders the same `SetCard` as the
  // shelf below it now, and that card's footer reads `summary.lastStudiedAt` —
  // so a strip left out of this call would show every recent set dated by
  // CREATION while the identical card below showed it dated by last study.
  // Same component, same set, two different dates, on one screen.
  const summaries = await loadSetStudySummaries(
    prisma,
    userId,
    [...recents.map((s) => s.id), ...otherOwnSets.map((s) => s.id)],
  )

  const hasNothing = recents.length === 0 && ownSets.length === 0
  const hasRecommended = recommended.recommendations.length > 0 || recommended.emptyReason !== null

  return (
    <div>
      {hasNothing ? (
        <div className="mt-8">
          <p className="lede">
            Nothing here yet. Make a set of your own, or find one someone has published.
          </p>
          <div className="flex gap-4 mt-6 text-sm">
            <Link href="/sets/new" className="underline underline-offset-4">Create a set</Link>
            <Link href="/browse" className="underline underline-offset-4">Browse published sets</Link>
          </div>
        </div>
      ) : (
        <>
          {/* Each block renders NOTHING rather than an empty shell — a new
              account must not meet three empty headings. */}
          {recents.length > 0 && (
            <Section className="mt-8" rule={false}>
              <SectionHeader title="Jump back in" />
              <SectionBody><SetStrip sets={recents} summaries={summaries} /></SectionBody>
            </Section>
          )}

          {/* Recommended sits BETWEEN what you were doing and what you own,
              because it is the only block on this page about somebody else's
              material — putting it last would bury the whole point of having a
              directory. It renders its own four empty states rather than
              disappearing, so a learner who has none can see WHY. */}
          {hasRecommended && (
            <Section rule={recents.length > 0}>
              <SectionHeader
                title="Recommended"
                hint={recommended.recommendations.length > 0 ? 'from Browse' : undefined}
                action={
                  <Link href="/browse" className="underline underline-offset-4">
                    Browse all
                  </Link>
                }
              />
              <SectionBody>
                <RecommendedStrip
                  recommendations={recommended.recommendations}
                  emptyReason={recommended.emptyReason}
                />
              </SectionBody>
            </Section>
          )}

          {/* `otherOwnSets`, not `ownSets` — anything already in the strip
              above is not repeated here. The block disappears entirely when
              that empties it, per the render-nothing-rather-than-an-empty-shell
              rule; "See all" is still one click away in the nav. */}
          {otherOwnSets.length > 0 && (
            <Section rule={recents.length > 0 || hasRecommended}>
              <SectionHeader
                title="Your sets"
                action={<Link href="/sets" className="underline underline-offset-4">See all</Link>}
              />
              <SectionBody>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {otherOwnSets.map((s) => (
                    <SetCard key={s.id} set={s} summary={summaries[s.id]} />
                  ))}
                </div>
              </SectionBody>
            </Section>
          )}
        </>
      )}
    </div>
  )
}
