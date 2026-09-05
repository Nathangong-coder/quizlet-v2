import { z } from 'zod';
import { CORRUPTIONS } from '@/lib/quiz/options';
import { DIMENSIONS, MAX_TAGS_PER_ANSWER } from '@/lib/errors/taxonomy';
import { KLP_STATUSES } from '@/lib/errors/klp-credit';
import { PROBE_KINDS, MAX_KLPS_AUTHORED } from '@/lib/klp/authoring-config';
import { KLP_VERDICTS } from '@/lib/klp/verdicts';
import { RELATABLE_TYPES, RELATION_PROVENANCES } from '@/lib/klp/relations';

export const MultipleChoiceOptionsSchema = z.object({
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.string().min(1),
});

export type MultipleChoiceOptions = z.infer<typeof MultipleChoiceOptionsSchema>;

export const ShortAnswerGradeSchema = z.object({
  clarity: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  conciseness: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  correctness: z.object({
    score: z.number().int().min(1).max(10),
    pros: z.array(z.string()),
    cons: z.array(z.string()),
  }),
  overall: z.number().min(1).max(10),
  summary: z.string().min(1),
  suggestedImprovement: z.string().min(1),
  /**
   * Per-KLP outcomes. `klpRef` is an index into the prompt's KLP list, never a
   * cuid. Optional so the no-KLP path parses today's shape unchanged.
   */
  klpResults: z.array(z.object({
    klpRef: z.number().int().min(0),
    status: z.enum(KLP_STATUSES),
    evidence: z.string().optional(),
  })).optional(),
  /**
   * `type` is z.string(), not an enum: it is validated against its OWN
   * dimension in TS (buildAnalysisWrites), which a flat enum cannot express.
   * `magnitude` is the AI's ONLY numeric contribution — how bad THIS instance
   * is within its type. The type's band converts it to a 1-5 severity in TS
   * (src/lib/errors/bands.ts); the model never sees the band.
   */
  errorTags: z.array(z.object({
    dimension: z.enum(DIMENSIONS),
    type: z.string().min(1),
    klpRef: z.number().int().min(0).optional(),
    secondaryKlpRef: z.number().int().min(0).optional(),
    magnitude: z.number().int().min(1).max(10),
    quote: z.string().optional(),
  })).max(MAX_TAGS_PER_ANSWER).optional(),
});

export type ShortAnswerGrade = z.infer<typeof ShortAnswerGradeSchema>;

export const AnnotationSchema = z.object({
  annotations: z.array(z.object({
    type: z.enum(['bold', 'underline', 'highlight']),
    text: z.string(),
    startIndex: z.number(),
    endIndex: z.number(),
    comment: z.string().optional(),
  })),
});

export type Annotation = z.infer<typeof AnnotationSchema>;

export const MultipleChoiceFeedbackSchema = z.object({
  feedback: z.string().min(1),
});

export type MultipleChoiceFeedback = z.infer<typeof MultipleChoiceFeedbackSchema>;

export const CardAutocompleteSchema = z.object({
  suggestions: z.array(z.string().min(1)).min(1).max(5),
});

export type CardAutocomplete = z.infer<typeof CardAutocompleteSchema>;

export const CardAutofillSchema = z.object({
  term: z.string().trim().min(1),
  definition: z.string().trim().min(1),
});

export type CardAutofill = z.infer<typeof CardAutofillSchema>;

/** AI output for a study note. Source line references are only UI hints. */
export const StudyNoteAnalysisSchema = z.object({
  summaryLines: z.array(z.object({
    text: z.string().trim().min(1),
    sourceLine: z.number().int().min(0).optional(),
    kind: z.enum(['insight', 'definition', 'question', 'action']).default('insight'),
  })).min(1).max(24),
  keyTerms: z.array(z.string().trim().min(1)).max(20),
  followUps: z.array(z.string().trim().min(1)).max(12),
  suggestions: z.array(z.object({
    sourceLine: z.number().int().min(0),
    kind: z.literal('remove'),
    excerpt: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(1).max(1000),
  })).max(12).default([]),
});

export type StudyNoteAnalysis = z.infer<typeof StudyNoteAnalysisSchema>;

export const StudyNoteStoredLineSchema = z.object({
  id: z.string().min(1),
  text: z.string().trim().min(1),
  sourceLine: z.number().int().min(0).optional(),
  kind: z.enum(['insight', 'definition', 'question', 'action']),
  highlighted: z.boolean(),
  comment: z.string().max(2000),
});

