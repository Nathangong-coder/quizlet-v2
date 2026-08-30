import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CollapsibleShell } from '@/components/shell/CollapsibleShell'
import { ProfileMenu } from '@/components/shell/ProfileMenu'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { AvatarDialog } from '@/components/shell/AvatarDialog'
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
    <CollapsibleShell
      signedIn={signedIn}
      recents={railRecents}
      account={
        user ? (
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
        )
      }
    >
      {children}
    </CollapsibleShell>
  )
}
