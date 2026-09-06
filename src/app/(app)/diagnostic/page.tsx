import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { isAdmin } from '@/lib/auth/roles'
import { getDiagnosticSetOptions } from '@/actions/diagnostic'
import { DiagnosticClient } from '@/components/diagnostic/DiagnosticClient'

/**
 * COMING SOON for everyone but admins.
 *
 * The diagnostic works — it asks good questions and grades them — but it is
 * WIRED TO NOTHING. `DiagnosticQuestion.learningPoint` is free text, not a
 * `CardKlp` foreign key, so a completed diagnostic writes no `AnswerKlpResult`,
 * no `KlpState` and no `StudyEvent`. A real user finished a 12-question run
 * scoring 75 and it moved not one number in his profile.
 *
 * That gap is invisible from inside the feature and infuriating once noticed:
 * the whole promise of the product is that what you do changes what it knows
 * about you. Better to say "not yet" than to let someone spend twenty minutes
 * earning nothing. Admins keep access so the pipeline can be developed and
 * tested against real runs.
 *
 * REMOVE THIS GATE when the diagnostic targets real key points and writes
 * through the same memory path every other mode uses.
 */
export default async function DiagnosticPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login?callbackUrl=%2Fdiagnostic')

  if (!isAdmin(session.user.role)) {
    return (
      <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
        <p className="label text-muted-foreground">Coming soon</p>
        <h1 className="text-2xl font-bold">Diagnostic test</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          A short adaptive test that finds what you do not know yet. It is not open
          because it does not yet feed your learning history &mdash; today it would grade you and
          then change nothing about what the app knows, and that is not worth your twenty minutes.
        </p>
        <p className="text-sm leading-6 text-muted-foreground">
          It is being connected to the key points behind each card, so a result moves your profile
          the way a quiz does.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Link href="/sets" className="rounded-md border px-4 py-2 text-sm hover:bg-muted">
            Study a set instead
          </Link>
        </div>
      </div>
    )
  }

  const result = await getDiagnosticSetOptions()
  if (!result.success) redirect('/login?callbackUrl=%2Fdiagnostic')
  return <DiagnosticClient sets={result.data} />
}
