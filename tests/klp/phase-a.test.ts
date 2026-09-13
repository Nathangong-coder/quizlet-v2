import { describe, it, expect } from 'vitest'
import { validateKlpSet, noveltyAgainstQuestion, RESTATEMENT_NOVELTY_FLOOR } from '@/lib/klp/validate'
import { extractNumbers, findNumericDefects, NUMERIC_TOLERANCE } from '@/lib/klp/numeric'
import {
  ABSTRACTION_LEVELS,
  findAbstractionDefects,
  abstractionSpread,
  isAbstractionLevel,
  toOrderedLevels,
} from '@/lib/klp/abstraction'
import { CLASSIFY_ABSTRACTION_PROMPT } from '@/lib/ai/prompts/classify-abstraction'
import { AbstractionClassificationSchema } from '@/lib/ai/schemas'
import { KLP_KINDS } from '@/lib/ai/schemas'

const Q = 'Walk me through how a $10 increase in depreciation affects the three statements.'
const rules = (klps: string[], q = Q, opts = {}) =>
  validateKlpSet(klps.map((text) => ({ text })), q, { targetCount: 1, ...opts }).map((d) => d.rule)

describe('self-containment', () => {
  it('flags a point that opens on an unresolvable pronoun', () => {
    // Ask a verifier whether "it also reduces taxable income" is true and the
    // answer is meaningless — "it" is unresolvable outside the list, so the
    // verifier invents a referent and grades against that. The point then LOOKS
    // verified, which is worse than being caught.
    expect(rules(['It also reduces taxable income by the depreciation amount.']))
      .toContain('not_self_contained')
  })

  it('flags an explicit cross-reference to another point', () => {
    expect(rules(['As mentioned above, net income falls by 6 at a 40% tax rate.']))
      .toContain('not_self_contained')
  })

  it('does NOT flag a mid-sentence pronoun with a local antecedent', () => {
    // Flagging these would train the author out of ordinary English — the same
    // trap isCompound is deliberately narrow to avoid.
    expect(rules(['Depreciation rises by 10, and it reduces pre-tax income by the same amount.']))
      .not.toContain('not_self_contained')
  })
})

describe('meta-language', () => {
  it('flags a sentence about what a student should say', () => {
    // Not a proposition about the world, so a grader asked whether an answer
    // supports it is really being asked whether the answer pleases an assessor.
    expect(rules(['The student should mention the tax shield.'])).toContain('meta_language')
    expect(rules(['A good answer identifies the cash impact.'])).toContain('meta_language')
  })

  it('does not flag a normative claim about the WORLD', () => {
    expect(rules(['Deferred tax liabilities must be recognised on temporary differences.']))
      .not.toContain('meta_language')
  })
})

describe('restatement by novelty', () => {
  it('flags a reworded restatement, which exact matching missed entirely', () => {
    expect(rules(['How a $10 depreciation increase affects the three statements.']))
      .toContain('restatement')
  })

  it('does NOT flag a well-anchored point that shares the question vocabulary', () => {
    // Overlap is the wrong direction to measure: a good point SHOULD share
    // vocabulary with its question, and measuring overlap flags the
    // best-anchored points hardest.
    expect(rules(['Depreciation of 10 reduces pre-tax income by 10, so net income falls by 6 at a 40% tax rate.']))
      .not.toContain('restatement')
  })

  it('scores novelty on the key point side, not the question side', () => {
    expect(noveltyAgainstQuestion('depreciation statements', Q)).toBeLessThan(RESTATEMENT_NOVELTY_FLOOR)
    expect(noveltyAgainstQuestion('accumulated deficit compounds quarterly', Q)).toBe(1)
  })

  it('is 0, not NaN, for a point with no content words', () => {
    expect(noveltyAgainstQuestion('the and of', Q)).toBe(0)
  })
})

