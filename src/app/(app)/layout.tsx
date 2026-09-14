import { auth } from '@/auth'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { CollapsibleShell } from '@/components/shell/CollapsibleShell'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { AppShell } from '@/components/shell/AppShell'

/**
 * The application shell: rail on the left, topbar above, content between,
 * footer under. Signed-in learners get the full rail from `AppShell`
 * (recents, folders, profile menu); a signed-out visitor on an app route —
 * Browse, a public set, a profile — gets the same rail with only Home,
 * Browse and Sign in on it.
 *
 * NOT the marketing top bar for visitors, deliberately. The landing and the
 * static pages have it, in their own `(marketing)` group; this layout must
 * not import `MarketingHeader`. When it did, Turbopack merged that
 * component into the chunk it shares with this layout's other client
 * modules (Base UI dialog/popover, floating-ui), and every marketing page
 * over-fetched ~185 KB it never rendered. One importer, one chunk.
 * `tests/shell/route-structure.test.ts` pins the separation.
 *
 * A ROUTE GROUP rather than a layout at `src/app/`. The study activities —
 * quiz, matching, review, print — deliberately sit outside it and render bare:
 * a timed game with a navigation column beside it is a game inviting you to
 * leave, and `/print` has to be chrome-free for the PDF to be usable at all.
 *
 * THIS LAYOUT OWNS THE MEASURE AND THE HORIZONTAL PADDING, exactly once.
 * Pages here must NOT re-center themselves.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const userId = session?.user?.id ?? null

  if (!userId) {
    return (
      <CollapsibleShell
        signedIn={false}
        recents={[]}
        folders={[]}
        account={
          <Link href="/login" className={cn(buttonVariants({ size: 'sm' }))}>
            Sign in
          </Link>
        }
      >
        {children}
        <SiteFooter />
      </CollapsibleShell>
    )
  }

  return <AppShell userId={userId}>{children}</AppShell>
}
