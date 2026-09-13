import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { buttonVariants } from '@/components/ui/button'
import { GameFrame } from '@/components/games/GameFrame'
import { GauntletGame } from '@/components/games/GauntletGame'
import { cn } from '@/lib/utils'

/** `/sets/[id]/games/gauntlet` — signed-in only: it grades with the viewer's credentials and reads their memory to plan the run. */
export default async function GauntletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const set = await prisma.set.findFirst({ where: { id, ...readableSetWhere(viewerId) }, select: { id: true, title: true } })
  if (!set) notFound()

  return (
    <GameFrame setId={id} setTitle={set.title} game="Gauntlet">
      {viewerId ? (
        <GauntletGame setId={id} />
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Gauntlet grades your answers with your own AI credentials, so it needs an account.</p>
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/sets/${id}/games/gauntlet`)}`} className={cn(buttonVariants())}>Sign in</Link>
        </div>
      )}
    </GameFrame>
  )
}