describe('R6 numeric consistency', () => {
  it('extracts magnitudes and percentages, ignoring years', () => {
    const f = extractNumbers('EBIT of $1,000 falls 40% since the 2008 crisis', 0)
    expect(f.map((x) => x.value)).toContain(1000)
    expect(f.find((x) => x.value === 40)?.isPercent).toBe(true)
    expect(f.map((x) => x.value)).not.toContain(2008)
  })

  it('catches the motivating case: a wrong after-tax number', () => {
    // A model that got this wrong while authoring will confidently confirm it
    // while verifying. Arithmetic is the one place a second AI opinion is worth
    // nothing.
    const defects = findNumericDefects([
      { text: 'EBIT falls by 10.' },
      { text: 'The tax rate is 40%.' },
      { text: 'Net income falls by 5.' },
    ])
    expect(defects).toHaveLength(1)
    expect(defects[0].index).toBe(2)
    expect(defects[0].detail).toContain('6.00')
  })

  it('accepts correct arithmetic', () => {
    expect(findNumericDefects([
      { text: 'EBIT falls by 10.' },
      { text: 'The tax rate is 40%.' },
      { text: 'Net income falls by 6.' },
    ])).toEqual([])
  })

  it('tolerates rounding rather than flagging it', () => {
    expect(findNumericDefects([
      { text: 'Pre-tax income falls by 10.' },
      { text: 'Taxed at 40.5%.' },
      { text: 'Net income falls by 6.' },
    ])).toEqual([])
    expect(NUMERIC_TOLERANCE).toBeGreaterThan(0)
  })

  it('stays silent when the card has no tax arithmetic at all', () => {
    // Most cards do not. Firing on them would train the operator to ignore it.
    expect(findNumericDefects([
      { text: 'Gross profit is revenue minus cost of goods sold.' },
      { text: 'Operating margin is typically 20 percent.' },
    ])).toEqual([])
  })

  it('stays silent when only one side of the tax line is named', () => {
    expect(findNumericDefects([
      { text: 'EBIT falls by 10.' },
      { text: 'The tax rate is 40%.' },
    ])).toEqual([])
  })

  it('REGRESSION: does not fire on ownership percentages (a real live card)', () => {
    // Found by running the rule over the live corpus. This card has NO tax
    // arithmetic at all — 80%, 50% and 20% are ownership stakes — but an
    // earlier version treated any bare percentage as a candidate tax rate,
    // matched "operating income" as pre-tax and "net income" as post-tax, and
    // reported a defect. A finance corpus is full of percentages that are not
    // tax rates, and a rule that cries wolf on correct authoring gets ignored.
    expect(findNumericDefects([
      { text: 'Because A owns more than 50% of B, it consolidates B, meaning it combines 100% of B financials with its own.' },
      { text: 'Through consolidation, B full $200M net income appears on A income statement, even though A only owns 80% of B.' },
      { text: 'The 20% of B not owned by A is $40M, calculated as 20% of $200M.' },
      { text: 'Because the $40M is adjusted below operating income, it does not affect operating income, EBITDA, or operating cash flow.' },
    ])).toEqual([])
  })

  it('accepts a card where SOME reading is consistent, not every pairing', () => {
    // A card can carry several unrelated numbers; demanding every pre/post pair
    // satisfy the identity would flag correct cards constantly.
    expect(findNumericDefects([
      { text: 'Revenue is 500 and EBIT falls by 10.' },
      { text: 'The tax rate is 40%.' },
      { text: 'Net income falls by 6.' },
    ])).toEqual([])
  })
})

describe('R4 abstraction', () => {
  it('does not collide with CardKlp.kind', () => {
    // `mechanism` is already a kind, meaning WHAT TYPE of proposition. Reusing
    // it for HOW ABSTRACT would make every query against it ambiguous — the
    // mistake this project already made once with categories-as-concepts.
    for (const level of ABSTRACTION_LEVELS) {
      expect(KLP_KINDS as readonly string[]).not.toContain(level)
    }
  })

  it('rejects a disposition at any count — it cannot be true of an ANSWER', () => {
    const d = findAbstractionDefects(['concrete', 'dispositional'])
    expect(d.map((x) => x.rule)).toContain('disposition')
    expect(d.find((x) => x.rule === 'disposition')?.index).toBe(1)
  })

  it('accepts a card sitting entirely at one level', () => {
    expect(findAbstractionDefects(['concrete', 'concrete', 'concrete', 'concrete'])).toEqual([])
  })

  it('accepts a card genuinely mixing two levels', () => {
    expect(findAbstractionDefects(['concrete', 'concrete', 'relational', 'relational'])).toEqual([])
  })

  it('flags a lone outlier among a set that is otherwise uniform', () => {
    const d = findAbstractionDefects(['concrete', 'concrete', 'concrete', 'relational'])
    expect(d.map((x) => x.rule)).toContain('abstraction_spread')
  })

  it('does not judge spread on a set too small to have a shape', () => {
    expect(findAbstractionDefects(['concrete', 'relational'])).toEqual([])
  })

  it('reports levels in abstraction order', () => {
    expect(abstractionSpread(['relational', 'concrete', 'relational'])).toEqual(['concrete', 'relational'])
  })

  it('validates the vocabulary', () => {
    expect(isAbstractionLevel('dispositional')).toBe(true)
    expect(isAbstractionLevel('mechanism')).toBe(false)
  })
})

