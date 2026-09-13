'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { createBlitz, reduceBlitz, progressOf, LANES, STRIKES, type BlitzState } from '@/lib/games/blitz'
import type { GamePieceLike } from '@/lib/games/pieces'
import { betterOf } from '@/lib/games/best'
import { useBest } from '@/lib/games/use-best'
import { cn } from '@/lib/utils'

/**
 * Blitz. A requestAnimationFrame loop sends ticks to the reducer; the DOM is
 * a pure function of state. Nothing is persisted but a device-local best.
 */
export function BlitzGame({ setId, pieces }: { setId: string; pieces: GamePieceLike[] }) {
  const [state, setState] = useState<BlitzState | null>(null)
  const [now, setNow] = useState(0)
  const [best, writeBest] = useBest<number>('blitz', setId)
  const raf = useRef<number | null>(null)
  // The loop reads the latest state through a ref so it can see the moment
  // the game ends and record the best there, inside the frame callback.
  const stateRef = useRef<BlitzState | null>(null)

  const playing = state?.status === 'playing'
  useEffect(() => {
    if (!playing) return
    const loop = () => {
      const t = performance.now()
      const cur = stateRef.current
      if (cur && cur.status === 'playing') {
        const next = reduceBlitz(cur, { type: 'tick', now: t })
        if (next.status === 'over') writeBest(betterOf(best, next.score, true))
        stateRef.current = next
        setState(next)
      }
      setNow(t)
      raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
    return () => { if (raf.current !== null) cancelAnimationFrame(raf.current) }
  }, [playing, best, writeBest])

  function start(t: number, seed: number) {
    const initial = createBlitz(pieces, seed, t)
    stateRef.current = initial
    setNow(t)
    setState(initial)
  }

  function tap(tile: string, now: number) {
    const cur = stateRef.current
    if (!cur) return
    const next = reduceBlitz(cur, { type: 'tap', tile, now })
    if (next.status === 'over' && cur.status !== 'over') writeBest(betterOf(best, next.score, true))
    stateRef.current = next
    setState(next)
  }

  if (!state) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Prompts fall in four lanes. Tap the right answer before one lands. Wrong taps make it fall faster; three landings and it is over. Three in a row doubles your points and freezes the board for a breath.
        </p>
        <p className="text-xs text-muted-foreground"><span className="metric">{pieces.length}</span> pieces in play{best !== null && <> · best on this device <span className="metric">{best}</span></>}</p>
        <Button onClick={() => start(performance.now(), Math.floor(Math.random() * 2 ** 31))}>Start</Button>
      </div>
    )
  }

  if (state.status === 'over') {
    const won = state.strikes < STRIKES
    return (
      <div className="space-y-4 text-center">
        <h2 className="font-heading text-2xl font-bold">{won ? 'Board cleared' : 'Three landed'}</h2>
        <p className="text-sm text-muted-foreground"><span className="metric text-lg font-semibold text-foreground">{state.score}</span> points · <span className="metric">{state.clears}</span> cleared{best !== null && <> · best <span className="metric">{best}</span></>}</p>
        <p className="text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
        <Button onClick={() => start(performance.now(), Math.floor(Math.random() * 2 ** 31))}>Again</Button>
      </div>
    )
  }

  const frozen = now < state.frozenUntil

  return (
    <div className="space-y-3 select-none">
      <div className="flex items-center justify-between text-sm">
        <span className="metric font-semibold">{state.score}</span>
        <span className={cn('text-xs', state.combo > 1 ? 'font-semibold text-primary' : 'text-muted-foreground')}>×{state.combo}{frozen ? ' · freeze' : ''}</span>
        <span className="text-xs text-muted-foreground" aria-label={`${state.strikes} of ${STRIKES} strikes`}>{'●'.repeat(state.strikes)}{'○'.repeat(STRIKES - state.strikes)}</span>
      </div>

      <div className="relative grid h-[52vh] min-h-[320px] grid-cols-4 gap-1.5 overflow-hidden rounded-xl bg-muted/40 p-1.5" role="img" aria-label="Falling prompts">
        {Array.from({ length: LANES }, (_, lane) => (
          <div key={lane} className="relative rounded-md border border-dashed border-border/60">
            {state.blocks.filter((b) => b.lane === lane).map((b) => {
              const p = progressOf(b, frozen ? state.frozenUntil : now)
              const isTarget = b.id === state.targetBlockId
              return (
                <div
                  key={b.id}
                  className={cn('absolute inset-x-1 rounded-md px-2 py-1.5 text-[12px] leading-tight shadow-[var(--shadow-sm)]', isTarget ? 'bg-primary text-primary-foreground' : 'bg-card text-foreground')}
                  style={{ top: `calc(${p * 100}% - ${p * 56}px)` }}
                >
                  {b.prompt}
                </div>
              )
            })}
          </div>
        ))}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-rose-500/60" aria-hidden="true" />
      </div>

      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {state.tiles.length === 0 ? (
          <div className="col-span-full py-3 text-center text-xs text-muted-foreground">…</div>
        ) : (
          state.tiles.map((t) => (
            <button key={t} type="button" onClick={() => tap(t, performance.now())} className="min-h-12 rounded-lg border border-border bg-card px-2 py-2 text-sm font-medium hover:border-primary/60 active:bg-accent">
              {t}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
