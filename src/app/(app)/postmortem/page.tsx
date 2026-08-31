import Link from 'next/link'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowRight, CalendarDays, Clock3, NotebookPen, Plus, Target } from 'lucide-react'
import { listPostmortems } from '@/actions/postmortem'
import { postmortemFormatLabel } from '@/lib/postmortem/kinds'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function PostmortemPage() {
  const result = await listPostmortems()
  if (!result.success) redirect('/login?callbackUrl=%2Fpostmortem')
  const sessions = result.success ? result.data : []
  const interviewCount = sessions.filter((session) => session.format.includes('interview')).length
  const gapCount = sessions.filter((session) => session.gaps).length

  return (
    <div className="w-full max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <NotebookPen className="h-4 w-4" aria-hidden="true" />
            Offline evidence
          </div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Postmortem</h1>
          <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
            Turn paper tests, mock interviews, and real conversations into a trail your future self can use.
          </p>
        </div>
        <Button size="lg" render={<Link href="/postmortem/new" />}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Log an offline session
        </Button>
      </header>

      <section aria-label="Postmortem overview" className="grid gap-3 sm:grid-cols-3">
        <Card size="sm" className="bg-muted/20">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><CalendarDays className="h-4 w-4" aria-hidden="true" /></div>
            <div><p className="text-2xl font-semibold leading-none">{sessions.length}</p><p className="mt-1 text-xs text-muted-foreground">sessions logged</p></div>
          </CardContent>
        </Card>
        <Card size="sm" className="bg-muted/20">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><Target className="h-4 w-4" aria-hidden="true" /></div>
            <div><p className="text-2xl font-semibold leading-none">{interviewCount}</p><p className="mt-1 text-xs text-muted-foreground">interview debriefs</p></div>
          </CardContent>
        </Card>
        <Card size="sm" className="bg-muted/20">
          <CardContent className="flex items-center gap-3 py-4">
            <div className="rounded-lg bg-primary/10 p-2 text-primary"><ArrowRight className="h-4 w-4" aria-hidden="true" /></div>
            <div><p className="text-2xl font-semibold leading-none">{gapCount}</p><p className="mt-1 text-xs text-muted-foreground">with a gap to revisit</p></div>
          </CardContent>
        </Card>
      </section>

      {result.success && sessions.length > 0 ? (
        <section aria-labelledby="postmortem-history" className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="postmortem-history" className="text-sm font-semibold uppercase tracking-[0.12em] text-muted-foreground">Your debriefs</h2>
            <span className="text-xs text-muted-foreground">Newest first</span>
          </div>
          <div className="space-y-3">
            {sessions.map((session) => (
              <Link key={session.id} href={`/postmortem/${session.id}`} className="group block focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <Card className="transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-[var(--shadow-md)]">
                  <CardContent className="space-y-4 p-5 sm:p-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary">{postmortemFormatLabel(session.format)}</Badge>
                          {session.setTitle && <span className="text-xs text-muted-foreground">from {session.setTitle}</span>}
                        </div>
                        <h3 className="truncate text-lg font-semibold group-hover:text-primary">{session.title}</h3>
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span>{format(session.occurredAt, 'MMM d, yyyy')}</span>
                        {session.confidence && <span aria-label={`Felt ${session.confidence} out of 5`}>{session.confidence}/5</span>}
                      </div>
                    </div>
                    <p className="line-clamp-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{session.whatCameUp}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      {session.durationMin && <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{session.durationMin} min</span>}
                      {session.gaps && <span className="inline-flex items-center gap-1.5 text-foreground"><Target className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Gap captured</span>}
                      {session.nextSteps && <span className="inline-flex items-center gap-1.5 text-foreground"><ArrowRight className="h-3.5 w-3.5 text-primary" aria-hidden="true" />Next move captured</span>}
                      <span className="ml-auto inline-flex items-center gap-1 font-semibold text-primary">Open debrief <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" /></span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <Card className="border-dashed bg-muted/10">
          <CardContent className="flex flex-col items-center px-6 py-16 text-center">
            <div className="rounded-full bg-primary/10 p-3 text-primary"><NotebookPen className="h-6 w-6" aria-hidden="true" /></div>
            <h2 className="mt-4 text-lg font-semibold">Your offline practice starts here</h2>
            <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Log what happened while it is fresh. A two-minute debrief can become the best preparation for your next paper, case, or interview.
            </p>
            <Button className="mt-6" render={<Link href="/postmortem/new" />}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Log your first session
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
