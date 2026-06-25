import { describe, it, expect } from 'vitest';
import { tangencyWeights, maxSharpe } from './maxSharpe';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('tangencyWeights', () => {
  it('weights ∝ excess/variance when uncorrelated', () => {
    // Σ = diag(0.04, 0.01), excess = (0.02, 0.01).
    // z = (0.02/0.04, 0.01/0.01) = (0.5, 1) → w = (1/3, 2/3).
    const w = tangencyWeights(
      [
        [0.04, 0],
        [0, 0.01],
      ],
      [0.02, 0.01],
    )!;
    expect(w[0]).toBeCloseTo(1 / 3, 12);
    expect(w[1]).toBeCloseTo(2 / 3, 12);
    expect(w[0] + w[1]).toBeCloseTo(1, 12);
  });

  it('matches the 2-asset closed form with correlation', () => {
    // Σ=[[0.04,0.01],[0.01,0.09]], excess=(0.03,0.02) → w=(5/6, 1/6).
    const w = tangencyWeights(
      [
        [0.04, 0.01],
        [0.01, 0.09],
      ],
      [0.03, 0.02],
    )!;
    expect(w[0]).toBeCloseTo(5 / 6, 12);
    expect(w[1]).toBeCloseTo(1 / 6, 12);
  });

  it('returns null when no positive-Sharpe tangent exists (excess ≤ 0)', () => {
    expect(
      tangencyWeights(
        [
          [0.04, 0],
          [0, 0.01],
        ],
        [-0.02, -0.01],
      ),
    ).toBeNull();
  });

  it('returns null for a singular covariance', () => {
    expect(
      tangencyWeights(
        [
          [0.04, 0.04],
          [0.04, 0.04],
        ],
        [0.03, 0.02],
      ),
    ).toBeNull();
  });
});

describe('maxSharpe', () => {
  // Positive-drift series so a tangency portfolio is well-defined.
  const a = fromReturns([0.02, -0.01, 0.03, -0.01, 0.02, 0.0, 0.01, 0.02]);
  const b = fromReturns([0.01, 0.0, 0.02, -0.01, 0.01, 0.01, 0.0, 0.01]);
  const c = fromReturns([0.03, -0.02, 0.01, 0.0, 0.02, -0.01, 0.02, 0.01]);

  it('maximizes Sharpe: tangency book beats equal-weight, weights sum to 1', () => {
    const r = maxSharpe([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'C', closes: c },
    ]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(3);
    const sum = r.rows.reduce((s, x) => s + x.weight, 0);
    expect(sum).toBeCloseTo(1, 9);
    // The tangency portfolio has the highest Sharpe among fully-invested books.
    expect(r.portSharpe).toBeGreaterThanOrEqual(r.equalSharpe - 1e-12);
    expect(r.rows[0].weight).toBeGreaterThanOrEqual(r.rows[1].weight);
  });

  it('computes per-asset Sharpe = meanRet / vol with rf = 0', () => {
    const r = maxSharpe([{ symbol: 'A', closes: a }]);
    expect(r.n).toBe(1);
    expect(r.rows[0].weight).toBeCloseTo(1, 9); // single positive-drift asset
    expect(r.rows[0].sharpe).toBeCloseTo(r.rows[0].meanRet / r.rows[0].vol, 12);
    expect(r.portSharpe).toBeCloseTo(r.rows[0].meanRet / r.rows[0].vol, 9);
  });

  it('applies the risk-free rate to per-asset Sharpe', () => {
    const rf = 0.005;
    const r = maxSharpe([{ symbol: 'A', closes: a }], rf);
    expect(r.rf).toBe(rf);
    expect(r.rows[0].sharpe).toBeCloseTo((r.rows[0].meanRet - rf) / r.rows[0].vol, 12);
  });

  it('aligns series to the common tail length', () => {
    const r = maxSharpe([
      { symbol: 'A', closes: a }, // 9 closes
      { symbol: 'B', closes: b.slice(b.length - 6) }, // 6 closes
    ]);
    expect(r.obs).toBe(5); // min length 6 → 5 returns
    expect(r.n).toBe(2);
  });

  it('drops flat and too-short series', () => {
    const r = maxSharpe([
      { symbol: 'A', closes: a },
      { symbol: 'FLAT', closes: [100, 100, 100, 100, 100] },
      { symbol: 'SHORT', closes: [100, 101] },
    ]);
    expect(r.n).toBe(1);
    expect(r.rows[0].symbol).toBe('A');
  });

  it('falls back to equal weights when Σ is singular', () => {
    // Identical series → singular covariance.
    const r = maxSharpe([
      { symbol: 'A', closes: a },
      { symbol: 'A2', closes: a },
    ]);
    expect(r.ok).toBe(false);
    expect(r.rows[0].weight).toBeCloseTo(0.5, 9);
    expect(r.rows[1].weight).toBeCloseTo(0.5, 9);
    // Fallback portfolio Sharpe equals the equal-weight Sharpe.
    expect(r.portSharpe).toBeCloseTo(r.equalSharpe, 9);
  });

  it('returns empty with no usable assets', () => {
    expect(maxSharpe([]).n).toBe(0);
    expect(maxSharpe([{ symbol: 'F', closes: [5, 5, 5] }]).rows).toHaveLength(0);
  });
});
