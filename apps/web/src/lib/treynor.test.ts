import { describe, it, expect } from 'vitest';
import { computeTreynor, treynorBoard, sortTreynor } from './treynor';

// Benchmark returns used throughout: mean 0, non-constant.
const BENCH = [0.1, -0.1, 0.1, -0.1];

describe('computeTreynor', () => {
  it('computes an exact clean case (beta 2, ann 0.1 → Treynor 0.05)', () => {
    // asset = bench·2 + a 0.1 drift: returns [0.3,-0.1,0.3,-0.1], mean 0.1, beta 2.
    const s = computeTreynor([0.3, -0.1, 0.3, -0.1], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(2, 10);
    expect(s.annReturn).toBeCloseTo(0.1, 12);
    expect(s.treynor).toBeCloseTo(0.05, 12); // 0.1 ÷ 2
  });

  it('reduces to the annualized return when beta = 1 (asset ≡ benchmark)', () => {
    const c = [0.1, -0.05, 0.2, -0.1];
    const s = computeTreynor(c, c, 1)!;
    expect(s.beta).toBeCloseTo(1, 10);
    expect(s.treynor).toBeCloseTo(s.annReturn, 12);
  });

  it('scales annReturn and Treynor linearly with periods/year, beta unchanged', () => {
    const a = [0.3, -0.1, 0.3, -0.1];
    const x = computeTreynor(a, BENCH, 1)!;
    const y = computeTreynor(a, BENCH, 252)!;
    expect(y.beta).toBeCloseTo(x.beta, 12);
    expect(y.annReturn).toBeCloseTo(x.annReturn * 252, 9);
    expect(y.treynor).toBeCloseTo(x.treynor! * 252, 9);
  });

  it('returns a null Treynor (not a huge number) when beta is ~0, despite a positive return', () => {
    // asset uncorrelated with bench: (a−mean)·(b−mean) cancels → beta 0, mean 0.1.
    const s = computeTreynor([0.2, 0.2, 0.0, 0.0], BENCH, 1)!;
    expect(s.beta).toBeCloseTo(0, 10);
    expect(s.annReturn).toBeCloseTo(0.1, 12);
    expect(s.treynor).toBeNull();
  });

  it('returns null when beta is undefined (constant benchmark / too few points)', () => {
    expect(computeTreynor([0.1, 0.2, 0.3], [0, 0, 0], 1)).toBeNull(); // flat bench, var 0
    expect(computeTreynor([0.1], [0.1], 1)).toBeNull(); // < 2 points
  });
});

describe('treynorBoard / sortTreynor', () => {
  // closes reconstructed from returns; toReturns recovers them.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 110, 99, 108.9, 98.01] }, // bench: [0.1,-0.1,0.1,-0.1]
    { symbol: 'WIN', closes: [100, 130, 117, 152.1, 136.89] }, // beta 2, ann 0.1 → Treynor 0.05
    { symbol: 'LOWBETA', closes: [100, 120, 120, 144, 144] }, // beta 1, ann 0.1 → Treynor 0.10
    { symbol: 'ZERO', closes: [100, 110, 121, 108.9, 98.01] }, // beta 0 → Treynor null
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('omits BTC, filters short series, ranks by Treynor desc, sinks null last', () => {
    const board = treynorBoard(series, 'BTC/USDT', 1);
    // same 0.1 return, but LOWBETA carries half the market risk → ranks above WIN.
    expect(board.map((r) => r.symbol)).toEqual(['LOWBETA', 'WIN', 'ZERO']);
    expect(board.find((r) => r.symbol === 'WIN')!.beta).toBeCloseTo(2, 6);
    expect(board.find((r) => r.symbol === 'WIN')!.treynor).toBeCloseTo(0.05, 6);
    expect(board.find((r) => r.symbol === 'LOWBETA')!.treynor).toBeCloseTo(0.1, 6);
    expect(board.find((r) => r.symbol === 'ZERO')!.treynor).toBeNull();
  });

  it('returns [] when the benchmark series is missing', () => {
    const board = treynorBoard(
      [
        { symbol: 'WIN', closes: [100, 130, 117, 152.1] },
        { symbol: 'X', closes: [100, 110, 120, 130] },
      ],
      'BTC/USDT',
      1,
    );
    expect(board).toEqual([]);
  });

  it('sorts by symbol and by beta', () => {
    const board = treynorBoard(series, 'BTC/USDT', 1);
    expect(sortTreynor(board, 'symbol').map((r) => r.symbol)).toEqual(['LOWBETA', 'WIN', 'ZERO']);
    expect(sortTreynor(board, 'beta').map((r) => r.symbol)).toEqual(['WIN', 'LOWBETA', 'ZERO']);
  });
});
