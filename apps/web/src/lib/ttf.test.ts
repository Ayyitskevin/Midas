import { describe, it, expect } from 'vitest';
import { classifyTtf, computeTtf, ttfBoard, sortTtf, type TtfBar, type TtfRow } from './ttf';

const mk = (rows: [number, number][]): TtfBar[] => rows.map(([high, low]) => ({ high, low }));

describe('classifyTtf', () => {
  it('maps the ±100 trend bands', () => {
    expect(classifyTtf(101)).toBe('up');
    expect(classifyTtf(100)).toBe('neutral'); // strict > 100
    expect(classifyTtf(0)).toBe('neutral');
    expect(classifyTtf(-100)).toBe('neutral'); // strict < -100
    expect(classifyTtf(-101)).toBe('down');
  });
});

describe('computeTtf', () => {
  // Workflow-verified example, reduced param N=2.
  //   bars H/L: bar0 10/8, bar1 12/9, bar2 14/11, bar3 13/10, bar4 16/13
  //   recent [3,4]: HH=16, LL=10 ; prior [1,2]: HH=14, LL=9
  //   buyPower = 16−9 = 7 ; sellPower = 14−10 = 4
  //   TTF = 100·(7−4)/(0.5·(7+4)) = 300/5.5 = 54.5454…
  it('matches the hand-computed example', () => {
    const r = computeTtf(mk([[10, 8], [12, 9], [14, 11], [13, 10], [16, 13]]), 2)!;
    expect(r).not.toBeNull();
    expect(r.buyPower).toBe(7);
    expect(r.sellPower).toBe(4);
    expect(r.ttf).toBeCloseTo(54.54545454545455, 9);
    expect(r.zone).toBe('neutral');
  });

  it('is a strong uptrend (> +100) on a sharp upside breakout', () => {
    // Recent low (18) sits above the prior high (12) → sellPower negative → TTF ≫ 100.
    const r = computeTtf(mk([[10, 8], [11, 9], [12, 10], [20, 18], [22, 20]]), 2)!;
    expect(r.ttf).toBeGreaterThan(100);
    expect(r.zone).toBe('up');
  });

  it('is a strong downtrend (< −100) on a sharp breakdown', () => {
    const r = computeTtf(mk([[22, 20], [21, 19], [20, 18], [12, 10], [10, 8]]), 2)!;
    expect(r.ttf).toBeLessThan(-100);
    expect(r.zone).toBe('down');
  });

  it('returns null on too little history or bad params', () => {
    expect(computeTtf([], 15)).toBeNull();
    // 2·N bars needed.
    expect(computeTtf(mk([[1, 1], [2, 2], [3, 3]]), 2)).toBeNull();
    expect(computeTtf(mk([[1, 1], [2, 2], [3, 3], [4, 4]]), 2)).not.toBeNull();
    expect(computeTtf(mk([[1, 1], [2, 2], [3, 3], [4, 4]]), 0)).toBeNull();
  });

  it('works with default params on a longer series', () => {
    const bars: TtfBar[] = Array.from({ length: 40 }, (_, i) => ({ high: 100 + i + 1, low: 100 + i - 1 }));
    const r = computeTtf(bars)!;
    expect(r).not.toBeNull();
    expect(r.zone).toBe(classifyTtf(r.ttf));
    expect(Number.isFinite(r.ttf)).toBe(true);
  });
});

describe('ttfBoard / sortTtf', () => {
  const rows: TtfRow[] = [
    { symbol: 'B/USDT', ttf: -120, buyPower: 1, sellPower: 5, zone: 'down', n: 40 },
    { symbol: 'A/USDT', ttf: 140, buyPower: 6, sellPower: 1, zone: 'up', n: 40 },
    { symbol: 'C/USDT', ttf: 30, buyPower: 4, sellPower: 2, zone: 'neutral', n: 40 },
  ];

  it('sorts by TTF descending by default', () => {
    expect(sortTtf(rows, 'ttf').map((r) => r.ttf)).toEqual([140, 30, -120]);
  });

  it('sorts by absolute strength and by symbol', () => {
    expect(sortTtf(rows, 'abs').map((r) => r.ttf)).toEqual([140, -120, 30]);
    expect(sortTtf(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = ttfBoard(
      [
        { symbol: 'OK/USDT', bars: mk([[10, 8], [12, 9], [14, 11], [13, 10], [16, 13]]) },
        { symbol: 'THIN/USDT', bars: mk([[1, 1], [2, 2]]) },
      ],
      'ttf',
      2,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
