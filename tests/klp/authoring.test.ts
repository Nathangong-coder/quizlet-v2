import { describe, it, expect, vi } from 'vitest'
import { authorCard } from '@/lib/klp/authoring'
import type { KlpVerdict } from '@/lib/klp/verdicts'

const ok: KlpVerdict = 'correct'
const no: KlpVerdict = 'omission'

function gen(over: Partial<Record<string, unknown>> = {}) {
  const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
  return {
    author: vi.fn().mockResolvedValue({
      referenceAnswer: 'ref',
      klps,
      wrongAnswers: [
        { kind: 'confident_wrong', text: 'w1' },
        { kind: 'vague', text: 'w2' },
        { kind: 'memorized_template', text: 'w3' },
      ],
    }),
    // Reference all-correct; every wrong answer all-wrong -> separation 1.0
    grade: vi.fn().mockImplementation(({ candidateAnswer }: { candidateAnswer: string }) => ({
      verdicts: klps.map((_, i) => ({
        klpIndex: i, verdict: candidateAnswer === 'ref' ? ok : no,
      })),
    })),
    revise: vi.fn().mockResolvedValue({ klps }),
    relate: vi.fn().mockResolvedValue({ relations: [] }),
    ...over,
  }
}

const card = { question: 'Walk me through it', definition: 'x', setTitle: 'Accounting' }

