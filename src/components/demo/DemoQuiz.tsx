'use client'

import { useEffect, useMemo, useState } from 'react'
import { demoExtractPoints, demoGrade } from '@/actions/demo'
import { DemoVerdicts, type DemoVerdictRow } from '@/components/demo/DemoVerdicts'
import { GeneratedPointsWarning } from '@/components/demo/GeneratedPointsWarning'
import { WaitlistPrompt, type WaitlistReason } from '@/components/demo/WaitlistPrompt'
import { GradeCard } from '@/components/quiz/GradeCard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { filterCardsByCategories, UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { GUEST_LIMITS } from '@/lib/demo/config'
import type { SignedPoints } from '@/lib/demo/signed-points'
import { clearActiveQuestion, markUsed, startGuestQuiz, type ActiveQuestion, type GuestState } from '@/lib/demo/store'
import { useGuestState } from '@/lib/demo/use-guest-state'
import type { ShortAnswerGrade } from '@/lib/ai/schemas'
import { cn } from '@/lib/utils'

type DemoQuizCard = {
  id: string
  term: string
  definition: string
  categories: { name: string; color: string | null }[]
  klps: { id: string; text: string }[]
}

type Question =
  | { kind: 'demo'; id: string; term: string; definition: string }
  | { kind: 'guest'; id: string; term: string; definition: string; points: SignedPoints }

type Graded = { grade: ShortAnswerGrade; rows: DemoVerdictRow[]; generatedPoints: boolean }

const RETRY = 'The demo is having trouble. Try again.'

/**
 * The stored question, resolved against the card it names: a demo card from
 * the page's data, a guest card (with its points) from the guest's state.
 * Null when there is none, or when its card is gone (or lost its points to an
 * edit) — the quiz cannot be graded then.
 */
function resolveQuestion(active: ActiveQuestion | null, cards: DemoQuizCard[], state: GuestState): Question | null {
  if (!active) return null
  if (active.kind === 'demo') {
    const c = cards.find((x) => x.id === active.cardId)
    return c ? { kind: 'demo', id: c.id, term: c.term, definition: c.definition } : null
  }
  const g = state.set?.cards.find((x) => x.id === active.cardId)
  return g?.points ? { kind: 'guest', id: g.id, term: g.term, definition: g.definition, points: g.points } : null
}

const sameActive = (a: ActiveQuestion | null, b: ActiveQuestion | null) =>
  a === b || (!!a && !!b && a.kind === b.kind && a.cardId === b.cardId)

