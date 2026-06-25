import { describe, it, expect } from 'vitest';
import { riskOfRuin, ruinCurve } from './ror';

describe('riskOfRuin', () => {
  it('makes ruin vanishingly unlikely for a strong edge bet small', () => {
    const r = riskOfRuin({ winRate: 0.5, payoff: 2, riskPct: 2 });
    // μ = 0.5·2 − 0.5 = 0.5,  var = 0.5·4 + 0.5 − 0.25 = 2.25
    expect(r.valid).toBe(true);
    expect(r.edge).toBe(true);
    expect(r.expectancy).toBeCloseTo(0.5, 10);
    expect(r.stdev).toBeCloseTo(1.5, 10);
    expect(r.unitsToRuin).toBeCloseTo(50, 10);
    expect(r.riskOfRuin).toBeGreaterThan(0);
    expect(r.riskOfRuin).toBeLessThan(1e-6);
    // E[max DD] = (var / 2μ)·riskPct = 2.25·2 = 4.5%
    expect(r.expectedMaxDD).toBeCloseTo(4.5, 10);
  });

  it('reports certain ruin for a negative-edge system', () => {
    const r = riskOfRuin({ winRate: 0.4, payoff: 1, riskPct: 5 });
    // μ = 0.4 − 0.6 = −0.2 < 0
    expect(r.valid).toBe(true);
    expect(r.edge).toBe(false);
    expect(r.expectancy).toBeCloseTo(-0.2, 10);
    expect(r.riskOfRuin).toBe(1);
    expect(r.expectedMaxDD).toBe(100);
  });

  it('matches the closed form for an even-money positive edge', () => {
    const r = riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 5 });
    // μ = 0.1, var = 0.99, U = 20, λ = 0.2/0.99, RoR = exp(−20λ)
    expect(r.riskOfRuin).toBeCloseTo(0.01759, 4);
    expect(r.expectedMaxDD).toBeCloseTo(24.75, 6);
  });

  it('grows with bet size and shrinks with a deeper ruin barrier', () => {
    const small = riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 2 });
    const big = riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 10 });
    expect(big.riskOfRuin).toBeGreaterThan(small.riskOfRuin);

    // A shallower ruin barrier (50% vs 100%) is easier to hit.
    const shallow = riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 5, ruinPct: 50 });
    const deep = riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 5, ruinPct: 100 });
    expect(shallow.riskOfRuin).toBeGreaterThan(deep.riskOfRuin);
  });

  it('never ruins a deterministic winner', () => {
    const r = riskOfRuin({ winRate: 1, payoff: 2, riskPct: 5 });
    expect(r.edge).toBe(true);
    expect(r.stdev).toBeCloseTo(0, 10);
    expect(r.riskOfRuin).toBe(0);
    expect(r.expectedMaxDD).toBe(0);
  });

  it('rejects malformed inputs', () => {
    for (const bad of [
      { winRate: 1.5, payoff: 2, riskPct: 2 },
      { winRate: -0.1, payoff: 2, riskPct: 2 },
      { winRate: 0.5, payoff: 0, riskPct: 2 },
      { winRate: 0.5, payoff: 2, riskPct: 0 },
      { winRate: 0.5, payoff: 2, riskPct: -2 },
      { winRate: 0.5, payoff: 2, riskPct: 2, ruinPct: 0 },
      { winRate: NaN, payoff: 2, riskPct: 2 },
    ]) {
      const r = riskOfRuin(bad);
      expect(r.valid).toBe(false);
      expect(r.riskOfRuin).toBe(0);
    }
  });
});

describe('ruinCurve', () => {
  it('maps each risk percent to its ruin probability, monotonically increasing', () => {
    const risks = [1, 2, 5, 10, 20];
    const curve = ruinCurve({ winRate: 0.55, payoff: 1 }, risks);
    expect(curve.map((c) => c.riskPct)).toEqual(risks);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].riskOfRuin).toBeGreaterThan(curve[i - 1].riskOfRuin);
    }
    // Each point matches a direct call.
    expect(curve[2].riskOfRuin).toBeCloseTo(
      riskOfRuin({ winRate: 0.55, payoff: 1, riskPct: 5 }).riskOfRuin,
      12,
    );
  });
});