describe('authorCard', () => {
  it('separates on the first pass and never revises', async () => {
    const g = gen()
    const out = await authorCard(card, g as never)
    expect(out.status).toBe('separated')
    expect(out.revisions).toBe(0)
    expect(g.revise).not.toHaveBeenCalled()
  })

  it('grades every candidate in its OWN call — reference plus three wrong', async () => {
    const g = gen()
    await authorCard(card, g as never)
    expect(g.grade).toHaveBeenCalledTimes(4)
  })

  /**
   * The grader must never be told which archetype it is looking at.
   *
   * Review finding (Fix 5): a blacklist of one key name
   * (`not.toContain('kind')`) stays green if `GradeInput` grows a
   * differently-named leak — `probeKind`, `archetype`, `candidateIndex` for
   * logging — that a production generator could still interpolate into the
   * prompt. Asserting the EXACT key set is the only form of this guard that
   * actually catches an added field, whatever it's called.
   */
  it('passes exactly the isolated fields into the grade call — no probe kind, no other leak', async () => {
    const g = gen()
    await authorCard(card, g as never)
    for (const call of g.grade.mock.calls) {
      expect(Object.keys(call[0]).sort()).toEqual(['candidateAnswer', 'klps', 'question', 'referenceAnswer'])
    }
  })

  /**
   * DEFECT 1 in the original plan: it declared `let round = 0`, read `round`
   * inside the `grade` mock, then reassigned `round = 1` AFTER awaiting
   * `authorCard` — dead code, since the mock only ever ran during the await
   * and could only ever see `round === 0`. Rewritten here with a counter
   * incremented INSIDE the mock itself, so it actually tracks which grading
   * round is in flight: calls 1-4 are round 0 (the wrong answers score 5/6,
   * too close to the reference to separate), calls 5+ are the post-revision
   * round (the wrong answers score 0, separating cleanly). This genuinely
   * forces `authorCard` through its revise-then-re-grade branch rather than
   * merely asserting call counts that would pass even if revision never ran.
   */
  it('revises when the wrong answers score too well, then re-grades', async () => {
    const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
    let callCount = 0
    const g = gen({
      grade: vi.fn().mockImplementation(({ candidateAnswer }: { candidateAnswer: string }) => {
        callCount += 1
        const isRound0 = callCount <= 4
        if (candidateAnswer === 'ref') {
          return { verdicts: klps.map((_, i) => ({ klpIndex: i, verdict: ok })) }
        }
        // Round 0: 5 of 6 KLPs pass (score 5/6, separation 1/6 — fails the
        // 0.4 floor). Round 1+: none pass (score 0, separation 1.0 — passes).
        return {
          verdicts: klps.map((_, i) => ({
            klpIndex: i,
            verdict: isRound0 ? (i < 5 ? ok : no) : no,
          })),
        }
      }),
    })
    const out = await authorCard(card, g as never)
    expect(g.revise).toHaveBeenCalled()
    expect(out.revisions).toBeGreaterThan(0)
    expect(out.status).toBe('separated')
  })

  /**
   * A card that will not separate is WRITTEN and FLAGGED, never dropped and
   * never retried silently.
   */
  it('flags low_discrimination after the cap instead of looping or dropping', async () => {
    const klps = Array.from({ length: 6 }, (_, i) => ({ text: `Proposition ${i}`, kind: 'mechanism' }))
    const g = gen({
      grade: vi.fn().mockResolvedValue({ verdicts: klps.map((_, i) => ({ klpIndex: i, verdict: ok })) }),
    })
    const out = await authorCard(card, g as never)
    expect(out.status).toBe('low_discrimination')
    expect(out.revisions).toBe(2)
    expect(out.klps.length).toBeGreaterThan(0)
  })

  it('computes weight from the relation graph, never from the model', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          { from: 1, to: 2, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g as never)
    expect(out.klps[0].weight).toBe(3)  // reaches 1 and 2
    expect(out.klps[2].weight).toBe(1)  // leaf
  })

  /**
   * The design requires dropping the SPECIFIC OFFENDER, not the whole batch.
   * `toBeLessThan(2)` (the original assertion) is satisfied by 0 survivors
   * too, which would also pass if `authorCard` dropped every edge the moment
   * any cycle appeared — exactly the "whole batch" failure mode this
   * behaviour exists to avoid. Pinning the exact survivor is what actually
   * guards it.
   */
  it('drops a relation that would create a cycle rather than persisting it', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          { from: 1, to: 0, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g as never)
    expect(out.relations).toHaveLength(1)
    expect(out.relations[0]).toMatchObject({ from: 0, to: 1, type: 'causes' })
  })

  /**
   * Fix 2 (review, Tasks 10-11): `RelationDraftSchema` bounds `from`/`to` at
   * `.min(0)` only — the upper bound is `klps.length`, which is dynamic and
   * cannot live in the schema. A hallucinated out-of-range index must be
   * dropped here, not left to throw at the Prisma layer in `persistAuthoring`
   * (`klpIds[r.from]` on a missing index). Same posture as
   * `extractKlpsForCards`'s "a hallucinated ref must not write another
   * card's KLPs onto this one" (`src/actions/klp.ts`).
   */
  it('drops a relation whose endpoint references a KLP index that does not exist on this card', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          // Only 6 KLPs exist (indices 0-5); 6 is out of range.
          { from: 2, to: 6, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g as never)
    expect(out.relations).toHaveLength(1)
    expect(out.relations[0]).toMatchObject({ from: 0, to: 1 })
    expect(out.relationStats).toEqual({ candidates: 2, accepted: 1, droppedForCycles: 0, droppedOutOfRange: 1 })
  })

  it('threads relation diagnostics through relationStats: candidates, accepted, cycle-drops', async () => {
    const g = gen({
      relate: vi.fn().mockResolvedValue({
        relations: [
          { from: 0, to: 1, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
          { from: 1, to: 0, type: 'causes', provenance: 'perturbation', rationale: 'r', probe: 'p' },
        ],
      }),
    })
    const out = await authorCard(card, g as never)
    expect(out.relationStats).toEqual({ candidates: 2, accepted: 1, droppedForCycles: 1, droppedOutOfRange: 0 })
  })

  it('reports mechanical defects without failing the card', async () => {
    const g = gen({
      author: vi.fn().mockResolvedValue({
        referenceAnswer: 'ref',
        klps: [{ text: 'only one point', kind: 'definition' }],
        wrongAnswers: [{ kind: 'vague', text: 'w' }],
      }),
    })
    const out = await authorCard(card, g as never)
    expect(out.defects.some((d) => d.rule === 'count')).toBe(true)
  })

  it('reports failed status when the author call produces no KLPs at all', async () => {
    const g = gen({
      author: vi.fn().mockResolvedValue({ referenceAnswer: 'ref', klps: [], wrongAnswers: [] }),
    })
    const out = await authorCard(card, g as never)
    expect(out.status).toBe('failed')
    expect(g.grade).not.toHaveBeenCalled()
    expect(out.relationStats).toEqual({ candidates: 0, accepted: 0, droppedForCycles: 0, droppedOutOfRange: 0 })
  })
})
