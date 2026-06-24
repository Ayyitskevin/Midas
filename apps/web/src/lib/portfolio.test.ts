import { describe, it, expect } from 'vitest';
import { applyTrade, positionMetrics } from '@/lib/portfolio';

describe('applyTrade', () => {
  it('opens from flat at the trade price', () => {
    expect(applyTrade({ quantity: 0, entryPrice: 0 }, { quantity: 2, price: 100 })).toEqual({
      quantity: 2,
      entryPrice: 100,
    });
  });

  it('averages up when adding to a long', () => {
    expect(applyTrade({ quantity: 2, entryPrice: 100 }, { quantity: 2, price: 200 })).toEqual({
      quantity: 4,
      entryPrice: 150,
    });
  });

  it('leaves the basis untouched when reducing a long', () => {
    expect(applyTrade({ quantity: 4, entryPrice: 150 }, { quantity: -1, price: 999 })).toEqual({
      quantity: 3,
      entryPrice: 150,
    });
  });

  it('returns null when the position closes to flat', () => {
    expect(applyTrade({ quantity: 3, entryPrice: 150 }, { quantity: -3, price: 123 })).toBeNull();
  });

  it('resets the basis to the trade price when flipping through zero', () => {
    expect(applyTrade({ quantity: 1, entryPrice: 100 }, { quantity: -3, price: 50 })).toEqual({
      quantity: -2,
      entryPrice: 50,
    });
  });

  it('averages a short symmetrically', () => {
    expect(applyTrade({ quantity: -2, entryPrice: 100 }, { quantity: -2, price: 200 })).toEqual({
      quantity: -4,
      entryPrice: 150,
    });
  });
});

describe('positionMetrics', () => {
  it('computes long P&L', () => {
    const m = positionMetrics(2, 100, 150);
    expect(m.cost).toBe(200);
    expect(m.value).toBe(300);
    expect(m.pnl).toBe(100);
    expect(m.pnlPct).toBeCloseTo(50);
  });

  it('computes short P&L — a falling mark is a gain', () => {
    const m = positionMetrics(-2, 100, 80);
    expect(m.cost).toBe(-200);
    expect(m.value).toBe(-160);
    expect(m.pnl).toBe(40); // (80 - 100) * -2
    expect(m.pnlPct).toBeCloseTo(20); // 40 / |−200| * 100
  });

  it('returns null marks when no price is available', () => {
    const m = positionMetrics(2, 100, null);
    expect(m.value).toBeNull();
    expect(m.pnl).toBeNull();
    expect(m.pnlPct).toBeNull();
  });
});
