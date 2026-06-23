// src/components/Navbar.tsx
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { auth } from '@/auth'
import { handleSignIn, handleSignOut } from '@/lib/actions/auth'

export default async function Navbar() {
  const session = await auth()

  return (
    <nav className="border-b bg-background">
      <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href="/sets" className="font-bold text-lg tracking-tight">
          Quizlet v2
        </Link>
        <div className="flex items-center gap-2">
          {session ? (
            <>
              <Link href="/sets" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
                My Sets
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
            <form action={handleSignIn}>
              <button className={cn(buttonVariants({ size: 'sm' }))}>
                Sign in with GitHub
              </button>
            </form>
          )}
        </div>
      </div>
    </nav>
  )
}
