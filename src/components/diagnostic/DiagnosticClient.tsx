'use client'

import { useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronRight, History, Loader2, RefreshCw, Sparkles, Stethoscope } from 'lucide-react'
import Link from 'next/link'
import { startDiagnosticTest, submitDiagnosticTest } from '@/actions/diagnostic'
import type {
  DiagnosticHistoryItem,
  DiagnosticQuestionView,
  DiagnosticResult,
  DiagnosticSetOption,
} from '@/actions/diagnostic'
import { DiagnosticAttemptView } from '@/components/diagnostic/DiagnosticAttemptView'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Phase = 'setup' | 'generating' | 'testing' | 'submitting' | 'results'

const QUESTION_COUNTS = [12, 20, 30]

export function DiagnosticClient({ sets, history }: { sets: DiagnosticSetOption[]; history: DiagnosticHistoryItem[] }) {
  const [phase, setPhase] = useState<Phase>('setup')
  const [setId, setSetId] = useState(sets[0]?.id ?? '')
  const [questionCount, setQuestionCount] = useState(12)
  const [setTitle, setSetTitle] = useState('')
  const [attemptId, setAttemptId] = useState('')
  const [questions, setQuestions] = useState<DiagnosticQuestionView[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [startedAt, setStartedAt] = useState<Record<string, number>>({})
  const [currentIndex, setCurrentIndex] = useState(0)
  const [result, setResult] = useState<DiagnosticResult | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const currentQuestion = questions[currentIndex]
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] ?? '' : ''
  const selectedSet = sets.find((set) => set.id === setId)

  function reset() {
    setPhase('setup')
    setAttemptId('')
    setSetTitle('')
    setQuestions([])
    setAnswers({})
    setStartedAt({})
    setCurrentIndex(0)
    setResult(null)
    setMessage(null)
  }

  function begin() {
    if (!setId) {
      setMessage('Choose a study set first.')
      return
    }
    setMessage(null)
    setPhase('generating')
    startTransition(async () => {
      const response = await startDiagnosticTest({ setId, questionCount })
      if (!response.success) {
        setPhase('setup')
        setMessage(response.detail?.why ? `${response.error}: ${response.detail.why}` : response.error)
        return
      }
      setAttemptId(response.data.attemptId)
      setSetTitle(response.data.setTitle)
      setQuestions(response.data.questions)
      setCurrentIndex(0)
      setPhase('testing')
    })
  }

  function updateAnswer(value: string) {
    if (!currentQuestion) return
    setAnswers((current) => ({ ...current, [currentQuestion.id]: value }))
    setStartedAt((current) => current[currentQuestion.id] ? current : { ...current, [currentQuestion.id]: Date.now() })
  }

  function nextQuestion() {
    if (!currentQuestion) return
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((index) => index + 1)
      return
    }
    finish()
  }

  function finish() {
    if (!attemptId) return
    setMessage(null)
    setPhase('submitting')
    startTransition(async () => {
      const response = await submitDiagnosticTest({
        attemptId,
        answers: questions.map((question) => ({
          questionId: question.id,
          answer: answers[question.id] ?? '',
          latencyMs: startedAt[question.id] ? Date.now() - startedAt[question.id] : undefined,
        })),
      })
      if (!response.success) {
        setPhase('testing')
        setMessage(response.detail?.why ? `${response.error}: ${response.detail.why}` : response.error)
        return
      }
      setResult(response.data)
      setPhase('results')
    })
  }

  if (phase === 'generating') {
    return <DiagnosticLoading title={`Building a baseline for ${selectedSet?.title ?? 'your set'}`} body="AI is choosing broad coverage and follow-up questions so the first result is useful, not just fast." />
  }

  if (phase === 'submitting') {
    return <DiagnosticLoading title="Mapping your learning gaps" body="Your responses are being graded against the set, then turned into concrete next recommendations." />
  }

  if (phase === 'testing' && currentQuestion) {
    const isLast = currentIndex === questions.length - 1
    return (
      <div className="w-full max-w-3xl space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">Diagnostic · {setTitle}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Show what you know.</h1>
          </div>
          <p className="text-sm tabular-nums text-muted-foreground">{currentIndex + 1} of {questions.length}</p>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-label={`Question ${currentIndex + 1} of ${questions.length}`} role="progressbar" aria-valuemin={1} aria-valuemax={questions.length} aria-valuenow={currentIndex + 1}>
          <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }} />
        </div>

        <Card className="shadow-[var(--shadow-sm)]">
          <CardContent className="space-y-6 p-6 sm:p-9">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={currentQuestion.kind === 'follow-up' ? 'secondary' : 'outline'}>{currentQuestion.kind === 'follow-up' ? 'Follow-up' : 'Core question'}</Badge>
              <span className="text-xs text-muted-foreground">Open response · no notes</span>
            </div>
            <h2 className="max-w-2xl text-xl font-semibold leading-relaxed sm:text-2xl">{currentQuestion.prompt}</h2>
            <div className="space-y-2">
              <label htmlFor={`diagnostic-answer-${currentQuestion.id}`} className="text-sm font-semibold">Your answer</label>
              <Textarea
                id={`diagnostic-answer-${currentQuestion.id}`}
                value={currentAnswer}
                onChange={(event) => updateAnswer(event.target.value)}
                placeholder="Explain it in your own words…"
                rows={8}
                autoFocus
                className="resize-y text-base leading-7"
              />
            </div>
            {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{message}</p>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
              <Button type="button" variant="ghost" onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))} disabled={currentIndex === 0}>
                <ArrowLeft className="h-4 w-4" aria-hidden="true" />Back
              </Button>
              <Button type="button" onClick={nextQuestion} disabled={isPending}>
                {isLast ? 'Submit diagnostic' : 'Next question'}
                {isLast ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'results' && result) {
    return (
      <DiagnosticAttemptView
        result={result}
        action={
          <Button variant="outline" onClick={reset}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Run another diagnostic
          </Button>
        }
      />
    )
  }

  return (
    <div className="w-full max-w-4xl space-y-8">
      <header className="max-w-2xl space-y-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-primary"><Stethoscope className="h-4 w-4" aria-hidden="true" />Diagnostic test</div>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Find the gaps before they find you.</h1>
        <p className="text-base leading-relaxed text-muted-foreground">A diagnostic spans the set, asks follow-ups, and turns your first attempt into a focused starting point for recommendations.</p>
      </header>

      <Card className="shadow-[var(--shadow-sm)]">
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="flex items-start gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><Sparkles className="h-5 w-5" aria-hidden="true" /></div><div><h2 className="font-semibold">Choose your baseline</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">The set is used to generate the questions and to connect mistakes back to your study memory.</p></div></div>
          <div className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_180px]">
            <div className="space-y-2"><label htmlFor="diagnostic-set" className="text-sm font-semibold">Study set</label><select id="diagnostic-set" value={setId} onChange={(event) => setSetId(event.target.value)} disabled={sets.length === 0} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50"><option value="">Select a set…</option>{sets.map((set) => <option key={set.id} value={set.id}>{set.title} · {set.cardCount} cards</option>)}</select></div>
            <div className="space-y-2"><label htmlFor="diagnostic-count" className="text-sm font-semibold">Question count</label><select id="diagnostic-count" value={questionCount} onChange={(event) => setQuestionCount(Number(event.target.value))} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30">{QUESTION_COUNTS.map((count) => <option key={count} value={count}>{count} questions</option>)}</select></div>
          </div>
          {sets.length === 0 && <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">Create a study set with cards before starting a diagnostic.</p>}
          {message && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{message}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"><p className="max-w-lg text-xs leading-relaxed text-muted-foreground">You need an AI credential configured in Settings → AI. The diagnostic will not silently fall back to ungraded questions.</p><Button size="lg" onClick={begin} disabled={isPending || sets.length === 0}>{isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Stethoscope className="h-4 w-4" aria-hidden="true" />}Start diagnostic</Button></div>
        </CardContent>
      </Card>

      <PastDiagnostics history={history} />
    </div>
  )
}

