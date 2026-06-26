import { describe, it, expect } from 'vitest';
import { computeAlpha, alphaBoard, sortAlpha } from './alpha';

// Benchmark returns: mean 0.1, non-constant. Used throughout.
const BENCH = [0.0, 0.2, 0.0, 0.2];

describe('computeAlpha', () => {
  it('computes an exact clean case (beta 2, ann 0.25, bench 0.1 → alpha 0.05)', () => {
    // asset = 2·bench + 0.05 drift each period: the drift IS the alpha.
    const s = computeAlpha([0.05, 0.45, 0.05, 0.45], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(2, 10);
    expect(s.annReturn).toBeCloseTo(0.25, 12);
    expect(s.benchReturn).toBeCloseTo(0.1, 12);
    expect(s.alpha).toBeCloseTo(0.05, 12); // 0.25 − 2·0.1
  });

  it('is zero when the asset is exactly beta·benchmark (return fully explained)', () => {
    // asset = 1.5·bench, no excess → alpha 0.
    const s = computeAlpha([0.0, 0.3, 0.0, 0.3], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(1.5, 10);
    expect(s.alpha).toBeCloseTo(0, 10);
  });

  it('is negative when the asset lags its beta-predicted return', () => {
    // asset = 2·bench − 0.05 drift.
    const s = computeAlpha([-0.05, 0.35, -0.05, 0.35], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(2, 10);
    expect(s.alpha).toBeCloseTo(-0.05, 10);
  });

  it('scales alpha / returns linearly with periods/year, beta unchanged', () => {
    const a = [0.05, 0.45, 0.05, 0.45];
    const x = computeAlpha(a, BENCH, 1)!;
    const y = computeAlpha(a, BENCH, 252)!;
    expect(y.beta).toBeCloseTo(x.beta, 12);
    expect(y.alpha).toBeCloseTo(x.alpha * 252, 9);
    expect(y.annReturn).toBeCloseTo(x.annReturn * 252, 9);
    expect(y.benchReturn).toBeCloseTo(x.benchReturn * 252, 9);
  });

  it('returns null when beta is undefined (constant benchmark / too few points)', () => {
    expect(computeAlpha([0.1, 0.2, 0.3], [0, 0, 0], 1)).toBeNull(); // flat bench, var 0
    expect(computeAlpha([0.1], [0.1], 1)).toBeNull(); // < 2 points
  });
});

describe('alphaBoard / sortAlpha', () => {
  // closes reconstructed from returns; toReturns recovers them.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 100, 120, 120, 144] }, // bench: [0,0.2,0,0.2]
    { symbol: 'HIGH', closes: [100, 105, 152.25, 159.8625, 231.800625] }, // alpha 0.05, beta 2
    { symbol: 'ZEROALPHA', closes: [100, 100, 120, 120, 144] }, // ≡ BTC path → beta 1, alpha 0
    { symbol: 'NEG', closes: [100, 95, 118.75, 112.8125, 141.015625] }, // alpha −0.05, beta 1.5
    { symbol: 'SHORT', closes: [100, 100] }, // < 3 closes → filtered out
  ];

  it('omits BTC, filters short series, ranks by alpha desc', () => {
    const board = alphaBoard(series, 'BTC/USDT', 1);
    expect(board.map((r) => r.symbol)).toEqual(['HIGH', 'ZEROALPHA', 'NEG']);
    expect(board.find((r) => r.symbol === 'HIGH')!.alpha).toBeCloseTo(0.05, 6);
    expect(board.find((r) => r.symbol === 'HIGH')!.beta).toBeCloseTo(2, 6);
    expect(board.find((r) => r.symbol === 'ZEROALPHA')!.alpha).toBeCloseTo(0, 6);
    expect(board.find((r) => r.symbol === 'NEG')!.alpha).toBeCloseTo(-0.05, 6);
    // every row shares the same annualized benchmark return (0.1)
    expect(board.every((r) => Math.abs(r.benchReturn - 0.1) < 1e-9)).toBe(true);
  });

  it('returns [] when the benchmark series is missing', () => {
    expect(alphaBoard([{ symbol: 'X', closes: [100, 105, 110, 115] }], 'BTC/USDT', 1)).toEqual([]);
  });

  it('sorts by symbol and by beta', () => {
    const board = alphaBoard(series, 'BTC/USDT', 1);
    expect(sortAlpha(board, 'symbol').map((r) => r.symbol)).toEqual(['HIGH', 'NEG', 'ZEROALPHA']);
    // beta: HIGH 2 > NEG 1.5 > ZEROALPHA 1
    expect(sortAlpha(board, 'beta').map((r) => r.symbol)).toEqual(['HIGH', 'NEG', 'ZEROALPHA']);
  });
});
