// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { CalibrationTile } from '@/components/profile/CalibrationTile'
import { CALIBRATION_MIN_SAMPLE, type CalibrationBucket } from '@/lib/metrics/calibration'

afterEach(cleanup)

function buckets(n: [number, number, number, number], correct: [number, number, number, number]): CalibrationBucket[] {
  return [1, 2, 3, 4].map((rating, i) => ({ rating: rating as 1 | 2 | 3 | 4, n: n[i], correct: correct[i] }))
}

describe('CalibrationTile', () => {
  it('below the floor: "N of 20 rated answers so far" and no rows', () => {
    render(<CalibrationTile calibration={buckets([3, 4, 3, 2], [0, 2, 2, 2])} />)
    expect(screen.getByText(`12 of ${CALIBRATION_MIN_SAMPLE} rated answers so far`)).toBeTruthy()
    expect(screen.queryByText(/rated/i, { selector: 'li *' })).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('at the floor: four rows of counts and the "counts, not a score" line', () => {
    render(<CalibrationTile calibration={buckets([1, 2, 3, 17], [0, 1, 2, 14])} />)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(4)
    expect(items[3].textContent).toMatch(/rated\s+Certain\s+—\s+right 14 of 17/)
    expect(items[0].textContent).toMatch(/rated\s+No idea\s+—\s+right 0 of 1/)
    expect(screen.getByText(/counts, not a score/i)).toBeTruthy()
    expect(screen.queryByText(/so far/)).toBeNull()
  })

  it('never renders a percentage or a score', () => {
    render(<CalibrationTile calibration={buckets([5, 5, 5, 5], [1, 2, 3, 4])} />)
    expect(document.body.textContent).not.toMatch(/%/)
    expect(document.body.textContent).not.toMatch(/\bECE\b|\bBrier\b/)
  })
})
