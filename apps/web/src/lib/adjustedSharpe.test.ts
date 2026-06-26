import { describe, it, expect } from 'vitest';
import { computeAdjustedSharpe, adjustedSharpeBoard, sortAdjustedSharpe } from './adjustedSharpe';

describe('computeAdjustedSharpe', () => {
  it('computes an exact symmetric case (skew 0, excess kurtosis −2)', () => {
    // returns [0.2,0,0.2,0]: mean 0.1, σ 0.1 → periodic SR 1; symmetric → skew 0;
    // standardized [1,-1,1,-1] → excess kurtosis −2. factor = 1 + 0 − (−2/24)·1² = 13/12.
    const r = computeAdjustedSharpe([100, 120, 120, 144, 144], 1)!;
    expect(r.skew).toBeCloseTo(0, 12);
    expect(r.exKurt).toBeCloseTo(-2, 12);
    expect(r.sharpe).toBeCloseTo(1, 12);
    expect(r.factor).toBeCloseTo(13 / 12, 12);
    expect(r.asr).toBeCloseTo(13 / 12, 12); // 1 × 13/12
    expect(r.n).toBe(4);
    // self-consistency: asr = sharpe × (1 + skew/6·SR − exKurt/24·SR²), SR = sharpe at ppy 1
    expect(r.asr).toBeCloseTo(r.sharpe * (1 + (r.skew / 6) * r.sharpe - (r.exKurt / 24) * r.sharpe ** 2), 12);
  });

  it('docks the Sharpe when returns are negatively skewed (fat left tail)', () => {
    // returns [0.1,0.1,0.1,-0.2]: one big down-move → left-skewed, positive mean.
    const r = computeAdjustedSharpe([100, 110, 121, 133.1, 106.48], 1)!;
    expect(r.skew).toBeLessThan(0);
    expect(r.factor).toBeLessThan(1);
    expect(r.asr).toBeLessThan(r.sharpe); // negative skew penalizes
    expect(r.asr).toBeGreaterThan(0);
  });

  it('annualizes the Sharpe and ASR by √ppy, leaving the shape factor unchanged', () => {
    const closes = [100, 120, 120, 144, 144];
    const x = computeAdjustedSharpe(closes, 1)!;
    const y = computeAdjustedSharpe(closes, 252)!;
    expect(y.skew).toBeCloseTo(x.skew, 12);
    expect(y.exKurt).toBeCloseTo(x.exKurt, 12);
    expect(y.factor).toBeCloseTo(x.factor, 12); // factor uses the periodic SR → ppy-invariant
    expect(y.sharpe).toBeCloseTo(x.sharpe * Math.sqrt(252), 9);
    expect(y.asr).toBeCloseTo(x.asr * Math.sqrt(252), 9);
  });

  it('returns null with fewer than three closes or zero volatility', () => {
    expect(computeAdjustedSharpe([100, 110], 1)).toBeNull();
    expect(computeAdjustedSharpe([100, 100, 100, 100], 1)).toBeNull(); // σ = 0
  });
});

describe('adjustedSharpeBoard / sortAdjustedSharpe', () => {
  const series = [
    { symbol: 'SYM', closes: [100, 120, 120, 144, 144] }, // asr 13/12
    { symbol: 'NEG', closes: [100, 110, 121, 133.1, 106.48] }, // negatively skewed
    { symbol: 'FLAT', closes: [100, 100, 100, 100] }, // σ = 0 → filtered out
    { symbol: 'SHORT', closes: [100, 110] }, // < 3 closes → filtered out
  ];

  it('filters degenerate/short series and ranks by ASR desc', () => {
    const board = adjustedSharpeBoard(series, 1);
    const syms = board.map((r) => r.symbol);
    expect(syms).toEqual(['SYM', 'NEG']); // FLAT & SHORT filtered; SYM asr > NEG asr
    const vals = board.map((r) => r.asr);
    for (let i = 1; i < vals.length; i++) expect(vals[i - 1]).toBeGreaterThanOrEqual(vals[i]);
  });

  it('sorts by symbol and by skew', () => {
    const board = adjustedSharpeBoard(series, 1);
    expect(sortAdjustedSharpe(board, 'symbol').map((r) => r.symbol)).toEqual(['NEG', 'SYM']);
    // SYM skew 0 > NEG skew (<0)
    expect(sortAdjustedSharpe(board, 'skew').map((r) => r.symbol)).toEqual(['SYM', 'NEG']);
  });
});
