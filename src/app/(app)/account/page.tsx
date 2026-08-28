import { redirect } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/auth'
import { PageHeader, SettingRow } from '@/components/ui/page-header'
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
      <div className="max-w-3xl">
        <h1 className="display">Account</h1>
        <p className="mt-4 text-sm text-destructive">{result.error}</p>
      </div>
    )
  }

  const account = result.data

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Account"
        lede={
          <>
            Who you are on this site. Your study history lives under{' '}
            <Link href="/profile" className="underline underline-offset-4 hover:text-foreground">
              Learning
            </Link>
            .
          </>
        }
      />

      {/*
        `SettingRow`, not one `Card` per setting. Six boxed, shadowed cards —
        each a heading, a description and one control — filled a screen with
        four settings and read as a form nobody had finished designing. Label
        and description left, control right, separated by hairlines.
      */}
      <div>
        <SettingRow
          label="Handle"
          description="The public name you're credited by. Needed before you can publish a set."
        >
          <HandlePanel initial={account.handle} />
        </SettingRow>

        <SettingRow
          label="Account email"
          description={
            /*
              Read-only, and the reason stays on screen. This address identifies
              the account and is its password-reset recovery address; letting it
              be edited without a verification round trip is an account-takeover
              vector. The contact address below is what "add your email" means.
            */
            account.hasGithub
              ? "From your GitHub account. It identifies you here, so it can't be edited directly yet."
              : "The address you signed up with. It identifies you here, so it can't be edited directly yet."
          }
        >
          <p className="font-mono text-sm">{account.email}</p>
        </SettingRow>

        <SettingRow
          label="Contact email"
          description="Where we write to you. Safe to change — it cannot be used to take over the account."
        >
          <ContactEmailPanel initial={account.contactEmail} />
        </SettingRow>

        <SettingRow label="Updates" description="Occasional product email. Nothing sends yet.">
          <EmailUpdatesPanel initial={account.emailUpdates} />
        </SettingRow>

        <SettingRow label="Appearance" description="Saved on this device, not to your account.">
          <ThemeChoice />
        </SettingRow>

        <SettingRow label="Sign-in" description="How you get into this account.">
          <p className="text-sm">
            <span className="font-medium">{account.hasGithub ? 'GitHub' : 'Password'}</span>
            <span className="text-muted-foreground"> — {account.email}</span>
          </p>
        </SettingRow>

        <SettingRow
          label={account.hasPassword ? 'Password' : 'Add a password'}
          description={
            account.hasPassword
              ? 'Changing it signs out every other session, including any an attacker holds.'
              : 'Lets you sign in without GitHub.'
          }
        >
          <PasswordPanel hasPassword={account.hasPassword} />
        </SettingRow>

        <SettingRow
          label="AI providers"
          description="The keys this account uses for grading, distractors and plans."
        >
          <Link href="/settings/ai" className="text-sm underline underline-offset-4">
            Manage AI providers
          </Link>
        </SettingRow>
      </div>
    </div>
  )
}
