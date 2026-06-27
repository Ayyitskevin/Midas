import { describe, it, expect } from 'vitest';
import { computeCks, cksBoard, sortCks, type CksBar, type CksRow } from './cks';

// Workflow-verified base series (p=2, x=1, q=2):
//   TR = [2,3,3,3]; Wilder ATR@3 = 2.875
//   highStop@3 = 13.125, lowStop@3 = 13.875
//   stopShort = max(11.25, 13.125) = 13.125 ; stopLong = min(11.75, 13.875) = 11.75
// The stops depend only on highs/lows/ATR, so the final close drives the regime.
const bars = (lastClose: number): CksBar[] => [
  { high: 10, low: 8, close: 9 },
  { high: 12, low: 9, close: 11 },
  { high: 14, low: 11, close: 13 },
  { high: 16, low: 13, close: lastClose },
];

describe('computeCks', () => {
  it('matches the hand-computed stops and is up when close breaks above the upper band', () => {
    const r = computeCks(bars(15), 2, 1, 2)!;
    expect(r).not.toBeNull();
    expect(r.stopShort).toBeCloseTo(13.125, 9);
    expect(r.stopLong).toBeCloseTo(11.75, 9);
    expect(r.regime).toBe('up');
    expect(r.pos).toBeCloseTo((100 * (15 - 11.75)) / (13.125 - 11.75), 9); // ≈236.36
    expect(r.supportPct).toBeCloseTo(((15 - 11.75) / 15) * 100, 9);
    expect(r.resistPct).toBeCloseTo(((13.125 - 15) / 15) * 100, 9);
  });

  it('is mid when close sits inside the channel (same stops)', () => {
    const r = computeCks(bars(12.5), 2, 1, 2)!;
    expect(r.stopShort).toBeCloseTo(13.125, 9);
    expect(r.stopLong).toBeCloseTo(11.75, 9);
    expect(r.regime).toBe('mid');
    expect(r.pos).toBeCloseTo((100 * (12.5 - 11.75)) / (13.125 - 11.75), 9); // ≈54.55
  });

  it('is down when close breaks below the lower band (same stops)', () => {
    const r = computeCks(bars(11), 2, 1, 2)!;
    expect(r.stopShort).toBeCloseTo(13.125, 9);
    expect(r.stopLong).toBeCloseTo(11.75, 9);
    expect(r.regime).toBe('down');
    expect(r.pos).toBeLessThan(0);
    expect(r.supportPct).toBeLessThan(0); // price below the support stop
  });

  it('keeps the upper band at or above the lower band and the regime consistent with pos', () => {
    const r = computeCks(bars(15), 2, 1, 2)!;
    expect(r.stopShort).toBeGreaterThanOrEqual(r.stopLong);
    // span > 0 here, so pos and regime must agree.
    expect(r.regime === 'up').toBe(r.pos > 100);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeCks([], 10, 1, 9)).toBeNull();
    // p + q − 1 = 3 bars needed for p=2,q=2.
    expect(computeCks(bars(15).slice(0, 2), 2, 1, 2)).toBeNull();
    expect(computeCks(bars(15).slice(0, 3), 2, 1, 2)).not.toBeNull();
    expect(computeCks(bars(15), 0, 1, 2)).toBeNull();
    expect(computeCks(bars(15), 2, 1, 0)).toBeNull();
    expect(computeCks(bars(15), 2, -1, 2)).toBeNull();
  });

  it('works with default params on a longer series', () => {
    const ramp: CksBar[] = Array.from({ length: 40 }, (_, i) => ({
      high: 100 + i + 1,
      low: 100 + i - 1,
      close: 100 + i,
    }));
    const r = computeCks(ramp)!;
    expect(r).not.toBeNull();
    expect(['up', 'down', 'mid']).toContain(r.regime);
    expect(r.stopShort).toBeGreaterThanOrEqual(r.stopLong);
  });
});

describe('cksBoard / sortCks', () => {
  const rows: CksRow[] = [
    { symbol: 'B/USDT', stopShort: 10, stopLong: 9, regime: 'mid', supportPct: 2, resistPct: 3, pos: 40, n: 30 },
    { symbol: 'A/USDT', stopShort: 10, stopLong: 9, regime: 'up', supportPct: 8, resistPct: -2, pos: 150, n: 30 },
    { symbol: 'C/USDT', stopShort: 10, stopLong: 9, regime: 'down', supportPct: -5, resistPct: 6, pos: -20, n: 30 },
  ];

  it('sorts by channel position descending by default (up-breaks first)', () => {
    expect(sortCks(rows, 'pos').map((r) => r.pos)).toEqual([150, 40, -20]);
  });

  it('sorts by support %, resist %, and symbol', () => {
    expect(sortCks(rows, 'support').map((r) => r.supportPct)).toEqual([8, 2, -5]);
    expect(sortCks(rows, 'resist').map((r) => r.resistPct)).toEqual([6, 3, -2]);
    expect(sortCks(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = cksBoard(
      [
        { symbol: 'OK/USDT', bars: bars(15) },
        { symbol: 'THIN/USDT', bars: bars(15).slice(0, 2) },
      ],
      'pos',
      2,
      1,
      2,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
