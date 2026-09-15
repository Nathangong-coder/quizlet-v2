import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Plus } from 'lucide-react'
import { auth } from '@/auth'
import { loadStartSets } from '@/lib/home/start-here'
import { StartHerePage } from '@/components/home/StartHere'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Flashcards' }

/** `/flashcards` — Start here → Flashcards: your sets to flip through, or make a new one. */
export default async function FlashcardsHub() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fflashcards')
  const sets = await loadStartSets(session.user.id)
  return (
    <StartHerePage
      title="Flashcards"
      lede="Flip through a set, or build one — by hand, from a pasted term|definition list, or by copying a published set."
      action={
        <div className="flex gap-2">
          <Link href="/browse" className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}>Browse published sets</Link>
          <Link href="/sets/new" className={cn(buttonVariants({ size: 'sm' }), 'gap-1.5')}><Plus className="h-4 w-4" aria-hidden="true" />New set</Link>
        </div>
      }
      sets={sets}
      hrefFor={(s) => `/sets/${s.id}`}
      cta="Flip through"
      secondary={{ label: 'Review mode', hrefFor: (s) => `/sets/${s.id}/review` }}
      empty={<>No sets yet. <Link href="/sets/new" className="text-primary underline-offset-4 hover:underline">Make one</Link> or <Link href="/browse" className="text-primary underline-offset-4 hover:underline">find a published set</Link>.</>}
    />
  )
}
