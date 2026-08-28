import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getAccountSettings } from '@/actions/account'
import ThemeChoice from '@/components/account/ThemeChoice'
import {
  HandlePanel,
  ContactEmailPanel,
  EmailUpdatesPanel,
} from '@/components/account/AccountPanels'
import { PasswordPanel } from '@/components/account/PasswordPanel'

/**
 * Your ACCOUNT — who you are on this site.
 *
 * Deliberately separate from `/profile/*`, which is your LEARNING: what you
 * know, what you answered, what to study next. Those three pages were all
 * called "Profile" while being about study history, so there was nowhere for
 * "my handle, my email, my theme" to live.
 *
 * NOT here, and each for a stated reason:
 * - **Language** — the app has no i18n at all (no library, no catalogue, every
 *   string a literal). A selector with one entry is a promise it can't keep.
 */
export default async function AccountPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/')

  const result = await getAccountSettings()
  if (!result.success) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="mt-4 text-sm text-destructive">{result.error}</p>
      </div>
    )
  }

  const account = result.data

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Account</h1>
        <p className="text-muted-foreground mt-2">
          Who you are on this site. Your study history lives under{' '}
          <a href="/profile" className="underline hover:text-foreground">
            Learning
          </a>
          .
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Handle</CardTitle>
          <CardDescription>
            The public name you&apos;re credited by. Needed before you can publish a set.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HandlePanel initial={account.handle} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email</CardTitle>
          <CardDescription>How we reach you, and how you sign in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-1">
            <p className="text-sm font-medium">Account email</p>
            <p className="font-mono text-sm">{account.email}</p>
            {/*
              Read-only, and the reason is on screen. This address identifies
              the account and is its password-reset recovery address; letting
              it be edited without a verification round trip is an
              account-takeover vector. The editable contact address below is
              what "add your email" should mean.
            */}
            <p className="text-xs text-muted-foreground">
              {account.hasGithub
                ? "From your GitHub account. It identifies you here, so it can't be edited directly yet."
                : "The address you signed up with. It identifies you here, so it can't be edited directly yet."}
            </p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium">Contact email</p>
            <ContactEmailPanel initial={account.contactEmail} />
          </div>

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Updates</p>
            <EmailUpdatesPanel initial={account.emailUpdates} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved on this device, not to your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeChoice />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sign-in</CardTitle>
          <CardDescription>How you get into this account.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm">
            <span className="font-medium">{account.hasGithub ? 'GitHub' : 'Password'}</span>
            <span className="text-muted-foreground"> — {account.email}</span>
          </p>
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">
              {account.hasPassword ? 'Password' : 'Add a password'}
            </p>
            <PasswordPanel hasPassword={account.hasPassword} />
          </div>
        </CardContent>
      </Card>

      {/*
        AI settings moved here when the navbar gained Home / Browse / Library.
        Six ghost buttons plus a primary plus sign-out was already a crowded
        bar, and provider credentials are an account-level setting rather than
        a place you navigate to. THIS LINK IS LOAD-BEARING: /settings/ai has no
        other entry point now, so deleting it strands the route.
      */}
      <Card>
        <CardHeader>
          <CardTitle>AI providers</CardTitle>
          <CardDescription>
            The keys this account uses for grading, distractors and plans.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link href="/settings/ai" className="text-sm underline underline-offset-4">
            Manage AI providers
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
