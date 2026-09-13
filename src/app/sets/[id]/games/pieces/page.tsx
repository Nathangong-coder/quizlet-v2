import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { readableSetWhere } from '@/lib/sets/visibility'
import { loadPiecesView } from '@/lib/games/load'
import { GameFrame } from '@/components/games/GameFrame'
import { PieceToggle } from '@/components/games/HubControls'

/**
 * `/sets/[id]/games/pieces` — the owner's "viewable subset": every piece,
 * grouped by card, with the key point it came from and an enable toggle;
 * and the cards that produced nothing, with why.
 */
export default async function PiecesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  void readableSetWhere
  const view = await loadPiecesView(viewerId, id)
  if (!view) notFound()

  const withPieces = view.cards.filter((c) => c.pieces.length > 0)
  const without = view.cards.filter((c) => c.pieces.length === 0)

  return (
    <GameFrame setId={id} setTitle={view.set.title} game="Game pieces" wide>
      <p className="mb-6 text-sm text-muted-foreground">
        Short prompt/answer pairs made from each card&rsquo;s key points. Blitz and Crossword draw from these. {view.set.isOwner ? 'Switch off any that read badly; games skip them.' : ''}
      </p>

      {withPieces.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pieces yet{view.set.isOwner ? ' — use Prepare games on the hub.' : '.'}</p>
      ) : (
        <ul className="space-y-6">
          {withPieces.map((c) => (
            <li key={c.id}>
              <h2 className="font-heading font-bold">{c.term}</h2>
              <ul className="mt-2 divide-y divide-border/70 rounded-lg border border-border">
                {c.pieces.map((p) => (
                  <li key={p.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    <div>
                      <div className={p.enabled ? '' : 'text-muted-foreground line-through'}>{p.prompt}</div>
                      {p.klpText && <div className="mt-0.5 text-xs text-muted-foreground">from: {p.klpText}</div>}
                    </div>
                    <div className="font-medium">
                      {p.answer}
                      {p.aliases.length > 0 && <span className="ml-1 text-xs font-normal text-muted-foreground">also: {p.aliases.join(', ')}</span>}
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">{p.kind}</span>
                    </div>
                    <div className="justify-self-end">{view.set.isOwner ? <PieceToggle pieceId={p.id} enabled={p.enabled} /> : <span className="text-xs text-muted-foreground">{p.enabled ? 'on' : 'off'}</span>}</div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      {without.length > 0 && (
        <section className="mt-10">
          <h2 className="label">Cards with no pieces</h2>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {without.map((c) => (
              <li key={c.id}>
                {c.term} <span className="text-xs">— {c.klpStatus === 'ready' ? 'no clean short answer in its key points' : 'no key points yet'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </GameFrame>
  )
}
