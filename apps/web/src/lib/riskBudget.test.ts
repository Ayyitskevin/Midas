import { describe, it, expect } from 'vitest';
import { riskDecomposition, riskBudget } from './riskBudget';

/** Price path whose simple returns reproduce `r`. */
const fromReturns = (r: number[], start = 100): number[] => {
  const out = [start];
  for (const x of r) out.push(out[out.length - 1] * (1 + x));
  return out;
};

describe('riskDecomposition', () => {
  it('attributes risk by variance for an equal-weight, uncorrelated book', () => {
    // Σ = diag(0.04, 0.01), w = (0.5, 0.5).
    // Σw = (0.02, 0.005); portVar = 0.0125; portVol = √0.0125.
    // pctRisk = (0.5·0.02, 0.5·0.005)/0.0125 = (80%, 20%).
    const d = riskDecomposition(
      [
        [0.04, 0],
        [0, 0.01],
      ],
      [0.5, 0.5],
    )!;
    expect(d.portVol).toBeCloseTo(Math.sqrt(0.0125), 12);
    expect(d.pctRisk[0]).toBeCloseTo(80, 9);
    expect(d.pctRisk[1]).toBeCloseTo(20, 9);
    // Component contributions sum to the portfolio vol (Euler).
    expect(d.riskContrib[0] + d.riskContrib[1]).toBeCloseTo(d.portVol, 12);
    expect(d.pctRisk[0] + d.pctRisk[1]).toBeCloseTo(100, 9);
  });

  it('handles a correlated book (equal risk despite unequal weights)', () => {
    // Σ=[[0.04,0.01],[0.01,0.09]], w=(0.6,0.4).
    // Σw=(0.028,0.042); RC ∝ (0.6·0.028, 0.4·0.042) = (0.0168, 0.0168) → 50/50.
    const d = riskDecomposition(
      [
        [0.04, 0.01],
        [0.01, 0.09],
      ],
      [0.6, 0.4],
    )!;
    expect(d.portVol).toBeCloseTo(Math.sqrt(0.0336), 12);
    expect(d.pctRisk[0]).toBeCloseTo(50, 9);
    expect(d.pctRisk[1]).toBeCloseTo(50, 9);
    expect(d.mctr[0]).toBeCloseTo(0.028 / Math.sqrt(0.0336), 12);
  });

  it('returns null when the book carries no risk (zero weights)', () => {
    expect(
      riskDecomposition(
        [
          [0.04, 0],
          [0, 0.01],
        ],
        [0, 0],
      ),
    ).toBeNull();
  });

  it('returns null on a dimension mismatch', () => {
    expect(riskDecomposition([[0.04]], [0.5, 0.5])).toBeNull();
    expect(riskDecomposition([], [])).toBeNull();
  });
});

describe('riskBudget', () => {
  const a = fromReturns([0.02, -0.01, 0.03, -0.02, 0.01, -0.01, 0.02, 0.0]);
  const b = fromReturns([0.01, 0.0, -0.01, 0.02, -0.01, 0.01, 0.0, 0.01]);
  const c = fromReturns([0.03, -0.02, 0.01, 0.0, 0.02, -0.03, 0.01, 0.01]);

  it('decomposes a book: risk shares sum to 100, contributions to portVol', () => {
    const r = riskBudget([
      { symbol: 'A', weight: 0.5, closes: a },
      { symbol: 'B', weight: 0.3, closes: b },
      { symbol: 'C', weight: 0.2, closes: c },
    ]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(3);
    const pctSum = r.rows.reduce((s, x) => s + x.pctRisk, 0);
    expect(pctSum).toBeCloseTo(100, 6);
    const rcSum = r.rows.reduce((s, x) => s + x.riskContrib, 0);
    expect(rcSum).toBeCloseTo(r.portVol, 9);
    const wSum = r.rows.reduce((s, x) => s + x.pctWeight, 0);
    expect(wSum).toBeCloseTo(100, 6);
    // Sorted by percent-of-risk descending.
    expect(r.rows[0].pctRisk).toBeGreaterThanOrEqual(r.rows[1].pctRisk);
    expect(r.rows[1].pctRisk).toBeGreaterThanOrEqual(r.rows[2].pctRisk);
  });

  it('gives a zero-weight holding zero risk contribution', () => {
    const r = riskBudget([
      { symbol: 'A', weight: 1, closes: a },
      { symbol: 'B', weight: 0, closes: b },
    ]);
    const rowB = r.rows.find((x) => x.symbol === 'B')!;
    expect(rowB.riskContrib).toBeCloseTo(0, 12);
    expect(rowB.pctRisk).toBeCloseTo(0, 9);
    // The lone risk-bearing name owns all the risk.
    const rowA = r.rows.find((x) => x.symbol === 'A')!;
    expect(rowA.pctRisk).toBeCloseTo(100, 9);
  });

  it('attributes all risk to a single holding', () => {
    const r = riskBudget([{ symbol: 'A', weight: 1, closes: a }]);
    expect(r.ok).toBe(true);
    expect(r.n).toBe(1);
    expect(r.rows[0].pctRisk).toBeCloseTo(100, 9);
    expect(r.rows[0].riskContrib).toBeCloseTo(r.portVol, 12);
  });

  it('aligns series to the common tail length', () => {
    const r = riskBudget([
      { symbol: 'A', weight: 0.5, closes: a }, // 9 closes
      { symbol: 'B', weight: 0.5, closes: b.slice(b.length - 6) }, // 6 closes
    ]);
    expect(r.obs).toBe(5); // min length 6 → 5 returns
    expect(r.n).toBe(2);
  });

  it('drops flat and too-short series', () => {
    const r = riskBudget([
      { symbol: 'A', weight: 0.5, closes: a },
      { symbol: 'B', weight: 0.3, closes: b },
      { symbol: 'FLAT', weight: 0.2, closes: [100, 100, 100, 100, 100] },
      { symbol: 'SHORT', weight: 0.1, closes: [100, 101] },
    ]);
    expect(r.n).toBe(2);
    expect(r.rows.map((x) => x.symbol).sort()).toEqual(['A', 'B']);
  });

  it('returns empty with no usable holdings', () => {
    expect(riskBudget([]).n).toBe(0);
    expect(riskBudget([]).ok).toBe(false);
    expect(riskBudget([{ symbol: 'F', weight: 1, closes: [5, 5, 5] }]).ok).toBe(false);
  });
});
