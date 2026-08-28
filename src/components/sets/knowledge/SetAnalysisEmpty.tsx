import Link from 'next/link'
import type { EmptyCause } from '@/lib/metrics/coverage'

/**
 * Why this set's analysis is thin — five causes, five remedies.
 *
 * The DIAGNOSIS is `diagnoseEmptyState`, shared with the learner dashboard and
 * with `scripts/tuning-check.ts`, so the gate and the page can never disagree
 * about whether there is enough data. Only the COPY is different, and that
 * difference is the point.
 *
 * `EmptyDashboard` is not reused verbatim because two of its remedies are wrong
 * in this context. It tells a learner whose scope is too narrow to "widen the
 * scope" and links to the settings page — correct advice on a dashboard whose
 * scope is a saved preference, and nonsense here, where the scope is the set
 * you deliberately navigated to and the only way to widen it is to leave.
 *
 * Every branch names the CAUSE and gives an action that works from this page.
 */
export function SetAnalysisEmpty({ cause, setId }: { cause: EmptyCause; setId: string }) {
  const { title, body, action } = copyFor(cause, setId)

  return (
    <div
      className={`rounded-lg border p-5 text-sm ${cause.blocking ? 'bg-muted/40' : 'border-dashed'}`}
    >
      <p className="font-medium">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-prose">{body}</p>
      {action && (
        <Link
          href={action.href}
          className="inline-block mt-3 underline underline-offset-4 hover:text-foreground"
        >
          {action.label}
        </Link>
      )}
    </div>
  )
}

function copyFor(
  cause: EmptyCause,
  setId: string,
): { title: string; body: string; action?: { href: string; label: string } } {
  switch (cause.kind) {
    case 'no_klps':
      return {
        title: 'This set has no key points yet',
        body:
          cause.pendingExtraction > 0
            ? `${cause.pendingExtraction} card${cause.pendingExtraction === 1 ? ' is' : 's are'} still being read. That happens in the background after a save — check back shortly.`
            : 'Key points are the individual claims each card makes, and everything on this page is measured against them. They are extracted automatically after a set is saved.',
        action: { href: `/sets/${setId}/edit`, label: 'Open this set' },
      }

    case 'scope_too_narrow':
      // Rewritten for this page. The dashboard's version says "widen your saved
      // scope" — here the scope IS this set, chosen by navigating to it.
      return {
        title: 'Nothing on this set has been studied yet',
        body:
          'Your other sets have material this page could report on, but this one has no answers behind it yet. Study it, or look at the consolidated view instead.',
        action: { href: `/sets/${setId}`, label: 'Study this set' },
      }

    case 'no_history':
      return {
        title: 'Nothing to analyse yet',
        body:
          'Every number here comes from answers you have actually given on this set. Take a quiz and it fills in — a handful of answers is enough for the retention curve to start.',
        action: { href: `/sets/${setId}/quiz`, label: 'Start a quiz' },
      }

    case 'below_floor':
      // The learner's OWN floor. Someone who set it to 1 must not be told they
      // need evidence they already have.
      return {
        title: 'Not enough evidence to draw conclusions',
        body: `${cause.measured} key point${cause.measured === 1 ? ' has' : 's have'} been tested on this set, but none has reached your evidence floor of ${cause.floor} answer${cause.floor === 1 ? '' : 's'}. Keep studying, or lower the floor if you would rather act on thinner evidence.`,
        action: { href: '/settings/study', label: 'Adjust your evidence floor' },
      }

    case 'nothing_categorized':
      return {
        title: 'No topics on this set yet',
        body: `${cause.cardsWithLiveKlps} card${cause.cardsWithLiveKlps === 1 ? ' has' : 's have'} key points, but none is in a category, and topics are built from categories. Adding one works retroactively — the evidence is already recorded against each key point, so a topic lights up without re-quizzing.`,
        action: { href: `/sets/${setId}/edit`, label: 'Add categories' },
      }
  }
}
