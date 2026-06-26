import { describe, it, expect } from 'vitest';
import {
  computeStochastic,
  stochasticBoard,
  stochasticSeries,
  stochZone,
  sortStoch,
  type StochBar,
  type StochRow,
} from './stochastic';

// With high=100 / low=0 every N-bar window has range 100, so rawK === close —
// which makes %K and %D hand-computable.
const bar = (close: number, high = 100, low = 0): StochBar => ({ high, low, close });
const bars = (closes: number[]): StochBar[] => closes.map((c) => bar(c));

describe('stochZone', () => {
  it('classifies by the 80 / 20 thresholds (inclusive)', () => {
    expect(stochZone(90)).toBe('overbought');
    expect(stochZone(80)).toBe('overbought');
    expect(stochZone(50)).toBe('neutral');
    expect(stochZone(20)).toBe('oversold');
    expect(stochZone(10)).toBe('oversold');
  });
});

describe('stochasticSeries', () => {
  it('maps a flat (zero-range) window to the 50 midpoint', () => {
    const flat: StochBar[] = Array.from({ length: 4 }, () => ({ high: 100, low: 100, close: 100 }));
    const s = stochasticSeries(flat, 3, 1, 2)!;
    expect(s.k.every((v) => v === 50)).toBe(true);
  });

  it('returns null with fewer than `period` bars', () => {
    expect(stochasticSeries(bars([10, 20]), 3)).toBeNull();
  });
});

describe('computeStochastic', () => {
  it('flags a bullish %K-over-%D cross', () => {
    // rawK = [50, 30, 60] → k = same (smoothK 1), d = [40, 45]
    const r = computeStochastic(bars([50, 50, 50, 30, 60]), 3, 1, 2)!;
    expect(r.k).toBeCloseTo(60, 6);
    expect(r.d).toBeCloseTo(45, 6);
    expect(r.cross).toBe('bull');
    expect(r.zone).toBe('neutral');
    expect(r.n).toBe(5);
  });

  it('flags a bearish %K-under-%D cross', () => {
    // rawK = [50, 70, 40] → d = [60, 55]; kLast 40 < dLast 55, kPrev 70 ≥ dPrev 60
    const r = computeStochastic(bars([50, 50, 50, 70, 40]), 3, 1, 2)!;
    expect(r.cross).toBe('bear');
    expect(r.k).toBeCloseTo(40, 6);
    expect(r.d).toBeCloseTo(55, 6);
  });

  it('reports overbought with no cross on a pinned-high series', () => {
    const r = computeStochastic(bars([90, 90, 90, 90, 90]), 3, 1, 2)!;
    expect(r.zone).toBe('overbought');
    expect(r.k).toBeCloseTo(90, 6);
    expect(r.cross).toBe('none');
  });

  it('reports oversold with no cross on a pinned-low series', () => {
    const r = computeStochastic(bars([10, 10, 10, 10, 10]), 3, 1, 2)!;
    expect(r.zone).toBe('oversold');
    expect(r.cross).toBe('none');
  });

  it('returns null with too little history', () => {
    expect(computeStochastic(bars([10, 20, 30, 40, 50, 60, 70, 80, 90, 80]), 14)).toBeNull();
    expect(computeStochastic([], 14)).toBeNull();
  });
});

describe('stochasticBoard', () => {
  const series = [
    { symbol: 'HOT', bars: bars([90, 90, 90, 90, 90]) },
    { symbol: 'COLD', bars: bars([10, 10, 10, 10, 10]) },
  ];

  it('defaults to sorting by %K descending', () => {
    const rows = stochasticBoard(series, 'k', 3, 1, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'COLD']);
    expect(rows[0].zone).toBe('overbought');
    expect(rows[1].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = stochasticBoard(series, 'symbol', 3, 1, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'HOT']);
  });

  it('skips symbols with too little history', () => {
    const rows = stochasticBoard(
      [
        { symbol: 'OK', bars: bars([90, 90, 90, 90, 90]) },
        { symbol: 'THIN', bars: bars([50, 50]) },
      ],
      'k',
      3,
      1,
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortStoch', () => {
  it('orders by %D descending', () => {
    const rows = [
      { symbol: 'A', d: 30 },
      { symbol: 'B', d: 90 },
      { symbol: 'C', d: 10 },
    ] as StochRow[];
    expect(sortStoch(rows, 'd').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
