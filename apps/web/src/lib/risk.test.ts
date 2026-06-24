import { describe, it, expect } from 'vitest';
import { computePosition } from '@/lib/risk';

describe('computePosition', () => {
  it('sizes a long so the stop loses exactly the risked amount', () => {
    const r = computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 95 });
    expect(r.valid).toBe(true);
    expect(r.side).toBe('long');
    expect(r.riskAmount).toBe(100); // 1% of 10k
    expect(r.perUnitRisk).toBe(5);
    expect(r.positionSize).toBe(20); // 100 / 5
    expect(r.notional).toBe(2000); // 20 * 100
    expect(r.stopDistancePct).toBe(5);
    expect(r.accountLeverage).toBeCloseTo(0.2);
  });

  it('infers a short when the stop sits above entry, with targets below', () => {
    const r = computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 105 });
    expect(r.side).toBe('short');
    expect(r.positionSize).toBe(20);
    expect(r.targets.map((t) => t.price)).toEqual([95, 90, 85]);
  });

  it('lays out a 1R/2R/3R target ladder for a long', () => {
    const r = computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 95 });
    expect(r.targets).toEqual([
      { r: 1, price: 105, profit: 100 },
      { r: 2, price: 110, profit: 200 },
      { r: 3, price: 115, profit: 300 },
    ]);
  });

  it('derives margin and an isolated-margin liquidation price when leveraged', () => {
    const r = computePosition({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopPrice: 95,
      leverage: 10,
    });
    expect(r.marginRequired).toBe(200); // notional 2000 / 10x
    expect(r.liqDistancePct).toBe(10); // 100 / 10x
    expect(r.liqPrice).toBeCloseTo(90); // long liquidates 10% below entry
  });

  it('liquidates a short above entry', () => {
    const r = computePosition({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopPrice: 105,
      leverage: 10,
    });
    expect(r.liqPrice).toBeCloseTo(110);
  });

  it('treats leverage of 1 or below as spot (no margin / liq)', () => {
    const r = computePosition({
      accountSize: 10_000,
      riskPct: 1,
      entryPrice: 100,
      stopPrice: 95,
      leverage: 1,
    });
    expect(r.marginRequired).toBeNull();
    expect(r.liqPrice).toBeNull();
    expect(r.liqDistancePct).toBeNull();
  });

  it('rejects a zero stop distance instead of dividing by zero', () => {
    const r = computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 100 });
    expect(r.valid).toBe(false);
    expect(r.positionSize).toBe(0);
    expect(r.reason).toMatch(/differ/i);
  });

  it('rejects non-positive account, risk, entry and stop', () => {
    expect(computePosition({ accountSize: 0, riskPct: 1, entryPrice: 100, stopPrice: 95 }).valid).toBe(false);
    expect(computePosition({ accountSize: 10_000, riskPct: 0, entryPrice: 100, stopPrice: 95 }).valid).toBe(false);
    expect(computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: -1, stopPrice: 95 }).valid).toBe(false);
    expect(computePosition({ accountSize: 10_000, riskPct: 1, entryPrice: 100, stopPrice: 0 }).valid).toBe(false);
  });

  it('rejects NaN inputs (e.g. empty form fields)', () => {
    const r = computePosition({ accountSize: NaN, riskPct: 1, entryPrice: 100, stopPrice: 95 });
    expect(r.valid).toBe(false);
  });
});
