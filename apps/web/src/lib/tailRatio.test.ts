import { describe, it, expect } from 'vitest';
import { computeTail, tailBoard, sortTail, type TailRow } from './tailRatio';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

// 21 returns → exact 5th/95th percentiles land on sorted[1] and sorted[19].
const symmetric = fromReturns(Array.from({ length: 21 }, (_, i) => -0.1 + 0.01 * i));
const rightFat = fromReturns([-0.04, -0.03, ...Array(17).fill(0), 0.06, 0.08]);
const leftFat = fromReturns([-0.08, -0.06, ...Array(17).fill(0), 0.03, 0.04]);

describe('computeTail', () => {
  it('is ≈1 for a symmetric distribution', () => {
    const r = computeTail(symmetric)!;
    expect(r.p95).toBeCloseTo(0.09, 6);
    expect(r.p5).toBeCloseTo(-0.09, 6);
    expect(r.tailRatio).toBeCloseTo(1, 6);
  });

  it('is >1 when the right tail is fatter', () => {
    const r = computeTail(rightFat)!;
    // p95 = sorted[19] = 0.06, p5 = sorted[1] = −0.03 → 2.
    expect(r.p95).toBeCloseTo(0.06, 6);
    expect(r.p5).toBeCloseTo(-0.03, 6);
    expect(r.tailRatio).toBeCloseTo(2, 6);
  });

  it('is <1 when the left tail is fatter', () => {
    const r = computeTail(leftFat)!;
    // p95 = 0.03, p5 = −0.06 → 0.5.
    expect(r.tailRatio).toBeCloseTo(0.5, 6);
  });

  it('reports a null ratio for a flat (no-dispersion) series', () => {
    const r = computeTail([100, 100, 100, 100])!;
    expect(r.p5).toBe(0);
    expect(r.tailRatio).toBeNull();
  });

  it('returns null with fewer than three closes', () => {
    expect(computeTail([100, 101])).toBeNull();
    expect(computeTail([100])).toBeNull();
  });
});

describe('tailBoard / sortTail', () => {
  it('ranks fat-right tails first and sinks a degenerate (null) name', () => {
    const board = tailBoard([
      { symbol: 'RIGHT', closes: rightFat },
      { symbol: 'SYM', closes: symmetric },
      { symbol: 'LEFT', closes: leftFat },
      { symbol: 'FLAT', closes: [100, 100, 100, 100] },
      { symbol: 'SHORT', closes: [100] },
    ]);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board.map((r) => r.symbol)).toEqual(['RIGHT', 'SYM', 'LEFT', 'FLAT']);
    expect(board[board.length - 1].tailRatio).toBeNull();
  });

  it('sorts by the left tail (most negative first) and by symbol', () => {
    const rows: TailRow[] = [
      { symbol: 'ZZZ', tailRatio: 2, p95: 0.05, p5: -0.02, meanRet: 0.01, n: 10 },
      { symbol: 'AAA', tailRatio: 1, p95: 0.04, p5: -0.06, meanRet: 0.0, n: 10 },
    ];
    expect(sortTail(rows, 'p5')[0].symbol).toBe('AAA'); // −0.06 first
    expect(sortTail(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
