import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import LoginForm from '@/components/auth/LoginForm'
import { isSignupOpen } from '@/lib/auth/signup-flag'
import { safeCallbackUrl } from '@/lib/auth/callback-url'

/**
 * The real sign-in page, replacing Auth.js's built-in one.
 *
 * `pages.signIn` in auth.config.ts points here, so the middleware redirect and
 * any bare `signIn()` call land on this page rather than on a generated form.
 *
 * Signing IN is never gated by CREDENTIALS_SIGNUP_ENABLED — a seeded dev
 * account and any existing password user must always be able to get in.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string; verified?: string; reset?: string }>
}) {
  const session = await auth()
  if (session?.user?.id) redirect('/sets')

  const params = await searchParams
  // Relative paths only: an absolute callbackUrl from the query string is an
  // open-redirect straight off the sign-in page. safeCallbackUrl parses with
  // the WHATWG URL parser rather than string-testing the raw value — see its
  // doc comment for why a string test alone is bypassable.
  const callbackUrl = safeCallbackUrl(params.callbackUrl)

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your password, or continue with GitHub.</CardDescription>
        </CardHeader>
        <CardContent>
          {params.verified === '1' ? (
            <p className="mb-4 text-sm text-foreground" role="status">
              Your email is verified. Sign in below.
            </p>
          ) : null}
          {params.reset === '1' ? (
            <p className="mb-4 text-sm text-foreground" role="status">
              Your password has been changed. Sign in with the new one.
            </p>
          ) : null}
          <LoginForm
            callbackUrl={callbackUrl}
            signupOpen={isSignupOpen()}
            initialError={params.error}
          />
        </CardContent>
      </Card>
    </div>
  )
}
