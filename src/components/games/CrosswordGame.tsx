'use client'

import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { Button } from '@/components/ui/button'
import { layoutCrossword, createCrossword, reduceCrossword, wordAt, isWordSolved, type CrosswordState } from '@/lib/games/crossword'
import type { GamePieceLike } from '@/lib/games/pieces'
import { betterOf } from '@/lib/games/best'
import { useBest } from '@/lib/games/use-best'
import { cn } from '@/lib/utils'

/**
 * Crossword. The grid is a table of buttons; one hidden input catches the
 * keyboard so mobile keyboards open. The reducer owns the cursor, entries,
 * check/reveal and the solved stamp.
 */
export function CrosswordGame({ setId, pieces }: { setId: string; pieces: GamePieceLike[] }) {
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31))
  const puzzle = useMemo(() => layoutCrossword(pieces, seed), [pieces, seed])
  const [state, setState] = useState<CrosswordState | null>(null)
  const [now, setNow] = useState(0)
  const [best, writeBest] = useBest<number>('crossword', setId)

  const running = state !== null && state.solvedAt === null
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  /** Every reducer dispatch goes through here so the solved moment records the best once. */
  function dispatch(next: CrosswordState) {
    if (next.solvedAt !== null && state?.solvedAt === null) {
      writeBest(betterOf(best, next.solvedAt - next.startedAt + next.penaltyMs, false))
    }
    setState(next)
  }

  if (!puzzle) {
    return <p className="text-sm text-muted-foreground">Not enough short answers in this set to build a crossword yet.</p>
  }

  function start() {
    const t = Date.now()
    setNow(t)
    setState(createCrossword(puzzle!, t))
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (!state) return
    if (/^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'type', letter: e.key, now: Date.now() })) }
    else if (e.key === 'Backspace') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'erase' })) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'move', dr: -1, dc: 0 })) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'move', dr: 1, dc: 0 })) }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'move', dr: 0, dc: -1 })) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'move', dr: 0, dc: 1 })) }
    else if (e.key === 'Tab' || e.key === ' ') { e.preventDefault(); dispatch(reduceCrossword(state, { type: 'toggle-dir' })) }
  }

  if (!state) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          The set&rsquo;s short answers as a crossword: {puzzle.words.length} words. Click a cell and type; arrows move, Tab flips direction. Check marks wrong letters; revealing a word costs 30 seconds.
        </p>
        {best !== null && <p className="text-xs text-muted-foreground">Best on this device: {Math.round(best / 1000)}s.</p>}
        <div className="flex gap-2">
          <Button onClick={start}>Start</Button>
          <Button variant="ghost" onClick={() => setSeed(Math.floor(Math.random() * 2 ** 31))}>Shuffle the grid</Button>
        </div>
      </div>
    )
  }

  const p = state.puzzle
  const cursorWord = state.cursor ? wordAt(p, state.cursor.row, state.cursor.col, state.cursor.dir) : null
  const numberAt = new Map<string, number>()
  for (const w of p.words) numberAt.set(`${w.row},${w.col}`, w.number)
  const elapsed = Math.max(0, ((state.solvedAt ?? now) - state.startedAt + state.penaltyMs) / 1000)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="metric">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}{state.penaltyMs > 0 && <span className="text-xs text-muted-foreground"> (+{state.penaltyMs / 1000}s)</span>}</span>
          {state.solvedAt !== null ? (
            <span className="font-semibold text-success">Solved</span>
          ) : (
            <span className="flex gap-1">
              <Button size="sm" variant="outline" onClick={() => dispatch(reduceCrossword(state, { type: 'check' }))}>Check</Button>
              <Button size="sm" variant="ghost" onClick={() => dispatch(reduceCrossword(state, { type: 'reveal-word', now: Date.now() }))}>Reveal word</Button>
            </span>
          )}
        </div>
        <div
          tabIndex={0}
          onKeyDown={onKey}
          role="grid"
          aria-label="Crossword grid"
          className="inline-grid gap-px rounded-md border border-border bg-border p-px outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ gridTemplateColumns: `repeat(${p.size}, minmax(0, 1fr))`, width: `min(100%, ${p.size * 34}px)` }}
        >
          {p.grid.map((row, r) =>
            row.map((cell, c) => {
              if (cell === null) return <div key={`${r},${c}`} className="aspect-square bg-background/60" aria-hidden="true" />
              const k = `${r},${c}`
              const entry = state.entries[k] ?? ''
              const isCursor = state.cursor?.row === r && state.cursor?.col === c
              const inWord = cursorWord ? (cursorWord.dir === 'across' ? cursorWord.row === r && c >= cursorWord.col && c < cursorWord.col + cursorWord.word.length : cursorWord.col === c && r >= cursorWord.row && r < cursorWord.row + cursorWord.word.length) : false
              const solvedHere = p.words.some((w) => isWordSolved(state, w) && (w.dir === 'across' ? w.row === r && c >= w.col && c < w.col + w.word.length : w.col === c && r >= w.row && r < w.row + w.word.length))
              return (
                <button
                  key={k}
                  type="button"
                  role="gridcell"
                  aria-label={`row ${r + 1} column ${c + 1}${entry ? `, ${entry}` : ''}`}
                  onClick={() => dispatch(reduceCrossword(state, { type: 'select', row: r, col: c }))}
                  className={cn(
                    'relative aspect-square bg-card text-center text-sm font-semibold uppercase',
                    inWord && 'bg-accent',
                    isCursor && 'bg-primary/25 ring-2 ring-inset ring-primary',
                    state.wrong[k] && 'text-rose-600',
                    state.revealed[k] && 'text-muted-foreground',
                    solvedHere && !state.wrong[k] && 'text-success',
                  )}
                >
                  {numberAt.has(k) && <span className="absolute left-0.5 top-0 text-[8px] font-normal text-muted-foreground">{numberAt.get(k)}</span>}
                  {entry}
                </button>
              )
            }),
          )}
        </div>
        {state.solvedAt !== null && (
          <div className="mt-4 flex items-center gap-3">
            <p className="text-sm text-muted-foreground">Nothing here was saved to your memory.</p>
            <Button size="sm" onClick={() => { setSeed(Math.floor(Math.random() * 2 ** 31)); setState(null) }}>New grid</Button>
          </div>
        )}
      </div>

      <div className="space-y-4 text-sm">
        {(['across', 'down'] as const).map((dir) => (
          <div key={dir}>
            <div className="label mb-1 capitalize">{dir}</div>
            <ol className="space-y-1">
              {p.clues[dir].map((cl) => {
                const w = p.words.find((x) => x.pieceId === cl.pieceId)!
                const active = cursorWord?.pieceId === cl.pieceId
                return (
                  <li key={cl.pieceId}>
                    <button type="button" onClick={() => setState({ ...state, cursor: { row: w.row, col: w.col, dir } })} className={cn('text-left hover:underline underline-offset-4', active && 'font-semibold text-primary', isWordSolved(state, w) && 'text-muted-foreground line-through')}>
                      <span className="metric">{cl.number}.</span> {cl.prompt} <span className="text-muted-foreground">({cl.length})</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        ))}
      </div>
    </div>
  )
}
