import { describe, it, expect } from 'vitest';
import { computePso, psoBoard, sortPso, type PsoBar, type PsoRow } from './premierstoch';

const bar = (high: number, low: number, close: number): PsoBar => ({ high, low, close });

// Small periods let the stochastic → nsk → double-EMA → exp-transform cascade be
// computed by hand. Verified by a 3-way adversarial recomputation against the
// LazyBear/Leibfarth Pine: the 8 bars below under length=2 / smooth=2 give
// PSO = 0.4377 (ss = 0.9389).
const EIGHT = [
  bar(11, 9, 10),
  bar(13, 10, 12),
  bar(12, 10, 11),
  bar(14, 11, 13),
  bar(13, 11, 12),
  bar(15, 12, 14),
  bar(14, 12, 13),
  bar(16, 13, 15),
];

describe('computePso', () => {
  it('matches the exact worked micro-example', () => {
    const r = computePso(EIGHT, 2, 2)!;
    expect(r).not.toBeNull();
    expect(r.pso).toBeCloseTo(0.4377, 3);
    expect(r.prev).toBeCloseTo(-0.0503, 3);
    expect(r.dir).toBe('up');
    expect(r.zone).toBe('mid');
    expect(r.n).toBe(8);
  });

  it('stays within [-1, 1]', () => {
    const wave = Array.from({ length: 40 }, (_, i) => {
      const mid = 100 + 8 * Math.sin(i / 3);
      return bar(mid + 1, mid - 1, mid + 0.5 * Math.cos(i / 2));
    });
    const r = computePso(wave)!; // defaults 8/5
    expect(r.pso).toBeGreaterThanOrEqual(-1);
    expect(r.pso).toBeLessThanOrEqual(1);
  });

  it('saturates overbought when close rides the high of the range', () => {
    const rising = Array.from({ length: 14 }, (_, i) => bar(10 + i, 8 + i, 10 + i));
    const r = computePso(rising, 2, 2)!;
    expect(r.pso).toBeGreaterThan(0.9);
    expect(r.zone).toBe('ob');
  });

  it('saturates oversold when close rides the low of the range', () => {
    const falling = Array.from({ length: 14 }, (_, i) => bar(20 - i, 18 - i, 18 - i));
    const r = computePso(falling, 2, 2)!;
    expect(r.pso).toBeLessThan(-0.9);
    expect(r.zone).toBe('os');
  });

  it('is zero when the range collapses', () => {
    // high == low → stochK falls back to neutral 50 → nsk 0 → ss 0 → PSO 0.
    const flat = Array.from({ length: 10 }, () => bar(10, 10, 10));
    const r = computePso(flat, 2, 2)!;
    expect(r.pso).toBe(0);
    expect(r.zone).toBe('mid');
  });

  it('returns null below length + 2·smooth bars', () => {
    expect(computePso(EIGHT.slice(0, 5), 2, 2)).toBeNull(); // 5 bars, needs 6
    expect(computePso(EIGHT)).toBeNull(); // 8 bars, defaults need 18
    expect(computePso([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computePso(EIGHT, 0, 2)).toBeNull();
    expect(computePso(EIGHT, 2, 0)).toBeNull();
  });
});

describe('psoBoard / sortPso', () => {
  const rising = Array.from({ length: 14 }, (_, i) => bar(10 + i, 8 + i, 10 + i));
  const falling = Array.from({ length: 14 }, (_, i) => bar(20 - i, 18 - i, 18 - i));

  it('skips thin history and sorts by PSO descending', () => {
    const board = psoBoard(
      [
        { symbol: 'DOWN', bars: falling },
        { symbol: 'UP', bars: rising },
        { symbol: 'THIN', bars: EIGHT.slice(0, 4) },
      ],
      'pso',
      2,
      2,
    );
    expect(board.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
  });

  it('sorts by symbol and by slope', () => {
    const a: PsoRow = { symbol: 'AAA', ...computePso(rising, 2, 2)!, pso: 0.5, prev: 0.1 };
    const b: PsoRow = { symbol: 'BBB', ...computePso(falling, 2, 2)!, pso: -0.5, prev: -0.1 };
    expect(sortPso([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortPso([b, a], 'slope')[0].symbol).toBe('AAA'); // +0.4 slope beats −0.4
  });
});
