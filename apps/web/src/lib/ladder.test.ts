import { describe, it, expect } from 'vitest';
import { ladder, type LadderInputs, type LadderWeighting } from './ladder';

const make = (over: Partial<LadderInputs>): LadderInputs => ({
  priceHigh: 100,
  priceLow: 80,
  rungs: 3,
  budget: 300,
  weighting: 'flat' as LadderWeighting,
  heavyLow: true,
  ...over,
});

describe('ladder', () => {
  it('spaces rungs evenly and blends a flat ladder by quantity', () => {
    const p = ladder(make({ weighting: 'flat' }));
    expect(p.valid).toBe(true);
    expect(p.rungs.map((r) => r.price)).toEqual([100, 90, 80]);
    expect(p.rungs.every((r) => Math.abs(r.notional - 100) < 1e-9)).toBe(true);
    expect(p.totalNotional).toBeCloseTo(300, 9);
    // qty = 100/100 + 100/90 + 100/80
    expect(p.totalQty).toBeCloseTo(1 + 100 / 90 + 1.25, 9);
    expect(p.avgEntry).toBeCloseTo(89.2562, 3);
  });

  it('weights a linear long ladder toward the low end', () => {
    const p = ladder(make({ weighting: 'linear', heavyLow: true, budget: 600 }));
    // ranks 0/1/2 → raw 1/2/3, sum 6 → notional 100/200/300 at price 100/90/80
    expect(p.rungs[0].notional).toBeCloseTo(100, 9);
    expect(p.rungs[1].notional).toBeCloseTo(200, 9);
    expect(p.rungs[2].notional).toBeCloseTo(300, 9);
    expect(p.rungs[2].weight).toBeCloseTo(0.5, 9);
    expect(p.avgEntry).toBeCloseTo(86.056, 3);
  });

  it('flips the heavy end for a short ladder', () => {
    const p = ladder(make({ weighting: 'linear', heavyLow: false, budget: 600 }));
    // heavy at the high end now → notional 300/200/100 at price 100/90/80
    expect(p.rungs[0].price).toBe(100);
    expect(p.rungs[0].notional).toBeCloseTo(300, 9);
    expect(p.rungs[2].notional).toBeCloseTo(100, 9);
  });

  it('scales a geometric ladder by the given ratio', () => {
    const p = ladder(make({ weighting: 'geometric', ratio: 2, heavyLow: true, budget: 700 }));
    // raw 1/2/4, sum 7 → notional 100/200/400
    expect(p.rungs.map((r) => Math.round(r.notional))).toEqual([100, 200, 400]);
    expect(p.rungs[2].weight).toBeCloseTo(4 / 7, 9);
  });

  it('always deploys exactly the budget', () => {
    const p = ladder(make({ weighting: 'geometric', budget: 5000, rungs: 7 }));
    const sum = p.rungs.reduce((a, r) => a + r.notional, 0);
    expect(sum).toBeCloseTo(5000, 6);
    expect(p.totalNotional).toBeCloseTo(5000, 6);
  });

  it('places a single rung at the range midpoint', () => {
    const p = ladder(make({ rungs: 1, budget: 100 }));
    expect(p.rungs).toHaveLength(1);
    expect(p.rungs[0].price).toBeCloseTo(90, 9);
    expect(p.avgEntry).toBeCloseTo(90, 9);
  });

  it('rejects malformed ladders', () => {
    for (const bad of [
      make({ priceHigh: 80, priceLow: 100 }), // inverted range
      make({ budget: 0 }),
      make({ rungs: 0 }),
      make({ priceLow: 0 }),
      make({ priceHigh: -100 }),
      make({ budget: NaN }),
    ]) {
      const p = ladder(bad);
      expect(p.valid).toBe(false);
      expect(p.rungs).toHaveLength(0);
    }
  });
});
