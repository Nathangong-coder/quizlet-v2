import { describe, it, expect } from 'vitest'
import { buildAnalysisWrites } from '@/lib/analysis/persist'
import { MC_TF_MAGNITUDE } from '@/lib/errors/bands'

const klps = [
  { id: 'klp-a', weight: 5 },
  { id: 'klp-b', weight: 3 },
]

// Spec 5 Phase A: the builder now also takes the answer text (spans are
// resolved against it), the card's relations and form requirements, and the
// grader's relation/form/unwarranted arrays. Empty here; the Spec 5 block at
// the bottom exercises them.
const spec5Empty = {
  answerText: '',
  relations: [] as { id: string }[],
  formReqs: [] as { id: string }[],
  relationResults: [],
  formResults: [],
  unwarranted: [],
}

const base = {
  mode: 'quiz-sa' as const,
  klps,
  starred: false,
  klpResults: [],
  errorTags: [],
  ...spec5Empty,
}

describe('buildAnalysisWrites — KLP results', () => {
  it('resolves a ref to a real id and computes credit', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 0, status: 'passed', evidence: 'said it plainly' }],
    })
    expect(w.klpResults).toEqual([
      {
        // The legacy `passed` draft is normalised: no v4 row says passed.
        klpId: 'klp-a', status: 'correct', credit: 0.95, mode: 'quiz-sa', evidence: 'said it plainly',
        // The quote is not in the (empty) answer text, so no span — null, not
        // absent, because the columns exist now and a legacy row's null must
        // mean the same thing as a fresh unresolved one.
        spanStart: null, spanEnd: null,
      },
    ])
  })

  it('drops a result whose ref does not resolve, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      klpResults: [{ klpRef: 7, status: 'failed' }],
    })
    expect(w.klpResults).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unresolved_klp_ref', value: '7' })
  })

  it('gives a failed status zero credit, short-circuiting before mode', () => {
    for (const mode of ['quiz-sa', 'quiz-mc', 'quiz-tf'] as const) {
      const w = buildAnalysisWrites({ ...base, mode, klpResults: [{ klpRef: 0, status: 'failed' }] })
      expect(w.klpResults[0].credit).toBe(0)
    }
  })

  it('scales a passed credit by the mode, which is where mode actually matters', () => {
    const sa = buildAnalysisWrites({ ...base, mode: 'quiz-sa', klpResults: [{ klpRef: 0, status: 'passed' }] })
    const tf = buildAnalysisWrites({ ...base, mode: 'quiz-tf', klpResults: [{ klpRef: 0, status: 'passed' }] })
    expect(sa.klpResults[0].credit).toBeCloseTo(0.95)
    expect(tf.klpResults[0].credit).toBeCloseTo(0.5)
    expect(sa.klpResults[0].credit).toBeGreaterThan(tf.klpResults[0].credit)
  })
})

