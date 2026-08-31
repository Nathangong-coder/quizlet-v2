'use client'

import { useState, useTransition } from 'react'
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Loader2, RefreshCw, Sparkles, Stethoscope } from 'lucide-react'
import Link from 'next/link'
import { startDiagnosticTest, submitDiagnosticTest } from '@/actions/diagnostic'
import type { DiagnosticQuestionView, DiagnosticResult, DiagnosticSetOption } from '@/actions/diagnostic'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'

type Phase = 'setup' | 'generating' | 'testing' | 'submitting' | 'results'

const QUESTION_COUNTS = [12, 20, 30]

export function DiagnosticClient({ sets }: { sets: DiagnosticSetOption[] }) {
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

  if (phase === 'results' && result) return <DiagnosticResults result={result} onReset={reset} />

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
    </div>
  )
}

function DiagnosticLoading({ title, body }: { title: string; body: string }) {
  return <div className="flex min-h-[min(60vh,560px)] w-full max-w-3xl items-center justify-center"><Card className="w-full shadow-[var(--shadow-sm)]"><CardContent className="flex flex-col items-center px-6 py-16 text-center sm:px-12"><div className="rounded-full bg-primary/10 p-4 text-primary"><Loader2 className="h-7 w-7 animate-spin" aria-hidden="true" /></div><p className="mt-6 text-sm font-semibold text-primary">Preparing your diagnostic</p><h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1><p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p></CardContent></Card></div>
}

function DiagnosticResults({ result, onReset }: { result: DiagnosticResult; onReset: () => void }) {
  const strengths = result.report.strengths
  const gaps = result.report.gaps
  return (
    <div className="w-full max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4"><div className="max-w-2xl space-y-2"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Baseline complete · {result.setTitle}</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your starting point is clear.</h1><p className="text-base leading-relaxed text-muted-foreground">{result.report.overview}</p></div><Button variant="outline" onClick={onReset}><RefreshCw className="h-4 w-4" aria-hidden="true" />Run another diagnostic</Button></header>
      <section aria-label="Diagnostic score" className="grid gap-3 sm:grid-cols-3"><Card className="bg-primary/[0.04] sm:col-span-1"><CardContent className="p-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Baseline score</p><p className="mt-2 text-5xl font-semibold tracking-tight text-primary">{result.score}<span className="text-2xl text-muted-foreground">%</span></p><p className="mt-2 text-sm text-muted-foreground">Across {result.questions.length} questions</p></CardContent></Card><ResultList title="Strengths" items={strengths} tone="positive" /><ResultList title="Gaps to work" items={gaps} tone="attention" /></section>

      <Card><CardContent className="space-y-5 p-6 sm:p-8"><div><h2 className="text-lg font-semibold">What to do next</h2><p className="mt-1 text-sm text-muted-foreground">These recommendations are grounded in this baseline, so your next study session has somewhere specific to start.</p></div><div className="grid gap-3 md:grid-cols-2">{result.report.recommendations.map((recommendation, index) => <div key={`${recommendation}-${index}`} className="flex gap-3 rounded-lg border border-border bg-muted/10 p-4"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span><p className="text-sm leading-relaxed">{recommendation}</p></div>)}</div></CardContent></Card>

      <section className="space-y-3"><div><h2 className="text-lg font-semibold">Learning-point readout</h2><p className="mt-1 text-sm text-muted-foreground">Each point is tied back to evidence from your answers.</p></div>{result.report.learningPoints.map((point, index) => <Card key={`${point.text}-${index}`}><CardContent className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Learning point</p><p className="mt-2 text-sm font-semibold leading-relaxed">{point.text}</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Evidence · {point.score}/10</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.evidence}</p></div><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next action</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.nextAction}</p></div></CardContent></Card>)}</section>

      <section className="space-y-3"><div><h2 className="text-lg font-semibold">Question review</h2><p className="mt-1 text-sm text-muted-foreground">Your answers remain attached to the diagnostic so the feedback is concrete.</p></div>{result.questions.map((question) => <Card key={question.id}><CardContent className="space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><Badge variant={question.status === 'mastered' ? 'secondary' : 'outline'}>{question.status}</Badge><span className="text-xs text-muted-foreground">{question.kind === 'follow-up' ? 'Follow-up' : 'Core question'}</span></div><span className="text-sm font-semibold tabular-nums">{question.score}/10</span></div><h3 className="font-semibold leading-relaxed">{question.prompt}</h3><div className="grid gap-3 md:grid-cols-2"><div className="rounded-lg bg-muted/20 p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your answer</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{question.answer || 'No answer submitted'}</p></div><div className="rounded-lg border border-border p-4"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Feedback</p><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{question.feedback}</p>{question.mistake && <p className="mt-3 inline-flex gap-1.5 text-sm text-amber-700 dark:text-amber-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{question.mistake}</p>}</div></div></CardContent></Card>)}</section>
      <p className="text-sm text-muted-foreground">Want to keep the context nearby? <Link href="/notes/new" className="font-semibold text-primary underline-offset-4 hover:underline">Capture a study note</Link>.</p>
    </div>
  )
}

function ResultList({ title, items, tone }: { title: string; items: string[]; tone: 'positive' | 'attention' }) {
  return <Card className={tone === 'attention' ? 'border-amber-400/40 bg-amber-300/[0.06]' : 'bg-muted/10'}><CardContent className="p-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>{items.length > 0 ? <ul className="mt-3 space-y-2">{items.map((item) => <li key={item} className="flex gap-2 text-sm leading-relaxed"><span className={tone === 'attention' ? 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500' : 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary'} aria-hidden="true" />{item}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">Nothing surfaced here in this pass.</p>}</CardContent></Card>
}
