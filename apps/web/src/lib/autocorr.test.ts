import { describe, it, expect } from 'vitest';
import { autocorr, computeAcf, acfBoard, sortAcf, type AcfRow } from './autocorr';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('autocorr', () => {
  it('is −1 at lag 1 and +1 at lag 2 for an alternating series', () => {
    const r = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    expect(autocorr(r, 1)).toBeCloseTo(-1, 12); // rₜ = −rₜ₋₁
    expect(autocorr(r, 2)).toBeCloseTo(1, 12); // rₜ = rₜ₋₂
  });

  it('is +1 at lag 1 for a perfectly increasing series', () => {
    expect(autocorr([1, 2, 3, 4, 5], 1)).toBeCloseTo(1, 12);
  });

  it('returns 0 without two overlapping pairs', () => {
    expect(autocorr([1, 2], 1)).toBe(0);
    expect(autocorr([1, 2, 3, 4], 0)).toBe(0);
  });
});

describe('computeAcf', () => {
  it('flags a reverting name (alternating returns)', () => {
    const r = computeAcf(fromReturns([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]))!;
    expect(r.lag1).toBeCloseTo(-1, 9);
    expect(r.lag2).toBeCloseTo(1, 9);
    expect(r.verdict).toBe('reverting');
  });

  it('flags a momentum name (persistently rising returns)', () => {
    const r = computeAcf(fromReturns([0.01, 0.02, 0.03, 0.04, 0.05, 0.06]))!;
    expect(r.lag1).toBeGreaterThan(0.1);
    expect(r.verdict).toBe('momentum');
  });

  it('keeps the verdict consistent with the lag-1 threshold', () => {
    const r = computeAcf(fromReturns([0.03, -0.01, 0.02, 0.0, -0.02, 0.01, 0.015, -0.005]))!;
    const expected = r.lag1 > 0.1 ? 'momentum' : r.lag1 < -0.1 ? 'reverting' : 'random';
    expect(r.verdict).toBe(expected);
  });

  it('returns null without at least five returns', () => {
    expect(computeAcf([100, 101, 102, 103])).toBeNull(); // 3 returns
    expect(computeAcf([100])).toBeNull();
  });
});

describe('acfBoard / sortAcf', () => {
  const mom = fromReturns([0.01, 0.02, 0.03, 0.04, 0.05, 0.06]);
  const rev = fromReturns([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]);

  it('drops too-short series and ranks the most positive lag-1 first', () => {
    const board = acfBoard([
      { symbol: 'REV', closes: rev },
      { symbol: 'MOM', closes: mom },
      { symbol: 'SHORT', closes: [100, 101, 102] },
    ]);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[0].symbol).toBe('MOM'); // highest lag-1
    expect(board[0].lag1).toBeGreaterThan(board[1].lag1);
  });

  it('sorts by lag-2 and by symbol', () => {
    const rows: AcfRow[] = [
      { symbol: 'ZZZ', lag1: 0.5, lag2: 0.1, lag3: 0, verdict: 'momentum', n: 50 },
      { symbol: 'AAA', lag1: 0.2, lag2: 0.4, lag3: 0, verdict: 'momentum', n: 50 },
    ];
    expect(sortAcf(rows, 'lag2')[0].symbol).toBe('AAA');
    expect(sortAcf(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
