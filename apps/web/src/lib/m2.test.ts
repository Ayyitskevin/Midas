import { describe, it, expect } from 'vitest';
import { computeM2, m2Board, sortM2 } from './m2';

// Benchmark returns: mean 0, per-period stdev 0.1.
const BENCH = [0.1, -0.1, 0.1, -0.1];

describe('computeM2', () => {
  it('computes an exact case — high-vol asset is de-levered to BTC risk', () => {
    // asset vol 0.2 (= 2× BTC's 0.1), mean 0.1 → Sharpe 0.5, M² = 0.1·(0.1/0.2) = 0.05.
    const s = computeM2([0.3, -0.1, 0.3, -0.1], BENCH, 1)!;
    expect(s.annReturn).toBeCloseTo(0.1, 12);
    expect(s.volAsset).toBeCloseTo(0.2, 12);
    expect(s.sharpe).toBeCloseTo(0.5, 12);
    expect(s.m2).toBeCloseTo(0.05, 12); // half the raw return — it ran at 2× BTC's risk
  });

  it('equals the raw return when the asset already carries BTC-equivalent vol', () => {
    // asset vol 0.1 (= BTC's), mean 0.05 → M² = annReturn.
    const s = computeM2([0.15, -0.05, 0.15, -0.05], BENCH, 1)!;
    expect(s.volAsset).toBeCloseTo(0.1, 12);
    expect(s.m2).toBeCloseTo(s.annReturn, 12);
    expect(s.m2).toBeCloseTo(0.05, 12);
  });

  it('levers a low-vol asset up to BTC risk', () => {
    // asset vol 0.05 (= half BTC's), mean 0.05 → M² = 0.05·(0.1/0.05) = 0.1.
    const s = computeM2([0.1, 0, 0.1, 0], BENCH, 1)!;
    expect(s.volAsset).toBeCloseTo(0.05, 12);
    expect(s.annReturn).toBeCloseTo(0.05, 12);
    expect(s.m2).toBeCloseTo(0.1, 12); // double the raw return — levered 2× to BTC's risk
  });

  it('annualizes M² by ppy and Sharpe by √ppy', () => {
    const a = [0.3, -0.1, 0.3, -0.1];
    const x = computeM2(a, BENCH, 1)!;
    const y = computeM2(a, BENCH, 252)!;
    expect(y.sharpe).toBeCloseTo(x.sharpe * Math.sqrt(252), 9);
    expect(y.annReturn).toBeCloseTo(x.annReturn * 252, 9);
    expect(y.volAsset).toBeCloseTo(x.volAsset * Math.sqrt(252), 9);
    expect(y.m2).toBeCloseTo(x.m2 * 252, 9); // M² is in return units → ∝ ppy
  });

  it('returns null when the asset has no variance or too few points', () => {
    expect(computeM2([0.1, 0.1, 0.1], BENCH, 1)).toBeNull(); // flat asset, sigma 0
    expect(computeM2([0.1], [0.1], 1)).toBeNull(); // < 2 points
  });
});

describe('m2Board / sortM2', () => {
  // closes reconstructed from returns; toReturns recovers them.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 110, 99, 108.9, 98.01] }, // bench, per-period sigma 0.1
    { symbol: 'MID', closes: [100, 110, 110, 121, 121] }, // sharpe 1, M² 0.1
    { symbol: 'HISHARPE', closes: [100, 115, 109.25, 125.6375, 119.355625] }, // sharpe 0.5, M² 0.05
    { symbol: 'LOSHARPE', closes: [100, 100, 90, 90, 81] }, // sharpe −1, M² −0.1
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('omits BTC, filters short series, ranks by M² desc', () => {
    const board = m2Board(series, 'BTC/USDT', 1);
    expect(board.map((r) => r.symbol)).toEqual(['MID', 'HISHARPE', 'LOSHARPE']);
    expect(board.find((r) => r.symbol === 'MID')!.m2).toBeCloseTo(0.1, 6);
    expect(board.find((r) => r.symbol === 'HISHARPE')!.m2).toBeCloseTo(0.05, 6);
    expect(board.find((r) => r.symbol === 'LOSHARPE')!.m2).toBeCloseTo(-0.1, 6);
  });

  it('ranks identically to Sharpe (M² is a monotone transform of it)', () => {
    const byM2 = m2Board(series, 'BTC/USDT', 1).map((r) => r.symbol);
    const bySharpe = sortM2(m2Board(series, 'BTC/USDT', 1), 'sharpe').map((r) => r.symbol);
    expect(byM2).toEqual(bySharpe);
  });

  it('returns [] when the benchmark series is missing', () => {
    expect(m2Board([{ symbol: 'X', closes: [100, 105, 110, 115] }], 'BTC/USDT', 1)).toEqual([]);
  });

  it('sorts by symbol', () => {
    const board = m2Board(series, 'BTC/USDT', 1);
    expect(sortM2(board, 'symbol').map((r) => r.symbol)).toEqual(['HISHARPE', 'LOSHARPE', 'MID']);
  });
});
