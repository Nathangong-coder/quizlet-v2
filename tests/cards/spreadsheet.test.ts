import { describe, it, expect } from 'vitest';
import {
  looksLikeCardTable,
  rowsToCSV,
  sniffAssetKind,
} from '@/lib/cards/spreadsheet';

describe('looksLikeCardTable', () => {
  it('returns true for a 2-column term/definition table', () => {
    const rows = [
      ['Accretion', 'EPS increase from an acquisition'],
      ['Dilution', 'EPS decrease from an acquisition'],
    ];
    const result = looksLikeCardTable(rows);
    expect(result.isTermDef).toBe(true);
  });

  it('returns true and identifies columns even with a header row', () => {
    const rows = [
      ['Term', 'Definition'],
      ['WACC', 'Weighted average cost of capital'],
      ['DCF', 'Discounted cash flow'],
    ];
    const result = looksLikeCardTable(rows);
    expect(result.isTermDef).toBe(true);
    expect(result.termCol).toBe(0);
    expect(result.defCol).toBe(1);
  });

  it('returns false for a single-column sheet', () => {
    const rows = [['Accretion'], ['Dilution']];
    const result = looksLikeCardTable(rows);
    expect(result.isTermDef).toBe(false);
  });

  it('returns false for sheets with fewer than 2 rows', () => {
    const rows = [['Accretion', 'Definition']];
    const result = looksLikeCardTable(rows);
    expect(result.isTermDef).toBe(false);
  });

  it('returns false for sheets with empty columns', () => {
    const rows = [
      ['Accretion', ''],
      ['', 'Definition'],
    ];
    const result = looksLikeCardTable(rows);
    expect(result.isTermDef).toBe(false);
  });

  it('rejects ragged rows with inconsistent columns', () => {
    const rows = [
      ['Accretion', 'EPS increase'],
      ['Dilution'], // missing second column
      ['WACC', 'Weighted average cost of capital'],
    ];
    const result = looksLikeCardTable(rows);
    // Only 2 out of 3 have the second column, which is 66% — below 70% threshold
    expect(result.isTermDef).toBe(false);
  });

  it('accepts sheets with mostly complete rows', () => {
    const rows = [
      ['Accretion', 'EPS increase'],
      ['Dilution', 'EPS decrease'],
      ['WACC', 'Weighted average cost of capital'],
      ['', ''], // empty row
    ];
    const result = looksLikeCardTable(rows);
    // 3 out of 4 have both columns, which is 75% — above 70% threshold
    expect(result.isTermDef).toBe(true);
  });
});

describe('rowsToCSV', () => {
  it('converts rows to CSV string', () => {
    const rows = [
      ['Accretion', 'EPS increase'],
      ['Dilution', 'EPS decrease'],
    ];
    const csv = rowsToCSV(rows);
    expect(csv).toContain('"Accretion"');
    expect(csv).toContain('"EPS increase"');
    expect(csv).toContain('"Dilution"');
  });

  it('escapes quotes in fields', () => {
    const rows = [['Concept', 'Definition with "quotes"']];
    const csv = rowsToCSV(rows);
    expect(csv).toContain('""quotes""');
  });

  it('respects maxRows limit', () => {
    const rows = [
      ['Row1', 'Data1'],
      ['Row2', 'Data2'],
      ['Row3', 'Data3'],
    ];
    const csv = rowsToCSV(rows, 2);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
  });
});

describe('sniffAssetKind', () => {
  it('identifies images', () => {
    expect(sniffAssetKind('image/jpeg', 'photo.jpg')).toBe('image');
    expect(sniffAssetKind('image/png', 'chart.png')).toBe('image');
    expect(sniffAssetKind('image/gif', 'animation.gif')).toBe('image');
  });

  it('identifies audio', () => {
    expect(sniffAssetKind('audio/mpeg', 'song.mp3')).toBe('audio');
    expect(sniffAssetKind('audio/wav', 'recording.wav')).toBe('audio');
    expect(sniffAssetKind('audio/mp4', 'audio.m4a')).toBe('audio');
  });

  it('identifies video', () => {
    expect(sniffAssetKind('video/mp4', 'video.mp4')).toBe('video');
    expect(sniffAssetKind('video/webm', 'movie.webm')).toBe('video');
  });

  it('identifies spreadsheets', () => {
    expect(sniffAssetKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'data.xlsx')).toBe('spreadsheet');
    expect(sniffAssetKind('application/vnd.ms-excel', 'data.xls')).toBe('spreadsheet');
    expect(sniffAssetKind('text/csv', 'data.csv')).toBe('spreadsheet');
  });

  it('identifies PDFs', () => {
    expect(sniffAssetKind('application/pdf', 'document.pdf')).toBe('pdf');
  });

  it('defaults to file for unknown types', () => {
    expect(sniffAssetKind('application/octet-stream', 'archive.zip')).toBe('file');
    expect(sniffAssetKind('text/plain', 'notes.txt')).toBe('file');
  });

  it('uses filename extension as fallback', () => {
    // Just a generic octet-stream, but the filename reveals it's a spreadsheet
    expect(sniffAssetKind('application/octet-stream', 'data.xlsx')).toBe('spreadsheet');
  });
});
