import { prisma } from '@/lib/db'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Button, buttonVariants } from '@/components/ui/button'
import { ArrowLeft } from 'lucide-react'
import { MatchGame } from '@/components/game/MatchGame'
import { initMatchGame } from '@/lib/game/match'
import { cn } from '@/lib/utils'

export default async function MatchGamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const set = await prisma.set.findUnique({
    where: { id },
    include: {
      cards: {
        orderBy: { position: 'asc' },
      },
    },
  })

  if (!set) {
    notFound()
  }

  if (set.cards.length < 2) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center">
        <h1 className="text-2xl font-bold mb-4">Set too small</h1>
        <p className="mb-6">You need at least 2 cards to play the matching game.</p>
        <Link href={`/sets/${id}`} className={cn(buttonVariants())}>
          Back to set
        </Link>
      </div>
    )
  }

  const gameState = initMatchGame(set.cards, crypto.randomUUID())

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link
          href={`/sets/${id}`}
          className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'flex items-center gap-2 -ml-2')}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to set
        </Link>
      </div>

      <MatchGame initialTiles={gameState.tiles} />
    </div>
  )
}
