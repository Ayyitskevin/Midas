import { describe, it, expect } from 'vitest';
import {
  computeProjection,
  projectionBoard,
  sortProjection,
  type ProjBar,
  type ProjRow,
} from './projection';

describe('computeProjection', () => {
  // Workflow-verified fixture (N=3): over [{H10,L8},{H12,L9},{H13,L10}], C=[9,11,12]
  //   slopeH = 1.5, slopeL = 1.0
  //   projected highs (k=0,1,2) = [13, 13.5, 13] → PBU = 13.5
  //   projected lows  (k=0,1,2) = [10, 10, 10]   → PBL = 10
  //   PO = 100·(12 − 10)/(13.5 − 10) = 200/3.5 = 57.142857
  // Prepend one lower bar so n ≥ period+1 and the latest 3-bar window is the fixture.
  const bars: ProjBar[] = [
    { high: 9, low: 7, close: 8 },
    { high: 10, low: 8, close: 9 },
    { high: 12, low: 9, close: 11 },
    { high: 13, low: 10, close: 12 },
  ];

  it('matches the hand-computed Projection Oscillator (signalPeriod 1 → signal = PO)', () => {
    const r = computeProjection(bars, 3, 1)!;
    expect(r).not.toBeNull();
    expect(r.po).toBeCloseTo(57.142857, 5);
    expect(r.signal).toBeCloseTo(57.142857, 5); // EMA period 1 echoes the series
    expect(r.hist).toBeCloseTo(0, 9);
    expect(r.zone).toBe('neutral');
    expect(r.n).toBe(4);
  });

  it('reads 50 (mid-band) on a symmetric linear ramp', () => {
    // close sits in the middle of a constant-width band that rides the trend.
    const ramp: ProjBar[] = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i,
    }));
    const r = computeProjection(ramp)!; // default 14 / 5
    expect(r.po).toBeCloseTo(50, 6);
    expect(r.zone).toBe('neutral');
  });

  it('saturates to 100 (overbought) when close rides the high of a trend', () => {
    const ramp: ProjBar[] = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i + 1, // close == high
    }));
    const r = computeProjection(ramp)!;
    expect(r.po).toBeCloseTo(100, 6);
    expect(r.zone).toBe('overbought');
  });

  it('saturates to 0 (oversold) when close rides the low of a trend', () => {
    const ramp: ProjBar[] = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i - 1, // close == low
    }));
    const r = computeProjection(ramp)!;
    expect(r.po).toBeCloseTo(0, 6);
    expect(r.zone).toBe('oversold');
  });

  it('returns 50 on a perfectly flat window (degenerate band) without dividing by zero', () => {
    const flat: ProjBar[] = Array.from({ length: 6 }, () => ({ high: 5, low: 5, close: 5 }));
    const r = computeProjection(flat, 3, 1)!;
    expect(r.po).toBe(50);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeProjection([], 14, 5)).toBeNull();
    // period + 1 = 4 bars needed for period 3.
    expect(computeProjection(bars.slice(0, 3), 3, 1)).toBeNull();
    expect(computeProjection(bars, 3, 1)).not.toBeNull();
    expect(computeProjection(bars, 1, 1)).toBeNull(); // period < 2
    expect(computeProjection(bars, 3, 0)).toBeNull(); // signalPeriod < 1
  });
});

describe('projectionBoard / sortProjection', () => {
  const rows: ProjRow[] = [
    { symbol: 'B/USDT', po: 55, signal: 50, hist: 5, zone: 'neutral', n: 200 },
    { symbol: 'A/USDT', po: 88, signal: 80, hist: 8, zone: 'overbought', n: 200 },
    { symbol: 'C/USDT', po: 12, signal: 20, hist: -8, zone: 'oversold', n: 200 },
  ];

  it('sorts by PO descending by default (most overbought first)', () => {
    expect(sortProjection(rows, 'po').map((r) => r.po)).toEqual([88, 55, 12]);
  });

  it('sorts by histogram and symbol', () => {
    expect(sortProjection(rows, 'hist').map((r) => r.hist)).toEqual([8, 5, -8]);
    expect(sortProjection(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = projectionBoard(
      [
        { symbol: 'OK/USDT', bars: [
          { high: 9, low: 7, close: 8 },
          { high: 10, low: 8, close: 9 },
          { high: 12, low: 9, close: 11 },
          { high: 13, low: 10, close: 12 },
        ] },
        { symbol: 'THIN/USDT', bars: [{ high: 9, low: 7, close: 8 }] },
      ],
      'po',
      3,
      1,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
