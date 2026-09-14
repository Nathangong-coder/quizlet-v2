import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { readableSetWhere } from '@/lib/sets/visibility'
import { buttonVariants } from '@/components/ui/button'
import { GameFrame } from '@/components/games/GameFrame'
import { ScoreBoard } from '@/components/games/ScoreBoard'
import { loadLeaderboard } from '@/lib/games/load'
import { GAME_MODES } from '@/lib/games/scores'
import { GauntletGame } from '@/components/games/GauntletGame'
import { cn } from '@/lib/utils'

/** `/sets/[id]/games/gauntlet` — signed-in only: it grades with the viewer's credentials and reads their memory to plan the run. */
export default async function GauntletPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const set = await prisma.set.findFirst({ where: { id, ...readableSetWhere(viewerId) }, select: { id: true, title: true } })
  if (!set) notFound()
  const boards = (await Promise.all(GAME_MODES['gauntlet'].map((m) => loadLeaderboard(viewerId, id, 'gauntlet', m)))).filter((b) => b !== null)
  const titles: Record<string, string> = { 'mc': 'Multiple choice', 'sa': 'Short answer' }

  return (
    <GameFrame setId={id} setTitle={set.title} game="Gauntlet" wide>
      {viewerId ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <GauntletGame setId={id} signedIn />
          <div className="space-y-3">{boards.map((b) => <ScoreBoard key={b.mode} game="gauntlet" title={titles[b.mode] ?? b.mode} rows={b.rows} viewerId={viewerId} compact />)}</div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-muted-foreground">Gauntlet grades your answers with your own AI credentials, so it needs an account.</p>
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/sets/${id}/games/gauntlet`)}`} className={cn(buttonVariants())}>Sign in</Link>
        </div>
      )}
    </GameFrame>
  )
}
