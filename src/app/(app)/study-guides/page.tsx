import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FileText, Plus } from 'lucide-react'
import { auth } from '@/auth'
import { loadStartSets } from '@/lib/home/start-here'
import { listStudyNotes } from '@/actions/study-notes'
import { StartHerePage } from '@/components/home/StartHere'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Study guides' }

/**
 * `/study-guides` — Start here → Study guides. Two kinds: a guide BUILT from
 * a set's key points (printable, shaded by your mastery), and the study
 * notes you write yourself with an AI summary underneath.
 */
export default async function StudyGuidesHub() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fstudy-guides')
  const [sets, notes] = await Promise.all([loadStartSets(session.user.id), listStudyNotes()])
  const noteRows = notes.success ? notes.data.slice(0, 6) : []
  return (
    <StartHerePage
      title="Study guides"
      lede="A guide is built from a set itself — your categories as chapters, every card’s key points as a checklist, shaded by what you have shown you know. Print it as it stands."
      action={<Link href="/notes/new" className={cn(buttonVariants({ size: 'sm', variant: 'outline' }), 'gap-1.5')}><Plus className="h-4 w-4" aria-hidden="true" />New study note</Link>}
      sets={sets}
      hrefFor={(s) => `/sets/${s.id}/guide`}
      cta="Open the guide"
      secondary={{ label: 'Mastery view', hrefFor: (s) => `/sets/${s.id}/mastery` }}
      disabledWhen={(s) => (s.klpCards === 0 ? 'No key points yet — the guide is written from them' : null)}
      empty={<>No sets yet. <Link href="/sets/new" className="text-primary underline-offset-4 hover:underline">Make one</Link> and its guide appears here.</>}
    >
      <section aria-labelledby="your-notes" className="mt-6">
        <div className="flex items-baseline justify-between">
          <h2 id="your-notes" className="label">Your study notes</h2>
          <Link href="/notes" className="text-xs text-primary underline-offset-4 hover:underline">All notes →</Link>
        </div>
        {noteRows.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Notes you write yourself, with an AI summary kept below your original text. <Link href="/notes/new" className="text-primary underline-offset-4 hover:underline">Write one</Link>.</p>
        ) : (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {noteRows.map((n) => (
              <li key={n.id}>
                <Link href={`/notes/${n.id}`} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-primary/60">
                  <FileText className="h-4 w-4 shrink-0 text-fuchsia-500" aria-hidden="true" />
                  <span className="truncate font-medium">{n.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </StartHerePage>
  )
}
