import { describe, it, expect } from 'vitest';
import { MultipleChoiceOptionsSchema, ShortAnswerGradeSchema, TrainingPlanSchema } from '@/lib/ai/schemas';

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
