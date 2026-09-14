'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Sparkles, Sword, Heart, Shield } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { buildGauntletRun, gauntletOptions, gradeGameAnswer, submitGameScore } from '@/actions/games'
import {
  createGauntlet,
  reduceGauntlet,
  currentEncounter,
  summarize,
  rollHit,
  ENEMIES,
  MAX_HP,
  MAGICIAN_HEAL,
  type GauntletState,
  type RunPlan,
  type GauntletMode,
  type EnemyKind,
} from '@/lib/games/gauntlet'
import { KNIGHT, KNIGHT_SHIELD, SLIME, IMP, DARK_KNIGHT, BOSS, MAGICIAN, type Sprite } from '@/lib/games/sprites'
import { PixelSprite } from '@/components/games/PixelSprite'
import { useBest } from '@/lib/games/use-best'
import { CredentialNote } from '@/components/games/GameFrame'
import { cn } from '@/lib/utils'

type Card = { id: string; term: string; definition: string }
interface Best { score: number }

const ENEMY_SPRITE: Record<EnemyKind, Sprite> = { slime: SLIME, imp: IMP, 'dark-knight': DARK_KNIGHT, miniboss: DARK_KNIGHT, boss: BOSS }

/**
 * Gauntlet. The reducer owns the fight; this component owns the scene, the
 * question for the current enemy, and the server round-trips (options for
 * MC, grading for SA). Random rolls and clocks are read at the event
 * boundary and passed in, so the reducer stays pure.
 */