/**
 * Finished diagnostics, so a run is something you can return to rather than a
 * page that vanishes when the tab closes.
 *
 * A pre-key-point attempt is labelled here as well as on its own page: the
 * reader should be able to tell, from the list, which of their results moved
 * their key-point mastery and which did not.
 */
function PastDiagnostics({ history }: { history: DiagnosticHistoryItem[] }) {
  if (history.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        Past diagnostics
      </div>
      <div className="space-y-2">
        {history.map((attempt) => (
          <Link
            key={attempt.id}
            href={`/diagnostic/${attempt.id}`}
            className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 transition-colors hover:bg-muted/40"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-semibold">{attempt.setTitle}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(attempt.completedAt).toLocaleDateString()} · {attempt.questionCount} questions
                {attempt.engineVersion < 2 && ' · not linked to key points'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="text-sm font-semibold tabular-nums">{attempt.score ?? '—'}%</span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  )
}

function DiagnosticLoading({ title, body }: { title: string; body: string }) {
  return <div className="flex min-h-[min(60vh,560px)] w-full max-w-3xl items-center justify-center"><Card className="w-full shadow-[var(--shadow-sm)]"><CardContent className="flex flex-col items-center px-6 py-16 text-center sm:px-12"><div className="rounded-full bg-primary/10 p-4 text-primary"><Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /></div><p className="mt-6 text-sm font-semibold text-primary">Preparing your diagnostic</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p></CardContent></Card></div>
}
