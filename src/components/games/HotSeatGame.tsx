'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { startHotSeat, gradeGameAnswer, probeHotSeat } from '@/actions/games'
import {
  createHotSeat,
  reduceHotSeat,
  probeTarget,
  verdictFor,
  transcript,
  HOT_SEAT_SECONDS,
  type HotSeatState,
} from '@/lib/games/hot-seat'
import type { Persona } from '@/lib/games/personas'
import { betterOf } from '@/lib/games/best'
import { useBest } from '@/lib/games/use-best'
import { CredentialNote } from '@/components/games/GameFrame'
import { cn } from '@/lib/utils'

/**
 * Hot Seat. The reducer owns mood and phases; this component owns the clock,
 * the two text boxes, and the three server calls (grade, probe, grade the
 * reply). A grading failure ends the question as "reviewing" with a toast —
 * the interview goes on.
 */
export function HotSeatGame({ setId }: { setId: string }) {
  const [persona, setPersona] = useState<Persona | null>(null)
  const [state, setState] = useState<HotSeatState | null>(null)
  const [answer, setAnswer] = useState('')
  const [reply, setReply] = useState('')
  const [secondsLeft, setSecondsLeft] = useState(HOT_SEAT_SECONDS)
  const [copied, setCopied] = useState(false)
  const [best, writeBest] = useBest<number>('hot-seat', setId)
  const [isPending, startTransition] = useTransition()

  // The soft clock. The interval only ticks the display; the ZERO crossing is
  // detected inside the tick and submits through a ref to the latest
  // `submit`, so no effect ever calls setState synchronously or closes over a
  // stale handler. The counter is reset by the handlers that start a question.
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
      const res = await startHotSeat(setId)
      if (!res.success) return void toast.error(res.error)
      if (res.data.cards.length === 0) return void toast.error('No cards with key points yet')
      setPersona(res.data.persona)
      setState(createHotSeat(res.data.cards))
      setSecondsLeft(HOT_SEAT_SECONDS)
      setAnswer('')
      setReply('')
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
        // Grade as all-failed so the interview keeps moving, then skip the probe.
        setState((s) => (s ? reduceHotSeat(reduceHotSeat(s, { type: 'graded', verdicts: [] }), { type: 'skip-probe' }) : s))
        return
      }
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
      setState((s) => (s ? reduceHotSeat(s, { type: 'probe-graded', recovered }) : s))
    })
  }

  function next() {
    if (!state) return
    const n = reduceHotSeat(state, { type: 'next' })
    setState(n)
    setSecondsLeft(HOT_SEAT_SECONDS)
    if (n.phase === 'done') writeBest(betterOf(best, Math.round(n.mood), true))
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

  // ------------------------------------------------------------ launch screen
  if (!state || !persona) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Five questions, a soft clock, an interviewer whose mood you can see. Miss a point and they probe it; recover and the mood comes back. Callback or no callback at the end.
        </p>
        <CredentialNote calls="five to ten calls for a full interview" />
        {best !== null && <p className="text-xs text-muted-foreground">Your best mood on this device: {best}.</p>}
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
        <div className="text-center">
          <div className="label">{persona.name}</div>
          <h2 className={cn('mt-1 font-heading text-3xl font-bold', v === 'callback' ? 'text-success' : v === 'maybe' ? 'text-warning' : 'text-muted-foreground')}>
            {v === 'callback' ? 'Callback.' : v === 'maybe' ? 'We’ll be in touch.' : 'No callback.'}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Final mood <span className="metric">{Math.round(state.mood)}</span> / 100</p>
        </div>
        <ol className="space-y-4">
          {state.turns.map((t, i) => (
            <li key={i} className="rounded-lg border border-border p-4 text-sm">
              <div className="font-medium">{i + 1}. {state.cards[i].term}</div>
              <p className="mt-1 italic text-muted-foreground">{t.answer}{t.timedOut ? ' [time]' : ''}</p>
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
    <div className="space-y-5">
      <div>
        <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>{persona.name} · mood</span><span className="metric">{Math.round(state.mood)}</span></div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={`mood ${Math.round(state.mood)} of 100`}>
          <div className={cn('h-full rounded-full transition-all', state.mood >= 65 ? 'bg-success' : state.mood >= 40 ? 'bg-warning' : 'bg-rose-500')} style={{ width: `${state.mood}%` }} />
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>question {state.index + 1} of {state.cards.length}</span>
        {state.phase === 'asking' && <span className={cn('metric', secondsLeft <= 10 && 'text-warning')}>{Math.max(0, secondsLeft)}s</span>}
      </div>

      {state.index === 0 && state.phase === 'asking' && !turn.answer && <p className="text-sm italic text-muted-foreground">&ldquo;{persona.opening}&rdquo;</p>}

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

      {(state.phase === 'probing' || state.phase === 'probe-grading' || state.phase === 'reviewing') && turn.verdicts && (
        <ul className="space-y-1 text-sm">
          {turn.verdicts.map((vd) => (
            <li key={vd.klpId} className={cn('flex gap-2', vd.status === 'passed' ? 'text-success' : vd.status === 'partial' ? 'text-warning' : 'text-muted-foreground')}>
              <span aria-hidden="true">{vd.status === 'passed' ? '✓' : vd.status === 'partial' ? '½' : '✗'}</span>{vd.text}
            </li>
          ))}
        </ul>
      )}

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
          {turn.probeRecovered !== null && <span className={cn('text-sm', turn.probeRecovered ? 'text-success' : 'text-muted-foreground')}>{turn.probeRecovered ? 'Recovered.' : 'Still missing.'}</span>}
          <Button onClick={next}>{state.index + 1 >= state.cards.length ? 'See the verdict' : 'Next question'}</Button>
        </div>
      )}
    </div>
  )
}
