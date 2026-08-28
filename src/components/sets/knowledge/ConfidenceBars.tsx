import { cn } from '@/lib/utils'
import type { ConfidenceHistogram } from '@/lib/sets/knowledge'

/**
 * Confidence 1-10 across this set, as ten bars.
 *
 * A histogram rather than a single average, because the average hides the shape
 * that matters: forty cards all at 5 and twenty at 1 plus twenty at 9 both
 * average 5, and they call for completely different study sessions.
 */
export function ConfidenceBars({ histogram }: { histogram: ConfidenceHistogram }) {
  if (histogram.studied === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No confidence recorded on this set yet. Review mode and quizzes both write it.
      </p>
    )
  }

  const peak = Math.max(...histogram.buckets)

  return (
    <div>
      <div className="flex items-end gap-1.5 h-28" role="img" aria-label="Confidence distribution">
        {histogram.buckets.map((count, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
            <span className="font-mono text-[10px] text-muted-foreground">{count || ''}</span>
            <div
              className={cn(
                'w-full rounded-t transition-colors',
                // Low confidence is where the work is, so it carries the
                // attention colour. This is a distribution the learner chose,
                // not a judgement of it — hence one accent, not a gradient
                // implying a grade.
                i < 5 ? 'bg-chart-5/60' : 'bg-chart-2/60',
              )}
              // A zero bucket still gets 2px so the axis reads as ten slots
              // rather than as however many happen to be non-empty.
              style={{ height: peak > 0 ? `${Math.max(2, (count / peak) * 88)}px` : '2px' }}
            />
            <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground mt-3">
        {histogram.studied} card{histogram.studied === 1 ? '' : 's'} rated
        {histogram.average !== null && (
          <>
            , averaging <span className="font-mono">{histogram.average.toFixed(1)}</span>
          </>
        )}
        . <span className="font-mono">{histogram.due}</span> due for review now.
      </p>
    </div>
  )
}