export const StudyNoteStoredAnalysisSchema = z.object({
  summaryLines: z.array(StudyNoteStoredLineSchema).max(24),
  keyTerms: z.array(z.string().min(1)).max(20),
  followUps: z.array(z.string().min(1)).max(12),
  suggestions: z.array(z.object({
    id: z.string().min(1),
    sourceLine: z.number().int().min(0),
    kind: z.literal('remove'),
    excerpt: z.string().min(1).max(500),
    rationale: z.string().min(1).max(1000),
  })).max(12).default([]),
  annotations: z.array(z.object({
    lineId: z.string().min(1),
    highlighted: z.boolean(),
    comment: z.string().max(2000),
  })).max(500).default([]),
});

export type StudyNoteStoredAnalysis = z.infer<typeof StudyNoteStoredAnalysisSchema>;

export const DiagnosticQuestionSetSchema = z.object({
  questions: z.array(z.object({
    cardRef: z.number().int().min(0),
    kind: z.enum(['core', 'follow-up']),
    learningPoint: z.string().trim().min(1).max(500),
    question: z.string().trim().min(1).max(1200),
    expectedAnswer: z.string().trim().min(1).max(1600),
  })).min(8).max(40),
});

export type DiagnosticQuestionSet = z.infer<typeof DiagnosticQuestionSetSchema>;

export const DiagnosticGradeSetSchema = z.object({
  grades: z.array(z.object({
    questionRef: z.number().int().min(0),
    score: z.number().int().min(1).max(10),
    status: z.enum(['mastered', 'partial', 'missed']),
    feedback: z.string().trim().min(1).max(1200),
    mistake: z.string().trim().max(800).optional(),
  })).min(1).max(40),
});

export type DiagnosticGradeSet = z.infer<typeof DiagnosticGradeSetSchema>;

export const DiagnosticReportSchema = z.object({
  overview: z.string().trim().min(1).max(1600),
  strengths: z.array(z.string().trim().min(1).max(500)).max(8),
  gaps: z.array(z.string().trim().min(1).max(500)).max(12),
  recommendations: z.array(z.string().trim().min(1).max(700)).min(1).max(12),
  learningPoints: z.array(z.object({
    text: z.string().trim().min(1).max(500),
    score: z.number().int().min(1).max(10),
    evidence: z.string().trim().min(1).max(700),
    nextAction: z.string().trim().min(1).max(700),
  })).max(24),
});

export type DiagnosticReport = z.infer<typeof DiagnosticReportSchema>;

export const TrainingPlanSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  focusAreas: z.array(z.object({
    label: z.string().min(1),
    reason: z.string().min(1),
    priority: z.enum(['low', 'medium', 'high']),
  })),
  recommendedCardIds: z.array(z.string()),
  generatedQuestions: z.array(z.object({
    cardId: z.string().optional(),
    question: z.string().min(1),
    expectedAnswer: z.string().min(1),
  })),
});

export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

/**
 * KLP kinds. `kind` is what makes "memorizes terms, fails on why" a groupBy
 * rather than an AI judgment — see docs/ai/error-taxonomy.md §6.
 */
export const KLP_KINDS = [
  'definition',
  'mechanism',
  'causal',
  'condition',
  'quantitative',
  'contrast',
  'example',
] as const;

export const MAX_KLPS_PER_CARD = 5;

export const KlpExtractionSchema = z.object({
  cards: z.array(
    z.object({
      // Index into the batch the prompt was built from. Cards are addressed by
      // position, never by cuid — the model must never see raw ids.
      ref: z.number().int().min(0),
      cardType: z.enum(['atomic', 'compound']),
      klps: z
        .array(
          z.object({
            text: z.string().min(1),
            weight: z.number().int().min(1).max(5),
            kind: z.enum(KLP_KINDS),
          }),
        )
        .min(1)
        .max(MAX_KLPS_PER_CARD),
    }),
  ),
});

export type KlpExtraction = z.infer<typeof KlpExtractionSchema>;

/**
 * KLP-aware MC generation. Distractors reference the KLP they corrupt by its
 * `ref` (index in the prompt), never by cuid; the action maps refs back to ids.
 */
