import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'
import { getStudyNote } from '@/actions/study-notes'
import { NoteForm } from '@/components/notes/NoteForm'
import { Button } from '@/components/ui/button'

export default async function EditNotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getStudyNote(id)
  if (!result.success) notFound()
  const note = result.data
  return <div className="w-full max-w-4xl space-y-8"><Button variant="ghost" size="sm" render={<Link href={`/notes/${id}`} />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to note</Button><header className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><FileText className="h-4 w-4" aria-hidden="true" />Edit study note</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Keep refining the source.</h1><p className="text-base leading-relaxed text-muted-foreground">Saving a changed note clears its old summary so analysis can never quietly describe stale text.</p></header><div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7"><NoteForm mode="edit" noteId={id} initial={{ title: note.title, body: note.body }} /></div></div>
}
