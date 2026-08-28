'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import type { EmptyCause } from '@/lib/metrics/coverage';

/**
 * Spec 3C §5. Four causes render identically — a loaded page with a header and
 * no rows — so the page must name which one it is. Three are fixable in
 * seconds once the learner knows, which is the entire argument for the copy.
 *
 * `blocking` separates "nothing can render" from "real content is on screen
 * and this explains a gap in it". Since Task 4B, `nothing_categorized` is the
 * second kind: uncategorized KLPs are study candidates now, so that library
 * gets a working study list and empty TOPIC sections.
 */
export default function EmptyDashboard({ cause }: { cause: EmptyCause }) {
  const { title, body, action } = copyFor(cause);

  return (
    <Card className={cause.blocking ? undefined : 'border-dashed'}>
      <CardContent className="py-6 space-y-2">
        <p className="font-medium">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action && (
          <Link href={action.href} className="text-sm text-primary hover:underline inline-block">
            {action.label}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}

function copyFor(cause: EmptyCause): {
  title: string;
  body: string;
  action?: { href: string; label: string };
} {
  switch (cause.kind) {
    case 'no_klps':
      return {
        title: 'Your cards have no key points yet',
        body:
          cause.pendingExtraction > 0
            ? `${cause.pendingExtraction} card${cause.pendingExtraction === 1 ? ' is' : 's are'} still being read. This happens in the background after you save a set — check back shortly.`
            : 'Key points are the individual claims a card makes, and everything on this page is measured against them. Open a set and extract them to get started.',
        action: { href: '/sets', label: 'Go to your sets' },
      };

    case 'scope_too_narrow':
      return {
        title: 'Nothing in your study scope has been studied yet',
        body:
          'Your saved scope is valid, just narrow — the rest of your library has material this page could report on. Widen the scope, or study something inside it.',
        action: { href: '/settings/study', label: 'Change your study scope' },
      };

    case 'no_history':
      return {
        title: 'Nothing to report yet',
        body:
          'Take a quiz and this fills in. Every number here comes from answers you have actually given — there is nothing to estimate from until then.',
        action: { href: '/sets', label: 'Start a quiz' },
      };

    case 'below_floor':
      // The learner's OWN floor. Someone who set it to 1 must not be told they
      // need evidence they already have.
      return {
        title: 'Not enough evidence to draw conclusions',
        body:
          `${cause.measured} key point${cause.measured === 1 ? ' has' : 's have'} been tested, but none has reached your evidence floor of ${cause.floor} answer${cause.floor === 1 ? '' : 's'} yet. Keep studying, or lower the floor if you would rather act on thinner evidence.`,
        action: { href: '/settings/study', label: 'Adjust your evidence floor' },
      };

    case 'nothing_categorized':
      return {
        title: 'No topics yet — your study list still works',
        body:
          `${cause.cardsWithLiveKlps} of your cards have key points, but none is in a category, and topics are built from categories. Adding a category works retroactively: the evidence is already recorded against each key point, so a topic lights up immediately without re-quizzing.`,
        action: { href: '/sets', label: 'Add categories to a set' },
      };
  }
}
