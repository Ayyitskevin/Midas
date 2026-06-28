import { describe, it, expect } from 'vitest';
import { computeRsl, rslBoard, sortRsl, type RslRow } from './rsl';

describe('computeRsl', () => {
  it('matches the hand-computed ratio above the average (strong)', () => {
    // SMA(last 4 of 10,11,12,13,14) = (11+12+13+14)/4 = 12.5; close 14 → 14/12.5 = 1.12
    const r = computeRsl([10, 11, 12, 13, 14], 4)!;
    expect(r).not.toBeNull();
    expect(r.rsl).toBeCloseTo(1.12, 9);
    expect(r.devPct).toBeCloseTo(12, 9);
    expect(r.side).toBe('up');
    expect(r.period).toBe(4);
    expect(r.n).toBe(5);
  });

  it('is below the average (weak) when price has fallen', () => {
    // SMA(last 4 of 20,18,16,14,12) = (18+16+14+12)/4 = 15; close 12 → 12/15 = 0.8
    const r = computeRsl([20, 18, 16, 14, 12], 4)!;
    expect(r.rsl).toBeCloseTo(0.8, 9);
    expect(r.devPct).toBeCloseTo(-20, 9);
    expect(r.side).toBe('down');
  });

  it('reads exactly 1.0 on a flat series (price on its average)', () => {
    const r = computeRsl([5, 5, 5, 5], 4)!;
    expect(r.rsl).toBeCloseTo(1, 12);
    expect(r.devPct).toBeCloseTo(0, 12);
    expect(r.side).toBe('up'); // ≥ 1 counts as up
  });

  it('is scale-invariant — identical shape at any price level gives the same RSL', () => {
    const small = computeRsl([10, 11, 12, 13, 14], 4)!;
    const large = computeRsl([1000, 1100, 1200, 1300, 1400], 4)!;
    expect(large.rsl).toBeCloseTo(small.rsl, 12);
    expect(large.devPct).toBeCloseTo(small.devPct, 12);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeRsl([], 130)).toBeNull();
    expect(computeRsl([10, 11, 12], 4)).toBeNull(); // need ≥ period closes
    expect(computeRsl([10, 11, 12, 13], 4)).not.toBeNull();
    expect(computeRsl([10, 11, 12, 13], 0)).toBeNull(); // period < 1
  });

  it('works with the default period on a longer ramp', () => {
    const ramp = Array.from({ length: 200 }, (_, i) => 100 + i);
    const r = computeRsl(ramp)!; // default 130
    expect(r).not.toBeNull();
    expect(r.period).toBe(130);
    expect(r.rsl).toBeGreaterThan(1); // a steady uptrend trades above its average
  });
});

describe('rslBoard / sortRsl', () => {
  const rows: RslRow[] = [
    { symbol: 'B/USDT', rsl: 1.05, devPct: 5, side: 'up', period: 130, n: 200 },
    { symbol: 'A/USDT', rsl: 1.2, devPct: 20, side: 'up', period: 130, n: 200 },
    { symbol: 'C/USDT', rsl: 0.85, devPct: -15, side: 'down', period: 130, n: 200 },
  ];

  it('sorts by RSL descending by default (strongest first)', () => {
    expect(sortRsl(rows, 'rsl').map((r) => r.rsl)).toEqual([1.2, 1.05, 0.85]);
  });

  it('sorts by symbol', () => {
    expect(sortRsl(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = rslBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 12, 13, 14] },
        { symbol: 'THIN/USDT', closes: [10, 11] },
      ],
      'rsl',
      4,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