describe('buildAnalysisWrites — error tags', () => {
  // inversion band is [2,5]; magnitude 7 -> floor 2 + 3*(6/9) = 4.
  const tag = { dimension: 'accuracy' as const, type: 'inversion', klpRef: 0, magnitude: 7 }

  it('computes significance from the KLP weight, not the model', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [tag] })
    expect(w.errorTags).toHaveLength(1)
    expect(w.errorTags[0]).toMatchObject({
      dimension: 'accuracy', type: 'inversion', klpId: 'klp-a',
      relevance: 5, severity: 4, magnitude: 7, mode: 'quiz-sa', starred: false,
    })
    // relevance 5 (klp-a's weight), severity 4, accuracy (1.0), unstarred:
    // (0.55*5 + 0.45*4) * 2 * 1.0 * 1 = 9.1 -> 9
    expect(w.errorTags[0].significance).toBe(9)
  })

  it('drops a tag with an unknown dimension, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'delivery' as never, type: 'inversion', klpRef: 0, magnitude: 3 }],
    })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unknown_dimension', value: 'delivery' })
  })

  it('drops a tag whose type is not in its dimension, and warns', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ ...tag, dimension: 'clarity', type: 'inversion' }],
    })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'invalid_type_for_dimension', value: 'clarity/inversion' })
  })

  it('drops a tag with an unknown type, and warns', () => {
    const w = buildAnalysisWrites({ ...base, errorTags: [{ ...tag, type: 'vibes' }] })
    expect(w.errorTags).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unknown_type', value: 'vibes' })
  })

  it('keeps a whole-answer tag with no klpRef, using relevance 3', () => {
    // No KLP target means no stored weight to read; the midpoint is the only
    // defensible neutral, and it is recorded so it can be recomputed.
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'conciseness', type: 'rambling', magnitude: 5 }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: null, relevance: 3 })
  })

  it('caps tags per dimension, keeping the most severe', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [
        // omission [2,5] at magnitude 1 -> floor 2
        { dimension: 'accuracy', type: 'omission', klpRef: 0, magnitude: 1 },
        // inversion [2,5] at MC_TF_MAGNITUDE -> ceiling 5
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: MC_TF_MAGNITUDE },
        // incomplete [1,3] at MC_TF_MAGNITUDE -> ceiling 3
        { dimension: 'accuracy', type: 'incomplete', klpRef: 1, magnitude: MC_TF_MAGNITUDE },
      ],
    })
    expect(w.errorTags).toHaveLength(2)
    expect(w.errorTags.map((t) => t.severity)).toEqual([5, 3])
    expect(w.warnings).toContainEqual({ reason: 'dimension_cap', value: 'accuracy' })
  })

  it('does NOT warn when a dimension reaches the cap without exceeding it', () => {
    // Exactly MAX_TAGS_PER_DIMENSION. The warning means "we dropped something",
    // so firing it here would make a clean answer look lossy.
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [
        { dimension: 'accuracy', type: 'omission', klpRef: 0, magnitude: 5 },
        { dimension: 'accuracy', type: 'inversion', klpRef: 1, magnitude: 6 },
      ],
    })
    expect(w.errorTags).toHaveLength(2)
    expect(w.warnings).not.toContainEqual({ reason: 'dimension_cap', value: 'accuracy' })
  })

  it('carries secondaryKlpId for conflation', () => {
    const w = buildAnalysisWrites({
      ...base,
      errorTags: [{ dimension: 'accuracy', type: 'conflation', klpRef: 0, secondaryKlpRef: 1, magnitude: MC_TF_MAGNITUDE }],
    })
    expect(w.errorTags[0]).toMatchObject({ klpId: 'klp-a', secondaryKlpId: 'klp-b' })
  })
})

describe('buildAnalysisWrites — status', () => {
  it('is analyzed when nothing was rejected', () => {
    expect(buildAnalysisWrites(base).status).toBe('analyzed')
  })

  it('stays analyzed when a tag was dropped — lossiness is a SEPARATE axis', () => {
    // "did we analyze" and "was the analysis lossy" are independent. Folding a
    // 'partial' status in would make "no_klps AND two tags rejected"
    // inexpressible.
    const w = buildAnalysisWrites({ ...base, errorTags: [{ dimension: 'accuracy', type: 'vibes', magnitude: 3 }] })
    expect(w.status).toBe('analyzed')
    expect(w.warnings.length).toBeGreaterThan(0)
  })

  it('is no_klps when the card has none', () => {
    const w = buildAnalysisWrites({ ...base, klps: [] })
    expect(w.status).toBe('no_klps')
    expect(w.klpResults).toEqual([])
  })

  it('lets forcedStatus override the derived status', () => {
    // Task 10 uses this for a legacy cache row with no distractor provenance.
    // Without the override such an answer records as `analyzed` — an answer
    // nobody could analyze, counted as a clean one.
    const w = buildAnalysisWrites({ ...base, forcedStatus: 'no_provenance' })
    expect(w.status).toBe('no_provenance')
  })

  it('lets forcedStatus win even when the card genuinely has no KLPs', () => {
    const w = buildAnalysisWrites({ ...base, klps: [], forcedStatus: 'failed' })
    expect(w.status).toBe('failed')
  })
})

