import { describe, it, expect } from 'vitest';
import { rollingVol, computeVov, vovBoard, sortVov } from './volOfVol';
import { mean, stdev } from './distribution';

describe('rollingVol', () => {
  it('is the population stdev of returns over each trailing window (anchored)', () => {
    // returns [0.1,0.3,0.2,0.4]; window 2, ppy 1 → stdev of each pair = |a−b|/2.
    const v = rollingVol([100, 110, 143, 171.6, 240.24], 2, 1);
    expect(v).toHaveLength(3);
    expect(v[0]).toBeCloseTo(0.1, 6); // |0.1−0.3|/2
    expect(v[1]).toBeCloseTo(0.05, 6); // |0.3−0.2|/2
    expect(v[2]).toBeCloseTo(0.1, 6); // |0.2−0.4|/2
  });

  it('is empty when the window cannot be filled', () => {
    expect(rollingVol([100, 110, 121], 5, 1)).toEqual([]);
  });
});

describe('computeVov', () => {
  it('reduces the rolling-vol series to its coefficient of variation', () => {
    const closes = [100, 110, 143, 171.6, 240.24];
    const series = rollingVol(closes, 2, 1); // ≈ [0.1, 0.05, 0.1]
    const r = computeVov(closes, 2, 1)!;
    expect(r.n).toBe(3);
    expect(r.meanVol).toBeCloseTo(mean(series), 9);
    expect(r.volOfVol).toBeCloseTo(stdev(series), 9);
    expect(r.vov).toBeCloseTo(stdev(series) / mean(series), 9);
    expect(r.current).toBeCloseTo(series[series.length - 1], 9);
  });

  it('keeps the vov (a ratio of vols) invariant to the annualization factor', () => {
    const closes = [100, 110, 143, 171.6, 240.24];
    const x = computeVov(closes, 2, 1)!;
    const y = computeVov(closes, 2, 252)!;
    expect(y.vov).toBeCloseTo(x.vov!, 9); // CV is unit-free
    expect(y.meanVol).toBeCloseTo(x.meanVol * Math.sqrt(252), 9); // levels still annualize
  });

  it('returns null with a flat series or too few windows', () => {
    expect(computeVov([100, 200, 400, 800, 1600], 2, 1)!.vov).toBeNull(); // constant returns → 0 vol
    expect(computeVov([100, 110, 121], 2, 1)).toBeNull(); // only 1 window
  });
});

describe('vovBoard / sortVov', () => {
  const series = [
    { symbol: 'STEADY', closes: [100, 200, 400, 800, 1600] }, // constant +100% (exact) → 0 vol → vov null
    { symbol: 'WILD', closes: [100, 110, 143, 171.6, 240.24] }, // varying vol → finite vov
    { symbol: 'CALM', closes: [100, 102, 104.04, 105.0804, 107.182] }, // mild, varied
    { symbol: 'SHORT', closes: [100, 110] }, // too few closes → filtered out
  ];

  it('filters short series, ranks by vov desc, sinks null vov last', () => {
    const board = vovBoard(series, 2, 365);
    expect(board.map((r) => r.symbol)).not.toContain('SHORT');
    expect(board[board.length - 1].symbol).toBe('STEADY'); // null vov sinks
    const finite = board.filter((r) => r.vov != null).map((r) => r.vov!);
    for (let i = 1; i < finite.length; i++) expect(finite[i - 1]).toBeGreaterThanOrEqual(finite[i]);
  });

  it('sorts by symbol', () => {
    const board = vovBoard(series, 2, 365);
    expect(sortVov(board, 'symbol').map((r) => r.symbol)).toEqual(['CALM', 'STEADY', 'WILD']);
  });
});
