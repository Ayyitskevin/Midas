import { describe, it, expect } from 'vitest';
import { computeGpr, gprBoard, sortGpr, type GprRow } from './gainToPain';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('computeGpr', () => {
  it('nets total return against the cumulative loss', () => {
    // returns 0.1, -0.05, 0.08, -0.03 → gain 0.18, pain 0.08, total 0.10.
    const r = computeGpr(fromReturns([0.1, -0.05, 0.08, -0.03]))!;
    expect(r.gain).toBeCloseTo(0.18, 9);
    expect(r.pain).toBeCloseTo(0.08, 9);
    expect(r.totalReturn).toBeCloseTo(0.1, 9);
    expect(r.gpr).toBeCloseTo(1.25, 9); // 0.10 / 0.08
    expect(r.up).toBe(2);
    expect(r.down).toBe(2);
    expect(r.n).toBe(4);
  });

  it('reports a null GPR when there were no losses', () => {
    const r = computeGpr(fromReturns([0.1, 0.2, 0.05]))!;
    expect(r.pain).toBe(0);
    expect(r.gpr).toBeNull();
    expect(r.down).toBe(0);
    expect(r.up).toBe(3);
  });

  it('is −1 for an all-losing series', () => {
    const r = computeGpr(fromReturns([-0.1, -0.05]))!;
    expect(r.gain).toBe(0);
    expect(r.pain).toBeCloseTo(0.15, 9);
    expect(r.gpr).toBeCloseTo(-1, 9); // total = −pain
  });

  it('treats flat periods as neither gain nor pain (null GPR)', () => {
    const r = computeGpr([100, 100, 100])!;
    expect(r.gain).toBe(0);
    expect(r.pain).toBe(0);
    expect(r.gpr).toBeNull();
    expect(r.up).toBe(0);
    expect(r.down).toBe(0);
  });

  it('returns null with fewer than two closes', () => {
    expect(computeGpr([100])).toBeNull();
    expect(computeGpr([])).toBeNull();
  });
});

describe('gprBoard / sortGpr', () => {
  const winner = fromReturns([0.05, -0.01, 0.04, -0.01]); // high GPR
  const loser = fromReturns([0.01, -0.05, 0.0, -0.04]); // negative GPR
  const noLoss = fromReturns([0.02, 0.03, 0.01]); // null GPR (no pain)

  it('drops too-short series and ranks a no-loss name at the top', () => {
    const board = gprBoard([
      { symbol: 'WIN', closes: winner },
      { symbol: 'LOSE', closes: loser },
      { symbol: 'PERF', closes: noLoss },
      { symbol: 'SHORT', closes: [100] },
    ]);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    // null GPR (no losses) is the best outcome → sorts first.
    expect(board[0].symbol).toBe('PERF');
    expect(board[0].gpr).toBeNull();
    // Winner outranks loser.
    const win = board.findIndex((r) => r.symbol === 'WIN');
    const lose = board.findIndex((r) => r.symbol === 'LOSE');
    expect(win).toBeLessThan(lose);
  });

  it('sorts by symbol alphabetically', () => {
    const board = sortGpr(
      [
        { symbol: 'ZZZ', gpr: 5, totalReturn: 0.5, gain: 0.6, pain: 0.1, up: 8, down: 2, n: 10 },
        { symbol: 'AAA', gpr: 1, totalReturn: 0.1, gain: 0.3, pain: 0.2, up: 5, down: 5, n: 10 },
      ],
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });

  it('sorts by up-day fraction descending', () => {
    const rows: GprRow[] = [
      { symbol: 'A', gpr: 1, totalReturn: 0.1, gain: 0.3, pain: 0.2, up: 3, down: 7, n: 10 },
      { symbol: 'B', gpr: 1, totalReturn: 0.1, gain: 0.3, pain: 0.2, up: 8, down: 2, n: 10 },
    ];
    expect(sortGpr(rows, 'up')[0].symbol).toBe('B');
  });
});
