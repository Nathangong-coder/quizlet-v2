import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Stethoscope, GraduationCap } from 'lucide-react'
import { auth } from '@/auth'
import { loadStartSets } from '@/lib/home/start-here'
import { getDiagnosticHistory } from '@/actions/diagnostic'
import { StartHerePage } from '@/components/home/StartHere'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export const metadata: Metadata = { title: 'Tests' }

/**
 * `/tests` — Start here → Tests. Two sections (owner, 2026-09-14): the
 * DIAGNOSTIC — a short written test across a set that seeds your memory —
 * and PRACTICE TESTS, the quiz on any set. The diagnostic used to sit on the
 * rail by itself; this is its home now.
 */
export default async function TestsHub() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Ftests')
  const [sets, history] = await Promise.all([loadStartSets(session.user.id), getDiagnosticHistory()])
  const recent = history.success ? history.data.slice(0, 4) : []
  const diagnosable = sets.filter((s) => s.klpCards > 0)

  return (
    <StartHerePage
      title="Tests"
      lede="A diagnostic to find out where you stand, then practice tests on any set — multiple choice, true/false, matching or written, read point by point."
      intro={
        <section aria-labelledby="diagnostic" className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id="diagnostic" className="inline-flex items-center gap-2 font-heading text-lg font-bold"><Stethoscope className="h-5 w-5 text-primary" aria-hidden="true" />Diagnostic</h2>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">Twelve written questions across a set, each anchored to a key point. Your answers seed your memory on day one, so your first real session already targets the gaps.</p>
            </div>
            <Link href="/diagnostic" className={cn(buttonVariants({ size: 'sm' }))}>Start a diagnostic</Link>
          </div>
          {diagnosable.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-2">
              {diagnosable.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <Link href={`/diagnostic?set=${s.id}`} className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs hover:border-primary/60">{s.title}</Link>
                </li>
              ))}
            </ul>
          )}
          {recent.length > 0 && (
            <div className="mt-4">
              <div className="label mb-1">Recent diagnostics</div>
              <ul className="divide-y divide-border/70 text-sm">
                {recent.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-3 py-1.5">
                    <Link href={`/diagnostic/${h.id}`} className="truncate hover:underline underline-offset-4">{h.setTitle}</Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{h.score === null ? '—' : `${h.score}%`} · {h.questionCount} questions · {h.completedAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      }
      sets={sets}
      hrefFor={(s) => `/sets/${s.id}/quiz`}
      cta="Practice test"
      secondary={{ label: 'Print a test', hrefFor: (s) => `/sets/${s.id}/quiz` }}
      disabledWhen={(s) => (s.cardCount === 0 ? 'No cards yet' : null)}
      empty={<>No sets yet. <Link href="/sets/new" className="text-primary underline-offset-4 hover:underline">Make one</Link> to test yourself on it.</>}
    >
      <h2 className="label mt-8 inline-flex items-center gap-1.5"><GraduationCap className="h-4 w-4" aria-hidden="true" />Practice tests</h2>
    </StartHerePage>
  )
}
