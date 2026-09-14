import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { SynapseLogo } from '@/components/shell/SynapseLogo'
import { cn } from '@/lib/utils'

/**
 * The 404. Root-level so it covers every route group and the bare study
 * routes alike. It says what happened and offers the three places a lost
 * visitor usually wanted — never a blank "This page could not be found".
 *
 * Deliberately no data read: a 404 is often a probe (a guessed set id), and
 * this page must not confirm anything about what exists.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-4 py-16 text-center">
      <SynapseLogo id="404" withWordmark={false} className="h-12 w-12 text-primary" />
      <p className="mt-6 label">404</p>
      <h1 className="display mt-2">That page is not here.</h1>
      <p className="lede mx-auto mt-4">
        The link may be wrong, the set may have been made private or deleted, or it may never have existed. Nothing of yours is lost.
      </p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className={cn(buttonVariants())}>Go home</Link>
        <Link href="/browse" className={cn(buttonVariants({ variant: 'outline' }))}>Browse published sets</Link>
        <Link href="/sets" className={cn(buttonVariants({ variant: 'ghost' }))}>Your library</Link>
      </div>
    </main>
  )
}
