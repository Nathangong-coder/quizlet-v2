import { describe, it, expect } from 'vitest';
import { parseImport } from '../../src/lib/parser/import';

describe('parseImport', () => {
  it('should parse basic comma-separated terms and semicolon-separated cards', () => {
    const input = 'Term 1,Definition 1;Term 2,Definition 2';
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should trim whitespace around terms and definitions', () => {
    const input = '  Term 1  ,  Definition 1  ; Term 2 , Definition 2  ';
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should handle quoted values containing delimiters', () => {
    const input = '"Net income, attributable to shareholders",Total profit;"The "Big" Apple",New York City';
    const expected = [
      { term: 'Net income, attributable to shareholders', definition: 'Total profit' },
      { term: 'The "Big" Apple', definition: 'New York City' },
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
    const input = 'Term 1,Definition 1;;;Term 2,Definition 2;';
    const expected = [
      { term: 'Term 1', definition: 'Definition 1' },
      { term: 'Term 2', definition: 'Definition 2' },
    ];
    expect(parseImport(input)).toEqual(expected);
  });

  it('should throw a descriptive error if a field delimiter is missing', () => {
    const input = 'Term 1,Definition 1;Term 2 without comma';
    expect(() => parseImport(input)).toThrow(/missing field delimiter/i);
  });

  it('should throw an error for empty term or definition', () => {
    const input = 'Term 1,; ,Definition 2';
    expect(() => parseImport(input)).toThrow();
  });

  it('should return an empty array for empty input', () => {
    expect(parseImport('')).toEqual([]);
    expect(parseImport('   ')).toEqual([]);
  });
});
