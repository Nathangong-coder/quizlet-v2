import { redirect } from 'next/navigation'
import { format } from 'date-fns'
import { getPostmortemSetOptions } from '@/actions/postmortem'
import { PostmortemForm, type PostmortemFormValues } from '@/components/postmortem/PostmortemForm'

export default async function NewPostmortemPage() {
  const result = await getPostmortemSetOptions()
  if (!result.success) redirect('/login?callbackUrl=%2Fpostmortem%2Fnew')

  const initial: PostmortemFormValues = {
    title: '',
    format: 'other',
    occurredAt: format(new Date(), 'yyyy-MM-dd'),
    setId: '',
    durationMin: '',
    confidence: '',
    whatCameUp: '',
    wins: '',
    gaps: '',
    nextSteps: '',
  }

  return (
    <div className="w-full max-w-4xl space-y-8">
      <header className="max-w-2xl space-y-2">
        <p className="text-sm font-semibold text-primary">New offline evidence</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Log a postmortem</h1>
        <p className="text-base leading-relaxed text-muted-foreground">Capture the useful residue of a session while you still remember the questions, instincts, and edges.</p>
      </header>
      <PostmortemForm mode="new" sets={result.data} initial={initial} />
    </div>
  )
}
