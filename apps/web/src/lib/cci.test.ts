import { describe, it, expect } from 'vitest';
import { computeCci, cciZone, cciBoard, sortCci, type CciBar } from './cci';

// Flat candles (high = low = close) so typical price == close.
const flat = (closes: number[]): CciBar[] => closes.map((c) => ({ high: c, low: c, close: c }));

describe('computeCci', () => {
  it('reads a rising window at +100', () => {
    // TP [1,2,3,4] → SMA 2.5, mean dev 1.0, CCI = (4−2.5)/(0.015·1) = 100.
    expect(computeCci(flat([1, 2, 3, 4]), 4)).toBeCloseTo(100, 6);
  });

  it('reads a falling window at −100', () => {
    expect(computeCci(flat([4, 3, 2, 1]), 4)).toBeCloseTo(-100, 6);
  });

  it('uses the typical price (H+L+C)/3', () => {
    // TP [10,12,14,16] → SMA 13, mean dev 2.0, CCI = (16−13)/(0.015·2) = 100.
    const bars: CciBar[] = [
      { high: 12, low: 8, close: 10 },
      { high: 14, low: 10, close: 12 },
      { high: 16, low: 12, close: 14 },
      { high: 18, low: 14, close: 16 },
    ];
    expect(computeCci(bars, 4)).toBeCloseTo(100, 6);
  });

  it('returns null with too little history or a flat window', () => {
    expect(computeCci(flat([1, 2, 3]), 4)).toBeNull();
    expect(computeCci([], 4)).toBeNull();
    expect(computeCci(flat([5, 5, 5, 5]), 4)).toBeNull(); // mean deviation 0
  });
});

describe('cciZone', () => {
  it('classifies by the ±100 thresholds', () => {
    expect(cciZone(150)).toBe('overbought');
    expect(cciZone(-150)).toBe('oversold');
    expect(cciZone(50)).toBe('neutral');
  });
});

describe('cciBoard', () => {
  const series = [
    { symbol: 'UP', bars: flat([1, 2, 3, 4]) },
    { symbol: 'DOWN', bars: flat([4, 3, 2, 1]) },
    { symbol: 'MID', bars: flat([2, 3, 4, 3]) }, // last TP == SMA → CCI 0
  ];

  it('defaults to sorting by CCI descending', () => {
    const rows = cciBoard(series, 'cci', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'MID', 'DOWN']); // 100 > 0 > −100
    expect(rows[0].zone).toBe('overbought');
    expect(rows[2].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = cciBoard(series, 'symbol', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'MID', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = cciBoard(
      [
        { symbol: 'OK', bars: flat([1, 2, 3, 4]) },
        { symbol: 'THIN', bars: flat([1, 2]) },
      ],
      'cci',
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortCci', () => {
  it('orders by CCI descending', () => {
    const rows = [
      { symbol: 'A', cci: 40, zone: 'neutral' as const, n: 20 },
      { symbol: 'B', cci: 180, zone: 'overbought' as const, n: 20 },
      { symbol: 'C', cci: -120, zone: 'oversold' as const, n: 20 },
    ];
    expect(sortCci(rows, 'cci').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
