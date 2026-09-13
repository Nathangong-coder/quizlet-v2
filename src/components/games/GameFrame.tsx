import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The bare chrome every game page shares: a back link to the hub, the set
 * title, and the game's name. Games render OUTSIDE the app shell (like
 * match/quiz/review) — a timed game with a navigation column beside it is a
 * game inviting you to leave.
 */
export function GameFrame({
  setId,
  setTitle,
  game,
  children,
  wide = false,
}: {
  setId: string
  setTitle: string
  game: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('mx-auto px-4 py-6 sm:py-8', wide ? 'max-w-5xl' : 'max-w-3xl')}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/sets/${setId}/games`} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2 gap-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Games
        </Link>
        <div className="text-right">
          <div className="label">{game}</div>
          <div className="truncate font-heading font-bold">{setTitle}</div>
        </div>
      </div>
      {children}
    </div>
  )
}

/** The launch-screen note for the two AI-graded games. */
export function CredentialNote({ calls, extra }: { calls: string; extra?: string }) {
  return (
    <div className="rounded-lg border border-warning/40 bg-warning-subtle p-3 text-sm" role="note">
      <p>
        <span className="font-semibold">Uses your AI credentials.</span> Typed answers are graded with the keys in your settings — about {calls}.
      </p>
      {extra && <p className="mt-1 text-muted-foreground">{extra}</p>}
      <p className="mt-1 text-muted-foreground">Nothing from this game is saved to your memory or history. It is just for fun.</p>
    </div>
  )
}
