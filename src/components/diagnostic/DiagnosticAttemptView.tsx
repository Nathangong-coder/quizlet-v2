import Link from 'next/link'
import { CheckCircle2, CircleAlert, History } from 'lucide-react'
import type { DiagnosticResult } from '@/actions/diagnostic'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

/**
 * A completed diagnostic, rendered the same way whether it was just submitted
 * or is being read back weeks later.
 *
 * One component rather than two so the live results screen and the past-attempt
 * page cannot drift — in particular so the legacy notice below cannot end up on
 * only one of them.
 *
 * `action` is whatever belongs in the header for the context: a "run another"
 * button on the live screen, a link back to the list on the history page.
 */
export function DiagnosticAttemptView({
  result,
  action,
}: {
  result: DiagnosticResult
  action?: React.ReactNode
}) {
  const strengths = result.report.strengths
  const gaps = result.report.gaps

  return (
    <div className="w-full max-w-5xl space-y-8">
      {result.engineVersion < 2 && <LegacyNotice />}

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Baseline complete · {result.setTitle}
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Your starting point is clear.</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{result.report.overview}</p>
        </div>
        {action}
      </header>

      <section aria-label="Diagnostic score" className="grid gap-3 sm:grid-cols-3">
        <Card className="bg-primary/[0.04] sm:col-span-1">
          <CardContent className="p-6">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Baseline score</p>
            <p className="mt-2 text-5xl font-semibold tracking-tight text-primary">
              {result.score}
              <span className="text-2xl text-muted-foreground">%</span>
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Across {result.questions.length} questions</p>
          </CardContent>
        </Card>
        <ResultList title="Strengths" items={strengths} tone="positive" />
        <ResultList title="Gaps to work" items={gaps} tone="attention" />
      </section>

      <Card>
        <CardContent className="space-y-5 p-6 sm:p-8">
          <div>
            <h2 className="text-lg font-semibold">What to do next</h2>
            <p className="mt-1 text-sm text-muted-foreground">These recommendations are grounded in this baseline, so your next study session has somewhere specific to start.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {result.report.recommendations.map((recommendation, index) => (
              <div key={`${recommendation}-${index}`} className="flex gap-3 rounded-lg border border-border bg-muted/10 p-4">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{index + 1}</span>
                <p className="text-sm leading-relaxed">{recommendation}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Key-point readout</h2>
          <p className="mt-1 text-sm text-muted-foreground">Each point is tied back to evidence from your answers.</p>
        </div>
        {result.report.learningPoints.map((point, index) => (
          <Card key={`${point.text}-${index}`}>
            <CardContent className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Key point</p>
                <p className="mt-2 text-sm font-semibold leading-relaxed">{point.text}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Evidence · {point.score}/10</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.evidence}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Next action</p>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{point.nextAction}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Question review</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your answers remain attached to the diagnostic so the feedback is concrete.</p>
        </div>
        {result.questions.map((question) => (
          <Card key={question.id}>
            <CardContent className="space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={question.status === 'mastered' ? 'secondary' : 'outline'}>{question.status}</Badge>
                  <span className="text-xs text-muted-foreground">{question.kind === 'follow-up' ? 'Follow-up' : 'Core question'}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums">{question.score}/10</span>
              </div>
              <h3 className="font-semibold leading-relaxed">{question.prompt}</h3>
              {result.engineVersion >= 2 && (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-semibold uppercase tracking-[0.12em]">Key point tested · </span>
                  {question.learningPoint}
                </p>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg bg-muted/20 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your answer</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{question.answer || 'No answer submitted'}</p>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Feedback</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{question.feedback}</p>
                  {question.mistake && (
                    <p className="mt-3 inline-flex gap-1.5 text-sm text-amber-700 dark:text-amber-200">
                      <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                      {question.mistake}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <p className="text-sm text-muted-foreground">
        Want to keep the context nearby?{' '}
        <Link href="/notes/new" className="font-semibold text-primary underline-offset-4 hover:underline">Capture a study note</Link>.
      </p>
    </div>
  )
}

/**
 * Shown on an attempt that ran before questions were anchored to key points.
 *
 * It says exactly what that run did and did not move. The alternative was to
 * guess which key point each free-text "learning point" had meant and write the
 * results in after the fact — for one attempt, of which only two of twelve
 * questions could have been matched unambiguously. A wrong match writes a false
 * fact into somebody's history that is indistinguishable from an observation,
 * so nothing was guessed and this says so instead.
 */
function LegacyNotice() {
  return (
    <div className="flex gap-3 rounded-lg border border-amber-400/40 bg-amber-300/[0.06] p-4">
      <History className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
      <div className="space-y-1 text-sm leading-relaxed">
        <p className="font-semibold">This diagnostic ran before key-point tracking.</p>
        <p className="text-muted-foreground">
          It moved your confidence on the cards it tested, but not your key-point mastery — its
          questions were not tied to the specific points behind each card, and nothing has been
          guessed after the fact.{' '}
          <Link href="/diagnostic" className="font-semibold text-primary underline-offset-4 hover:underline">
            Run a fresh one
          </Link>{' '}
          to have it count.
        </p>
      </div>
    </div>
  )
}

function ResultList({ title, items, tone }: { title: string; items: string[]; tone: 'positive' | 'attention' }) {
  return (
    <Card className={tone === 'attention' ? 'border-amber-400/40 bg-amber-300/[0.06]' : 'bg-muted/10'}>
      <CardContent className="p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{title}</p>
        {items.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {items.map((item) => (
              <li key={item} className="flex gap-2 text-sm leading-relaxed">
                <span
                  className={tone === 'attention' ? 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500' : 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary'}
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Nothing surfaced here in this pass.</p>
        )}
      </CardContent>
    </Card>
  )
}
