import { describe, it, expect } from 'vitest';
import { computeHma, wma, hmaBoard, sortHma, type HmaRow } from './hma';

describe('wma', () => {
  it('weights linearly (1..p, newest highest) and divides by p(p+1)/2', () => {
    // (4·8 + 3·6 + 2·4 + 1·2) / 10 = 60/10 = 6
    expect(wma([2, 4, 6, 8], 4)[3]).toBeCloseTo(6, 9);
    // period 2: (2·11 + 1·10)/3 = 32/3
    expect(wma([10, 11], 2)[1]).toBeCloseTo(32 / 3, 9);
  });

  it('is NaN before the window fills', () => {
    const w = wma([10, 11, 13, 16], 4);
    expect(Number.isNaN(w[0])).toBe(true);
    expect(Number.isNaN(w[2])).toBe(true);
    expect(w[3]).toBeCloseTo(13.5, 9); // (4·16+3·13+2·11+1·10)/10
  });
});

describe('computeHma', () => {
  // Workflow-verified fixture (n=4 → half=2, sq=round(√4)=2) over 7 closes:
  //   WMA(close,2) = [_,10.6667,12.3333,15,17.3333,17.3333,15.6667]
  //   WMA(close,4) = [_,_,_,13.5,15.7,16.7,16.3]
  //   raw          = [16.5, 18.96667, 17.96667, 15.03333]
  //   HMA          = [_, 18.14444, 18.3, 16.01111]   (1441/90 at the last bar)
  //   slope = 16.01111 − 18.3 = −2.28889 → slopePct = 100·(−206)/1647 = −12.50759
  const closes = [10, 11, 13, 16, 18, 17, 15];

  it('matches the hand-computed HMA and percent slope (falling)', () => {
    const r = computeHma(closes, 4)!;
    expect(r).not.toBeNull();
    expect(r.hma).toBeCloseTo(1441 / 90, 6); // 16.0111111…
    expect(r.slopePct).toBeCloseTo(-20600 / 1647, 6); // −12.5075897…
    expect(r.dir).toBe('down');
    expect(r.period).toBe(4);
    expect(r.n).toBe(7);
  });

  it('rises with a positive slope on a steady up-trend', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 100 + i);
    const r = computeHma(ramp)!; // default 20
    expect(r.dir).toBe('up');
    expect(r.slopePct).toBeGreaterThan(0);
    expect(Number.isFinite(r.hma)).toBe(true);
  });

  it('falls with a negative slope on a steady down-trend', () => {
    const ramp = Array.from({ length: 40 }, (_, i) => 200 - i);
    const r = computeHma(ramp)!;
    expect(r.dir).toBe('down');
    expect(r.slopePct).toBeLessThan(0);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeHma([], 20)).toBeNull();
    // period + round(√period) = 4 + 2 = 6 closes needed for period 4.
    expect(computeHma(closes.slice(0, 5), 4)).toBeNull();
    expect(computeHma(closes.slice(0, 6), 4)).not.toBeNull();
    expect(computeHma(closes, 1)).toBeNull(); // period < 2
  });
});

describe('hmaBoard / sortHma', () => {
  const rows: HmaRow[] = [
    { symbol: 'B/USDT', hma: 100, slopePct: 0.4, dir: 'up', period: 20, n: 200 },
    { symbol: 'A/USDT', hma: 50, slopePct: 1.8, dir: 'up', period: 20, n: 200 },
    { symbol: 'C/USDT', hma: 3, slopePct: -1.2, dir: 'down', period: 20, n: 200 },
  ];

  it('sorts by percent slope descending by default (strongest up-trends first)', () => {
    expect(sortHma(rows, 'slope').map((r) => r.slopePct)).toEqual([1.8, 0.4, -1.2]);
  });

  it('sorts by symbol', () => {
    expect(sortHma(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = hmaBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 13, 16, 18, 17, 15] },
        { symbol: 'THIN/USDT', closes: [10, 11, 13] },
      ],
      'slope',
      4,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