export function GauntletGame({ setId, signedIn }: { setId: string; signedIn: boolean }) {
  const [mode, setMode] = useState<GauntletMode>('mc')
  const [plan, setPlan] = useState<(RunPlan & { cards: Card[] }) | null>(null)
  const [state, setState] = useState<GauntletState | null>(null)
  const [options, setOptions] = useState<{ cardId: string; options: string[]; correct: string; source: 'ai' | 'fallback' } | null>(null)
  const [typed, setTyped] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [best, writeBest] = useBest<Best>(`gauntlet-${mode}`, setId)
  const [isPending, startTransition] = useTransition()

  const cardById = new Map((plan?.cards ?? []).map((c) => [c.id, c]))
  const enc = state ? currentEncounter(state) : null
  const card = enc ? cardById.get(enc.cardId) : null

  function loadOptions(cardId: string, ask: 'term' | 'definition') {
    setOptions(null)
    startTransition(async () => {
      const res = await gauntletOptions(cardId, ask)
      if (!res.success) return void toast.error(res.error)
      setOptions({ cardId, ...res.data })
    })
  }

  function start() {
    startTransition(async () => {
      const res = await buildGauntletRun(setId, { mode })
      if (!res.success) return void toast.error(res.error)
      const s = createGauntlet(res.data, Date.now())
      setPlan(res.data)
      setState(s)
      setNote(null)
      setSaved(null)
      const first = res.data.encounters[0]
      if (mode === 'mc' && first) loadOptions(first.cardId, first.ask)
    })
  }

  function finish(next: GauntletState) {
    const done = summarize(next)
    if (!done) return
    if (!best || done.score > best.score) writeBest({ score: done.score })
    if (!signedIn) return
    startTransition(async () => {
      const res = await submitGameScore({ game: 'gauntlet', mode, setId, score: done.score, meta: { kills: done.kills, hp: done.hp, status: done.status } })
      if (res.success) setSaved(res.data.saved ? 'Saved to the leaderboard.' : res.data.reason === 'no_handle' ? 'Choose a handle in Account to appear on the leaderboard.' : null)
    })
  }

  function attack(hit: boolean, accuracy: number | undefined, now: number, said: string) {
    if (!state || !enc) return
    const next = reduceGauntlet(state, { type: 'attack', hit, accuracy, now })
    setState(next)
    setTyped('')
    setNote(said)
    if (next.phase === 'won' || next.phase === 'dead') return finish(next)
    // MC: a new enemy needs its options; the same enemy still standing keeps them.
    const nextEnc = currentEncounter(next)
    if (mode === 'mc' && nextEnc && next.index !== state.index) loadOptions(nextEnc.cardId, nextEnc.ask)
  }

  function pick(option: string, now: number) {
    if (!options || !enc) return
    const hit = option === options.correct
    attack(hit, undefined, now, hit ? 'A clean strike.' : `Miss — it was: ${options.correct}`)
  }

  function submitTyped(now: number, roll: number) {
    if (!card || typed.trim().length === 0) return
    startTransition(async () => {
      const res = await gradeGameAnswer(card.id, typed)
      if (!res.success) return void toast.error(res.error)
      const hit = rollHit(res.data.accuracy, roll)
      const pct = Math.round(res.data.accuracy * 100)
      attack(hit, res.data.accuracy, now, hit ? `${pct}% to hit — it lands.` : `${pct}% to hit — the swing goes wide.`)
    })
  }

  function magician(choice: 'heal' | 'weaken', now: number) {
    if (!state) return
    const next = reduceGauntlet(state, { type: 'magician', choice, now })
    setState(next)
    setNote(choice === 'heal' ? `The magician mends you for ${MAGICIAN_HEAL}.` : 'The magician curses the next foe — it hits for half and falls faster.')
    const nextEnc = currentEncounter(next)
    if (mode === 'mc' && nextEnc) loadOptions(nextEnc.cardId, nextEnc.ask)
  }

  // ------------------------------------------------------------ launch screen
  if (!plan || !state) {
    return (
      <div className="space-y-5">
        <div className="flex items-end gap-4 rounded-2xl bg-accent p-5">
          <PixelSprite sprite={KNIGHT} overlays={[KNIGHT_SHIELD]} size={72} label="The knight" />
          <p className="text-sm text-accent-foreground">
            Twelve enemies stand between you and the Examiner. A right answer is a strike; a wrong one is a miss, and they hit back — harder the further you get. Every third kill the magician offers a choice.
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-3 text-sm">
          <p><span className="font-semibold">Built from what you are weakest on.</span> Your least-confident cards become the champions and the boss. It only reads your memory; nothing here changes it.</p>
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="label mb-1">Mode</legend>
          {(['mc', 'sa'] as const).map((m) => (
            <label key={m} className={cn('cursor-pointer rounded-lg border p-3 text-sm', mode === m ? 'border-primary bg-accent' : 'border-border')}>
              <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
              <span className="font-semibold">{m === 'mc' ? 'Multiple choice' : 'Short answer'}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {m === 'mc' ? 'Four options per enemy; the wrong ones are written to sound right.' : 'Type the answer; your accuracy on the key points is your chance to hit, rolled in the open.'}
              </span>
            </label>
          ))}
        </fieldset>
        <CredentialNote calls={mode === 'mc' ? 'one call per card the first time anyone meets it (then cached)' : 'one call per swing'} extra="Falls back to plain options from the set when no credential is usable." />
        {best && <p className="text-xs text-muted-foreground">Your best on this device ({mode === 'mc' ? 'multiple choice' : 'short answer'}): {best.score}.</p>}
        <Button onClick={start} disabled={isPending}>{isPending ? 'Sharpening…' : 'Enter the gauntlet'}</Button>
      </div>
    )
  }

  // --------------------------------------------------------------- end screen
  const done = summarize(state)
  if (done) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto w-fit rounded-2xl bg-accent p-5">
          {done.status === 'won' ? <PixelSprite sprite={KNIGHT} overlays={[KNIGHT_SHIELD]} size={96} label="The knight, victorious" /> : <PixelSprite sprite={BOSS} size={96} label="The Examiner" />}
        </div>
        <h2 className="font-heading text-2xl font-bold">{done.status === 'won' ? 'The Examiner falls.' : 'The gauntlet got you.'}</h2>
        <p className="text-sm text-muted-foreground">
          <span className="metric text-lg font-semibold text-foreground">{done.score}</span> points · <span className="metric">{done.kills}</span> kills · <span className="metric">{done.hp}</span> HP left · best streak <span className="metric">{done.bestStreak}</span> · <span className="metric">{Math.round(done.elapsedMs / 1000)}s</span>
        </p>
        {saved && <p className="text-xs text-primary">{saved}</p>}
        <p className="text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
        <Button onClick={() => { setPlan(null); setState(null); setOptions(null) }}>Run it again</Button>
      </div>
    )
  }

  if (!enc || !card) return null
  const enemy = ENEMIES[enc.kind]
  const hitsTotal = Math.max(enemy.hits, state.enemyHitsLeft)
  const prompt = enc.ask === 'term' ? card.term : card.definition
  const isBoss = enc.kind === 'boss' || enc.kind === 'miniboss'

  return (
    <div className="space-y-4">
      {/* HUD */}
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs"><span className="inline-flex items-center gap-1 font-semibold"><Heart className="h-3.5 w-3.5 text-rose-500" aria-hidden="true" />You</span><span className="metric">{state.hp} / {MAX_HP}</span></div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${state.hp} of ${MAX_HP} HP`}>
            <div className={cn('h-full rounded-full transition-all', state.hp > 50 ? 'bg-success' : state.hp > 25 ? 'bg-warning' : 'bg-rose-500')} style={{ width: `${(state.hp / MAX_HP) * 100}%` }} />
          </div>
        </div>
        <div className="text-center text-xs text-muted-foreground">
          <span className="metric font-semibold text-foreground">{state.score}</span> pts · streak {state.streak}{state.weakened && <> · <Sparkles className="inline h-3 w-3" aria-hidden="true" /> cursed</>}
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between text-xs"><span className="inline-flex items-center gap-1 font-semibold"><Sword className="h-3.5 w-3.5" aria-hidden="true" />{enemy.name}</span><span className="metric">{state.enemyHitsLeft} / {hitsTotal}</span></div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`${enemy.name}: ${state.enemyHitsLeft} of ${hitsTotal} hits left`}>
            <div className="h-full rounded-full bg-rose-500 transition-all" style={{ width: `${(state.enemyHitsLeft / hitsTotal) * 100}%` }} />
          </div>
        </div>
      </div>

      {/* Run progress */}
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`enemy ${state.index + 1} of ${state.plan.encounters.length}`}>
        <div className="h-full bg-primary transition-all" style={{ width: `${(state.index / state.plan.encounters.length) * 100}%` }} />
      </div>

      {/* Scene */}
      <div className={cn('relative flex items-end justify-between rounded-2xl px-6 pb-2 pt-6', isBoss ? 'bg-violet-100 dark:bg-violet-950/40' : 'bg-accent')}>
        <PixelSprite sprite={KNIGHT} overlays={[KNIGHT_SHIELD]} size={88} label="You, the knight" className={cn(state.last && !state.last.hit && 'animate-pulse')} />
        <div className="pb-4 text-center text-xs text-muted-foreground">
          {note ?? (isBoss ? `${enemy.name} steps forward.` : `A ${enemy.name.toLowerCase()} blocks the way.`)}
        </div>
        {state.phase === 'magician' ? (
          <PixelSprite sprite={MAGICIAN} size={88} label="The magician" />
        ) : (
          <PixelSprite sprite={ENEMY_SPRITE[enc.kind]} size={enc.kind === 'boss' ? 104 : 88} flip label={enemy.name} className={cn(state.last?.hit && 'animate-pulse')} />
        )}
      </div>

      {state.phase === 'magician' ? (
        <div className="rounded-xl border border-violet-300 p-4 dark:border-violet-800">
          <p className="text-sm"><span className="font-semibold">The magician:</span> &ldquo;Three down. I can mend you, or I can weaken the next one. Choose.&rdquo;</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => magician('heal', Date.now())}><Heart className="h-4 w-4" aria-hidden="true" />Heal {MAGICIAN_HEAL} HP</Button>
            <Button variant="outline" onClick={() => magician('weaken', Date.now())}><Shield className="h-4 w-4" aria-hidden="true" />Weaken the next enemy</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="label mb-1">{enc.ask === 'term' ? 'Give the definition' : 'Name the term'}{isBoss && ` · hit ${hitsTotal - state.enemyHitsLeft + 1} of ${hitsTotal}`}</div>
            <p className="text-lg font-medium">{prompt}</p>
          </div>

          {mode === 'mc' ? (
            options && options.cardId === enc.cardId ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {options.options.map((o) => (
                  <button key={o} type="button" onClick={() => pick(o, Date.now())} className="rounded-lg border border-border bg-card px-4 py-3 text-left text-sm hover:border-primary/60">
                    {o}
                  </button>
                ))}
                {options.source === 'fallback' && <p className="text-xs text-muted-foreground sm:col-span-2">Plain options from the set — no usable credential for written distractors.</p>}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground" role="status">The enemy readies its answers…</p>
            )
          ) : (
            <form onSubmit={(e) => { e.preventDefault(); submitTyped(Date.now(), Math.random()) }} className="space-y-2">
              <Textarea value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your answer — your accuracy is your chance to hit" rows={3} className="resize-none" autoFocus />
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={isPending || typed.trim().length === 0}>{isPending ? 'Swinging…' : 'Strike'}</Button>
                {state.last?.accuracy !== undefined && <span className="text-xs text-muted-foreground">last swing: {Math.round((state.last.accuracy ?? 0) * 100)}% to hit</span>}
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}
