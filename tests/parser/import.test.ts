import { describe, it, expect } from 'vitest';
import { parseImport } from '../../src/lib/parser/import';

describe('parseImport', () => {
  it('should parse basic pipe-separated terms and semicolon-separated cards, allowing raw commas in values', () => {
    const input = 'Net Income|Revenue minus expenses, e.g. $1,000,000;Term 2|Definition 2';
    const expected = [
      { term: 'Net Income', definition: 'Revenue minus expenses, e.g. $1,000,000' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should trim whitespace around terms and definitions', () => {
    const input = '  Term 1  |  Definition 1  ; Term 2 | Definition 2  ';
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should handle quoted values containing delimiters', () => {
    const input = '"Revenue | COGS"|Gross profit;"Section A; Section B"|Combined sections';
    const expected = [
      { term: 'Revenue | COGS', definition: 'Gross profit' },
      { term: 'Section A; Section B', definition: 'Combined sections' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should support custom delimiters via ParseOptions', () => {
    const input = 'Term 1|Definition 1\nTerm 2|Definition 2';
    const options = { cardDelimiter: '\n', fieldDelimiter: '|' };
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input, options)).toEqual(expected);
  });

  it('should skip empty entries between delimiters', () => {
    const input = 'Term 1|Definition 1;;;Term 2|Definition 2;';
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should throw a descriptive error if a field delimiter is missing', () => {
    const input = 'Term 1|Definition 1;Term 2 without pipe';
    expect(() => parseImport(input)).toThrow(/missing field delimiter/i);
  });

  it('should throw an error for empty term or definition', () => {
    const input = 'Term 1|; |Definition 2';
    expect(() => parseImport(input)).toThrow();
  });

  it('should return an empty array for empty input', () => {
    expect(parseImport('')).toEqual([]);
    expect(parseImport('   ')).toEqual([]);
  });
});
