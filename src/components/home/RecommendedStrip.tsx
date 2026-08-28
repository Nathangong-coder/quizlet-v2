import Link from 'next/link'
import { SetGlyph } from '@/components/sets/SetGlyph'
import {
  RECOMMEND_EMPTY_COPY,
  type Recommendation,
  type RecommendReason,
} from '@/lib/sets/recommend'

/**
 * Published sets matching what the learner is weakest on.
 *
 * THE `because` LINE IS ALWAYS VISIBLE, never a tooltip and never truncated
 * away. Cross-user category matching is a string match wearing a concept's
 * clothing — one account's "vocabulary" is Spanish and another's is finance —
 * so the learner must be able to see WHY a set was suggested and judge for
 * themselves that a wrong match is wrong. Hiding the reason turns a shaky
 * heuristic into an authoritative-looking ranking, which is worse than not
 * shipping it.
 */
export function RecommendedStrip({
  recommendations,
  emptyReason,
}: {
  recommendations: Recommendation[]
  emptyReason: RecommendReason | null
}) {
  if (recommendations.length === 0) {
    if (emptyReason === null) return null
    // Four distinct messages, never one generic "nothing to show" — the
    // remedies are completely different and merging them is the
    // is-this-broken confusion this codebase has hit before.
    return <p className="text-sm text-muted-foreground py-2">{RECOMMEND_EMPTY_COPY[emptyReason]}</p>
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-4 px-4 sm:mx-0 sm:px-0">
      {recommendations.map((r) => (
        <Link
          key={r.setId}
          href={`/sets/${r.setId}`}
          className="group shrink-0 w-56 border-t pt-3 hover:border-primary/50 transition-colors"
        >
          <div className="text-primary/70">
            <SetGlyph setId={r.setId} categoryCount={3} className="w-9 h-9" />
          </div>
          <p className="mt-2 text-sm font-medium leading-snug line-clamp-2 group-hover:underline underline-offset-4">
            {r.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="metric">{r.cardCount}</span> {r.cardCount === 1 ? 'card' : 'cards'}
            {/* No fallback to User.name — that is the OAuth real-name field. */}
            {r.ownerHandle && <> · @{r.ownerHandle}</>}
          </p>
          <p className="mt-2 text-xs text-muted-foreground italic">{r.because}</p>
        </Link>
      ))}
    </div>
  )
}
