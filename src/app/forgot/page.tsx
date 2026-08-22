import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import ForgotForm from '@/components/auth/ForgotForm'

/**
 * Never gated by CREDENTIALS_SIGNUP_ENABLED. The flag governs creating
 * accounts; an existing password user must always be able to recover one.
 */
export default async function ForgotPage() {
  const session = await auth()
  if (session?.user?.id) redirect('/account')

  return (
    <div className="max-w-md mx-auto px-4 py-12">
      <Card>
        <CardHeader>
          <CardTitle>Reset your password</CardTitle>
          <CardDescription>
            Enter your email or handle and we’ll send a link that works for one hour.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ForgotForm />
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
