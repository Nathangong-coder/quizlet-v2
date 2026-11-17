import { ShortAnswerGradeWithAnalysisSchema } from '@/lib/ai/schemas'
import { describe, it, expect } from 'vitest';
import { CandidateGradeSchema, MultipleChoiceOptionsSchema, ShortAnswerGradeSchema, TrainingPlanSchema } from '@/lib/ai/schemas';

describe('AI Schemas', () => {
  describe('MultipleChoiceOptionsSchema', () => {
    it('should validate a correct response', () => {
      const valid = {
        options: ['Option 1', 'Option 2', 'Option 3', 'Option 4'],
        correctAnswer: 'Option 1',
      };
      expect(MultipleChoiceOptionsSchema.parse(valid)).toEqual(valid);
    });

    it('should fail if there are not exactly 4 options', () => {
      const invalid = {
        options: ['Option 1', 'Option 2', 'Option 3'],
        correctAnswer: 'Option 1',
      };
      expect(() => MultipleChoiceOptionsSchema.parse(invalid)).toThrow();
    });

    it('should fail if an option is empty', () => {
      const invalid = {
        options: ['Option 1', '', 'Option 3', 'Option 4'],
        correctAnswer: 'Option 1',
      };
      expect(() => MultipleChoiceOptionsSchema.parse(invalid)).toThrow();
    });
  });

  describe('ShortAnswerGradeSchema', () => {
    const criterion = (score: number) => ({
      score,
      pros: ['Correctly identifies the key driver.'],
      cons: ['Could be more concise.'],
    });

    it('should validate a correct grade', () => {
      const valid = {
        clarity: criterion(8),
        conciseness: criterion(7),
        correctness: criterion(9),
        overall: 8,
        summary: 'Great answer, but could be more concise.',
        suggestedImprovement: 'Try to remove the first sentence.',
      };
      expect(ShortAnswerGradeSchema.parse(valid)).toEqual(valid);
    });

    it('should fail if a criterion score is out of bounds', () => {
      const invalid = {
        clarity: criterion(11),
        conciseness: criterion(7),
        correctness: criterion(9),
        overall: 8,
        summary: '...',
        suggestedImprovement: '...',
      };
      expect(() => ShortAnswerGradeSchema.parse(invalid)).toThrow();
    });

    it('should fail if summary is missing', () => {
      const invalid = {
        clarity: criterion(8),
        conciseness: criterion(7),
        correctness: criterion(9),
        overall: 8,
        summary: '',
        suggestedImprovement: '...',
      };
      expect(() => ShortAnswerGradeSchema.parse(invalid)).toThrow();
    });

    // Spec 5 Phase A, Task 3: klpResults.status is the runtime vocabulary.
    // `passed` is a read-only alias on historical rows (D1) — the grader is
    // never offered it, so the schema never accepts it.
    it('klpResults.status accepts a wide-vocabulary verdict and rejects the legacy word', () => {
      const base = {
        clarity: criterion(8),
        conciseness: criterion(7),
        correctness: criterion(9),
        overall: 8,
        summary: 'Great answer, but could be more concise.',
        suggestedImprovement: 'Try to remove the first sentence.',
      };
      expect(() =>
        ShortAnswerGradeSchema.parse({
          ...base,
          klpResults: [{ klpRef: 0, status: 'correct' }],
        }),
      ).not.toThrow();
      expect(() =>
        ShortAnswerGradeSchema.parse({
          ...base,
          klpResults: [{ klpRef: 0, status: 'passed' }],
        }),
      ).toThrow();
    });

    /**
     * Task 3 fix round: the shared verdict block asks for `quote`, every
     * consumer (`buildAnalysisWrites` -> `AnswerKlpResult.evidence`) reads
     * `evidence`, and the schema accepted both — so nothing failed and every
     * runtime row's evidence was null. The parsed value bridges the two.
     */
    describe('quote -> evidence bridge', () => {
      const base = {
        clarity: criterion(8),
        conciseness: criterion(7),
        correctness: criterion(9),
        overall: 8,
        summary: 's',
        suggestedImprovement: 'i',
      };

      it('a klpResult carrying only `quote` parses with `evidence` populated', () => {
        const parsed = ShortAnswerGradeSchema.parse({
          ...base,
          klpResults: [{ klpRef: 0, status: 'omission', quote: 'x' }],
        });
        expect(parsed.klpResults?.[0].evidence).toBe('x');
        expect(parsed.klpResults?.[0].quote).toBe('x');
      });

      it('an explicit `evidence` wins over `quote`', () => {
        const parsed = ShortAnswerGradeSchema.parse({
          ...base,
          klpResults: [{ klpRef: 0, status: 'omission', quote: 'the quote', evidence: 'the evidence' }],
        });
        expect(parsed.klpResults?.[0].evidence).toBe('the evidence');
      });

      it('neither key leaves `evidence` undefined, never a fabricated string', () => {
        const parsed = ShortAnswerGradeSchema.parse({
          ...base,
          klpResults: [{ klpRef: 0, status: 'correct' }],
        });
        expect(parsed.klpResults?.[0].evidence).toBeUndefined();
      });

      it('the authoring grader (CandidateGradeSchema) bridges the same way — its output line says evidence, the block it embeds says quote', () => {
        const parsed = CandidateGradeSchema.parse({
          verdicts: [
            { klpIndex: 0, verdict: 'omission', quote: 'q' },
            { klpIndex: 1, verdict: 'partial', quote: 'q', evidence: 'e' },
            { klpIndex: 2, verdict: 'correct' },
          ],
        });
        expect(parsed.verdicts.map((v) => v.evidence)).toEqual(['q', 'e', undefined]);
      });
    });
  });

  describe('TrainingPlanSchema', () => {
    it('should validate a correct plan', () => {
      const valid = {
        title: 'Finance Basics Plan',
        summary: 'Focus on core concepts.',
        focusAreas: [
          { label: 'DCF', reason: 'Struggling with terminal value', priority: 'high' },
        ],
        recommendedCardIds: ['card1', 'card2'],
        generatedQuestions: [
          { cardId: 'card1', question: 'What is WACC?', expectedAnswer: 'Weighted Average Cost of Capital' },
        ],
      };
      expect(TrainingPlanSchema.parse(valid)).toEqual(valid);
    });

    it('should fail for invalid priority', () => {
      const invalid = {
        title: 'Plan',
        summary: '...',
        focusAreas: [
          { label: 'X', reason: '...', priority: 'urgent' },
        ],
        recommendedCardIds: [],
        generatedQuestions: [],
      };
      expect(() => TrainingPlanSchema.parse(invalid)).toThrow();
    });
  });
});

describe('ShortAnswerGradeWithAnalysisSchema (v6 — klpResults required when key points were listed)', () => {
  const rubric = {
    clarity: { score: 8, pros: [], cons: [] },
    conciseness: { score: 8, pros: [], cons: [] },
    correctness: { score: 8, pros: [], cons: [] },
    overall: 8, summary: 's', suggestedImprovement: 'i',
  }
  it('rejects a reply that drops klpResults — the silent zero-verdict failure the benchmark caught', () => {
    expect(ShortAnswerGradeWithAnalysisSchema.safeParse({ ...rubric }).success).toBe(false)
    expect(ShortAnswerGradeWithAnalysisSchema.safeParse({ ...rubric, klpResults: [] }).success).toBe(false)
  })
  it('accepts a reply with at least one verdict, and the base schema still accepts the rubric-only shape', () => {
    expect(ShortAnswerGradeWithAnalysisSchema.safeParse({ ...rubric, klpResults: [{ klpRef: 0, status: 'omission' }] }).success).toBe(true)
    expect(ShortAnswerGradeSchema.safeParse({ ...rubric }).success).toBe(true)
  })
})
