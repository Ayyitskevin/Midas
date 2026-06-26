import { describe, it, expect } from 'vitest';
import {
  computeSharpeStability,
  sharpeStabilityBoard,
  sortSharpeStability,
} from './sharpeStability';
import { rollingSharpe } from './rollingSharpe';
import { stdev } from './distribution';

describe('computeSharpeStability', () => {
  it('reduces the rolling-Sharpe series to mean ÷ stdev (anchored case)', () => {
    // returns [0.1,0.3,0.2,0.4]; window 2, ppy 1 → rolling Sharpes [2,5,3].
    const closes = [100, 110, 143, 171.6, 240.24];
    const rs = rollingSharpe(closes, closes.map((_, i) => i), 2, 1);
    expect(rs.points.map((p) => p.sharpe)).toHaveLength(3);
    expect(rs.points[0].sharpe).toBeCloseTo(2, 6);
    expect(rs.points[1].sharpe).toBeCloseTo(5, 6);
    expect(rs.points[2].sharpe).toBeCloseTo(3, 6);

    const r = computeSharpeStability(closes, 2, 1)!;
    expect(r.n).toBe(3);
    expect(r.avgSharpe).toBeCloseTo((2 + 5 + 3) / 3, 6); // 10/3
    expect(r.current).toBeCloseTo(3, 6); // last window [0.2,0.4]
    expect(r.sdSharpe).toBeCloseTo(stdev([2, 5, 3]), 6);
    expect(r.stability).toBeCloseTo(10 / 3 / stdev([2, 5, 3]), 6);
  });

  it('returns null with fewer than two rolling windows', () => {
    expect(computeSharpeStability([100, 110, 121], 2, 1)).toBeNull(); // 1 window
    expect(computeSharpeStability([100, 110, 121, 133], 10, 1)).toBeNull(); // window can't fill
  });

  it('has a null stability when the rolling Sharpe never varies (steady compounder)', () => {
    // constant +100% return (exact powers of two) ⇒ each window σ=0 ⇒ rolling
    // Sharpe 0 everywhere ⇒ zero dispersion ⇒ stability undefined.
    const r = computeSharpeStability([100, 200, 400, 800, 1600], 2, 1)!;
    expect(r.avgSharpe).toBe(0);
    expect(r.sdSharpe).toBe(0);
    expect(r.stability).toBeNull();
  });
});

describe('sharpeStabilityBoard / sortSharpeStability', () => {
  const series = [
    { symbol: 'A', closes: [100, 110, 143, 171.6, 240.24] },
    { symbol: 'B', closes: [100, 108, 130, 150, 198] },
    { symbol: 'FLAT', closes: [100, 200, 400, 800, 1600] }, // steady compounder (exact) → stability null
    { symbol: 'SHORT', closes: [100, 110, 121] }, // 1 window → filtered out entirely
  ];

  it('filters too-short series, keeps null-stability rows but sinks them last', () => {
    const board = sharpeStabilityBoard(series, 2, 1);
    const syms = board.map((r) => r.symbol);
    expect(syms).toContain('A');
    expect(syms).toContain('B');
    expect(syms).toContain('FLAT');
    expect(syms).not.toContain('SHORT'); // < 2 windows → null → not in board
    expect(board[board.length - 1].symbol).toBe('FLAT'); // null stability sinks
    // non-null stabilities are in descending order
    const vals = board.filter((r) => r.stability != null).map((r) => r.stability!);
    for (let i = 1; i < vals.length; i++) {
      expect(vals[i - 1]).toBeGreaterThanOrEqual(vals[i]);
    }
  });

  it('sorts by symbol and by stdev (steadiest first)', () => {
    const board = sharpeStabilityBoard(series, 2, 1);
    expect(sortSharpeStability(board, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'FLAT']);
    const bySd = sortSharpeStability(board, 'sdSharpe');
    for (let i = 1; i < bySd.length; i++) {
      expect(bySd[i - 1].sdSharpe).toBeLessThanOrEqual(bySd[i].sdSharpe);
    }
  });
});
