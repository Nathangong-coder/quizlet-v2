import { describe, it, expect } from 'vitest';
import { shuffleOptions, scoreMultipleChoice, overallQuizScore } from '@/lib/quiz/scoring';

describe('Quiz Scoring Helpers', () => {
  describe('shuffleOptions', () => {
    it('should preserve all options after shuffling', () => {
      const options = ['A', 'B', 'C', 'D'];
      const shuffled = shuffleOptions(options);
      expect(shuffled).toHaveLength(4);
      expect(shuffled).toEqual(expect.arrayContaining(options));
    });

    it('should produce the same shuffle for the same seed', () => {
      const options = ['A', 'B', 'C', 'D'];
      const seed = 'test-seed';
      const shuffle1 = shuffleOptions(options, seed);
      const shuffle2 = shuffleOptions(options, seed);
      expect(shuffle1).toEqual(shuffle2);
    });
  });

  describe('scoreMultipleChoice', () => {
    it('should return true for exact matches', () => {
      expect(scoreMultipleChoice('Option A', 'Option A')).toBe(true);
    });

    it('should return true for matches that differ only by whitespace', () => {
      expect(scoreMultipleChoice(' Option A ', 'Option A')).toBe(true);
    });

    it('should return false for incorrect answers', () => {
      expect(scoreMultipleChoice('Option A', 'Option B')).toBe(false);
    });

    it('should return false for empty selections', () => {
      expect(scoreMultipleChoice('', 'Option A')).toBe(false);
      expect(scoreMultipleChoice(null as any, 'Option A')).toBe(false);
    });
  });

  describe('overallQuizScore', () => {
    it('should calculate the average score correctly', () => {
      const results = [
        { score: 100 },
        { score: 0 },
        { score: 100 },
        { score: 50 },
      ];
      expect(overallQuizScore(results)).toBe(62.5);
    });

    it('should ignore null scores', () => {
      const results = [
        { score: 100 },
        { score: null },
        { score: 0 },
      ];
      expect(overallQuizScore(results)).toBe(50);
    });

    it('should return null when there are no scored answers', () => {
      expect(overallQuizScore([])).toBeNull();
      expect(overallQuizScore([{ score: null }, { score: null }])).toBeNull();
    });
  });
});
