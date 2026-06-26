import { describe, it, expect } from 'vitest';
import { computeAppraisal, appraisalBoard, sortAppraisal } from './appraisal';

// Benchmark returns: mean 0, non-constant.
const BENCH = [0.1, -0.1, 0.1, -0.1];

describe('computeAppraisal', () => {
  it('computes an exact clean case (alpha 0.05, residual vol 0.1 → appraisal 0.5)', () => {
    // asset = 0.05 drift + 1·bench + ε, where ε = [.1,.1,-.1,-.1] is orthogonal to
    // bench and to the constant → OLS recovers beta 1, alpha 0.05, resid std 0.1.
    const s = computeAppraisal([0.25, 0.05, 0.05, -0.15], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(1, 10);
    expect(s.alpha).toBeCloseTo(0.05, 12);
    expect(s.residualVol).toBeCloseTo(0.1, 12);
    expect(s.appraisal).toBeCloseTo(0.5, 12); // 0.05 ÷ 0.1
  });

  it('annualizes like a Sharpe — the ratio scales by √(periods/year)', () => {
    const a = [0.25, 0.05, 0.05, -0.15];
    const x = computeAppraisal(a, BENCH, 1)!;
    const y = computeAppraisal(a, BENCH, 252)!;
    expect(y.alpha).toBeCloseTo(x.alpha * 252, 9); // alpha ∝ ppy
    expect(y.residualVol).toBeCloseTo(x.residualVol * Math.sqrt(252), 9); // vol ∝ √ppy
    expect(y.appraisal).toBeCloseTo(x.appraisal! * Math.sqrt(252), 9); // ratio ∝ √ppy
  });

  it('is negative when alpha is negative', () => {
    // same structure, drift −0.05.
    const s = computeAppraisal([0.15, -0.05, -0.05, -0.25], BENCH, 1)!;
    expect(s.alpha).toBeCloseTo(-0.05, 12);
    expect(s.residualVol).toBeCloseTo(0.1, 12);
    expect(s.appraisal).toBeCloseTo(-0.5, 12);
  });

  it('returns a null appraisal (but a defined alpha) when there is no residual risk', () => {
    // asset = 2·bench + 0.05, a perfect linear fit → residuals all zero.
    const s = computeAppraisal([0.05, 0.45, 0.05, 0.45], [0.0, 0.2, 0.0, 0.2], 1)!;
    expect(s.residualVol).toBeCloseTo(0, 12);
    expect(s.appraisal).toBeNull();
    expect(s.alpha).toBeCloseTo(0.05, 12);
  });

  it('returns null when beta is undefined (constant benchmark / too few points)', () => {
    expect(computeAppraisal([0.1, 0.2, 0.3], [0, 0, 0], 1)).toBeNull();
    expect(computeAppraisal([0.1], [0.1], 1)).toBeNull();
  });
});

describe('appraisalBoard / sortAppraisal', () => {
  // closes reconstructed from returns; toReturns recovers them.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 110, 99, 108.9, 98.01] }, // bench [0.1,-0.1,0.1,-0.1]
    { symbol: 'GOOD', closes: [100, 125, 131.25, 137.8125, 117.140625] }, // appraisal +0.5
    { symbol: 'BAD', closes: [100, 115, 109.25, 103.7875, 77.840625] }, // appraisal −0.5
    { symbol: 'PERFECT', closes: [100, 115, 97.75, 112.4125, 95.550625] }, // 1.5·bench → null
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('omits BTC, filters short series, ranks by appraisal desc, sinks null last', () => {
    const board = appraisalBoard(series, 'BTC/USDT', 1);
    expect(board.map((r) => r.symbol)).toEqual(['GOOD', 'BAD', 'PERFECT']);
    expect(board.find((r) => r.symbol === 'GOOD')!.appraisal).toBeCloseTo(0.5, 6);
    expect(board.find((r) => r.symbol === 'BAD')!.appraisal).toBeCloseTo(-0.5, 6);
    expect(board.find((r) => r.symbol === 'PERFECT')!.appraisal).toBeNull();
  });

  it('returns [] when the benchmark series is missing', () => {
    expect(appraisalBoard([{ symbol: 'X', closes: [100, 105, 110, 115] }], 'BTC/USDT', 1)).toEqual([]);
  });

  it('sorts by symbol and by residual vol', () => {
    const board = appraisalBoard(series, 'BTC/USDT', 1);
    expect(sortAppraisal(board, 'symbol').map((r) => r.symbol)).toEqual(['BAD', 'GOOD', 'PERFECT']);
    // GOOD & BAD carry residual risk (0.1); PERFECT has none → last.
    expect(sortAppraisal(board, 'residualVol')[2].symbol).toBe('PERFECT');
  });
});
