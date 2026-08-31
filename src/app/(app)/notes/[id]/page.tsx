import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText, Pencil } from 'lucide-react'
import { getStudyNote } from '@/actions/study-notes'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { NoteDeleteButton } from '@/components/notes/NoteDeleteButton'
import { NoteSummaryEditor } from '@/components/notes/NoteSummaryEditor'

export default async function NoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const result = await getStudyNote(id)
  if (!result.success) notFound()
  const note = result.data

  return <div className="w-full max-w-4xl space-y-8"><div className="flex flex-wrap items-center justify-between gap-3"><Button variant="ghost" size="sm" render={<Link href="/notes" />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />All notes</Button><div className="flex items-center gap-1"><Button variant="ghost" size="sm" render={<Link href={`/notes/${id}/edit`} />}><Pencil className="h-4 w-4" aria-hidden="true" />Edit</Button><NoteDeleteButton id={id} /></div></div><header className="space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><FileText className="h-4 w-4" aria-hidden="true" />Study note</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{note.title}</h1><p className="text-sm text-muted-foreground">Your original note stays unchanged when its analysis is regenerated.</p></header><Card><CardContent className="p-6 sm:p-8"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Original note</h2><Badge variant="outline">{note.body.split(/\r?\n/).filter(Boolean).length} lines</Badge></div><p className="whitespace-pre-wrap text-base leading-8">{note.body}</p></CardContent></Card><NoteSummaryEditor noteId={note.id} analysis={note.analysis} /></div>
}
