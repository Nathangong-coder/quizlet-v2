import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'
import { peekResetToken } from '@/actions/auth-reset'

/**
 * GET validates without consuming — the POST is what claims the token. A GET
 * that consumed would let a mail scanner burn the link before the human sees
 * the form.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const raw = decodeURIComponent(token)
  const valid = await peekResetToken(raw)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{valid ? 'Choose a new password' : 'That link didn’t work'}</CardTitle>
          <CardDescription>
            {valid
              ? 'Once you save it, every device signed in to this account is signed out.'
              : 'Reset links expire after an hour and can only be used once.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {valid ? (
            <ResetPasswordForm token={raw} />
          ) : (
            <p className="text-sm text-muted-foreground">
              <Link href="/forgot" className="underline hover:text-foreground">
                Request a new link
              </Link>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            <Link href="/login" className="underline hover:text-foreground">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
