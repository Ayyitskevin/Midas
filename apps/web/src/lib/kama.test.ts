import { describe, it, expect } from 'vitest';
import { computeKama, kamaBoard, sortKama, type KamaRow } from './kama';

describe('computeKama', () => {
  // Workflow-verified example, reduced params n=2, fast=2, slow=3.
  //   closes = [10, 12, 11, 14]
  //   ER[3] = 0.5; SC[3] = (0.5*(2/3 − 1/2) + 1/2)^2 = 0.34027778
  //   kama2 = 11.691358024691358 ; kama3 = 12.476937585733882
  //   slope = 0.7855795610425247
  it('matches the hand-computed adaptive example', () => {
    const r = computeKama([10, 12, 11, 14], 2, 2, 3)!;
    expect(r).not.toBeNull();
    expect(r.kama).toBeCloseTo(12.476937585733882, 9);
    expect(r.slope).toBeCloseTo(0.7855795610425247, 9);
    expect(r.er).toBeCloseTo(0.5, 9);
    expect(r.dir).toBe('up');
    expect(r.side).toBe('above'); // close 14 > kama 12.48
    expect(r.distPct).toBeCloseTo(((14 - 12.476937585733882) / 14) * 100, 9);
    expect(r.slopePct).toBeCloseTo((0.7855795610425247 / 14) * 100, 9);
  });

  it('reports a high Efficiency Ratio on a clean monotonic trend', () => {
    const r = computeKama([10, 11, 12, 13, 14], 2, 2, 3)!;
    expect(r.er).toBeCloseTo(1, 9); // every move is fully directional
    expect(r.dir).toBe('up');
    expect(r.side).toBe('above');
  });

  it('reports a near-zero Efficiency Ratio on a choppy series', () => {
    const r = computeKama([10, 12, 10, 12, 10, 12], 2, 2, 3)!;
    expect(r.er).toBeCloseTo(0, 9); // net change over n bars is zero
  });

  it('barely moves and reads flat on a constant series', () => {
    const r = computeKama([5, 5, 5, 5, 5], 2, 2, 3)!;
    expect(r.er).toBe(0);
    expect(r.kama).toBeCloseTo(5, 12);
    expect(r.slope).toBeCloseTo(0, 12);
    expect(r.dir).toBe('flat');
    expect(r.distPct).toBeCloseTo(0, 12);
  });

  it('returns null on too little history or bad params', () => {
    expect(computeKama([], 10)).toBeNull();
    // n + 2 closes needed.
    expect(computeKama([1, 2, 3], 2, 2, 3)).toBeNull();
    expect(computeKama([1, 2, 3, 4], 2, 2, 3)).not.toBeNull();
    expect(computeKama([1, 2, 3, 4, 5], 0)).toBeNull();
    expect(computeKama([1, 2, 3, 4, 5], 2, 0, 3)).toBeNull();
    expect(computeKama([1, 2, 3, 4, 5], 2, 2, 0)).toBeNull();
  });

  it('works with default params on a longer series', () => {
    const closes = Array.from({ length: 50 }, (_, i) => 100 + i + 3 * Math.sin(i / 2));
    const r = computeKama(closes)!;
    expect(r).not.toBeNull();
    expect(r.er).toBeGreaterThanOrEqual(0);
    expect(r.er).toBeLessThanOrEqual(1);
    expect(r.dir).toBe(r.slope > 0 ? 'up' : r.slope < 0 ? 'down' : 'flat');
  });
});

describe('kamaBoard / sortKama', () => {
  const rows: KamaRow[] = [
    { symbol: 'B/USDT', kama: 10, slope: -0.1, er: 0.3, distPct: -2, slopePct: -1, dir: 'down', side: 'below', n: 50 },
    { symbol: 'A/USDT', kama: 10, slope: 0.4, er: 0.8, distPct: 5, slopePct: 4, dir: 'up', side: 'above', n: 50 },
    { symbol: 'C/USDT', kama: 10, slope: 0.1, er: 0.5, distPct: 1, slopePct: 1, dir: 'up', side: 'above', n: 50 },
  ];

  it('sorts by distance from KAMA descending by default', () => {
    expect(sortKama(rows, 'dist').map((r) => r.distPct)).toEqual([5, 1, -2]);
  });

  it('sorts by efficiency, slope %, and symbol', () => {
    expect(sortKama(rows, 'er').map((r) => r.er)).toEqual([0.8, 0.5, 0.3]);
    expect(sortKama(rows, 'slope').map((r) => r.slopePct)).toEqual([4, 1, -1]);
    expect(sortKama(rows, 'symbol').map((r) => r.symbol)).toEqual(['A/USDT', 'B/USDT', 'C/USDT']);
  });

  it('skips symbols with too little history', () => {
    const board = kamaBoard(
      [
        { symbol: 'OK/USDT', closes: [10, 11, 12, 13, 14, 15] },
        { symbol: 'THIN/USDT', closes: [1, 2, 3] },
      ],
      'dist',
      2,
      2,
      3,
    );
    expect(board.some((r) => r.symbol === 'OK/USDT')).toBe(true);
    expect(board.some((r) => r.symbol === 'THIN/USDT')).toBe(false);
  });
});
