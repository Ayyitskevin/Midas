import { describe, it, expect } from 'vitest';
import { computeVhf, vhfBoard, sortVhf, type VhfRow } from './vhf';

describe('computeVhf', () => {
  it('matches a hand-computed example', () => {
    // closes [10,12,11,14,13,15], N=3, last bar:
    //   window closes [14,13,15] → range |15−13| = 2
    //   moves |14−11|+|13−14|+|15−13| = 3+1+2 = 6  → VHF = 2/6 = 0.3333.
    // prev (index 4): window [11,14,13] → range 3, moves 1+3+1 = 5 → 0.6.
    const r = computeVhf([10, 12, 11, 14, 13, 15], 3)!;
    expect(r).not.toBeNull();
    expect(r.vhf).toBeCloseTo(0.3333, 4);
    expect(r.prev).toBeCloseTo(0.6, 4);
    expect(r.dir).toBe('down');
    expect(r.regime).toBe('mid');
    expect(r.n).toBe(6);
  });

  it('reads a steady trend higher than a choppy range', () => {
    const trend = computeVhf([1, 2, 3, 4, 5, 6], 3)!; // range 2 / moves 3 = 0.6667
    const chop = computeVhf([10, 11, 10, 11, 10, 11], 3)!; // range 1 / moves 3 = 0.3333
    expect(trend.vhf).toBeCloseTo(2 / 3, 4);
    expect(chop.vhf).toBeCloseTo(1 / 3, 4);
    expect(trend.vhf).toBeGreaterThan(chop.vhf);
  });

  it('classifies regimes by the 0.20 / 0.35 thresholds', () => {
    // A long strict ramp → range (N−1) / moves N → 9/10 = 0.9 (trend).
    const ramp = Array.from({ length: 11 }, (_, i) => i);
    expect(computeVhf(ramp, 10)!.regime).toBe('trend');
    // A tight zigzag of unit moves over a wide window → small range / big moves.
    const zig = Array.from({ length: 21 }, (_, i) => 100 + (i % 2));
    const z = computeVhf(zig, 20)!;
    expect(z.vhf).toBeLessThanOrEqual(0.2);
    expect(z.regime).toBe('chop');
  });

  it('is zero when price never moves', () => {
    const flat = Array.from({ length: 6 }, () => 100); // range 0, moves 0 → guarded to 0
    const r = computeVhf(flat, 3)!;
    expect(r.vhf).toBe(0);
    expect(r.regime).toBe('chop');
  });

  it('returns null below period + 1 closes', () => {
    expect(computeVhf([10, 12, 11], 3)).toBeNull(); // 3 closes, needs 4
    expect(computeVhf(Array.from({ length: 20 }, (_, i) => i))).toBeNull(); // defaults need 29
    expect(computeVhf([])).toBeNull();
  });

  it('returns null on bad params', () => {
    expect(computeVhf([10, 12, 11, 14], 0)).toBeNull();
  });
});

describe('vhfBoard / sortVhf', () => {
  const trend = [1, 2, 3, 4, 5, 6];
  const chop = [10, 11, 10, 11, 10, 11];

  it('skips thin history and sorts by VHF descending', () => {
    const board = vhfBoard(
      [
        { symbol: 'CHOP', closes: chop },
        { symbol: 'TREND', closes: trend },
        { symbol: 'THIN', closes: [1, 2, 3] },
      ],
      'vhf',
      3,
    );
    expect(board.map((r) => r.symbol)).toEqual(['TREND', 'CHOP']);
  });

  it('sorts by symbol and by slope', () => {
    const a: VhfRow = { symbol: 'AAA', ...computeVhf(trend, 3)!, vhf: 0.6, prev: 0.4 };
    const b: VhfRow = { symbol: 'BBB', ...computeVhf(chop, 3)!, vhf: 0.3, prev: 0.35 };
    expect(sortVhf([b, a], 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'BBB']);
    expect(sortVhf([b, a], 'slope')[0].symbol).toBe('AAA'); // +0.2 slope beats −0.05
  });
});
