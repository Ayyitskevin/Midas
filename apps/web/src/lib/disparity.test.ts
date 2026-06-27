import { describe, it, expect } from 'vitest';
import {
  computeDisparity,
  disparityBoard,
  sortDisparity,
  type DisparityRow,
} from './disparity';

describe('computeDisparity', () => {
  // Hand-computed example: closes = [8, 8, 8, 12], period = 3.
  //   emaSeries(closes, 3), k = 2/(3+1) = 0.5:
  //     e = [8, 8, 8, 12*0.5 + 8*0.5 = 10]
  //   DI(last) = 100 × (12 − 10) / 10 = 20
  //   DI(prev) = 100 × (8 − 8) / 8   = 0
  it('matches the hand-computed example (price above its EMA)', () => {
    const r = computeDisparity([8, 8, 8, 12], 3)!;
    expect(r).not.toBeNull();
    expect(r.di).toBeCloseTo(20, 9);
    expect(r.prev).toBeCloseTo(0, 9);
    expect(r.dir).toBe('up');
    expect(r.side).toBe('above');
    expect(r.n).toBe(4);
  });

  it('is negative and below the mean when price sits under its EMA', () => {
    // closes = [12, 12, 12, 8], period 3: e = [12,12,12,10]; DI = 100×(8−10)/10 = −20.
    const r = computeDisparity([12, 12, 12, 8], 3)!;
    expect(r.di).toBeCloseTo(-20, 9);
    expect(r.side).toBe('below');
    expect(r.dir).toBe('down'); // −20 < prior 0
  });

  it('is zero when price sits exactly on its mean (flat series)', () => {
    const r = computeDisparity([10, 10, 10, 10], 3)!;
    expect(r.di).toBeCloseTo(0, 12);
    expect(r.prev).toBeCloseTo(0, 12);
    expect(r.side).toBe('above'); // 0 counts as on/above the mean
  });

  it('returns null on too little history or bad params', () => {
    expect(computeDisparity([], 14)).toBeNull();
    expect(computeDisparity([1, 2, 3], 3)).toBeNull(); // n < period + 1
    expect(computeDisparity([1, 2, 3, 4], 3)).not.toBeNull(); // n === period + 1
    expect(computeDisparity([1, 2, 3, 4, 5], 0)).toBeNull();
  });
});

describe('disparityBoard / sortDisparity', () => {
  const rows: DisparityRow[] = [
    { symbol: 'B/USDT', di: -5, prev: -4, dir: 'down', side: 'below', n: 30 },
    { symbol: 'A/USDT', di: 8, prev: 6, dir: 'up', side: 'above', n: 30 },
    { symbol: 'C/USDT', di: -1, prev: -2, dir: 'up', side: 'below', n: 30 },
  ];

  it('sorts by DI descending by default', () => {
    expect(sortDisparity(rows, 'di').map((r) => r.di)).toEqual([8, -1, -5]);
  });

  it('sorts by absolute stretch and by symbol', () => {
    expect(sortDisparity(rows, 'abs').map((r) => r.di)).toEqual([8, -5, -1]);
    expect(sortDisparity(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = disparityBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 12, 13, 14, 15] },
        { symbol: 'THIN/USDT', closes: [1, 2] },
      ],
      'di',
      3,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
