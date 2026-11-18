'use client'

import { useMemo, useState } from 'react'
import { demoExtractPoints, demoGrade } from '@/actions/demo'
import { DemoVerdicts, type DemoVerdictRow } from '@/components/demo/DemoVerdicts'
import { GeneratedPointsWarning } from '@/components/demo/GeneratedPointsWarning'
import { WaitlistPrompt } from '@/components/demo/WaitlistPrompt'
import { GradeCard } from '@/components/quiz/GradeCard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { filterCardsByCategories, UNCATEGORIZED_ID } from '@/lib/cards/categories'
import { GUEST_LIMITS } from '@/lib/demo/config'
import type { SignedPoints } from '@/lib/demo/signed-points'
import { markUsed, startGuestQuiz, type GuestState } from '@/lib/demo/store'
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

export function DemoQuiz({ cards }: { cards: DemoQuizCard[] }) {
  const [state, update, loaded] = useGuestState()
  const [source, setSource] = useState<'demo' | 'guest'>('demo')
  const [selected, setSelected] = useState<string[]>([])
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState('')
  const [graded, setGraded] = useState<Graded | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [prompt, setPrompt] = useState<{ open: boolean; reason: string }>({ open: false, reason: '' })

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

  const openPrompt = (reason: string) => setPrompt({ open: true, reason })
  const waitlistPrompt = (
    <WaitlistPrompt open={prompt.open} onOpenChange={(open) => setPrompt((p) => ({ ...p, open }))} reason={prompt.reason} />
  )

  // A server refusal: the prompt for the quota-style ones, an inline message for the rest.
  function refused(res: { reason: string; message: string }, feature: 'grade' | 'klp-extract', base: GuestState) {
    if (res.reason === 'quota_used') update(markUsed(base, feature))
    if (res.reason === 'quota_used' || res.reason === 'demo_cap') openPrompt(res.reason)
    else setMessage(res.reason === 'ai_failed' ? RETRY : res.message)
  }

  const demoPool = filterCardsByCategories(
    cards.map((c) => ({ ...c, categoryIds: c.categories.map((x) => x.name) })),
    selected,
  ).filter((c) => c.klps.length > 0)
  const poolSize = source === 'demo' ? demoPool.length : guestEligible.length

  async function start() {
    setMessage(null)
    const started = startGuestQuiz(state)
    if (!started.ok) {
      openPrompt('quizzes')
      return
    }
    let next = started.state
    update(next)
    setAnswer('')
    setGraded(null)
    if (source === 'demo') {
      const card = demoPool[Math.floor(Math.random() * demoPool.length)]
      if (card) setQuestion({ kind: 'demo', id: card.id, term: card.term, definition: card.definition })
      return
    }
    const guest = guestEligible[Math.floor(Math.random() * guestEligible.length)]
    if (!guest) return
    if (guest.points) {
      setQuestion({ kind: 'guest', id: guest.id, term: guest.term, definition: guest.definition, points: guest.points })
      return
    }
    setPending(true)
    try {
      const res = await demoExtractPoints({ card: { term: guest.term, definition: guest.definition } })
      if (!res.ok) return refused(res, 'klp-extract', next)
      next = markUsed(next, 'klp-extract')
      // Keep the signed points on the card so a later quiz does not extract again.
      update({
        ...next,
        set: next.set && {
          ...next.set,
          cards: next.set.cards.map((c) => (c.id === guest.id ? { ...c, points: res.data } : c)),
        },
      })
      setQuestion({ kind: 'guest', id: guest.id, term: guest.term, definition: guest.definition, points: res.data })
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
      if (!res.ok) return refused(res, 'grade', state)
      const { grade, verdicts, generatedPoints } = res.data
      // Verdicts are in the prompt's point order, so the position is the grader's klpRef.
      const rows = verdicts.map((v, i) => ({
        text: v.text,
        status: v.status,
        evidence: grade.klpResults?.find((r) => r.klpRef === i)?.evidence || undefined,
      }))
      update(markUsed(state, 'grade'))
      setGraded({ grade, rows, generatedPoints })
    } finally {
      setPending(false)
    }
  }

  function newQuiz() {
    if (state.quizzesStarted >= GUEST_LIMITS.quizzes) return openPrompt('quizzes')
    setQuestion(null)
    setGraded(null)
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
