import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { buttonVariants } from '@/components/ui/button'
import { GameFrame } from '@/components/games/GameFrame'
import { HotSeatGame } from '@/components/games/HotSeatGame'
import { cn } from '@/lib/utils'

/** `/sets/[id]/games/hot-seat` — signed-in only: it grades with the viewer's credentials. */
export default async function HotSeatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const set = await prisma.set.findFirst({ where: { id, ...readableSetWhere(viewerId) }, select: { id: true, title: true } })
  if (!set) notFound()

  return (
    <GameFrame setId={id} setTitle={set.title} game="Hot Seat">
      {viewerId ? (
        <HotSeatGame setId={id} />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Hot Seat grades your answers with your own AI credentials, so it needs an account.</p>
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/sets/${id}/games/hot-seat`)}`} className={cn(buttonVariants())}>Sign in</Link>
        </div>
      )}
    </GameFrame>
  )
}
