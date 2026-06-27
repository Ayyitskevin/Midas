import { describe, it, expect } from 'vitest';
import {
  computeRainbow,
  rainbowBoard,
  sortRainbow,
  type RainbowBar,
  type RainbowRow,
} from './rainbow';

const mk = (rows: [number, number, number][]): RainbowBar[] =>
  rows.map(([high, low, close]) => ({ high, low, close }));

describe('computeRainbow', () => {
  // Workflow-verified example, reduced params bands=3, lookback N=3.
  //   C=[10,11,13,12,16], H=[11,12,14,13,17], L=[9,10,12,11,15]
  //   bands@last = [14, 13.25, 12.75] → bandAvg = 40/3 = 13.3333
  //   range = HHV(17) − LLV(11) = 6
  //   RO = 100·(16 − 13.3333)/6 = 44.4444 ; BW = 100·(14 − 12.75)/6 = 20.8333
  const up = mk([
    [11, 9, 10],
    [12, 10, 11],
    [14, 12, 13],
    [13, 11, 12],
    [17, 15, 16],
  ]);

  it('matches the hand-computed example (price above the rainbow)', () => {
    const r = computeRainbow(up, 3, 3)!;
    expect(r).not.toBeNull();
    expect(r.bandAvg).toBeCloseTo(40 / 3, 9);
    expect(r.ro).toBeCloseTo(44.44444444444444, 9);
    expect(r.bandwidth).toBeCloseTo(20.833333333333332, 9);
    expect(r.side).toBe('above');
  });

  it('is negative and below when price sits under the rainbow', () => {
    const down = mk([
      [17, 15, 16],
      [13, 11, 12],
      [14, 12, 13],
      [12, 10, 11],
      [11, 9, 10],
    ]);
    const r = computeRainbow(down, 3, 3)!;
    expect(r.ro).toBeCloseTo(-23.333333333333332, 9);
    expect(r.bandwidth).toBeCloseTo(25, 9);
    expect(r.side).toBe('below');
  });

  it('is zero when the price range collapses (flat bars)', () => {
    const flat = mk([
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
      [10, 10, 10],
    ]);
    const r = computeRainbow(flat, 3, 3)!;
    expect(r.ro).toBe(0);
    expect(r.bandwidth).toBe(0);
  });

  it('returns null on too little history or bad params', () => {
    const up = mk([
      [11, 9, 10],
      [12, 10, 11],
      [14, 12, 13],
      [13, 11, 12],
      [17, 15, 16],
    ]);
    expect(computeRainbow([], 10)).toBeNull();
    expect(computeRainbow(up.slice(0, 3), 3, 3)).toBeNull(); // n < bands + 1
    expect(computeRainbow(up.slice(0, 4), 3, 3)).not.toBeNull();
    expect(computeRainbow(up, 0, 3)).toBeNull();
    expect(computeRainbow(up, 3, 0)).toBeNull();
  });

  it('works with default params (10 bands) on a longer series', () => {
    const bars: RainbowBar[] = Array.from({ length: 40 }, (_, i) => {
      const c = 100 + i + 2 * Math.sin(i / 3);
      return { high: c + 1, low: c - 1, close: c };
    });
    const r = computeRainbow(bars)!;
    expect(r).not.toBeNull();
    expect(Number.isFinite(r.ro)).toBe(true);
    expect(r.bandwidth).toBeGreaterThanOrEqual(0);
    expect(r.side).toBe(r.ro >= 0 ? 'above' : 'below');
  });
});

describe('rainbowBoard / sortRainbow', () => {
  const rows: RainbowRow[] = [
    { symbol: 'B/USDT', ro: -10, bandwidth: 12, bandAvg: 5, side: 'below', n: 40 },
    { symbol: 'A/USDT', ro: 30, bandwidth: 25, bandAvg: 9, side: 'above', n: 40 },
    { symbol: 'C/USDT', ro: 5, bandwidth: 8, bandAvg: 7, side: 'above', n: 40 },
  ];

  it('sorts by oscillator descending by default', () => {
    expect(sortRainbow(rows, 'ro').map((r) => r.ro)).toEqual([30, 5, -10]);
  });

  it('sorts by bandwidth and by symbol', () => {
    expect(sortRainbow(rows, 'bandwidth').map((r) => r.bandwidth)).toEqual([25, 12, 8]);
    expect(sortRainbow(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = rainbowBoard(
      [
        { symbol: 'OK/USDT', bars: mk([[11, 9, 10], [12, 10, 11], [14, 12, 13], [13, 11, 12], [17, 15, 16]]) },
        { symbol: 'THIN/USDT', bars: mk([[1, 1, 1], [2, 2, 2]]) },
      ],
      'ro',
      3,
      3,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
