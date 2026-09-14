'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { startHotSeat, gradeGameAnswer, probeHotSeat, submitGameScore } from '@/actions/games'
import {
  createHotSeat,
  reduceHotSeat,
  probeTarget,
  verdictFor,
  transcript,
  faceFor,
  HOT_SEAT_SECONDS,
  HOT_SEAT_MODES,
  type HotSeatState,
  type HotSeatMode,
  type Face,
} from '@/lib/games/hot-seat'
import type { Persona } from '@/lib/games/personas'
import { HOST_BASE, FACES, COSTUMES } from '@/lib/games/sprites'
import { PixelSprite } from '@/components/games/PixelSprite'
import { betterOf } from '@/lib/games/best'
import { useBest } from '@/lib/games/use-best'
import { CredentialNote } from '@/components/games/GameFrame'
import { cn } from '@/lib/utils'

/**
 * Hot Seat. The reducer owns mood and phases; this component owns the clock,
 * the two text boxes, the interviewer's face, and the three server calls.
 *
 * What the learner sees after an answer is the FACE and the follow-up —
 * never the list of missed points (owner's call: the game should feel like
 * an interview, where nobody hands you the rubric). The transcript at the
 * end shows the points, once the interview is over.
 */
export function HotSeatGame({ setId, signedIn }: { setId: string; signedIn: boolean }) {
  const [mode, setMode] = useState<HotSeatMode>('normal')
  const [persona, setPersona] = useState<Persona | null>(null)
  const [costume, setCostume] = useState<string>('default')
  const [state, setState] = useState<HotSeatState | null>(null)
  const [face, setFace] = useState<Face>('neutral')
  const [answer, setAnswer] = useState('')
  const [reply, setReply] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(HOT_SEAT_SECONDS)
  const [copied, setCopied] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)
  const [best, writeBest] = useBest<number>(`hot-seat-${mode}`, setId)
  const [isPending, startTransition] = useTransition()

  const asking = state?.phase === 'asking'
  const submitRef = useRef<(timedOut: boolean) => void>(() => {})
  useEffect(() => {
    if (!asking) return
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id)
          queueMicrotask(() => submitRef.current(true))
          return 0
        }
        return s - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [asking, state?.index])

  function start() {
    startTransition(async () => {
      const res = await startHotSeat(setId, mode)
      if (!res.success) return void toast.error(res.error)
      if (res.data.cards.length === 0) return void toast.error('No cards with key points yet')
      setPersona(res.data.persona)
      setCostume(res.data.costume)
      setState(createHotSeat(res.data.cards, mode))
      setFace('neutral')
      setSecondsLeft(HOT_SEAT_SECONDS)
      setAnswer('')
      setReply('')
      setSaved(null)
    })
  }

  function submit(timedOut: boolean) {
    if (!state || state.phase !== 'asking') return
    const card = state.cards[state.index]
    const text = answer.trim() || '(no answer)'
    const afterSubmit = reduceHotSeat(state, { type: 'submit', answer: text, timedOut })
    setState(afterSubmit)
    setAnswer('')
    startTransition(async () => {
      const res = await gradeGameAnswer(card.id, text)
      if (!res.success) {
        toast.error(res.error)
        setState((s) => (s ? reduceHotSeat(reduceHotSeat(s, { type: 'graded', verdicts: [] }), { type: 'skip-probe' }) : s))
        return
      }
      setFace(faceFor(res.data.verdicts))
      const graded = reduceHotSeat(afterSubmit, { type: 'graded', verdicts: res.data.verdicts })
      setState(graded)
      const target = probeTarget(res.data.verdicts)
      if (graded.phase === 'probing' && target && persona) {
        const p = await probeHotSeat(card.id, target.klpId, text, persona)
        if (!p.success) {
          toast.error(p.error)
          setState((s) => (s ? reduceHotSeat(s, { type: 'skip-probe' }) : s))
          return
        }
        setState((s) => (s ? reduceHotSeat(s, { type: 'probe', klpId: target.klpId, question: p.data.question }) : s))
      }
    })
  }

  useEffect(() => {
    submitRef.current = submit
  })

  function submitReply() {
    if (!state || state.phase !== 'probing') return
    const turn = state.turns[state.index]
    const card = state.cards[state.index]
    const text = reply.trim()
    if (!text || !turn.probeKlpId) return
    const afterSubmit = reduceHotSeat(state, { type: 'probe-submit', answer: text })
    setState(afterSubmit)
    setReply('')
    startTransition(async () => {
      const res = await gradeGameAnswer(card.id, text, { klpIds: [turn.probeKlpId!] })
      const recovered = res.success && res.data.verdicts.every((v) => v.status === 'passed')
      if (!res.success) toast.error(res.error)
      setFace(recovered ? 'pleased' : 'skeptical')
      setState((s) => (s ? reduceHotSeat(s, { type: 'probe-graded', recovered }) : s))
    })
  }

  function next() {
    if (!state) return
    const n = reduceHotSeat(state, { type: 'next' })
    setState(n)
    setFace('neutral')
    setSecondsLeft(HOT_SEAT_SECONDS)
    if (n.phase === 'done') {
      const mood = Math.round(n.mood)
      writeBest(betterOf(best, mood, true))
      if (!signedIn) return
      startTransition(async () => {
        const res = await submitGameScore({ game: 'hot-seat', mode, setId, score: mood, meta: { rounds: n.cards.length, verdict: verdictFor(n.mood) } })
        if (res.success) setSaved(res.data.saved ? 'Saved to the leaderboard.' : res.data.reason === 'no_handle' ? 'Choose a handle in Account to appear on the leaderboard.' : null)
      })
    }
  }

  async function copyTranscript() {
    if (!state || !persona) return
    try {
      await navigator.clipboard.writeText(transcript(state, persona))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy')
    }
  }

  const host = (f: Face, size = 96) => (
    <PixelSprite sprite={HOST_BASE} overlays={[COSTUMES[costume]?.overlay ?? COSTUMES.default.overlay, FACES[f]]} size={size} label={`${persona?.name ?? 'The interviewer'}, ${f}`} />
  )

  // ------------------------------------------------------------ launch screen
  if (!state || !persona) {
    return (
      <div className="space-y-5">
        <div className="flex items-end gap-4 rounded-2xl bg-accent p-5">
          <PixelSprite sprite={HOST_BASE} overlays={[FACES.neutral]} size={72} label="The interviewer" />
          <p className="text-sm text-accent-foreground">
            An interviewer, a soft clock, and a mood you can read on their face. Miss a point and they probe it — you get one reply. Callback or no callback at the end. The interviewer dresses for the subject.
          </p>
        </div>
        <fieldset className="grid gap-2 sm:grid-cols-3">
          <legend className="label mb-1">Difficulty</legend>
          {(Object.keys(HOT_SEAT_MODES) as HotSeatMode[]).map((m) => {
            const c = HOT_SEAT_MODES[m]
            return (
              <label key={m} className={cn('cursor-pointer rounded-lg border p-3 text-sm', mode === m ? 'border-primary bg-accent' : 'border-border')}>
                <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="sr-only" />
                <span className="font-semibold">{c.label}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{c.rounds} questions · patience {c.decay === 1 ? 'normal' : c.decay > 1 ? 'thin' : 'generous'} · recovery {Math.round(c.recovery * 100)}%</span>
              </label>
            )
          })}
        </fieldset>
        <CredentialNote calls={`${HOT_SEAT_MODES[mode].rounds} to ${HOT_SEAT_MODES[mode].rounds * 2} calls for a full interview`} />
        {best !== null && <p className="text-xs text-muted-foreground">Your best mood on this device ({HOT_SEAT_MODES[mode].label.toLowerCase()}): {best}.</p>}
        <Button onClick={start} disabled={isPending}>{isPending ? 'Taking a seat…' : 'Take the hot seat'}</Button>
      </div>
    )
  }

  const turn = state.turns[state.index]
  const card = state.cards[state.index]

  // --------------------------------------------------------------- end screen
  if (state.phase === 'done') {
    const v = verdictFor(state.mood)
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center text-center">
          {host(v === 'callback' ? 'impressed' : v === 'maybe' ? 'neutral' : 'annoyed', 112)}
          <div className="label mt-2">{persona.name}</div>
          <h2 className={cn('mt-1 font-heading text-3xl font-bold', v === 'callback' ? 'text-success' : v === 'maybe' ? 'text-warning' : 'text-muted-foreground')}>
            {v === 'callback' ? 'Callback.' : v === 'maybe' ? 'We’ll be in touch.' : 'No callback.'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Final mood <span className="metric">{Math.round(state.mood)}</span> / 100 · {HOT_SEAT_MODES[state.mode].label}</p>
          {saved && <p className="mt-1 text-xs text-primary">{saved}</p>}
        </div>
        <ol className="space-y-4">
          {state.turns.map((t, i) => (
            <li key={i} className="rounded-lg border border-border p-4 text-sm">
              <div className="font-medium">{i + 1}. {state.cards[i].term}</div>
              <p className="mt-1 italic text-muted-foreground">{t.answer}{t.timedOut ? ' [time]' : ''}</p>
              {/* The points, shown only now that the interview is over. */}
              <ul className="mt-2 space-y-1">
                {(t.verdicts ?? []).map((vd) => (
                  <li key={vd.klpId} className={cn('flex gap-2', vd.status === 'passed' ? 'text-success' : vd.status === 'partial' ? 'text-warning' : 'text-muted-foreground')}>
                    <span aria-hidden="true">{vd.status === 'passed' ? '✓' : vd.status === 'partial' ? '½' : '✗'}</span>{vd.text}
                  </li>
                ))}
              </ul>
              {t.probeQuestion && (
                <div className="mt-2 border-l-2 border-border pl-3">
                  <p><span className="font-medium">{persona.name}:</span> {t.probeQuestion}</p>
                  <p className="italic text-muted-foreground">{t.probeAnswer ?? '(no reply)'} {t.probeRecovered === null ? '' : t.probeRecovered ? '· recovered' : '· still missing'}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={copyTranscript}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? 'Copied' : 'Copy transcript'}</Button>
          <Button onClick={() => { setState(null); setPersona(null) }}>Another interview</Button>
        </div>
        <p className="text-xs text-muted-foreground">Nothing here was saved to your memory.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4 rounded-2xl bg-accent p-4">
        {host(face, 96)}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{persona.name} · mood</span><span className="metric">{Math.round(state.mood)}</span></div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-background/60" role="img" aria-label={`mood ${Math.round(state.mood)} of 100`}>
            <div className={cn('h-full rounded-full transition-all', state.mood >= 65 ? 'bg-success' : state.mood >= 40 ? 'bg-warning' : 'bg-rose-500')} style={{ width: `${state.mood}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>question {state.index + 1} of {state.cards.length} · {HOT_SEAT_MODES[state.mode].label}</span>
            {state.phase === 'asking' && <span className={cn('metric', secondsLeft <= 10 && 'text-warning')}>{Math.max(0, secondsLeft)}s</span>}
          </div>
          {state.index === 0 && state.phase === 'asking' && !turn.answer && <p className="mt-2 text-sm italic text-muted-foreground">&ldquo;{persona.opening}&rdquo;</p>}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <div className="label mb-1">{persona.name} asks</div>
        <p className="text-lg font-medium">{card.term}</p>
      </div>

      {state.phase === 'asking' && (
        <form onSubmit={(e) => { e.preventDefault(); submit(false) }} className="space-y-2">
          <Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Answer in your own words" rows={5} className="resize-none" autoFocus />
          <Button type="submit" disabled={isPending}>Answer</Button>
        </form>
      )}

      {state.phase === 'grading' && <p className="text-sm text-muted-foreground" role="status">{persona.name} is listening…</p>}

      {state.phase === 'probing' && !turn.probeQuestion && <p className="text-sm text-muted-foreground" role="status">{persona.name} leans in…</p>}

      {state.phase === 'probing' && turn.probeQuestion && (
        <form onSubmit={(e) => { e.preventDefault(); submitReply() }} className="space-y-2 rounded-lg bg-warning-subtle p-4">
          <p className="text-sm"><span className="font-semibold">{persona.name}:</span> {turn.probeQuestion}</p>
          <Textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="One shot to recover" rows={3} className="resize-none" autoFocus />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={isPending || reply.trim().length === 0}>Reply</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setState(reduceHotSeat(state, { type: 'skip-probe' }))}>Pass</Button>
          </div>
        </form>
      )}

      {state.phase === 'probe-grading' && <p className="text-sm text-muted-foreground" role="status">Considering your reply…</p>}

      {state.phase === 'reviewing' && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {turn.probeRecovered === true ? 'They nod.' : turn.probeRecovered === false ? 'They move on.' : face === 'impressed' ? 'That landed.' : face === 'pleased' ? 'Good.' : 'Noted.'}
          </span>
          <Button onClick={next}>{state.index + 1 >= state.cards.length ? 'See the verdict' : 'Next question'}</Button>
        </div>
      )}
    </div>
  )
}
