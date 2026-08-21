import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ResendVerification from '@/components/auth/ResendVerification'
import { consumeEmailVerification } from '@/actions/auth-verify'

/**
 * On success: redirect to /login?verified=1. Deliberately NOT an auto-sign-in
 * — see consumeEmailVerification.
 *
 * On failure: a plain page offering a resend, never a stack trace. An expired
 * link and a link a mail scanner already burned look identical from here, and
 * the remedy is the same for both.
 */
export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const result = await consumeEmailVerification(decodeURIComponent(token))

  // redirect() throws to unwind, so it must sit outside any try/catch. There
  // is none here on purpose.
  if (result.ok) redirect('/login?verified=1')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>That link didn’t work</CardTitle>
          <CardDescription>
            Verification links expire after 24 hours and can only be used once.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Enter your email or handle and we’ll send a fresh one.
          </p>
          <ResendVerification />
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
