import { describe, it, expect } from 'vitest';
import { computeCmf, cmfBoard, sortCmf, type CmfBar, type CmfRow } from './cmf';

const bar = (high: number, low: number, close: number, volume: number): CmfBar => ({ high, low, close, volume });

describe('computeCmf', () => {
  it('is +1 with full accumulation (close at the highs)', () => {
    const r = computeCmf([bar(10, 8, 10, 100), bar(12, 10, 12, 100)], 2)!;
    expect(r.cmf).toBeCloseTo(1, 6); // (100+100)/(100+100)
    expect(r.side).toBe('buyers');
    expect(r.strong).toBe(true);
    expect(r.n).toBe(2);
  });

  it('is −1 with full distribution (close at the lows)', () => {
    const r = computeCmf([bar(10, 8, 8, 100), bar(12, 10, 10, 100)], 2)!;
    expect(r.cmf).toBeCloseTo(-1, 6);
    expect(r.side).toBe('sellers');
    expect(r.strong).toBe(true);
  });

  it('is volume-weighted and flags weak flow below ±0.25', () => {
    // MFM 0.2 (close 9.2 in 8–10) and MFM 0 (close 10 in 8–12); equal volume
    // → CMF = (0.2·100 + 0·100) / 200 = 0.1
    const r = computeCmf([bar(10, 8, 9.2, 100), bar(12, 8, 10, 100)], 2)!;
    expect(r.cmf).toBeCloseTo(0.1, 6);
    expect(r.side).toBe('buyers');
    expect(r.strong).toBe(false);
  });

  it('maps a zero-volume window to 0', () => {
    expect(computeCmf([bar(10, 8, 10, 0), bar(12, 10, 12, 0)], 2)!.cmf).toBe(0);
  });

  it('returns null with too little history', () => {
    expect(computeCmf([bar(10, 8, 10, 100)], 2)).toBeNull();
    expect(computeCmf([], 2)).toBeNull();
  });
});

describe('cmfBoard', () => {
  const series = [
    { symbol: 'ACC', bars: [bar(10, 8, 10, 100), bar(12, 10, 12, 100)] }, // +1
    { symbol: 'DIST', bars: [bar(10, 8, 8, 100), bar(12, 10, 10, 100)] }, // −1
  ];

  it('defaults to sorting by CMF descending', () => {
    const rows = cmfBoard(series, 'cmf', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'DIST']);
    expect(rows[0].side).toBe('buyers');
    expect(rows[1].side).toBe('sellers');
  });

  it('sorts by symbol', () => {
    const rows = cmfBoard(series, 'symbol', 2);
    expect(rows.map((r) => r.symbol)).toEqual(['ACC', 'DIST']);
  });

  it('skips symbols with too little history', () => {
    const rows = cmfBoard(
      [
        { symbol: 'OK', bars: [bar(10, 8, 10, 100), bar(12, 10, 12, 100)] },
        { symbol: 'THIN', bars: [bar(10, 8, 10, 100)] },
      ],
      'cmf',
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCmf', () => {
  it('orders by CMF descending', () => {
    const rows = [
      { symbol: 'A', cmf: 0.1 },
      { symbol: 'B', cmf: 0.4 },
      { symbol: 'C', cmf: -0.2 },
    ] as CmfRow[];
    expect(sortCmf(rows, 'cmf').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