export function DemoQuiz({ cards }: { cards: DemoQuizCard[] }) {
  const [state, update, loaded] = useGuestState()
  const [source, setSource] = useState<'demo' | 'guest'>('demo')
  const [selected, setSelected] = useState<string[]>([])
  // The question lives in the guest's stored state until it is graded, so a
  // refresh brings it back; the graded result belongs to this view.
  const [done, setDone] = useState<{ question: Question; graded: Graded } | null>(null)
  const [answer, setAnswer] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ open: boolean; reason: WaitlistReason }>({ open: false, reason: 'invite' })

  const active = resolveQuestion(state.activeQuestion, cards, state)
  const dangling = loaded && state.activeQuestion !== null && active === null ? state.activeQuestion : null
  useEffect(() => {
    // The stored question's card no longer exists: forget the question — only
    // if it is still that one, never a newer quiz's.
    if (dangling) update((current) => (sameActive(current.activeQuestion, dangling) ? clearActiveQuestion(current) : current))
  }, [dangling, update])

  const guestCards = state.set?.cards ?? []
  const canExtract = !state.used['klp-extract']
  // A guest card is quizzable once it has points, or while the guest can still extract.
  const guestEligible = guestCards.filter((c) => c.points || canExtract)
  const chips = useMemo(() => {
    const names: string[] = []
    for (const c of cards) for (const cat of c.categories) if (!names.includes(cat.name)) names.push(cat.name)
    const list = names.map((n) => ({ id: n, label: n }))
    if (list.length > 0 && cards.some((c) => c.categories.length === 0)) list.push({ id: UNCATEGORIZED_ID, label: 'Uncategorized' })
    return list
  }, [cards])

  if (!loaded) return <div className="h-48 rounded-lg border border-border bg-muted/40" aria-hidden />

  const question = done?.question ?? active
  const graded = done?.graded ?? null

  const openPrompt = (reason: WaitlistReason) => setPrompt({ open: true, reason })
  const waitlistPrompt = (
    <WaitlistPrompt open={prompt.open} onOpenChange={(open) => setPrompt((p) => ({ ...p, open }))} reason={prompt.reason} />
  )

  // A server refusal: the prompt for the quota-style ones, an inline message for
  // the rest. Only quota_used marks the feature spent — ip_limit and demo_cap
  // never served the guest, so the try stays theirs.
  function refused(res: { reason: string; message: string }, feature: 'grade' | 'klp-extract') {
    if (res.reason === 'quota_used') update((current) => markUsed(current, feature))
    if (res.reason === 'quota_used' || res.reason === 'demo_cap' || res.reason === 'ip_limit') openPrompt(res.reason)
    else setMessage(res.reason === 'ai_failed' ? RETRY : res.message)
  }

  const demoPool = filterCardsByCategories(
    cards.map((c) => ({ ...c, categoryIds: c.categories.map((x) => x.name) })),
    selected,
  ).filter((c) => c.klps.length > 0)
  const poolSize = source === 'demo' ? demoPool.length : guestEligible.length

  async function start() {
    setMessage(null)
    if (state.quizzesStarted >= GUEST_LIMITS.quizzes) {
      openPrompt('quizzes')
      return
    }
    const pool = source === 'demo' ? demoPool : guestEligible
    const picked = pool[Math.floor(Math.random() * pool.length)]
    if (!picked) {
      setMessage('No cards are available for this source.')
      return
    }
    setAnswer('')
    setDone(null)
    const target: ActiveQuestion = { kind: source, cardId: picked.id }
    const guest = source === 'guest' ? (picked as (typeof guestCards)[number]) : null
    if (!guest || guest.points) {
      // One write counts the quiz and records its question.
      const started = startGuestQuiz(state, target)
      if (started.ok) update(started.state)
      else openPrompt('quizzes')
      return
    }
    // Extract FIRST: the quiz is only counted once a question will be shown, so a
    // provider failure never spends the guest's one quiz.
    setPending(true)
    try {
      const res = await demoExtractPoints({ card: { term: guest.term, definition: guest.definition } })
      if (!res.ok) return refused(res, 'klp-extract')
      let counted = false
      // After the await, build on the CURRENT record, not this render's state.
      update((current) => {
        // Keep the signed points on the card so a later quiz does not extract again.
        const used = markUsed(current, 'klp-extract')
        const withPoints: GuestState = {
          ...used,
          set: used.set && {
            ...used.set,
            cards: used.set.cards.map((c) => (c.id === guest.id ? { ...c, points: res.data } : c)),
          },
        }
        const started = startGuestQuiz(withPoints, target)
        counted = started.ok
        return started.ok ? started.state : withPoints
      })
      if (!counted) openPrompt('quizzes')
    } catch {
      // A thrown action (network, server error): nothing was counted.
      setMessage(RETRY)
    } finally {
      setPending(false)
    }
  }

  async function submit() {
    if (!question || !answer.trim()) return
    setMessage(null)
    if (state.used.grade) {
      openPrompt('quota_used')
      return
    }
    setPending(true)
    try {
      const res = await demoGrade(
        question.kind === 'demo'
          ? { kind: 'demo', cardId: question.id, answer }
          : { kind: 'guest', card: { term: question.term, definition: question.definition }, points: question.points, answer },
      )
      if (!res.ok) return refused(res, 'grade')
      const { grade, verdicts, generatedPoints } = res.data
      // Verdicts are in the prompt's point order, so the position is the grader's klpRef.
      const rows = verdicts.map((v, i) => ({
        text: v.text,
        status: v.status,
        evidence: grade.klpResults?.find((r) => r.klpRef === i)?.evidence || undefined,
      }))
      // The grade landed: the quiz is over, so its question no longer needs restoring.
      update((current) => clearActiveQuestion(markUsed(current, 'grade')))
      setDone({ question, graded: { grade, rows, generatedPoints } })
    } catch {
      // A thrown action (network, server error): the answer stays for a retry.
      setMessage(RETRY)
    } finally {
      setPending(false)
    }
  }

  function newQuiz() {
    if (state.quizzesStarted >= GUEST_LIMITS.quizzes) return openPrompt('quizzes')
    setDone(null)
  }

  if (!question) {
    return (
      <div className="space-y-5">
        <p className="text-sm text-muted-foreground">Short answer, 1 question. You write the answer; it is graded point by point.</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Source">
          <Button type="button" variant={source === 'demo' ? 'default' : 'outline'} aria-pressed={source === 'demo'} onClick={() => setSource('demo')}>
            Demo set
          </Button>
          <Button
            type="button"
            variant={source === 'guest' ? 'default' : 'outline'}
            aria-pressed={source === 'guest'}
            disabled={guestCards.length === 0}
            onClick={() => setSource('guest')}
          >
            My cards
          </Button>
        </div>
        {source === 'demo' && chips.length > 0 && (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
            {chips.map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={selected.includes(c.id)}
                onClick={() => setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm',
                  selected.includes(c.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {message && (
          <p role="alert" className="text-sm text-destructive">
            {message}
          </p>
        )}
        <Button onClick={start} disabled={pending || poolSize === 0}>
          {pending ? 'Preparing…' : 'Start quiz'}
        </Button>
        {poolSize === 0 && <p className="text-sm text-muted-foreground">No cards are available for this source.</p>}
        {waitlistPrompt}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {question.kind === 'guest' && <GeneratedPointsWarning />}
      <div className="space-y-2 rounded-lg border border-border bg-card p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">Question 1 of 1</p>
        <p className="break-words text-lg">{question.term}</p>
      </div>
      <div className="space-y-2">
        <label htmlFor="demo-answer" className="text-sm font-medium">
          Your answer
        </label>
        <Textarea id="demo-answer" value={answer} maxLength={2000} readOnly={!!graded} onChange={(e) => setAnswer(e.target.value)} />
      </div>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      {graded ? (
        <div className="space-y-4">
          <DemoVerdicts rows={graded.rows} />
          <GradeCard grade={graded.grade} />
          {graded.generatedPoints && <GeneratedPointsWarning />}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => openPrompt('questions')}>Next question</Button>
            <Button variant="outline" onClick={newQuiz}>
              New quiz
            </Button>
          </div>
        </div>
      ) : (
        <Button onClick={submit} disabled={pending || !answer.trim()}>
          {pending ? 'Grading…' : 'Submit answer'}
        </Button>
      )}
      {waitlistPrompt}
    </div>
  )
}
