import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import LoginForm from '@/components/auth/LoginForm'
import { isSignupOpen } from '@/lib/auth/signup-flag'

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
  searchParams: Promise<{ callbackUrl?: string; error?: string }>
}) {
  const session = await auth()
  if (session?.user?.id) redirect('/sets')

  const params = await searchParams
  // Relative paths only: an absolute callbackUrl from the query string is an
  // open-redirect straight off the sign-in page.
  const raw = params.callbackUrl ?? '/sets'
  const callbackUrl = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/sets'

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Use your password, or continue with GitHub.</CardDescription>
        </CardHeader>
        <CardContent>
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
