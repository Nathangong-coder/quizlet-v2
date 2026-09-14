import type { Metadata } from 'next'
import Link from 'next/link'
import { LegalPage } from '@/components/marketing/LegalPage'

export const metadata: Metadata = {
  title: 'Terms of use',
  description: 'The agreement between you and synapseHQ when you use the service.',
}

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use" updated="13 September 2026">
      <p>
        These terms are the agreement between you and <strong>[legal entity name]</strong> (&ldquo;synapseHQ&rdquo;, &ldquo;we&rdquo;) for using the service at this site. By creating an account or using the service you accept them.
      </p>

      <h2>1. The service</h2>
      <p>
        synapseHQ is a study app: flashcards, tests, review, study groups, games, and AI-assisted grading and generation. Some features are marked as coming and are not yet available. We may change or withdraw features; we will not remove your ability to export your own sets.
      </p>

      <h2>2. Your account</h2>
      <ul>
        <li>You need an account for most features. Sign-up may require an invite code and a verified email address.</li>
        <li>You are responsible for what happens under your account and for keeping your password private. Tell us at <strong>[contact email]</strong> if you think it has been compromised.</li>
        <li>One person, one account. Handles must not impersonate someone else.</li>
        <li>You must be at least 13.</li>
      </ul>

      <h2>3. Your content</h2>
      <ul>
        <li>You own the sets, cards, notes and files you create. You give us the licence we need to store, display and process them to run the service for you — and, for content you make <strong>public</strong>, to show it to other users and let them copy it into their own accounts, credited to your handle.</li>
        <li>A copy someone made of your public set is theirs to keep, even if you later make the original private or delete it.</li>
        <li>Only upload what you have the right to upload. We remove content on a valid rights complaint.</li>
        <li>Do not publish content that is illegal, hateful, harassing, sexually explicit, or that reveals someone else&rsquo;s private information. We may unlist or remove it and may close the account.</li>
      </ul>

      <h2>4. AI features</h2>
      <ul>
        <li>AI grading and generation run on API keys <strong>you</strong> supply, against providers <strong>you</strong> choose. You are responsible for your keys, for any charges the provider bills you, and for complying with that provider&rsquo;s terms.</li>
        <li>AI output can be wrong. Grades, key points, generated questions and plans are aids to studying, not authoritative judgements. Check anything that matters.</li>
      </ul>

      <h2>5. Study groups</h2>
      <p>
        Joining a group shares your progress on that group&rsquo;s sets with its members. Do not share an invite link with people the group&rsquo;s members would not expect. Group owners may remove members; members may leave at any time.
      </p>

      <h2>6. Acceptable use</h2>
      <ul>
        <li>No scraping, bulk downloading, or automated access other than through features we provide.</li>
        <li>No attempting to reach other users&rsquo; private content, credentials, or accounts.</li>
        <li>No spam, no malware, no interference with the service.</li>
      </ul>

      <h2>7. Ending the agreement</h2>
      <p>
        You can delete your account at any time from the Account page. We may suspend or close an account that breaks these terms, with notice where practical. Sections 3, 8 and 9 survive.
      </p>

      <h2>8. Disclaimers and liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo;. We do our best to keep it up and your data safe, but we do not promise uninterrupted service or error-free results, and we are not liable for indirect or consequential loss, or for outcomes of exams, interviews or decisions made using the service. Nothing here limits liability that cannot be limited by law.
      </p>

      <h2>9. Governing law</h2>
      <p>These terms are governed by the law of <strong>[jurisdiction]</strong>, and its courts have exclusive jurisdiction, subject to any mandatory consumer protections where you live.</p>

      <h2>10. Changes</h2>
      <p>We may update these terms. Material changes are dated above and announced in the app for signed-in users; continuing to use the service after that is acceptance.</p>

      <p className="text-sm text-muted-foreground">See also the <Link href="/privacy">privacy policy</Link>.</p>
    </LegalPage>
  )
}
