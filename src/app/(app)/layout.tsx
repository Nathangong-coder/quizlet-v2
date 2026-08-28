import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import ThemeToggle from '@/components/theme/ThemeToggle'
import { RailNav } from '@/components/shell/RailNav'
import { MobileRail } from '@/components/shell/MobileRail'
import { ProfileMenu } from '@/components/shell/ProfileMenu'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { AvatarDialog } from '@/components/shell/AvatarDialog'
import { SynapseLogo } from '@/components/shell/SynapseLogo'
import { loadRecentSets } from '@/lib/sets/recents'
import { RAIL_RECENTS_LIMIT } from '@/lib/shell/nav'

/**
 * The application shell: rail on the left, topbar above, content between.
 *
 * A ROUTE GROUP rather than a layout at `src/app/`. The study activities —
 * quiz, matching, review, print — deliberately sit outside it and render bare:
 * a timed game with a navigation column beside it is a game inviting you to
 * leave, and `/print` has to be chrome-free for the PDF to be usable at all.
 * `tests/shell/route-structure.test.ts` enforces that split, so a later file
 * move cannot quietly put a nav rail on the print view.
 *
 * THIS LAYOUT OWNS THE MEASURE AND THE HORIZONTAL PADDING, exactly once. Before
 * this, the root layout applied `max-w-6xl mx-auto px-4` and then every page
 * applied its own on top — centered inside centered, `px-4` twice. That was
 * invisible only while both centered on the same axis; a fixed-width rail is
 * what makes it visible. Pages here must NOT re-center themselves.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const userId = session?.user?.id ?? null
  const signedIn = userId !== null

  // Both reads are skipped entirely for a signed-out visitor, who has neither.
  const [recents, user] = await Promise.all([
    userId ? loadRecentSets(userId, RAIL_RECENTS_LIMIT) : Promise.resolve([]),
    userId
      ? prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, handle: true, image: true, avatarUrl: true },
        })
      : Promise.resolve(null),
  ])

  const railRecents = recents.map((r) => ({ id: r.id, title: r.title, isOwn: r.isOwn }))

  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] min-h-screen">
      {/* `hidden lg:flex`, with MobileRail carrying the same nav in a drawer
          below that breakpoint. */}
      <aside className="hidden lg:flex flex-col gap-6 border-r px-3 py-5 h-screen sticky top-0">
        {/* `h-*` with no width: the viewBox is 640x200, so height alone sizes
            it and the aspect ratio does the rest. A fixed width here would
            letterbox the mark the moment the wordmark's metrics change. */}
        <Link href="/" className="px-3" aria-label="synapseHQ home">
          <SynapseLogo id="rail" className="h-9 w-auto text-foreground" />
        </Link>
        <div className="flex-1 overflow-y-auto">
          <RailNav signedIn={signedIn} recents={railRecents} />
        </div>
      </aside>

      {/* `minmax(0,1fr)` above, not `1fr`: a grid track sized `1fr` refuses to
          shrink below its content, so one wide table or code block on any page
          would push the whole column past the viewport and scroll the body
          horizontally. */}
      <div className="flex flex-col min-w-0">
        <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <MobileRail signedIn={signedIn} recents={railRecents} />
          <Link href="/" className="lg:hidden" aria-label="synapseHQ home">
            <SynapseLogo id="topbar" className="h-7 w-auto text-foreground" />
          </Link>

          <div className="flex-1" />

          {/* Outside the auth branch: a signed-out visitor reading /browse
              needs the theme control just as much. It stays in the topbar
              rather than moving into the menu — it is a control you use, not a
              setting you visit. */}
          <ThemeToggle />

          {user ? (
            <ProfileMenu
              handle={user.handle}
              name={user.name}
              avatar={
                <AvatarMark
                  userId={user.id}
                  avatarUrl={user.avatarUrl}
                  image={user.image}
                  seed={user.id}
                  name={user.name}
                  size={32}
                />
              }
              menuAvatar={
                <AvatarMark
                  userId={user.id}
                  avatarUrl={user.avatarUrl}
                  image={user.image}
                  seed={user.id}
                  name={user.name}
                  size={72}
                />
              }
              changePhoto={<AvatarDialog hasUpload={Boolean(user.avatarUrl)} />}
            />
          ) : (
            <Link href="/login" className={cn(buttonVariants({ size: 'sm' }))}>
              Sign in
            </Link>
          )}
        </header>

        <main className="flex-1 w-full max-w-[72rem] px-4 py-8 lg:px-8 lg:py-10">{children}</main>
      </div>
    </div>
  )
}
