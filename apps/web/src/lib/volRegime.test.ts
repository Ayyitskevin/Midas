import { describe, it, expect } from 'vitest';
import { computeVolRegime, volRegimeBoard, sortVReg, type VRegRow } from './volRegime';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('computeVolRegime', () => {
  it('computes the short/long ratio and the rolling-vol percentile', () => {
    // returns [.01,-.01,.05,-.05,.02,-.02], short 2 / long 6.
    // shortVol = 0.02, longVol = √0.001; rolling-2 vols [.01,.03,.05,.035,.02]
    // → today's .02 is ≤ by {.01,.02} of 5 → 40th pct.
    const r = computeVolRegime(fromReturns([0.01, -0.01, 0.05, -0.05, 0.02, -0.02]), 2, 6)!;
    expect(r.shortVol).toBeCloseTo(0.02, 9);
    expect(r.longVol).toBeCloseTo(Math.sqrt(0.001), 9);
    expect(r.ratio).toBeCloseTo(0.02 / Math.sqrt(0.001), 9);
    expect(r.pct).toBeCloseTo(40, 9);
    expect(r.n).toBe(6);
  });

  it('reads ratio 1 and 100th percentile for constant volatility', () => {
    const r = computeVolRegime(
      fromReturns([0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01]),
      4,
      8,
    )!;
    expect(r.ratio).toBeCloseTo(1, 9);
    expect(r.pct).toBeCloseTo(100, 9);
  });

  it('flags an expanding regime with ratio > 1', () => {
    const r = computeVolRegime(
      fromReturns([0.005, -0.005, 0.005, -0.005, 0.03, -0.03, 0.03, -0.03]),
      4,
      8,
    )!;
    expect(r.ratio!).toBeGreaterThan(1);
  });

  it('returns null on invalid windows or too little history', () => {
    const closes = fromReturns([0.01, -0.01, 0.02, -0.02, 0.01, -0.01]);
    expect(computeVolRegime(closes, 1, 6)).toBeNull(); // shortW < 2
    expect(computeVolRegime(closes, 4, 4)).toBeNull(); // longW ≤ shortW
    expect(computeVolRegime(closes, 4, 3)).toBeNull(); // longW ≤ shortW
    expect(computeVolRegime(fromReturns([0.01, -0.01, 0.02, -0.02]), 2, 8)).toBeNull(); // n < longW
  });
});

describe('volRegimeBoard / sortVReg', () => {
  const expanding = fromReturns([0.005, -0.005, 0.005, -0.005, 0.03, -0.03, 0.03, -0.03]);
  const contracting = fromReturns([0.03, -0.03, 0.03, -0.03, 0.005, -0.005, 0.005, -0.005]);

  it('drops too-short series and ranks the most-expanding first', () => {
    const board = volRegimeBoard(
      [
        { symbol: 'EXP', closes: expanding },
        { symbol: 'CON', closes: contracting },
        { symbol: 'SHORT', closes: fromReturns([0.01, -0.01, 0.02]) },
      ],
      4,
      8,
    );
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[0].symbol).toBe('EXP');
    expect(board[0].ratio!).toBeGreaterThan(board[1].ratio!);
  });

  it('sorts by percentile and by symbol', () => {
    const rows: VRegRow[] = [
      { symbol: 'ZZZ', shortVol: 0.02, longVol: 0.02, ratio: 1, pct: 30, n: 60 },
      { symbol: 'AAA', shortVol: 0.04, longVol: 0.02, ratio: 2, pct: 90, n: 60 },
    ];
    expect(sortVReg(rows, 'pct')[0].symbol).toBe('AAA');
    expect(sortVReg(rows, 'symbol').map((r) => r.symbol)).toEqual(['AAA', 'ZZZ']);
  });
});
