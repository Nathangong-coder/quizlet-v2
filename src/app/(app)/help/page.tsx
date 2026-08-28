import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { FeedbackForm } from '@/components/help/FeedbackForm'
import { PageHeader } from '@/components/ui/page-header'

/**
 * Help & feedback.
 *
 * Signed in only, and that is a deliberate limit rather than an oversight: an
 * open form here is an unauthenticated write endpoint that emails an operator's
 * personal inbox.
 *
 * `contactEmail` before `email`, because the account address is identity and
 * the contact address is the one the user nominated for correspondence. The
 * form keeps both editable — the address you want a reply at is not necessarily
 * either of them.
 */
export default async function HelpPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true, handle: true, email: true, contactEmail: true },
  })

  return (
    <div className="max-w-2xl space-y-8">
      <PageHeader
        title="Help & feedback"
        lede="Something broken, something confusing, or something missing — tell us. Every message is read."
      />

      <FeedbackForm
        defaultName={user?.name ?? user?.handle ?? ''}
        defaultEmail={user?.contactEmail ?? user?.email ?? ''}
      />

      <div className="border-t pt-6 text-sm text-muted-foreground space-y-2">
        <p className="font-medium text-foreground">Before you write</p>
        <p>
          If the AI is failing to grade or generate questions, the cause is almost always a
          credential &mdash; check{' '}
          <Link href="/settings/ai" className="underline underline-offset-4 hover:text-foreground">
            AI settings
          </Link>
          , which names which key failed and why.
        </p>
        <p>
          If your scores look wrong rather than absent, the thresholds that produce them are
          yours to change under{' '}
          <Link href="/settings/study" className="underline underline-offset-4 hover:text-foreground">
            Study settings
          </Link>
          .
        </p>
      </div>
    </div>
  )
}
