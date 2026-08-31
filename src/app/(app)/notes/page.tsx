import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileText, Plus, Sparkles } from 'lucide-react'
import { listStudyNotes } from '@/actions/study-notes'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export default async function NotesPage() {
  const result = await listStudyNotes()
  if (!result.success) redirect('/login?callbackUrl=%2Fnotes')
  const notes = result.data

  return (
    <div className="w-full max-w-5xl space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4"><div className="max-w-2xl space-y-2"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><FileText className="h-4 w-4" aria-hidden="true" />Study notes</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Keep the thinking, not just the answer.</h1><p className="text-base leading-relaxed text-muted-foreground">Write freely, then turn the useful parts into an editable study surface when you are ready.</p></div><Button size="lg" render={<Link href="/notes/new" />}><Plus className="h-4 w-4" aria-hidden="true" />New study note</Button></header>
      {notes.length > 0 ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{notes.map((note) => <Link key={note.id} href={`/notes/${note.id}`} className="group focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><Card className="h-full transition-[border-color,box-shadow,transform] duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/50 group-hover:shadow-[var(--shadow-md)]"><CardContent className="flex h-full flex-col p-5"><div className="flex items-center justify-between gap-3"><div className="rounded-lg bg-primary/10 p-2 text-primary"><FileText className="h-5 w-5" aria-hidden="true" /></div><ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" aria-hidden="true" /></div><h2 className="mt-5 line-clamp-2 text-lg font-semibold group-hover:text-primary">{note.title}</h2><p className="mt-2 line-clamp-4 min-h-24 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">{note.body}</p><div className="mt-auto flex items-center gap-2 pt-5 text-xs text-muted-foreground">{note.analysis ? <><Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" /><span>AI summary ready</span></> : <span>Not analyzed yet</span>}</div></CardContent></Card></Link>)}</div> : <Card className="border-dashed bg-muted/10"><CardContent className="flex flex-col items-center px-6 py-16 text-center"><div className="rounded-full bg-primary/10 p-3 text-primary"><FileText className="h-6 w-6" aria-hidden="true" /></div><h2 className="mt-4 text-lg font-semibold">Start with the messy version</h2><p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">Lecture notes, interview reflections, questions from a paper test—put them somewhere you can return to and shape.</p><Button className="mt-6" render={<Link href="/notes/new" />}><Plus className="h-4 w-4" aria-hidden="true" />Write your first note</Button></CardContent></Card>}
    </div>
  )
}
