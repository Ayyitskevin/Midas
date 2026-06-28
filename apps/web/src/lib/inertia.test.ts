import { describe, it, expect } from 'vitest';
import {
  computeInertia,
  inertiaBoard,
  sortInertia,
  type InertiaRow,
} from './inertia';

describe('computeInertia', () => {
  // Workflow-verified example, reduced params stdevPeriod=2, rviPeriod=2, linregPeriod=3.
  //   closes = [10, 11, 13, 12, 14, 15, 14]
  //   sd   = [0.5, 1, 0.5, 1, 0.5, 0.5]
  //   rvi  = [100, 60, 84.6154, 90.4762, 51.3514]
  //   inertia = linreg endpoint of [84.6154, 90.4762, 51.3514] = 58.8490
  it('matches the hand-computed pipeline (rolling stdev → RVI → linreg)', () => {
    const r = computeInertia([10, 11, 13, 12, 14, 15, 14], 2, 2, 3)!;
    expect(r).not.toBeNull();
    expect(r.rvi).toBeCloseTo(51.351351351351354, 9);
    expect(r.inertia).toBeCloseTo(58.84895884895885, 9);
    expect(r.side).toBe('up'); // 58.85 ≥ 50
  });

  it('reads bearish (< 50, down) on a mostly-falling series', () => {
    const r = computeInertia([20, 18, 19, 17, 15, 16, 14], 2, 2, 3)!;
    expect(r.inertia).toBeLessThan(50);
    expect(r.side).toBe('down');
  });

  it('keeps the raw RVI within 0..100', () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + 10 * Math.sin(i / 4) + i * 0.2);
    const r = computeInertia(closes)!;
    expect(r).not.toBeNull();
    expect(r.rvi).toBeGreaterThanOrEqual(0);
    expect(r.rvi).toBeLessThanOrEqual(100);
    expect(r.side).toBe(r.inertia >= 50 ? 'up' : 'down');
  });

  it('returns null on too little history or bad params', () => {
    expect(computeInertia([], 10)).toBeNull();
    // stdev + rvi + linreg − 2 = 5 closes needed for (2,2,3).
    expect(computeInertia([10, 11, 13, 12], 2, 2, 3)).toBeNull();
    expect(computeInertia([10, 11, 13, 12, 14], 2, 2, 3)).not.toBeNull();
    expect(computeInertia(Array.from({ length: 50 }, (_, i) => i), 0, 14, 20)).toBeNull();
    expect(computeInertia(Array.from({ length: 50 }, (_, i) => i), 10, 14, 1)).toBeNull();
  });

  it('works with default params on a longer series', () => {
    const r = computeInertia(Array.from({ length: 60 }, (_, i) => 100 + i))!;
    expect(r).not.toBeNull();
    expect(r.rvi).toBeGreaterThanOrEqual(0);
    expect(r.rvi).toBeLessThanOrEqual(100);
    expect(r.n).toBe(60);
  });
});

describe('inertiaBoard / sortInertia', () => {
  const rows: InertiaRow[] = [
    { symbol: 'B/USDT', inertia: 45, rvi: 40, side: 'down', n: 60 },
    { symbol: 'A/USDT', inertia: 72, rvi: 80, side: 'up', n: 60 },
    { symbol: 'C/USDT', inertia: 58, rvi: 55, side: 'up', n: 60 },
  ];

  it('sorts by inertia descending by default', () => {
    expect(sortInertia(rows, 'inertia').map((r) => r.inertia)).toEqual([72, 58, 45]);
  });

  it('sorts by raw RVI and by symbol', () => {
    expect(sortInertia(rows, 'rvi').map((r) => r.rvi)).toEqual([80, 55, 40]);
    expect(sortInertia(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = inertiaBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 13, 12, 14, 15, 14] },
        { symbol: 'THIN/USDT', closes: [1, 2, 3] },
      ],
      'inertia',
      2,
      2,
      3,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
