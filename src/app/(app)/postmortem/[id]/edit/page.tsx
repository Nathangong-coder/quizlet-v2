import { notFound, redirect } from 'next/navigation'
import { getPostmortem, getPostmortemSetOptions } from '@/actions/postmortem'
import { PostmortemForm, type PostmortemFormValues } from '@/components/postmortem/PostmortemForm'

export default async function EditPostmortemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [postmortemResult, setsResult] = await Promise.all([getPostmortem(id), getPostmortemSetOptions()])
  if (!postmortemResult.success) notFound()
  if (!setsResult.success) redirect('/login')
  const postmortem = postmortemResult.data

  const initial: PostmortemFormValues = {
    title: postmortem.title,
    format: postmortem.format as PostmortemFormValues['format'],
    occurredAt: postmortem.occurredAt.toISOString().slice(0, 10),
    setId: postmortem.setId ?? '',
    durationMin: postmortem.durationMin ? String(postmortem.durationMin) : '',
    confidence: postmortem.confidence ? String(postmortem.confidence) : '',
    whatCameUp: postmortem.whatCameUp,
    wins: postmortem.wins ?? '',
    gaps: postmortem.gaps ?? '',
    nextSteps: postmortem.nextSteps ?? '',
  }

  return (
    <div className="w-full max-w-4xl space-y-8">
      <header className="max-w-2xl space-y-2">
        <p className="text-sm font-semibold text-primary">Edit offline evidence</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Update this postmortem</h1>
        <p className="text-base leading-relaxed text-muted-foreground">Add detail while the session is still close enough to remember.</p>
      </header>
      <PostmortemForm mode="edit" postmortemId={id} sets={setsResult.data} initial={initial} />
    </div>
  )
}
