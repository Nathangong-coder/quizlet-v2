import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Shows the address AS TYPED. This is the primary typo defence, and it beats
 * the email itself: the user sees `me@gmial.com` on screen while they still
 * remember typing it.
 *
 * Not gated by CREDENTIALS_SIGNUP_ENABLED — someone who signed up before the
 * flag was flipped off still needs to be able to read this.
 */
export default async function CheckEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>
}) {
  const params = await searchParams
  // Capped rather than trusted: this is a query parameter and it is echoed
  // back to the page. React escapes it, so the cap is about a wall of text,
  // not about injection.
  const email = (params.email ?? '').slice(0, 200)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Check your inbox</CardTitle>
          <CardDescription>
            {email ? (
              <>
                We sent a verification link to <strong>{email}</strong>. Open it to finish setting
                up your account.
              </>
            ) : (
              <>We sent you a verification link. Open it to finish setting up your account.</>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The link works for 24 hours. If the address above is wrong, sign up again with the
            correct one.
          </p>
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
