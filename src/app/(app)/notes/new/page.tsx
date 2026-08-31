import Link from 'next/link'
import { ArrowLeft, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NoteForm } from '@/components/notes/NoteForm'

export default function NewNotePage() {
  return <div className="w-full max-w-4xl space-y-8"><Button variant="ghost" size="sm" render={<Link href="/notes" />}><ArrowLeft className="h-4 w-4" aria-hidden="true" />All notes</Button><header className="max-w-2xl space-y-3"><div className="flex items-center gap-2 text-sm font-semibold text-primary"><FilePlus2 className="h-4 w-4" aria-hidden="true" />New study note</div><h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Put the raw thinking somewhere safe.</h1><p className="text-base leading-relaxed text-muted-foreground">Write in your own words first. The summary is a second layer you can question and edit.</p></header><div className="rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-sm)] sm:p-7"><NoteForm mode="new" initial={{ title: '', body: '' }} /></div></div>
}
