'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { DoorOpen, Footprints, Heart, Lock, Shield, Skull } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { buildGauntletRun, gradeGameAnswer } from '@/actions/games'
import { createGauntlet, reduceGauntlet, currentRoom, currentAsk, summarize, type GauntletState, type RunPlan, type Room } from '@/lib/games/gauntlet'
import { useBest } from '@/lib/games/use-best'
import { CredentialNote } from '@/components/games/GameFrame'
import { cn } from '@/lib/utils'

type Card = { id: string; term: string; definition: string }

interface Best { roomsCleared: number; bossesBeaten: number }

/**
 * Gauntlet. The reducer owns the run; this component owns fetching the plan,
 * the current answer box, and the one server round-trip a typed room makes.
 * On a credential failure mid-run the rest of the run degrades to MC — the
 * corridor/door/boss structure is kept, only the format changes.
 */
export function GauntletGame({ setId }: { setId: string }) {
  const [plan, setPlan] = useState<(RunPlan & { cards: Card[] }) | null>(null)
  const [mcOnly, setMcOnly] = useState(false)
  const [state, setState] = useState<GauntletState | null>(null)
  const [typed, setTyped] = useState('')
  const [last, setLast] = useState<{ ok: boolean; note: string } | null>(null)
  const [forcedMc, setForcedMc] = useState(false)
  const [best, writeBest] = useBest<Best>('gauntlet', setId)
  const [isPending, startTransition] = useTransition()

  function start() {
    startTransition(async () => {
      const res = await buildGauntletRun(setId, { mcOnly })
      if (!res.success) return void toast.error(res.error)
      setPlan(res.data)
      setState(createGauntlet(res.data, Date.now()))
      setLast(null)
    })
  }

  const cardById = new Map((plan?.cards ?? []).map((c) => [c.id, c]))
  const room = state ? currentRoom(state) : null
  const card = room ? cardById.get(room.cardId) : null
  const ask = state ? currentAsk(state) : 'term'
  const format: Room['format'] = room ? (forcedMc ? 'mc' : room.format) : 'mc'

  // `now` is taken at the event boundary by the caller — the compiler treats a
  // function reached through another function as possibly-render, so the
  // impure clock read lives in the JSX handlers, not here.
  function apply(ok: boolean, note: string, now: number) {
    if (!state) return
    const next = reduceGauntlet(state, { type: ok ? 'hit' : 'miss', now })
    setState(next)
    setLast({ ok, note })
    setTyped('')
    const done = summarize(next)
    if (done) {
      if (!best || done.roomsCleared > best.roomsCleared || (done.roomsCleared === best.roomsCleared && done.bossesBeaten > best.bossesBeaten)) {
        writeBest({ roomsCleared: done.roomsCleared, bossesBeaten: done.bossesBeaten })
      }
    }
  }

  function pickOption(option: string, now: number) {
    if (!card || !room) return
    const correct = ask === 'term' ? card.definition : card.term
    apply(option === correct, option === correct ? 'Through.' : `It was: ${correct}`, now)
  }

  function submitTyped(now: number) {
    if (!card || typed.trim().length === 0) return
    startTransition(async () => {
      const res = await gradeGameAnswer(card.id, typed)
      if (!res.success) {
        toast.error(res.error)
        // Degrade the rest of the run to MC rather than stalling.
        setForcedMc(true)
        return
      }
      const missed = res.data.verdicts.filter((v) => v.status !== 'passed').map((v) => v.text)
      apply(res.data.hit, res.data.hit ? 'The door opens.' : `Missing: ${missed.slice(0, 2).join(' · ')}`, now)
    })
  }

  // ------------------------------------------------------------ launch screen
  if (!plan || !state) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          A run through the set. Cards you know are corridors, cards you half know are locked doors, and your three weakest cards are the bosses at the end. Three lives; a shield every five in a row.
        </p>
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p><span className="font-semibold">Built from what you are weakest on.</span> The run reads your confidence on this set to decide which cards are doors and bosses. It only reads — nothing you do here changes it.</p>
        </div>
        <CredentialNote calls="one call per locked door and two per boss" extra="Turn on Multiple choice only to make zero calls." />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={mcOnly} onChange={(e) => setMcOnly(e.target.checked)} className="h-4 w-4 rounded border-input" />
          Multiple choice only
        </label>
        {best && <p className="text-xs text-muted-foreground">Your best on this device: {best.roomsCleared} rooms, {best.bossesBeaten} bosses.</p>}
        <Button onClick={start} disabled={isPending}>{isPending ? 'Building the run…' : 'Start the run'}</Button>
      </div>
    )
  }

  // ------------------------------------------------------------- end screen
  const done = summarize(state)
  if (done) {
    return (
      <div className="space-y-4 text-center">
        <div className={cn('mx-auto flex h-16 w-16 items-center justify-center rounded-full', done.status === 'won' ? 'bg-success text-white' : 'bg-muted text-muted-foreground')}>
          {done.status === 'won' ? <Shield className="h-8 w-8" aria-hidden="true" /> : <Skull className="h-8 w-8" aria-hidden="true" />}
        </div>
        <h2 className="font-heading text-2xl font-bold">{done.status === 'won' ? 'You cleared the gauntlet' : 'The gauntlet got you'}</h2>
        <p className="text-sm text-muted-foreground">
          <span className="metric">{done.roomsCleared}</span> rooms · <span className="metric">{done.bossesBeaten}</span> bosses · best streak <span className="metric">{done.bestStreak}</span> · <span className="metric">{Math.round(done.elapsedMs / 1000)}s</span>
        </p>
        <p className="text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
        <Button onClick={() => { setPlan(null); setState(null); setForcedMc(false) }}>Run it again</Button>
      </div>
    )
  }

  if (!room || !card) return null
  const prompt = ask === 'term' ? card.term : card.definition
  const RoomIcon = room.kind === 'boss' ? Skull : room.kind === 'door' ? Lock : Footprints

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-1" aria-label={`${state.lives} lives`}>
          {Array.from({ length: 3 }, (_, i) => <Heart key={i} className={cn('h-4 w-4', i < state.lives ? 'fill-rose-500 text-rose-500' : 'text-muted-foreground/40')} aria-hidden="true" />)}
          {state.shields > 0 && <span className="ml-2 inline-flex items-center gap-1 text-xs"><Shield className="h-3.5 w-3.5" aria-hidden="true" />{state.shields}</span>}
        </div>
        <div className="text-muted-foreground">room {state.index + 1} of {state.queue.length} · streak {state.streak}</div>
      </div>

      <ol className="flex gap-1" aria-hidden="true">
        {state.queue.map((r, i) => {
          const I = r.kind === 'boss' ? Skull : r.kind === 'door' ? DoorOpen : Footprints
          return (
            <li key={i} className={cn('flex h-6 flex-1 items-center justify-center rounded', i < state.index ? 'bg-success/20 text-success' : i === state.index ? 'bg-primary text-primary-foreground' : r.kind === 'boss' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200' : 'bg-muted text-muted-foreground')}>
              <I className="h-3 w-3" />
            </li>
          )
        })}
      </ol>

      <div className={cn('rounded-xl border p-5', room.kind === 'boss' ? 'border-rose-300 dark:border-rose-800' : room.kind === 'door' ? 'border-primary/50' : 'border-border')}>
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <RoomIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {room.kind === 'boss' ? `Boss · hit ${state.hits + 1} of 2` : room.kind === 'door' ? 'Locked door' : 'Corridor'}
          <span className="ml-auto font-normal normal-case">{ask === 'term' ? 'give the definition' : 'name the term'}</span>
        </div>
        <p className="text-lg font-medium">{prompt}</p>
      </div>

      {last && (
        <p className={cn('text-sm', last.ok ? 'text-success' : 'text-warning')} role="status">{last.note}</p>
      )}

      {format === 'mc' && room.options ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {room.options.map((o) => (
            <button key={o} type="button" onClick={() => pickOption(o, Date.now())} className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:border-primary/60">
              {o}
            </button>
          ))}
        </div>
      ) : format === 'mc' ? (
        // Forced-MC fallback for a room planned as typed: use the other side's
        // card text as the only option we have — a degraded but playable room.
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Grading is unavailable — this room is a free pass.</p>
          <Button variant="outline" onClick={() => apply(true, 'Waved through.', Date.now())}>Continue</Button>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submitTyped(Date.now()) }} className="space-y-2">
          <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer" rows={3} className="resize-none" autoFocus />
          <Button type="submit" disabled={isPending || typed.trim().length === 0}>{isPending ? 'Grading…' : 'Answer'}</Button>
        </form>
      )}
    </div>
  )
}
