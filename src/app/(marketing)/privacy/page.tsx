import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What synapseHQ collects, why, who sees it, and how to delete it.',
}

/**
 * Written against what the app ACTUALLY does — read the schema and the AI
 * layer before editing this. Every sentence is a statement of fact about the
 * code; the operator, contact address and governing law are the owner's.
 */
export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy" updated="13 September 2026">
      <p>
        synapseHQ (&ldquo;we&rdquo;, &ldquo;us&rdquo;) is a study app. This policy says what we collect, why, who
        else sees it, and how you get rid of it. It is written to be read, not skimmed past.
      </p>

      <h2>Who is responsible</h2>
      <p>
        The service is operated by <strong>synapseHQ</strong>. Questions about this policy go to{' '}
        <a href="mailto:ngong7053@gmail.com">ngong7053@gmail.com</a>.
      </p>

      <h2>What we collect</h2>
      <h3>Account</h3>
      <ul>
        <li>Your email address (from GitHub sign-in or from sign-up), and a password hash if you set a password. We never store the password itself.</li>
        <li>A public handle you choose, an optional one-line bio, and an optional avatar. If you sign in with GitHub we receive the name and picture GitHub provides; the name is never shown publicly.</li>
        <li>An optional contact email, if you add one, and whether you want product updates (nothing sends yet).</li>
      </ul>
      <h3>What you make</h3>
      <ul>
        <li>Your sets, cards, categories, notes, postmortems and folders, including any images or files you attach. Attachments are stored on Vercel Blob and served only through an authenticated route that checks you may see them.</li>
        <li>Sets are <strong>private by default</strong>. You can make one link-shareable or public; a public set is listed under your handle.</li>
      </ul>
      <h3>How you study</h3>
      <ul>
        <li>Every answer you give in a study mode (Review, Test) — what you wrote, whether it was right, per-idea outcomes, and derived confidence and mastery numbers. This is the learner memory the app is built around.</li>
        <li>Session records: when you studied, which set, how long. <strong>Games record nothing.</strong></li>
        <li>If you join a study group, members of that group can see your progress on the group&rsquo;s sets — and only those sets. The join screen states this and requires your acknowledgement. Leaving a group ends it immediately; nothing is copied.</li>
      </ul>
      <h3>AI credentials</h3>
      <ul>
        <li>The app grades written answers and generates questions using AI providers <strong>you</strong> configure with <strong>your own</strong> API keys. Keys are encrypted at rest (AES-256-GCM) and used only to make requests on your behalf.</li>
        <li>When an AI feature runs, the card text, your answer, and a compact, ID-free summary of your recent performance are sent to the provider you chose (for example Google, Anthropic, OpenAI, OpenRouter, or a custom endpoint). That provider&rsquo;s privacy terms apply to that request. We keep a log of each call&rsquo;s provider, model, token counts and outcome — never the key.</li>
      </ul>
      <h3>Technical</h3>
      <ul>
        <li>One essential cookie keeps you signed in. We set no advertising or third-party tracking cookies.</li>
        <li>If you allow it in the cookie banner, we count visits with Vercel Analytics, which is cookieless and does not identify you. You can change that choice at any time from the footer.</li>
        <li>Standard server logs (IP address, user agent, timestamps) are kept by our hosting provider, Vercel, for security and operations.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run the service: sign you in, show you your sets, grade your answers, build your plan.</li>
        <li>To keep it safe: rate limits, abuse and spam prevention, moderation of published sets.</li>
        <li>To improve it: aggregate, non-identifying usage counts (only if you allowed analytics).</li>
      </ul>
      <p>We do not sell personal data and we do not show advertising.</p>

      <h2>Who else sees it</h2>
      <ul>
        <li><strong>Vercel</strong> — hosting, file storage (Blob), and optional analytics.</li>
        <li><strong>Neon or Supabase</strong> — the Postgres database.</li>
        <li><strong>Resend</strong> — transactional email (verification and password reset).</li>
        <li><strong>GitHub</strong> — if you sign in with GitHub.</li>
        <li><strong>The AI providers you configure</strong> — as described above, using your keys.</li>
        <li><strong>Other users</strong> — only what you publish (public sets under your handle, your profile page) and what you share by joining a study group.</li>
      </ul>

      <h2>How long we keep it</h2>
      <p>
        For as long as your account exists. Forgetting a card or a set from your Danger Zone deletes the underlying evidence, not just the estimate. Deleting your account deletes your sets, study history, credentials, and group memberships; published sets that others have copied remain as their copies, credited to your handle at the time of the copy.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>Edit your handle, bio, contact email and password on the Account page.</li>
        <li>Change a set&rsquo;s visibility from its Share menu at any time.</li>
        <li>Leave any study group at any time.</li>
        <li>Turn analytics off from the footer&rsquo;s cookie choices.</li>
        <li>Ask us for a copy of your data, or for its deletion, at <a href="mailto:ngong7053@gmail.com">ngong7053@gmail.com</a>. If you are in the UK or EU you also have the rights to rectification, restriction, portability and to complain to your supervisory authority.</li>
      </ul>

      <h2>Children</h2>
      <p>The service is not directed at children under 13, and we do not knowingly collect their data. If you believe a child has an account, contact us and we will delete it.</p>

      <h2>Changes</h2>
      <p>If this policy changes materially we will update the date above and, for signed-in users, say so in the app. The current version is always at <Link href="/privacy">/privacy</Link>.</p>

      <p className="text-sm text-muted-foreground">See also the <Link href="/terms">terms of use</Link> and the <Link href="/cookies">cookie notice</Link>.</p>
    </LegalPage>
  )
}
