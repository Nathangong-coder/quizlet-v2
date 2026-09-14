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
import { HotSeatGame } from '@/components/games/HotSeatGame'
import { PixelSprite } from '@/components/games/PixelSprite'
import { HOST_BASE, FACES } from '@/lib/games/sprites'
import { cn } from '@/lib/utils'

/** `/sets/[id]/games/hot-seat` — signed-in only: it grades with the viewer's credentials. */
export default async function HotSeatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const set = await prisma.set.findFirst({ where: { id, ...readableSetWhere(viewerId) }, select: { id: true, title: true } })
  if (!set) notFound()
  const boards = (await Promise.all(GAME_MODES['hot-seat'].map((m) => loadLeaderboard(viewerId, id, 'hot-seat', m)))).filter((b) => b !== null)
  const titles: Record<string, string> = { 'easy': 'Easy', 'normal': 'Normal', 'hard': 'Hard' }

  return (
    <GameFrame setId={id} setTitle={set.title} game="Hot Seat" wide>
      {viewerId ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
          <HotSeatGame setId={id} signedIn />
          <div className="space-y-3">{boards.map((b) => <ScoreBoard key={b.mode} game="hot-seat" title={titles[b.mode] ?? b.mode} rows={b.rows} viewerId={viewerId} compact />)}</div>
        </div>
      ) : (
        <div className="space-y-3 text-sm">
          <div className="flex items-end gap-4 rounded-2xl bg-accent p-5">
            <PixelSprite sprite={HOST_BASE} overlays={[FACES.neutral]} size={72} label="The interviewer" />
            <p className="text-accent-foreground">An interviewer whose face you can read, dressed for the subject. Miss a point and they probe it. Every other game here is open to anyone; this one reads your written answers with your own AI keys, so it needs an account.</p>
          </div>
          <Link href={`/login?callbackUrl=${encodeURIComponent(`/sets/${id}/games/hot-seat`)}`} className={cn(buttonVariants())}>Sign in</Link>
        </div>
      )}
    </GameFrame>
  )
}
