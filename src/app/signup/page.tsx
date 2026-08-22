import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import SignUpForm from '@/components/auth/SignUpForm'
import { isSignupOpen } from '@/lib/auth/signup-flag'

/**
 * Behind CREDENTIALS_SIGNUP_ENABLED. `notFound()` rather than a "coming soon"
 * page: there is nothing here to wait for yet, and a form that always refuses
 * reads as broken.
 *
 * The action re-checks the flag itself — this guard is the affordance, not the
 * enforcement.
 */
export default async function SignUpPage() {
  if (!isSignupOpen()) notFound()

  const session = await auth()
  if (session?.user?.id) redirect('/sets')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>
            You need an invite code. We will email you a link to confirm your address.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SignUpForm />
          <p className="text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link href="/login" className="underline hover:text-foreground">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
