import Link from 'next/link'
import { prisma } from '@/lib/db'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CollapsibleShell } from '@/components/shell/CollapsibleShell'
import { ProfileMenu } from '@/components/shell/ProfileMenu'
import { AvatarMark } from '@/components/shell/AvatarMark'
import { AvatarDialog } from '@/components/shell/AvatarDialog'
import { loadRecentSets } from '@/lib/sets/recents'
import { RAIL_RECENTS_LIMIT } from '@/lib/shell/nav'
import { loadRecentFolders, RAIL_FOLDERS_LIMIT } from '@/lib/folders/recents'
import { SiteFooter } from '@/components/marketing/SiteFooter'

/**
 * The SIGNED-IN application shell: rail on the left, topbar above, content
 * between, footer under. Split out of `(app)/layout.tsx` and loaded there
 * with a dynamic `import()` on the signed-in branch ONLY.
 *
 * The reason is the visitor's bundle. A server component's client imports
 * are bundled per route statically — rendered or not — so while this lived
 * in the layout, every anonymous hit on the landing page downloaded the
 * rail, the profile menu and the avatar dialog (Base UI + floating-ui,
 * ~150 KB) it would never render. The bundle analyzer showed it; the
 * dynamic import is what keeps it out.
 */
export async function AppShell({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [recents, folders, user] = await Promise.all([
    loadRecentSets(userId, RAIL_RECENTS_LIMIT),
    loadRecentFolders(userId, RAIL_FOLDERS_LIMIT),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, handle: true, image: true, avatarUrl: true, role: true },
    }),
  ])

  const railRecents = recents.map((r) => ({ id: r.id, title: r.title, isOwn: r.isOwn }))
  const railFolders = folders.map((folder) => ({ id: folder.id, name: folder.name }))

  return (
    <CollapsibleShell
      signedIn
      role={user?.role}
      recents={railRecents}
      folders={railFolders}
      account={
        user ? (
          <ProfileMenu
            handle={user.handle}
            name={user.name}
            avatar={<AvatarMark userId={user.id} avatarUrl={user.avatarUrl} image={user.image} seed={user.id} name={user.name} size={32} />}
            menuAvatar={<AvatarMark userId={user.id} avatarUrl={user.avatarUrl} image={user.image} seed={user.id} name={user.name} size={72} />}
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
      <SiteFooter />
    </CollapsibleShell>
  )
}