export const MultipleChoiceKlpSchema = z.object({
  correctAnswer: z.string().min(1),
  distractors: z
    .array(
      z.object({
        text: z.string().min(1),
        klpRef: z.number().int().min(0),
        corruption: z.enum(CORRUPTIONS),
      }),
    )
    .length(3),
});

export type MultipleChoiceKlp = z.infer<typeof MultipleChoiceKlpSchema>;

export const TrueFalseStatementSchema = z.object({
  statement: z.string().min(1),
  klpRef: z.number().int().min(0),
  corruption: z.enum(CORRUPTIONS),
});

export type TrueFalseStatement = z.infer<typeof TrueFalseStatementSchema>;

/**
 * How many LEAF concepts one key point may carry.
 *
 * Two, not three: breadth now comes from the tree, so these are peers ("the
 * concept this is chiefly about" plus at most one it honestly also covers),
 * not rungs. A third peer is almost always the model padding.
 */
export const MAX_CONCEPTS_PER_KLP = 2;

/** @deprecated Use MAX_CONCEPTS_PER_KLP. Kept so the tuning bound keeps working. */
export const MAX_KLTS_PER_KLP = MAX_CONCEPTS_PER_KLP;

export const KltSummarySchema = z.object({
  klps: z.array(
    z.object({
      // Index into the batch, never a cuid — the model must never see raw ids.
      ref: z.number().int().min(0),
      /** 3-6 word rendering of the proposition, e.g. "Debt impact on WACC". */
      label: z.string().min(1),
      /** Leaf concepts, most central first. May be empty. */
      concepts: z.array(z.string().min(1)).max(MAX_CONCEPTS_PER_KLP),
    }),
  ),
});

export type KltSummary = z.infer<typeof KltSummarySchema>;

export const KltPlacementSchema = z.object({
  placements: z.array(
    z.object({
      /** The concept being placed, echoed back exactly as given. */
      concept: z.string().min(1),
      /** Root-first path INCLUDING the concept itself as the last element. */
      path: z.array(z.string().min(1)).min(1),
    }),
  ),
});

export type KltPlacement = z.infer<typeof KltPlacementSchema>;

/**
 * Deepest a suggested skeleton may go. Top rungs only — never leaves.
 *
 * Separate from `MAX_TREE_DEPTH` (the whole tree's cap, 8): a skeleton is
 * proposed BEFORE any placement happens, to anchor the top few rungs a
 * subject organises into, not to describe the tree's eventual full depth.
 */
export const MAX_SKELETON_DEPTH = 3;

export const KltSkeletonSchema = z.object({
  /** Root-first paths, each 1..MAX_SKELETON_DEPTH segments. Never a leaf. */
  paths: z.array(z.array(z.string().min(1)).min(1).max(MAX_SKELETON_DEPTH)).min(1),
});

export type KltSkeleton = z.infer<typeof KltSkeletonSchema>;

/**
 * The KLP authoring pipeline (Stage 8 rebuild, Spec 2). Four schemas for the
 * four calls in `src/lib/klp/authoring.ts`'s loop — author, grade, revise,
 * relate. See `docs/superpowers/specs/2026-09-04-klp-authoring-pipeline-design.md`.
 *
 * Bounded by `MAX_KLPS_AUTHORED` (9), NOT the legacy `MAX_KLPS_PER_CARD` (5)
 * above. The two are deliberately separate constants — see the doc comment
 * on `MAX_KLPS_AUTHORED` in `src/lib/klp/authoring-config.ts`: conflating them
 * once already silently changed the legacy extraction prompt's behaviour on
 * this branch, for cards that never go through authoring at all.
 */

/**
 * Call A's output. Deliberately has NO `weight` field — weight is COMPUTED
 * from the relation graph (`blastRadius` -> `weightFromBlastRadius`) in the
 * orchestrator, never asked of the model. Audit finding G1: a model asked
 * "how central is this?" says "very" — 92% of AI-assigned weights were 4 or 5.
 */
