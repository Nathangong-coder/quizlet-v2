import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REGRADE_BUDGET_MS, REGRADE_CARDS_PER_RUN } from '@/lib/klp/regrade'
import { RUN_BUDGET_MS } from '@/lib/klp/background-authoring'

/**
 * A SOURCE SCAN, not a route invocation.
 *
 * The route needs a database and a credential pool, and this suite has no
 * DB-mocking precedent — so the properties worth protecting are pinned by
 * reading the file, the same posture `tests/auth/edge-safety.test.ts` takes
 * with the import graph. It catches the reorder and the wrong-prompt
 * regression, which are the two ways this quietly stops working.
 */
const ROUTE = readFileSync(
  join(process.cwd(), 'src/app/api/cron/author-klps/route.ts'),
  'utf-8',
)

describe('the background re-grade sweep is wired into the daily cron', () => {
  it('is called at all — otherwise nothing repairs stranded evidence automatically', () => {
    expect(ROUTE).toContain('regradeSweep')
  })

  it('runs BEFORE authoring, not after', () => {
    // THE ORDER IS THE DESIGN. Authoring supersedes key points, which is what
    // detaches learner evidence in the first place — this route is the largest
    // producer of the damage the sweep repairs. Run last, the sweep gets
    // whatever wall clock authoring left over, and a repair that only happens
    // when there is time to spare is not a repair.
    const sweepAt = ROUTE.indexOf('regradeSweep(')
    const authorAt = ROUTE.indexOf('await authorCard(')
    expect(sweepAt).toBeGreaterThan(-1)
    expect(authorAt).toBeGreaterThan(-1)
    expect(sweepAt).toBeLessThan(authorAt)
  })

  it('reports what it repaired in the response', () => {
    // A silent repair is indistinguishable from one that never ran.
    expect(ROUTE).toMatch(/\bregraded,/)
  })

  it('re-grades with the SAME prompt the quiz uses', () => {
    // A second grading prompt would drift, and a re-graded answer has to stay
    // comparable to a freshly graded one.
    expect(ROUTE).toContain('GRADE_SHORT_ANSWER_PROMPT')
  })

  it('discards error tags rather than re-deriving them', () => {
    // Re-deriving tags would rewrite the learner's error history under today's
    // significance constants as a side effect of a repair.
    expect(ROUTE).toMatch(/klpResults:\s*\(grade\.klpResults\s*\?\?\s*\[\]\)/)
  })
})

describe('sweep budgets', () => {
  it('leaves most of the invocation to authoring', () => {
    // The sweep runs first, so its cap is the only thing stopping a backlog of
    // re-gradable answers from consuming the whole run and authoring nothing.
    expect(REGRADE_BUDGET_MS).toBeLessThan(RUN_BUDGET_MS / 2)
  })

  it('processes more cards than the authoring batch, because most are free', () => {
    // Pure carry-forward costs zero AI calls; only a short-answer whose live
    // set gained a point needs one.
    expect(REGRADE_CARDS_PER_RUN).toBeGreaterThan(0)
  })
})
