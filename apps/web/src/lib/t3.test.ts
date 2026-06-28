import { describe, it, expect } from 'vitest';
import { computeT3, t3Board, sortT3, type T3Row } from './t3';

describe('computeT3', () => {
  it('matches the independently-verified ramp fixture (N=5, v=0.7)', () => {
    // close = 100 + i over 60 bars. In steady state each EMA(5) lags 2 bars, so
    // e_k = price − 2k and T3 = price − 1.8 (the c1..c4 weighting). At bar 59
    // (price 159) → T3 = 157.2; reference + independent reimpl both got 157.19999996.
    const ramp = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = computeT3(ramp)!;
    expect(r).not.toBeNull();
    expect(r.t3).toBeCloseTo(157.2, 4);
    expect(r.dir).toBe('up');
    expect(r.slopePct).toBeGreaterThan(0);
    expect(r.slopePct).toBeCloseTo((1 / 156.2) * 100, 1); // ≈0.64% per bar
    expect(r.period).toBe(5);
    expect(r.n).toBe(60);
  });

  it('passes a constant series through unchanged (coefficients sum to 1)', () => {
    const flat = Array.from({ length: 40 }, () => 50);
    const r = computeT3(flat)!;
    expect(r.t3).toBeCloseTo(50, 6);
    expect(r.slopePct).toBeCloseTo(0, 9);
    expect(r.dir).toBe('flat');
  });

  it('falls with a negative slope on a steady down-trend', () => {
    const down = Array.from({ length: 60 }, (_, i) => 200 - i);
    const r = computeT3(down)!;
    expect(r.t3).toBeCloseTo(142.8, 4); // price(141) + 1.8 (lagging a falling series)
    expect(r.dir).toBe('down');
    expect(r.slopePct).toBeLessThan(0);
  });

  it('returns null on too little history or bad params', () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 100 + i);
    expect(computeT3([], 5, 0.7)).toBeNull();
    // 6·period = 30 closes needed for period 5.
    expect(computeT3(ramp.slice(0, 29), 5, 0.7)).toBeNull();
    expect(computeT3(ramp.slice(0, 30), 5, 0.7)).not.toBeNull();
    expect(computeT3(ramp, 0, 0.7)).toBeNull(); // period < 1
    expect(computeT3(ramp, 5, -0.1)).toBeNull(); // v < 0
  });

  it('reduces toward DEMA-like behaviour at v=1 while still tracking the trend', () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = computeT3(ramp, 5, 1)!;
    expect(r.dir).toBe('up');
    expect(r.t3).toBeGreaterThan(157); // less lag than v=0.7 → closer to price (159)
    expect(r.t3).toBeLessThan(159.5);
  });
});

describe('t3Board / sortT3', () => {
  const rows: T3Row[] = [
    { symbol: 'B/USDT', t3: 100, slopePct: 0.4, dir: 'up', period: 5, n: 200 },
    { symbol: 'A/USDT', t3: 50, slopePct: 1.6, dir: 'up', period: 5, n: 200 },
    { symbol: 'C/USDT', t3: 3, slopePct: -0.9, dir: 'down', period: 5, n: 200 },
  ];

  it('sorts by percent slope descending by default (strongest up-trends first)', () => {
    expect(sortT3(rows, 'slope').map((r) => r.slopePct)).toEqual([1.6, 0.4, -0.9]);
  });

  it('sorts by symbol', () => {
    expect(sortT3(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 100 + i);
    const board = t3Board(
      [
        { symbol: 'OK/USDT', closes: ramp },
        { symbol: 'THIN/USDT', closes: ramp.slice(0, 10) },
      ],
      'slope',
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
