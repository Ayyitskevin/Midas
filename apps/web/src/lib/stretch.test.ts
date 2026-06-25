import { describe, it, expect } from 'vitest';
import { computeStretch, stretchBoard } from './stretch';

const SQRT2 = Math.SQRT2;

describe('computeStretch', () => {
  it('computes z-score, %B and distance over the window', () => {
    const r = computeStretch([1, 2, 3, 4, 5], 5)!;
    expect(r).not.toBeNull();
    expect(r.ma).toBeCloseTo(3, 10);
    expect(r.last).toBe(5);
    expect(r.zscore).toBeCloseTo(SQRT2, 10); // 2 / sqrt(2)
    expect(r.percentB).toBeCloseTo((SQRT2 + 2) / 4, 10);
    expect(r.distancePct).toBeCloseTo(66.6667, 3);
    expect(r.label).toBe('neutral');
    expect(r.n).toBe(5);
  });

  it('flags an overbought stretch at the upper band', () => {
    const r = computeStretch([0, 0, 0, 0, 1], 5)!;
    expect(r.zscore).toBeCloseTo(2, 10);
    expect(r.percentB).toBeCloseTo(1, 10);
    expect(r.label).toBe('overbought');
    expect(r.distancePct).toBeCloseTo(400, 10);
  });

  it('flags an oversold stretch at the lower band', () => {
    const r = computeStretch([1, 1, 1, 1, 0], 5)!;
    expect(r.zscore).toBeCloseTo(-2, 10);
    expect(r.percentB).toBeCloseTo(0, 10);
    expect(r.label).toBe('oversold');
  });

  it('sits on the MA when the window is flat', () => {
    const r = computeStretch([5, 5, 5, 5, 5], 5)!;
    expect(r.zscore).toBe(0);
    expect(r.percentB).toBe(0.5);
    expect(r.distancePct).toBe(0);
    expect(r.label).toBe('neutral');
  });

  it('uses only the trailing window', () => {
    const r = computeStretch([100, 100, 100, 1, 2, 3, 4, 5], 5)!;
    expect(r.ma).toBeCloseTo(3, 10);
    expect(r.last).toBe(5);
  });

  it('returns null when it cannot fill the window', () => {
    expect(computeStretch([1, 2], 5)).toBeNull();
    expect(computeStretch([1, 2, 3], 1)).toBeNull();
    expect(computeStretch([], 5)).toBeNull();
    expect(computeStretch([1, 2, 3, 4, 5], 5, 0)).toBeNull();
  });
});

describe('stretchBoard', () => {
  it('builds and sorts rows, dropping series too short for the window', () => {
    const board = stretchBoard(
      [
        { symbol: 'A', closes: [0, 0, 0, 0, 1] }, // z +2
        { symbol: 'B', closes: [1, 2, 3, 4, 5] }, // z +1.41
        { symbol: 'C', closes: [1, 1, 1, 1, 0] }, // z −2
        { symbol: 'D', closes: [1, 2] }, // too short
      ],
      5,
      'zscore',
    );
    expect(board.map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('sorts alphabetically by symbol on request', () => {
    const board = stretchBoard(
      [
        { symbol: 'SOL', closes: [1, 2, 3, 4, 5] },
        { symbol: 'BTC', closes: [5, 4, 3, 2, 1] },
      ],
      5,
      'symbol',
    );
    expect(board.map((r) => r.symbol)).toEqual(['BTC', 'SOL']);
  });
});
