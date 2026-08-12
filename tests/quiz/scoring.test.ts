import { describe, it, expect } from 'vitest';
import { shuffleOptions, scoreMultipleChoice, overallQuizScore, storedScore } from '@/lib/quiz/scoring';

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

  describe('storedScore', () => {
    it('should return the mean when it is already an integer', () => {
      expect(storedScore([{ score: 100 }, { score: 0 }])).toBe(50);
      expect(storedScore([{ score: 100 }, { score: 99 }, { score: 50 }])).toBe(83);
    });

    it('should round a fractional mean to an integer', () => {
      // 100/3 = 33.33... -> down
      expect(storedScore([{ score: 100 }, { score: 0 }, { score: 0 }])).toBe(33);
      // 200/3 = 66.66... -> up
      expect(storedScore([{ score: 100 }, { score: 100 }, { score: 0 }])).toBe(67);
    });

    it('should pin the half-way rounding rule to Math.round (half up)', () => {
      // Mean is exactly 62.5. Math.round -> 63; a truncating or half-to-even
      // rule would give 62. This is the rule the Int column has always stored,
      // so it is asserted, not left incidental.
      expect(storedScore([{ score: 100 }, { score: 0 }, { score: 100 }, { score: 50 }])).toBe(63);
      // Exactly 0.5 -> 1, again half UP rather than half to even.
      expect(storedScore([{ score: 1 }, { score: 0 }])).toBe(1);
      // Exactly 1.5 -> 2 (half to even would give 2 as well); 2.5 -> 3 is the
      // case that separates them.
      expect(storedScore([{ score: 3 }, { score: 2 }])).toBe(3);
    });

    it('should return null when there is nothing to average', () => {
      expect(storedScore([])).toBeNull();
      expect(storedScore([{ score: null }])).toBeNull();
      expect(storedScore([{ score: null }, { score: null }])).toBeNull();
    });

    it('should exclude nulls from the denominator, not treat them as zero', () => {
      expect(storedScore([{ score: 100 }, { score: null }])).toBe(100);
      expect(storedScore([{ score: 100 }, { score: null }, { score: 0 }])).toBe(50);
    });
  });
});
