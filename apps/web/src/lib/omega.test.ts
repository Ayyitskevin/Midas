import { describe, it, expect } from 'vitest';
import { computeOmega, omegaBoard, sortOmega, type OmegaRow } from './omega';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('computeOmega', () => {
  const closes = fromReturns([0.02, -0.01, 0.03, -0.02]);

  it('is the ratio of upside to downside at the threshold (τ=0)', () => {
    const r = computeOmega(closes, 0)!;
    expect(r.upside).toBeCloseTo(0.05, 9); // 0.02 + 0.03
    expect(r.downside).toBeCloseTo(0.03, 9); // 0.01 + 0.02
    expect(r.omega).toBeCloseTo(5 / 3, 9);
    expect(r.meanRet).toBeCloseTo(0.005, 9);
    expect(r.n).toBe(4);
  });

  it('shifts upside/downside as the threshold moves and decreases monotonically', () => {
    const r = computeOmega(closes, 0.01)!;
    // d = [0.01, -0.02, 0.02, -0.03] → up 0.03, down 0.05.
    expect(r.upside).toBeCloseTo(0.03, 9);
    expect(r.downside).toBeCloseTo(0.05, 9);
    expect(r.omega).toBeCloseTo(0.6, 9);
    // Raising the threshold lowers Omega.
    expect(r.omega!).toBeLessThan(computeOmega(closes, 0)!.omega!);
  });

  it('equals the Gain-to-Pain ratio + 1 at τ=0', () => {
    const r = computeOmega(closes, 0)!;
    // GPR = (gain − pain)/pain = (0.05 − 0.03)/0.03; Ω(0) = gain/pain = GPR + 1.
    const gpr = (0.05 - 0.03) / 0.03;
    expect(r.omega).toBeCloseTo(gpr + 1, 9);
  });

  it('reports a null Omega when nothing falls below the threshold', () => {
    const r = computeOmega(fromReturns([0.02, 0.03, 0.01]), 0)!;
    expect(r.downside).toBe(0);
    expect(r.omega).toBeNull();
  });

  it('is zero when everything falls below the threshold', () => {
    const r = computeOmega(fromReturns([-0.01, -0.02]), 0)!;
    expect(r.upside).toBe(0);
    expect(r.omega).toBe(0);
  });

  it('returns null with fewer than two closes', () => {
    expect(computeOmega([100], 0)).toBeNull();
    expect(computeOmega([], 0)).toBeNull();
  });
});

describe('omegaBoard / sortOmega', () => {
  const strong = fromReturns([0.04, -0.01, 0.03, -0.01]); // high Omega
  const weak = fromReturns([0.01, -0.04, 0.0, -0.03]); // low Omega
  const noDown = fromReturns([0.02, 0.03, 0.01]); // null Omega (no downside)

  it('drops too-short series and ranks a no-downside name at the top', () => {
    const board = omegaBoard(
      [
        { symbol: 'STRONG', closes: strong },
        { symbol: 'WEAK', closes: weak },
        { symbol: 'PERF', closes: noDown },
        { symbol: 'SHORT', closes: [100] },
      ],
      0,
    );
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[0].symbol).toBe('PERF'); // null Omega sorts first
    expect(board[0].omega).toBeNull();
    const strongIdx = board.findIndex((r) => r.symbol === 'STRONG');
    const weakIdx = board.findIndex((r) => r.symbol === 'WEAK');
    expect(strongIdx).toBeLessThan(weakIdx);
  });

  it('passes the threshold through to every name', () => {
    const board = omegaBoard([{ symbol: 'A', closes: strong }], 0.02);
    const direct = computeOmega(strong, 0.02)!;
    expect(board[0].omega).toBeCloseTo(direct.omega!, 12);
  });

  it('sorts by symbol and by mean return', () => {
    const rows: OmegaRow[] = [
      { symbol: 'ZZZ', omega: 2, upside: 0.4, downside: 0.2, meanRet: 0.01, n: 10 },
      { symbol: 'AAA', omega: 3, upside: 0.6, downside: 0.2, meanRet: 0.03, n: 10 },
    ];
    expect(sortOmega(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
    expect(sortOmega(rows, 'meanRet')[0].symbol).toBe('AAA');
  });
});
