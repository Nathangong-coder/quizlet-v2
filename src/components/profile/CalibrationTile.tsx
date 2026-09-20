'use client'

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { SELF_RATING_LABELS } from '@/lib/memory/self-rating'
import {
  CALIBRATION_MIN_SAMPLE,
  calibrationSample,
  type CalibrationBucket,
} from '@/lib/metrics/calibration'

/**
 * Spec 6 §6: "rated Certain — right 14 of 17", four rows, suppressed below
 * `CALIBRATION_MIN_SAMPLE`. No number on this tile is a calibration score;
 * the formula and the probability mapping are Spec 7's, and the copy says so.
 */
export function CalibrationTile({ calibration }: { calibration: CalibrationBucket[] }) {
  const sample = calibrationSample(calibration)
  const belowFloor = sample < CALIBRATION_MIN_SAMPLE

  return (
    <Card>
      <CardHeader>
        <CardTitle>Confidence vs results</CardTitle>
        <CardDescription>
          How often you were right at each level of sureness you gave before seeing feedback.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {belowFloor ? (
          <p className="text-sm text-muted-foreground">
            {sample} of {CALIBRATION_MIN_SAMPLE} rated answers so far
          </p>
        ) : (
          <>
            <ul className="space-y-1.5">
              {calibration.map((b) => (
                <li key={b.rating} className="flex items-center justify-between gap-3 text-sm">
                  <span>
                    <span className="text-muted-foreground">rated </span>
                    <span className="font-medium">{SELF_RATING_LABELS[b.rating]}</span>
                  </span>
                  <span className="tabular-nums">
                    <span className="text-muted-foreground">{' — '}</span>
                    right {b.correct} of {b.n}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              These are counts, not a score. Whether your confidence tracks your results is
              read from them later; nothing here changes what you are shown next.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}
