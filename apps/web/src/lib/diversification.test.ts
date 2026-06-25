import { describe, it, expect } from 'vitest';
import { divRatio, diversification } from './diversification';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('divRatio', () => {
  it('is √2 for two uncorrelated, equal-risk names', () => {
    const d = divRatio(
      [0.5, 0.5],
      [0.2, 0.2],
      [
        [0.04, 0],
        [0, 0.04],
      ],
    )!;
    expect(d.weightedAvgVol).toBeCloseTo(0.2, 12);
    expect(d.portVol).toBeCloseTo(Math.sqrt(0.02), 12);
    expect(d.ratio).toBeCloseTo(Math.SQRT2, 12); // ≈ 2 effective bets
  });

  it('is 1 when the names are perfectly correlated', () => {
    const d = divRatio(
      [0.5, 0.5],
      [0.2, 0.2],
      [
        [0.04, 0.04],
        [0.04, 0.04],
      ],
    )!;
    expect(d.ratio).toBeCloseTo(1, 12);
  });

  it('sits between for a partial correlation', () => {
    // corr 0.5 → portVar 0.03 → DR = √(0.04/0.03).
    const d = divRatio(
      [0.5, 0.5],
      [0.2, 0.2],
      [
        [0.04, 0.02],
        [0.02, 0.04],
      ],
    )!;
    expect(d.ratio).toBeCloseTo(Math.sqrt(0.04 / 0.03), 12);
    expect(d.ratio).toBeGreaterThan(1);
    expect(d.ratio).toBeLessThan(Math.SQRT2);
  });

  it('is 1 for a single asset', () => {
    const d = divRatio([1], [0.2], [[0.04]])!;
    expect(d.ratio).toBeCloseTo(1, 12);
  });

  it('returns null on a dimension mismatch or a riskless book', () => {
    expect(divRatio([0.5, 0.5], [0.2], [[0.04]])).toBeNull();
    expect(divRatio([1], [0], [[0]])).toBeNull();
  });
});

describe('diversification', () => {
  const a = fromReturns([0.02, -0.01, 0.03, -0.02, 0.01, -0.01, 0.02, 0.0]);
  const b = fromReturns([-0.01, 0.02, -0.02, 0.01, 0.0, 0.02, -0.01, 0.01]);
  const c = fromReturns([0.03, -0.02, 0.01, 0.0, -0.01, 0.02, 0.01, -0.02]);

  it('scores the equal-weight book with DR ≥ 1 and effective bets = DR²', () => {
    const r = diversification([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'C', closes: c },
    ]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(3);
    expect(r.divRatio!).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(r.effectiveBets!).toBeCloseTo(r.divRatio! * r.divRatio!, 12);
    expect(r.divRatio).toBeCloseTo(r.weightedAvgVol / r.portVol, 12);
    // Equal weights, and assets sorted by volatility descending.
    expect(r.assets.every((x) => Math.abs(x.weight - 1 / 3) < 1e-12)).toBe(true);
    expect(r.assets[0].vol).toBeGreaterThanOrEqual(r.assets[1].vol);
  });

  it('collapses to DR ≈ 1 when the book is perfectly correlated (duplicate names)', () => {
    const r = diversification([
      { symbol: 'A', closes: a },
      { symbol: 'A2', closes: a },
    ]);
    expect(r.divRatio).toBeCloseTo(1, 9);
    expect(r.effectiveBets).toBeCloseTo(1, 9);
  });

  it('is DR 1 for a single usable name', () => {
    const r = diversification([{ symbol: 'A', closes: a }]);
    expect(r.n).toBe(1);
    expect(r.divRatio).toBeCloseTo(1, 12);
  });

  it('aligns series to the common tail length', () => {
    const r = diversification([
      { symbol: 'A', closes: a }, // 9 closes
      { symbol: 'B', closes: b.slice(b.length - 6) }, // 6 closes
    ]);
    expect(r.obs).toBe(5); // min length 6 → 5 returns
    expect(r.n).toBe(2);
  });

  it('drops flat and too-short series', () => {
    const r = diversification([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'FLAT', closes: [100, 100, 100, 100, 100] },
      { symbol: 'SHORT', closes: [100, 101] },
    ]);
    expect(r.n).toBe(2);
    expect(r.assets.map((x) => x.symbol).sort()).toEqual(['A', 'B']);
  });

  it('returns empty with no usable names', () => {
    expect(diversification([]).ok).toBe(false);
    expect(diversification([{ symbol: 'F', closes: [5, 5, 5] }]).ok).toBe(false);
  });
});
