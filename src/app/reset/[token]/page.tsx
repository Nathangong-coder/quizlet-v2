import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'
import { peekResetToken } from '@/actions/auth-reset'

/**
 * Mirrors `safeDecode` in `src/app/verify/[token]/page.tsx`. A hand-mangled
 * or truncated link must land on the "that link didn't work" branch, not on
 * Next's generic error boundary. decodeURIComponent throws URIError on
 * malformed input like `%zz`, so an undecodable token is simply passed
 * through: it will fail to resolve to a row and take the same path as any
 * other dead token.
 */
function safeDecode(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * GET validates without consuming — the POST is what claims the token. A GET
 * that consumed would let a mail scanner burn the link before the human sees
 * the form.
 */
export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const raw = safeDecode(token)
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