describe('validateKlpSet integration', () => {
  it('skips abstraction entirely when nothing classified the points', () => {
    // Absence means "not classified", never "all concrete". Classification
    // needs a model; every other rule here is deterministic and must still run
    // for a caller with no AI budget.
    expect(rules(['Net income falls by 6 at a 40% tax rate.'])).not.toContain('disposition')
  })

  it('applies abstraction when it IS supplied', () => {
    const out = validateKlpSet(
      [{ text: 'The learner grasps leverage.' }],
      Q,
      { targetCount: 1, abstraction: ['dispositional'] },
    )
    expect(out.map((d) => d.rule)).toContain('disposition')
  })

  it('still reports the pre-existing rules', () => {
    expect(rules(['EBIT falls by 10 and net income falls by 6.'])).toContain('compound')
  })
})

describe('toOrderedLevels', () => {
  it('maps index-keyed replies onto KLP order', () => {
    expect(toOrderedLevels({ levels: [
      { klpIndex: 1, level: 'relational' },
      { klpIndex: 0, level: 'concrete' },
    ] }, 2)).toEqual(['concrete', 'relational'])
  })

  it('leaves a skipped point UNDEFINED rather than defaulting it to concrete', () => {
    // Defaulting would be the flattering direction twice over: it invents a
    // level nobody judged, and `concrete` is the level least likely to trigger
    // a finding — so a truncated reply would make the skipped point look clean
    // rather than unexamined.
    expect(toOrderedLevels({ levels: [{ klpIndex: 0, level: 'concrete' }] }, 3))
      .toEqual(['concrete', undefined, undefined])
  })

  it('drops an unclassified point from the spread statistic entirely', () => {
    // Four classified points with one outlier would fire; three classified plus
    // an unknown must not, because the shape is not established.
    expect(findAbstractionDefects(['concrete', 'concrete', 'concrete', undefined])).toEqual([])
  })

  it('still reports a disposition beside unclassified points', () => {
    const d = findAbstractionDefects([undefined, 'dispositional', undefined])
    expect(d.map((x) => x.rule)).toEqual(['disposition'])
    expect(d[0].index).toBe(1)
  })
})

describe('CLASSIFY_ABSTRACTION_PROMPT', () => {
  const built = CLASSIFY_ABSTRACTION_PROMPT.build({
    question: 'Why is the after-tax cost of debt lower than its coupon?',
    klps: [{ text: 'Interest is tax-deductible.' }, { text: 'Understands leverage.' }],
  })

  it('names every level in the closed vocabulary', () => {
    for (const l of ABSTRACTION_LEVELS) expect(built).toContain(l)
  })

  it('gives the model an operational test for dispositional', () => {
    // Without one, "dispositional" is a label the model applies by vibe. The
    // test that matters is whether the statement could be true or false of an
    // ANSWER — a proposition can, a claim about a person cannot.
    expect(built).toContain('true or false of an ANSWER')
  })

  it('forbids comparing the statements to each other', () => {
    // Cards legitimately mix levels, and a model nudged toward consistency
    // would flatten a correct set into a uniform one.
    expect(built).toContain('Do not compare the statements to each other')
  })

  it('never shows the model CardKlp.kind — a different axis with a shared word', () => {
    // `mechanism` exists in both vocabularies with different meanings, which is
    // exactly why R4 renamed this one. Showing the kind invites the wrong answer.
    expect(built).not.toContain('definition|mechanism')
    expect(built.toLowerCase()).not.toContain('kind:')
  })

  it('indexes the statements so a level can be traced back', () => {
    expect(built).toContain('[0] Interest is tax-deductible.')
  })
})

describe('AbstractionClassificationSchema', () => {
  it('rejects a level outside the vocabulary', () => {
    expect(AbstractionClassificationSchema.safeParse({
      levels: [{ klpIndex: 0, level: 'mechanism' }],
    }).success).toBe(false)
  })

  it('accepts a partial reply — the caller decides what a gap means', () => {
    expect(AbstractionClassificationSchema.safeParse({
      levels: [{ klpIndex: 2, level: 'concrete' }],
    }).success).toBe(true)
  })
})
