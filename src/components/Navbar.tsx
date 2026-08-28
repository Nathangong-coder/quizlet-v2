// src/components/Navbar.tsx
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { auth } from '@/auth'
import { handleSignOut } from '@/lib/actions/auth'
import ThemeToggle from '@/components/theme/ThemeToggle'

export default async function Navbar() {
  const session = await auth()

  return (
    <nav className="border-b bg-background">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/" className="font-heading font-semibold text-xl tracking-tight">
          Quizlet v2
        </Link>
        <div className="flex items-center gap-2">
          {/* Outside the auth branch: a signed-out visitor reading the landing
              page needs the theme control just as much. */}
          <ThemeToggle />
          {session ? (
            <>
              {/* "Library", not "My Sets". The item beside it is now Browse,
                  and My Sets vs Browse names the wrong axis — the distinction
                  is yours-vs-everyone's, which stops being true the moment you
                  fork someone's set into it. */}
              <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Home
              </Link>
              <Link href="/browse" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Browse
              </Link>
              <Link href="/sets" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Library
              </Link>
              {/* "Learning", not "Profile". These three pages are about what
                  you know and what you answered; the account itself now has its
                  own page, and two things called Profile is how the old naming
                  left nowhere for a handle or an email to live. */}
              <Link href="/profile" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Learning
              </Link>
              <Link href="/account" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Account
              </Link>
              <Link href="/sets/new" className={cn(buttonVariants({ size: 'sm' }))}>
                + New Set
              </Link>
              <form action={handleSignOut}>
                <button className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              {/* Browse is reachable signed OUT on purpose: it is the only
                  surface a stranger can use to judge whether this is worth
                  signing up for. */}
              <Link href="/browse" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                Browse
              </Link>
              <Link href="/login" className={cn(buttonVariants({ size: 'sm' }))}>
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
