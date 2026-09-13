import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadPlayablePieces } from '@/lib/games/load'
import { MIN_PIECES } from '@/lib/games/pieces'
import { GameFrame } from '@/components/games/GameFrame'
import { BlitzGame } from '@/components/games/BlitzGame'

/** `/sets/[id]/games/blitz` — pieces only, no AI, anonymous-playable on a link/public set. */
export default async function BlitzPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const data = await loadPlayablePieces(viewerId, id)
  if (!data) notFound()
  const usable = data.pieces
  const short = MIN_PIECES.blitz - usable.length

  return (
    <GameFrame setId={id} setTitle={data.title} game="Blitz" wide={false}>
      {short > 0 ? (
        <p className="text-sm text-muted-foreground">Needs {short} more {short === 1 ? 'piece' : 'pieces'}. The set owner can prepare them from the games hub.</p>
      ) : (
        <BlitzGame setId={id} pieces={usable} />
      )}
    </GameFrame>
  )
}
