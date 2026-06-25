import { describe, it, expect } from 'vitest';
import { frontierStats, frontierVol, frontier } from './frontier';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('frontierStats / frontierVol', () => {
  // Σ = diag(0.04, 0.01), μ = (0.01, 0.02).
  // A = 25 + 100 = 125; B = 0.25 + 2 = 2.25; C = 0.0025 + 0.04 = 0.0425;
  // D = 125·0.0425 − 2.25² = 5.3125 − 5.0625 = 0.25.
  const cov = [
    [0.04, 0],
    [0, 0.01],
  ];
  const mu = [0.01, 0.02];

  it('computes the A,B,C,D scalars from Σ⁻¹', () => {
    const st = frontierStats(cov, mu)!;
    expect(st.A).toBeCloseTo(125, 9);
    expect(st.B).toBeCloseTo(2.25, 9);
    expect(st.C).toBeCloseTo(0.0425, 9);
    expect(st.D).toBeCloseTo(0.25, 9);
  });

  it('frontier vol at the GMV return equals the GMV vol and is the minimum', () => {
    const st = frontierStats(cov, mu)!;
    const gmvRet = st.B / st.A; // 0.018
    const gmvVol = Math.sqrt(1 / st.A); // √0.008
    expect(gmvRet).toBeCloseTo(0.018, 12);
    expect(frontierVol(st, gmvRet)).toBeCloseTo(gmvVol, 12);
    // Any other target return has strictly larger volatility.
    expect(frontierVol(st, 0.03)).toBeGreaterThan(gmvVol);
    expect(frontierVol(st, 0.005)).toBeGreaterThan(gmvVol);
  });

  it('returns D ≈ 0 when all mean returns are equal (degenerate frontier)', () => {
    const st = frontierStats(cov, [0.01, 0.01])!;
    expect(Math.abs(st.D)).toBeLessThan(1e-9);
  });

  it('returns null for a singular covariance', () => {
    expect(
      frontierStats(
        [
          [0.04, 0.04],
          [0.04, 0.04],
        ],
        mu,
      ),
    ).toBeNull();
  });
});

describe('frontier', () => {
  // Positive-drift series with distinct means so the frontier is non-degenerate.
  const a = fromReturns([0.03, -0.01, 0.02, 0.01, 0.02, -0.01, 0.03, 0.0]);
  const b = fromReturns([0.0, 0.01, -0.01, 0.02, 0.0, 0.01, 0.0, 0.01]);
  const c = fromReturns([0.02, -0.02, 0.01, 0.03, -0.01, 0.02, 0.0, 0.01]);

  it('builds a frontier with GMV/tangency/equal markers and asset points', () => {
    const r = frontier([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'C', closes: c },
    ]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(3);
    expect(r.assets).toHaveLength(3);
    expect(r.curve).toHaveLength(61); // default sample count
    expect(r.gmv).not.toBeNull();
    expect(r.tangency).not.toBeNull();
    expect(r.equal).not.toBeNull();

    // The GMV is the global minimum-variance fully-invested book: no single
    // asset, and no equal-weight book, can beat it on volatility.
    const minAssetVol = Math.min(...r.assets.map((x) => x.vol));
    expect(r.gmv!.vol).toBeLessThanOrEqual(minAssetVol + 1e-9);
    expect(r.gmv!.vol).toBeLessThanOrEqual(r.equal!.vol + 1e-12);

    // Every sampled frontier point is at least as volatile as the GMV.
    for (const p of r.curve) expect(p.vol).toBeGreaterThanOrEqual(r.gmv!.vol - 1e-9);

    // maxSharpe = tangency return / tangency vol, and tangency maximizes Sharpe.
    expect(r.maxSharpe).toBeCloseTo(r.tangency!.ret / r.tangency!.vol, 9);
    expect(r.maxSharpe).toBeGreaterThanOrEqual(r.equal!.ret / r.equal!.vol - 1e-9);
  });

  it('honors a custom sample count', () => {
    const r = frontier(
      [
        { symbol: 'A', closes: a },
        { symbol: 'B', closes: b },
      ],
      11,
    );
    expect(r.curve).toHaveLength(11);
  });

  it('aligns series to the common tail length', () => {
    const r = frontier([
      { symbol: 'A', closes: a }, // 9 closes
      { symbol: 'B', closes: b.slice(b.length - 6) }, // 6 closes
    ]);
    expect(r.obs).toBe(5); // min length 6 → 5 returns
    expect(r.n).toBe(2);
  });

  it('drops flat and too-short series', () => {
    const r = frontier([
      { symbol: 'A', closes: a },
      { symbol: 'B', closes: b },
      { symbol: 'FLAT', closes: [100, 100, 100, 100, 100] },
      { symbol: 'SHORT', closes: [100, 101] },
    ]);
    expect(r.n).toBe(2);
    expect(r.assets.map((x) => x.symbol)).toEqual(['A', 'B']);
  });

  it('degenerates gracefully for a single asset (GMV = the asset, no curve)', () => {
    const r = frontier([{ symbol: 'A', closes: a }]);
    expect(r.ok).toBe(false);
    expect(r.curve).toHaveLength(0);
    expect(r.tangency).toBeNull();
    expect(r.gmv).not.toBeNull();
    expect(r.gmv!.vol).toBeCloseTo(r.assets[0].vol, 9);
    expect(r.gmv!.ret).toBeCloseTo(r.assets[0].ret, 9);
  });

  it('returns empty with no usable assets', () => {
    expect(frontier([]).n).toBe(0);
    expect(frontier([]).ok).toBe(false);
    expect(frontier([{ symbol: 'F', closes: [5, 5, 5] }]).assets).toHaveLength(0);
  });
});
