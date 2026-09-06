import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { auth } from '@/auth'
import { getDiagnosticAttempt } from '@/actions/diagnostic'
import { DiagnosticAttemptView } from '@/components/diagnostic/DiagnosticAttemptView'

/**
 * A finished diagnostic, read back later.
 *
 * Until this existed there was no way to view one at all: the report was
 * written to the database and rendered nowhere once the tab closed. It is also
 * where an `engineVersion: 1` attempt gets told it ran before key-point
 * tracking, which is the entire reason nothing was backfilled.
 *
 * `getDiagnosticAttempt` is owner-scoped in its own `where`, so this page needs
 * no second check — it renders whatever comes back or nothing.
 */
export default async function DiagnosticAttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>
}) {
  const session = await auth()
  const { attemptId } = await params
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/diagnostic/${attemptId}`)}`)
  }

  const result = await getDiagnosticAttempt(attemptId)
  if (!result.success) notFound()

  return (
    <DiagnosticAttemptView
      result={result.data}
      action={
        <Link
          href="/diagnostic"
          className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          All diagnostics
        </Link>
      }
    />
  )
}
