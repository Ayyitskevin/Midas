import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { computeTrend, trendBoard, sortTrend, type TrendRow } from './maTrend';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

const up = mk([1, 2, 3, 4, 5, 6]); // always above a rising SMA(3)
const down = mk([6, 5, 4, 3, 2, 1]); // always below
const flip = mk([10, 9, 8, 7, 8, 12]); // below, below, above, above

describe('computeTrend', () => {
  it('tracks a persistent up-trend above the SMA', () => {
    const r = computeTrend(up, 3)!;
    expect(r).not.toBeNull();
    expect(r.run).toBe(4); // all 4 SMA bars closed above
    expect(r.pctAbove).toBe(1);
    expect(r.above).toBe(true);
    expect(r.dist).toBeCloseTo(16.6667, 3); // (6 − 5) / 6
    expect(r.n).toBe(4);
  });

  it('tracks a persistent down-trend below the SMA', () => {
    const r = computeTrend(down, 3)!;
    expect(r.run).toBe(-4);
    expect(r.pctAbove).toBe(0);
    expect(r.above).toBe(false);
  });

  it('counts only the current run after a cross', () => {
    const r = computeTrend(flip, 3)!;
    expect(r.run).toBe(2); // below, below, above, above → current up-run is 2
    expect(r.pctAbove).toBe(0.5);
    expect(r.above).toBe(true);
  });

  it('returns null with too few candles for the SMA', () => {
    expect(computeTrend(mk([1, 2]), 3)).toBeNull();
    expect(computeTrend([], 3)).toBeNull();
  });
});

describe('trendBoard', () => {
  const series = [
    { symbol: 'UP', candles: up },
    { symbol: 'DOWN', candles: down },
    { symbol: 'FLIP', candles: flip },
  ];

  it('defaults to sorting by run descending (longest up-runs first)', () => {
    const rows = trendBoard(series, 'run', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'FLIP', 'DOWN']); // +4 > +2 > −4
  });

  it('sorts by symbol', () => {
    const rows = trendBoard(series, 'symbol', 3);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'FLIP', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = trendBoard(
      [
        { symbol: 'OK', candles: up },
        { symbol: 'THIN', candles: mk([1, 2]) },
      ],
      'run',
      3,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortTrend', () => {
  it('orders by pctAbove descending', () => {
    const rows = [
      { symbol: 'A', pctAbove: 0.4 },
      { symbol: 'B', pctAbove: 0.9 },
      { symbol: 'C', pctAbove: 0.1 },
    ] as TrendRow[];
    expect(sortTrend(rows, 'pctAbove').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