export const AuthorDraftSchema = z.object({
  /**
   * The points the card's own definition already makes, and how many KLPs each
   * needs once expanded — the judgment half of adaptive sizing (increment A
   * §5), returned by the call that is ALREADY reading the definition rather
   * than by a fifth AI call whose entire output would be one number.
   *
   * `klpsNeeded` is loosely typed on purpose: `z.number()` rather than an
   * `int().min(1).max(3)`. `src/lib/klp/sizing.ts` floors, clamps and sums it,
   * and a tight bound here would fail the WHOLE call — reference answer, KLPs
   * and all three adversaries, 1 of the run's 6-16 requests — over a model
   * writing 2.5 in a field that only ever contributes to a maximum.
   *
   * OPTIONAL, so a model that omits it degrades the sizing rather than the run:
   * `targetKlpCount` still has the mechanical prior and the floor.
   */
  definitionPoints: z.array(z.object({
    point: z.string().min(1),
    klpsNeeded: z.number(),
  })).optional(),
  referenceAnswer: z.string().min(1),
  /**
   * Where the model believes the card's own definition is wrong or incomplete
   * (increment A §2).
   *
   * The definition is the SKELETON the reference answer expands, so the model
   * needs somewhere to put a disagreement. This field is that somewhere, and it
   * exists specifically so the model does NOT silently "correct" the owner's
   * card: a pipeline that quietly rewrites what the owner wrote is worse than
   * one that flags it, because the owner never learns their card was wrong.
   * Surfaced by `scripts/author-klps.ts` at the end of a run; not persisted.
   */
  concerns: z.array(z.string().min(1)).optional(),
  klps: z.array(z.object({
    text: z.string().min(1),
    kind: z.enum(KLP_KINDS),
  })).min(1).max(MAX_KLPS_AUTHORED),
  /**
   * EXACTLY `PROBE_KINDS.length`, one per archetype, no duplicates. `.min(1)`
   * alone (the original bound) let a model return one adversary, or three
   * `vague` ones, and neither `computeSeparation` (which reads the BEST wrong
   * answer) nor anything downstream would notice — a card silently loses
   * most of its discrimination test with nothing flagging it. `.length()`
   * pins the count; `.refine` pins distinctness, since three answers of the
   * same kind pass `.length(3)` but still aren't the three-archetype design
   * the prompt asks for.
   */
  wrongAnswers: z.array(z.object({
    kind: z.enum(PROBE_KINDS),
    text: z.string().min(1),
  }))
    .length(PROBE_KINDS.length)
    .refine(
      (arr) => new Set(arr.map((w) => w.kind)).size === arr.length,
      { message: 'wrongAnswers must cover each archetype exactly once, with no duplicates' },
    ),
});

export type AuthorDraft = z.infer<typeof AuthorDraftSchema>;

/**
 * Call B's output: one verdict per KLP for ONE candidate answer. `klpIndex`
 * is a position in the prompt's KLP list, never a cuid — the grader never
 * sees the KLPs' real ids, only their text.
 */
export const CandidateGradeSchema = z.object({
  verdicts: z.array(z.object({
    klpIndex: z.number().int().min(0),
    verdict: z.enum(KLP_VERDICTS),
    evidence: z.string().optional(),
  })),
});

export type CandidateGrade = z.infer<typeof CandidateGradeSchema>;

/** Call C's output: a revised KLP set, same shape as call A's `klps`. */
export const ReviseKlpsSchema = z.object({
  klps: z.array(z.object({
    text: z.string().min(1),
    kind: z.enum(KLP_KINDS),
  })).min(1).max(MAX_KLPS_AUTHORED),
});

export type ReviseKlps = z.infer<typeof ReviseKlpsSchema>;

/**
 * Call D's output. `from`/`to` are KLP INDEXES within the card, not ids —
 * the orchestrator maps them onto real `CardKlp` ids once they exist
 * (`persistAuthoring`).
 *
 * `type` is bounded by `RELATABLE_TYPES`, NOT the full `RELATION_TYPES` —
 * `analogous_to` is a real vocabulary member but is cross-card, and this
 * call only ever sees one card's KLPs. Review finding: the prompt telling
 * the model not to emit it was the ONLY defence before this bound existed;
 * models ignore instructions routinely, and without a schema-level reject a
 * stray `analogous_to` would sail through `canonicalizeEdges` (exempted from
 * the cycle check as symmetric) and get persisted as a relation this spec
 * explicitly promised not to create.
 */
export const RelationDraftSchema = z.object({
  relations: z.array(z.object({
    from: z.number().int().min(0),
    to: z.number().int().min(0),
    type: z.enum(RELATABLE_TYPES),
    provenance: z.enum(RELATION_PROVENANCES),
    rationale: z.string().min(1),
    probe: z.string().min(1),
  })),
});

export type RelationDraft = z.infer<typeof RelationDraftSchema>;
