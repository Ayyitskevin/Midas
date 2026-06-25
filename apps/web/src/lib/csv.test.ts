import { describe, it, expect } from 'vitest';
import { toCsv, escapeCsvField, isoFromMs, type CsvColumn } from '@/lib/csv';

describe('escapeCsvField', () => {
  it('leaves plain values untouched', () => {
    expect(escapeCsvField('BTC')).toBe('BTC');
    expect(escapeCsvField(42)).toBe('42');
  });

  it('renders booleans and nullish as expected', () => {
    expect(escapeCsvField(true)).toBe('true');
    expect(escapeCsvField(false)).toBe('false');
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });

  it('quotes fields with comma, quote or newline and doubles inner quotes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('he said "hi"')).toBe('"he said ""hi"""');
    expect(escapeCsvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('toCsv', () => {
  interface Row {
    symbol: string;
    qty: number;
    note: string | null;
  }
  const cols: CsvColumn<Row>[] = [
    { header: 'Symbol', value: (r) => r.symbol },
    { header: 'Qty', value: (r) => r.qty },
    { header: 'Note', value: (r) => r.note },
  ];

  it('emits a header plus CRLF-joined rows', () => {
    const csv = toCsv(
      [
        { symbol: 'BTC', qty: 2, note: 'core' },
        { symbol: 'ETH', qty: 5, note: null },
      ],
      cols,
    );
    expect(csv).toBe('Symbol,Qty,Note\r\nBTC,2,core\r\nETH,5,');
  });

  it('escapes values inside rows', () => {
    const csv = toCsv([{ symbol: 'BTC', qty: 1, note: 'buy, then hold' }], cols);
    expect(csv).toBe('Symbol,Qty,Note\r\nBTC,1,"buy, then hold"');
  });

  it('returns just the header for an empty row set', () => {
    expect(toCsv([], cols)).toBe('Symbol,Qty,Note');
  });
});

describe('isoFromMs', () => {
  it('formats a finite epoch as ISO', () => {
    expect(isoFromMs(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns empty string for a non-finite or invalid instant', () => {
    expect(isoFromMs(NaN)).toBe('');
    expect(isoFromMs(Infinity)).toBe('');
  });
});