describe('magnitude persistence (Spec 3)', () => {
  it('stores magnitude alongside the derived severity for short answer', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [],
      errorTags: [
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: 1 },
      ],
    })

    expect(result.errorTags[0].magnitude).toBe(1)
    // inversion band [2,5] at magnitude 1 -> floor
    expect(result.errorTags[0].severity).toBe(2)
  })

  it('writes MC_TF_MAGNITUDE for a multiple-choice tag so null stays legacy-only', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-mc',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [],
      errorTags: [
        { dimension: 'accuracy', type: 'inversion', klpRef: 0, magnitude: MC_TF_MAGNITUDE },
      ],
    })

    expect(result.errorTags[0].magnitude).toBe(MC_TF_MAGNITUDE)
    expect(result.errorTags[0].severity).toBe(5)
  })

  it('still caps per dimension by the derived severity', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [],
      errorTags: [
        { dimension: 'conciseness', type: 'redundancy', magnitude: 1 },
        { dimension: 'conciseness', type: 'kitchen_sink', magnitude: 10 },
        { dimension: 'conciseness', type: 'rambling', magnitude: 10 },
      ],
    })

    const kept = result.errorTags.filter((t) => t.dimension === 'conciseness')
    expect(kept).toHaveLength(2)
    expect(kept.map((t) => t.type)).toContain('kitchen_sink')
    expect(kept.map((t) => t.type)).not.toContain('redundancy')
  })
})

describe('duplicate KLP references must not destroy the answer (B10)', () => {
  it('keeps one result per KLP when the grader names the same point twice', () => {
    // ShortAnswerGradeSchema permits a repeated klpRef — nothing in the schema
    // or the prompt forbids it. Without deduping, `createMany` violates the
    // (quizAnswerId, klpId) unique constraint, the whole transaction rolls
    // back, and a paid-for grading is discarded behind "Failed to submit
    // answer". The learner loses the answer to a grader quirk.
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [
        { klpRef: 0, status: 'partial' },
        { klpRef: 0, status: 'passed' },
      ],
      errorTags: [],
    })

    expect(result.klpResults).toHaveLength(1)
    expect(result.warnings.map((w) => w.reason)).toContain('duplicate_klp_ref')
  })

  it('keeps the FIRST judgment, rather than merging two contradictory ones', () => {
    // Merging would invent a verdict the grader never gave. Dropping the later
    // one is the only option that persists something the model actually said.
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [
        { klpRef: 0, status: 'failed' },
        { klpRef: 0, status: 'passed' },
      ],
      errorTags: [],
    })

    expect(result.klpResults[0].status).toBe('failed')
    expect(result.klpResults[0].credit).toBe(0)
  })

  it('does not confuse two DIFFERENT refs that both resolve', () => {
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }, { id: 'klp2', weight: 3 }],
      starred: false,
      ...spec5Empty,
      klpResults: [
        { klpRef: 0, status: 'passed' },
        { klpRef: 1, status: 'failed' },
      ],
      errorTags: [],
    })

    expect(result.klpResults.map((r) => r.klpId)).toEqual(['klp1', 'klp2'])
    expect(result.warnings.map((w) => w.reason)).not.toContain('duplicate_klp_ref')
  })

  it('dedupes on the resolved KLP id, not the raw ref', () => {
    // Two distinct refs can resolve to the same KLP if the caller's `klps`
    // array repeats one — the constraint is on klpId, so that is what must be
    // deduped. Deduping on `klpRef` alone would still hit the constraint.
    const result = buildAnalysisWrites({
      mode: 'quiz-sa',
      klps: [{ id: 'klp1', weight: 5 }, { id: 'klp1', weight: 5 }],
      starred: false,
      ...spec5Empty,
      klpResults: [
        { klpRef: 0, status: 'passed' },
        { klpRef: 1, status: 'failed' },
      ],
      errorTags: [],
    })

    expect(result.klpResults).toHaveLength(1)
  })
})

