import { describe, it, expect } from 'vitest';
import {
  classifyTrend,
  computeTii,
  tiiBoard,
  sortTii,
  type TiiRow,
} from './tii';

describe('classifyTrend', () => {
  it('maps the 80 / 50 / 20 bands', () => {
    expect(classifyTrend(100)).toBe('strong-up');
    expect(classifyTrend(80)).toBe('strong-up');
    expect(classifyTrend(79.9)).toBe('up');
    expect(classifyTrend(51)).toBe('up');
    expect(classifyTrend(50)).toBe('flat');
    expect(classifyTrend(49)).toBe('down');
    expect(classifyTrend(20.1)).toBe('down');
    expect(classifyTrend(20)).toBe('strong-down');
    expect(classifyTrend(0)).toBe('strong-down');
  });
});

describe('computeTii', () => {
  // Hand-computed example (workflow-verified), reduced params major=4, minor=2.
  //   closes = [10, 11, 12, 13, 14, 12]
  //   window = last 2 bars (indices 4, 5):
  //     SMA(4)@4 = mean(11,12,13,14) = 12.5 ; dev = 14 − 12.5 = +1.5
  //     SMA(4)@5 = mean(12,13,14,12) = 12.75; dev = 12 − 12.75 = −0.75
  //     SDpos = 1.5, SDneg = 0.75
  //     TII = 100 × 1.5 / (1.5 + 0.75) = 66.6667
  it('matches the hand-computed example', () => {
    const r = computeTii([10, 11, 12, 13, 14, 12], 4, 2)!;
    expect(r).not.toBeNull();
    expect(r.tii).toBeCloseTo(66.66666666666667, 9);
    // Prior window (bars 3,4) is all above the SMA → TII = 100.
    expect(r.prev).toBeCloseTo(100, 9);
    expect(r.delta).toBeCloseTo(66.66666666666667 - 100, 9);
    expect(r.trend).toBe('up');
    expect(r.n).toBe(6);
  });

  it('is 100 / strong-up when every window bar is above its SMA', () => {
    const r = computeTii([10, 11, 12, 13, 14, 15], 4, 2)!;
    expect(r.tii).toBeCloseTo(100, 9);
    expect(r.trend).toBe('strong-up');
  });

  it('is 0 / strong-down when every window bar is below its SMA', () => {
    const r = computeTii([15, 14, 13, 12, 11, 10], 4, 2)!;
    expect(r.tii).toBeCloseTo(0, 9);
    expect(r.trend).toBe('strong-down');
  });

  it('returns the neutral 50 on a flat series (all deviations zero)', () => {
    const r = computeTii([5, 5, 5, 5, 5, 5], 4, 2)!;
    expect(r.tii).toBe(50);
    expect(r.prev).toBe(50);
    expect(r.trend).toBe('flat');
  });

  it('stays within 0..100 and is self-consistent with default params', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + 8 * Math.sin(i / 4) + i * 0.3);
    const r = computeTii(closes)!;
    expect(r).not.toBeNull();
    expect(r.tii).toBeGreaterThanOrEqual(0);
    expect(r.tii).toBeLessThanOrEqual(100);
    expect(r.delta).toBeCloseTo(r.tii - r.prev, 12);
    expect(r.trend).toBe(classifyTrend(r.tii));
  });

  it('returns null on too little history or bad params', () => {
    expect(computeTii([], 60)).toBeNull();
    expect(computeTii([1, 2, 3, 4, 5], 4, 2)).toBeNull(); // n < major + minor
    expect(computeTii([1, 2, 3, 4, 5, 6], 4, 2)).not.toBeNull(); // n === major + minor
    expect(computeTii(Array.from({ length: 20 }, (_, i) => i), 0)).toBeNull();
    expect(computeTii(Array.from({ length: 20 }, (_, i) => i), 4, 0)).toBeNull();
  });
});

describe('tiiBoard / sortTii', () => {
  const rows: TiiRow[] = [
    { symbol: 'B/USDT', tii: 40, prev: 45, delta: -5, trend: 'down', n: 100 },
    { symbol: 'A/USDT', tii: 85, prev: 70, delta: 15, trend: 'strong-up', n: 100 },
    { symbol: 'C/USDT', tii: 60, prev: 62, delta: -2, trend: 'up', n: 100 },
  ];

  it('sorts by TII descending by default', () => {
    expect(sortTii(rows, 'tii').map((r) => r.tii)).toEqual([85, 60, 40]);
  });

  it('sorts by delta and by symbol', () => {
    expect(sortTii(rows, 'delta').map((r) => r.delta)).toEqual([15, -2, -5]);
    expect(sortTii(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = tiiBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 12, 13, 14, 15, 16, 17] },
        { symbol: 'THIN/USDT', closes: [1, 2, 3] },
      ],
      'tii',
      4,
      2,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
