import Link from 'next/link'
import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { ArrowLeft, ArrowRight, CalendarDays, Clock3, Pencil, Target } from 'lucide-react'
import { getPostmortem } from '@/actions/postmortem'
import { postmortemFormatLabel } from '@/lib/postmortem/kinds'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PostmortemDeleteButton } from '@/components/postmortem/PostmortemDeleteButton'

export default async function PostmortemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getPostmortem(id)
  if (!result.success) notFound()
  const postmortem = result.data

  return (
    <div className="w-full max-w-4xl space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" render={<Link href="/postmortem" />}>
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All postmortems
        </Button>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" render={<Link href={`/postmortem/${id}/edit`} />}>
            <Pencil className="h-4 w-4" aria-hidden="true" />
            Edit
          </Button>
          <PostmortemDeleteButton id={id} />
        </div>
      </div>

      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{postmortemFormatLabel(postmortem.format)}</Badge>
          {postmortem.setTitle && <span className="text-sm text-muted-foreground">connected to {postmortem.setTitle}</span>}
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{postmortem.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" aria-hidden="true" />{format(postmortem.occurredAt, 'MMMM d, yyyy')}</span>
            {postmortem.durationMin && <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" aria-hidden="true" />{postmortem.durationMin} minutes</span>}
            {postmortem.confidence && <span className="inline-flex items-center gap-1.5"><Target className="h-4 w-4" aria-hidden="true" />Felt {postmortem.confidence}/5</span>}
          </div>
        </div>
      </header>

      <Card className="border-primary/20 bg-primary/[0.035]">
        <CardContent className="p-6 sm:p-8">
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">What came up</p>
          <p className="whitespace-pre-wrap text-base leading-8 text-foreground">{postmortem.whatCameUp}</p>
        </CardContent>
      </Card>

      {(postmortem.wins || postmortem.gaps) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {postmortem.wins && <DebriefCard eyebrow="What went well" body={postmortem.wins} tone="positive" />}
          {postmortem.gaps && <DebriefCard eyebrow="Where was the gap?" body={postmortem.gaps} tone="neutral" />}
        </div>
      )}

      {postmortem.nextSteps && (
        <Card>
          <CardContent className="p-6 sm:p-7">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-primary">Next move</p>
            <p className="whitespace-pre-wrap text-base leading-8">{postmortem.nextSteps}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
        <p className="max-w-lg text-xs leading-relaxed text-muted-foreground">This is a private reflection, not a scored activity. It will not change your card confidence or mastery.</p>
        {postmortem.gaps && <Button variant="outline" render={<Link href="/postmortem/new" />}>
          Log another debrief <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>}
      </div>
    </div>
  )
}

function DebriefCard({ eyebrow, body, tone }: { eyebrow: string; body: string; tone: 'positive' | 'neutral' }) {
  return (
    <Card className={tone === 'positive' ? 'border-emerald-500/20 bg-emerald-500/[0.035]' : ''}>
      <CardContent className="p-6">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>
        <p className="whitespace-pre-wrap text-sm leading-7">{body}</p>
      </CardContent>
    </Card>
  )
}