describe('Spec 5 Phase A — spans, relations, form results, unwarranted claims', () => {
  // "FCF rises because D&A is non-cash." — 'FCF rises' sits at [0, 9);
  // 'D&A is non-cash' starts after "FCF rises because " (18 chars).
  const answerText = 'FCF rises because D&A is non-cash.'
  const s5 = {
    mode: 'quiz-sa' as const,
    klps: [{ id: 'k1', weight: 3 }, { id: 'k2', weight: 4 }],
    starred: false,
    relations: [{ id: 'r1' }],
    formReqs: [{ id: 'f1' }],
    answerText,
    errorTags: [],
    klpResults: [],
    relationResults: [],
    formResults: [],
    unwarranted: [],
  }

  it('resolves quotes to spans and warns on a paraphrase', () => {
    const w = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 0, status: 'correct' }, { klpRef: 1, status: 'inversion', quote: 'FCF rises' }],
    })
    expect(w.klpResults[1]).toMatchObject({
      klpId: 'k2', status: 'inversion', credit: 0, evidence: 'FCF rises', spanStart: 0, spanEnd: 9,
    })
    // A `correct` verdict carries no quote: null span and NO warning — the
    // grader was never asked to quote there, so nothing went unresolved.
    expect(w.klpResults[0]).toMatchObject({ klpId: 'k1', spanStart: null, spanEnd: null })
    expect(w.warnings).toEqual([])

    const w2 = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 1, status: 'omission', quote: 'cash flow goes up' }],
    })
    expect(w2.klpResults[0].spanStart).toBeNull()
    expect(w2.klpResults[0].spanEnd).toBeNull()
    // The paraphrase is still kept as evidence text for display; only the span is missing.
    expect(w2.klpResults[0].evidence).toBe('cash flow goes up')
    expect(w2.warnings).toContainEqual({ reason: 'quote_unresolved', value: 'klp:1' })
  })

  it('treats an empty quote as no quote — null span, no evidence, no warning', () => {
    const w = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 0, status: 'correct', quote: '' }, { klpRef: 1, status: 'partial', quote: '   ' }],
      relationResults: [{ relationRef: 0, status: 'correct', quote: '' }],
      unwarranted: [{ text: 'x', quote: '', magnitude: 2 }],
    })
    expect(w.klpResults[0]).toMatchObject({ spanStart: null, spanEnd: null })
    expect(w.klpResults[0].evidence).toBeUndefined()
    expect(w.klpResults[1].evidence).toBeUndefined()
    expect(w.relationResults[0].evidence).toBeUndefined()
    expect(w.unwarranted[0].evidence).toBeUndefined()
    expect(w.warnings).toEqual([])
  })

  it('accepts the bridged `evidence` key as the quote (the schema transform fills it)', () => {
    const w = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 1, status: 'partial', evidence: 'FCF rises' }],
    })
    expect(w.klpResults[0]).toMatchObject({ evidence: 'FCF rises', spanStart: 0, spanEnd: 9 })
  })

  it('writes relation results with passive provenance and form results', () => {
    const w = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 0, status: 'omission', quote: 'D&A is non-cash' }],
      formResults: [{ formRef: 0, status: 'not_met' }],
    })
    expect(w.relationResults).toHaveLength(1)
    expect(w.relationResults[0]).toMatchObject({
      relationId: 'r1', status: 'omission', credit: 0, provenance: 'passive',
      evidence: 'D&A is non-cash', spanStart: 18, spanEnd: 33,
    })
    expect(w.formResults).toHaveLength(1)
    expect(w.formResults[0]).toMatchObject({
      formRequirementId: 'f1', status: 'not_met', spanStart: null, spanEnd: null,
    })
    expect(w.warnings).toEqual([])
  })

  it('credits a relation the way a key point is credited — status x mode x factor', () => {
    const w = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'FCF rises' }],
    })
    expect(w.relationResults[0].credit).toBeCloseTo(0.95)
    const tf = buildAnalysisWrites({
      ...s5,
      mode: 'quiz-tf',
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'FCF rises' }],
    })
    expect(tf.relationResults[0].credit).toBeCloseTo(0.5)
  })

  it('warns on an unresolved relation or form quote with a typed ref', () => {
    const w = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'not in the answer' }],
      formResults: [{ formRef: 0, status: 'met', quote: 'nor this' }],
    })
    expect(w.relationResults[0].spanStart).toBeNull()
    expect(w.formResults[0].spanStart).toBeNull()
    expect(w.warnings).toContainEqual({ reason: 'quote_unresolved', value: 'rel:0' })
    expect(w.warnings).toContainEqual({ reason: 'quote_unresolved', value: 'form:0' })
  })

  it('an unresolved relation ref is a warning, never a row', () => {
    const w = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 7, status: 'correct' }],
    })
    expect(w.relationResults).toHaveLength(0)
    expect(w.warnings).toContainEqual({ reason: 'unresolved_relation_ref', value: '7' })
  })

  it('an unresolved form ref is a warning, never a row', () => {
    const w = buildAnalysisWrites({
      ...s5,
      formResults: [{ formRef: 3, status: 'met' }],
    })
    expect(w.formResults).toHaveLength(0)
    expect(w.warnings).toContainEqual({ reason: 'unresolved_form_ref', value: '3' })
  })

  it('with NO relations or form reqs wired (Task 8 pending), every ref is a warning and no row', () => {
    // This is the state every SA call site is in until Task 8 passes the
    // real ids: the grader's arrays are forwarded, the id lists are empty.
    const w = buildAnalysisWrites({
      ...s5,
      relations: [],
      formReqs: [],
      relationResults: [{ relationRef: 0, status: 'correct' }],
      formResults: [{ formRef: 0, status: 'met' }],
    })
    expect(w.relationResults).toEqual([])
    expect(w.formResults).toEqual([])
    expect(w.warnings).toContainEqual({ reason: 'unresolved_relation_ref', value: '0' })
    expect(w.warnings).toContainEqual({ reason: 'unresolved_form_ref', value: '0' })
  })

  it('dedupes a relation named twice, keeping the first judgment', () => {
    // AnswerRelationResult is unique on (quizAnswerId, relationId), same
    // constraint shape AnswerKlpResult has — and the same transaction-wide
    // rollback if it is violated.
    const w = buildAnalysisWrites({
      ...s5,
      relationResults: [
        { relationRef: 0, status: 'failed', quote: 'FCF rises' },
        { relationRef: 0, status: 'correct', quote: 'FCF rises' },
      ],
    })
    expect(w.relationResults).toHaveLength(1)
    expect(w.relationResults[0].status).toBe('failed')
    expect(w.warnings).toContainEqual({ reason: 'duplicate_relation_ref', value: '0' })
  })

  it('unwarranted claims dock KLP credit through the contamination band', () => {
    const clean = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 0, status: 'correct' }],
    })
    const dirty = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 0, status: 'correct' }],
      unwarranted: [{ text: 'claims D&A is a cash outflow', quote: 'D&A is non-cash', magnitude: 10 }],
    })
    expect(dirty.unwarranted).toHaveLength(1)
    expect(dirty.unwarranted[0]).toMatchObject({
      text: 'claims D&A is a cash outflow', magnitude: 10, evidence: 'D&A is non-cash', spanStart: 18, spanEnd: 33,
    })
    expect(dirty.klpResults[0].credit).toBeLessThan(clean.klpResults[0].credit)
    // Magnitude 10 is the top of the band: the same dock a severity-5 tag gives.
    expect(dirty.klpResults[0].credit).toBeCloseTo(clean.klpResults[0].credit * 0.5)
  })

  it('an unwarranted claim also docks relation credit', () => {
    const clean = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'FCF rises' }],
    })
    const dirty = buildAnalysisWrites({
      ...s5,
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'FCF rises' }],
      unwarranted: [{ text: 'x', magnitude: 6 }],
    })
    expect(dirty.relationResults[0].credit).toBeLessThan(clean.relationResults[0].credit)
  })

  it('an unwarranted claim with no quote is still a row, with a null span and no warning', () => {
    const w = buildAnalysisWrites({
      ...s5,
      unwarranted: [{ text: 'invented a tax shield figure', magnitude: 4 }],
    })
    expect(w.unwarranted[0]).toMatchObject({ text: 'invented a tax shield figure', magnitude: 4, spanStart: null })
    expect(w.warnings).toEqual([])
  })

  it('an unwarranted claim whose quote does not resolve warns with its index', () => {
    const w = buildAnalysisWrites({
      ...s5,
      unwarranted: [
        { text: 'a', quote: 'FCF rises', magnitude: 2 },
        { text: 'b', quote: 'nowhere in the answer', magnitude: 2 },
      ],
    })
    expect(w.unwarranted).toHaveLength(2)
    expect(w.warnings).toEqual([{ reason: 'quote_unresolved', value: 'unwarranted:1' }])
  })

  it('never writes passed — a legacy passed draft lands as correct, at full credit', () => {
    // `passed` is a read-only alias from v4 on. MC/TF drafts and any older
    // caller are covered HERE, not at each draft site.
    const w = buildAnalysisWrites({
      ...s5,
      klpResults: [{ klpRef: 0, status: 'passed' }, { klpRef: 1, status: 'partial' }],
      relationResults: [{ relationRef: 0, status: 'correct', quote: 'FCF rises' }],
    })
    expect(w.klpResults[0]).toMatchObject({ klpId: 'k1', status: 'correct', credit: 0.95 })
    expect(w.klpResults.every((r) => r.status !== 'passed')).toBe(true)
    // A relation row's status is typed `KlpVerdict`, which has no `passed`
    // member — comparing the literal is a tsc error, so widen to string here.
    expect(w.relationResults.every((r) => (r.status as string) !== 'passed')).toBe(true)
  })
})
