import { describe, it, expect } from 'vitest';
import {
  invertMatrix,
  covarianceMatrix,
  gmvWeights,
  portfolioVariance,
  minVariance,
} from './minVariance';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

/** Multiply two matrices (for round-trip checks). */
const matmul = (a: number[][], b: number[][]): number[][] =>
  a.map((row) => b[0].map((_, j) => row.reduce((s, x, k) => s + x * b[k][j], 0)));

describe('invertMatrix', () => {
  it('inverts a known 2x2', () => {
    // [[4,7],[2,6]] has det 10 → inverse (1/10)[[6,-7],[-2,4]].
    const inv = invertMatrix([
      [4, 7],
      [2, 6],
    ])!;
    expect(inv[0][0]).toBeCloseTo(0.6, 12);
    expect(inv[0][1]).toBeCloseTo(-0.7, 12);
    expect(inv[1][0]).toBeCloseTo(-0.2, 12);
    expect(inv[1][1]).toBeCloseTo(0.4, 12);
  });

  it('inverts a diagonal 3x3 to reciprocals', () => {
    const inv = invertMatrix([
      [2, 0, 0],
      [0, 4, 0],
      [0, 0, 5],
    ])!;
    expect(inv[0][0]).toBeCloseTo(0.5, 12);
    expect(inv[1][1]).toBeCloseTo(0.25, 12);
    expect(inv[2][2]).toBeCloseTo(0.2, 12);
    expect(inv[0][1]).toBe(0);
  });

  it('round-trips M·M⁻¹ ≈ I for a non-trivial matrix needing a pivot swap', () => {
    // Leading entry is 0, forcing partial pivoting.
    const m = [
      [0, 2, 1],
      [1, 1, 1],
      [2, 1, 3],
    ];
    const inv = invertMatrix(m)!;
    const id = matmul(m, inv);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) expect(id[i][j]).toBeCloseTo(i === j ? 1 : 0, 10);
    }
  });

  it('is scale-invariant up to the inverse scale (tiny covariance-sized entries)', () => {
    const small = [
      [4e-4, 1e-4],
      [1e-4, 9e-4],
    ];
    const inv = invertMatrix(small)!;
    const id = matmul(small, inv);
    expect(id[0][0]).toBeCloseTo(1, 9);
    expect(id[1][1]).toBeCloseTo(1, 9);
    expect(id[0][1]).toBeCloseTo(0, 9);
  });

  it('returns null for a singular matrix', () => {
    expect(
      invertMatrix([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });

  it('returns null for empty or all-zero matrices', () => {
    expect(invertMatrix([])).toBeNull();
    expect(
      invertMatrix([
        [0, 0],
        [0, 0],
      ]),
    ).toBeNull();
  });
});

describe('covarianceMatrix', () => {
  it('computes population covariance and is symmetric', () => {
    // A=[-1,0,1] mean 0, B=[-1,1,0] mean 0.
    const cov = covarianceMatrix([
      [-1, 0, 1],
      [-1, 1, 0],
    ]);
    expect(cov[0][0]).toBeCloseTo(2 / 3, 12); // var A
    expect(cov[1][1]).toBeCloseTo(2 / 3, 12); // var B
    expect(cov[0][1]).toBeCloseTo(1 / 3, 12); // cov(A,B) = (1+0+0)/3
    expect(cov[0][1]).toBe(cov[1][0]);
  });
});

describe('portfolioVariance', () => {
  it('evaluates wᵀΣw', () => {
    const cov = [
      [0.04, 0.0],
      [0.0, 0.09],
    ];
    // equal-weight: 0.25*0.04 + 0.25*0.09 = 0.0325
    expect(portfolioVariance(cov, [0.5, 0.5])).toBeCloseTo(0.0325, 12);
    // all in asset 1 → its own variance
    expect(portfolioVariance(cov, [1, 0])).toBeCloseTo(0.04, 12);
  });

  it('clamps tiny negative undershoot to zero', () => {
    expect(portfolioVariance([[0]], [0])).toBe(0);
  });
});

describe('gmvWeights', () => {
  it('reduces to inverse-variance weights when uncorrelated', () => {
    // Σ = diag(0.04, 0.01) → w ∝ (1/0.04, 1/0.01) = (25, 100) → (0.2, 0.8).
    const w = gmvWeights([
      [0.04, 0],
      [0, 0.01],
    ])!;
    expect(w[0]).toBeCloseTo(0.2, 12);
    expect(w[1]).toBeCloseTo(0.8, 12);
    expect(w[0] + w[1]).toBeCloseTo(1, 12);
  });

  it('matches the 2-asset closed form with correlation', () => {
    // σ1²=0.04, σ2²=0.09, σ12=0.01.
    // w1 = (σ2² - σ12)/(σ1² + σ2² - 2σ12) = 0.08/0.11.
    const w = gmvWeights([
      [0.04, 0.01],
      [0.01, 0.09],
    ])!;
    expect(w[0]).toBeCloseTo(0.08 / 0.11, 12);
    expect(w[1]).toBeCloseTo(0.03 / 0.11, 12);
  });

  it('splits 50/50 when variances are equal regardless of correlation', () => {
    const w = gmvWeights([
      [0.04, 0.02],
      [0.02, 0.04],
    ])!;
    expect(w[0]).toBeCloseTo(0.5, 12);
    expect(w[1]).toBeCloseTo(0.5, 12);
  });

  it('produces a short leg (negative weight) for a dominated asset', () => {
    // Asset 2 is high-variance and highly correlated → GMV shorts it.
    const w = gmvWeights([
      [0.04, 0.075],
      [0.075, 0.16],
    ])!;
    expect(w[0] + w[1]).toBeCloseTo(1, 12);
    expect(w[1]).toBeLessThan(0);
    expect(w[0]).toBeGreaterThan(1);
  });

  it('returns null for a singular covariance', () => {
    expect(
      gmvWeights([
        [0.04, 0.04],
        [0.04, 0.04],
      ]),
    ).toBeNull();
  });
});

describe('minVariance', () => {
  const a = fromReturns([0.01, -0.01, 0.02, -0.02, 0.01, -0.01, 0.0, 0.01]);
  const b = fromReturns([-0.02, 0.02, -0.01, 0.03, -0.02, 0.01, 0.01, -0.01]);
  const c = fromReturns([0.03, -0.03, 0.01, -0.01, 0.02, -0.02, 0.01, 0.0]);

  it('returns fully-invested weights with the lowest variance', () => {
    const r = minVariance([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'C', closes: c },
    ]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(3);
    const sum = r.rows.reduce((s, x) => s + x.weight, 0);
    expect(sum).toBeCloseTo(1, 9);
    // The minimum-variance book is by definition no worse than equal-weight or
    // inverse-vol on variance.
    expect(r.portVol).toBeLessThanOrEqual(r.equalVol + 1e-12);
    expect(r.portVol).toBeLessThanOrEqual(r.invVolVol + 1e-12);
    // Rows are sorted by weight descending.
    expect(r.rows[0].weight).toBeGreaterThanOrEqual(r.rows[1].weight);
  });

  it('aligns series to the common tail length', () => {
    const r = minVariance([
      { symbol: 'A', closes: a }, // 9 closes
      { symbol: 'B', closes: b.slice(b.length - 6) }, // 6 closes
    ]);
    expect(r.obs).toBe(5); // min length 6 → 5 returns
    expect(r.n).toBe(2);
  });

  it('drops flat and too-short series', () => {
    const r = minVariance([
      { symbol: 'A', closes: a },
      { symbol: 'FLAT', closes: [100, 100, 100, 100, 100] },
      { symbol: 'SHORT', closes: [100, 101] },
    ]);
    expect(r.n).toBe(1);
    expect(r.rows[0].symbol).toBe('A');
    expect(r.rows[0].weight).toBeCloseTo(1, 9);
  });

  it('keeps the hasShort flag consistent with the row weights', () => {
    const r = minVariance([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'C', closes: c },
    ]);
    expect(r.hasShort).toBe(r.rows.some((row) => row.weight < 0));
  });

  it('falls back to inverse-vol weights when Σ is singular', () => {
    // Identical series → singular covariance; degrade gracefully.
    const r = minVariance([
      { symbol: 'A', closes: a },
      { symbol: 'A2', closes: a },
    ]);
    expect(r.ok).toBe(false);
    expect(r.n).toBe(2);
    // Inverse-vol of two equal-vol names → 50/50.
    expect(r.rows[0].weight).toBeCloseTo(0.5, 9);
    expect(r.rows[1].weight).toBeCloseTo(0.5, 9);
  });

  it('returns empty with no usable assets', () => {
    expect(minVariance([]).n).toBe(0);
    expect(minVariance([{ symbol: 'F', closes: [5, 5, 5] }]).rows).toHaveLength(0);
  });
});
