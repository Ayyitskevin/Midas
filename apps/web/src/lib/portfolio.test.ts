import { describe, it, expect } from 'vitest';
import { applyTrade, foldTrade, positionMetrics } from '@/lib/portfolio';

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

describe('foldTrade — realized P&L', () => {
  it('books nothing on open or add', () => {
    expect(foldTrade({ quantity: 0, entryPrice: 0 }, { quantity: 2, price: 100 }).realized).toBe(0);
    expect(foldTrade({ quantity: 2, entryPrice: 100 }, { quantity: 2, price: 200 }).realized).toBe(0);
  });

  it('books P&L when reducing a long', () => {
    const r = foldTrade({ quantity: 4, entryPrice: 150 }, { quantity: -1, price: 200 });
    expect(r.realized).toBe(50); // 1 × (200 − 150)
    expect(r.position).toEqual({ quantity: 3, entryPrice: 150 });
  });

  it('books the full P&L when closing a long', () => {
    const r = foldTrade({ quantity: 3, entryPrice: 150 }, { quantity: -3, price: 200 });
    expect(r.realized).toBe(150); // 3 × 50
    expect(r.position).toBeNull();
  });

  it('books P&L when covering a short at a profit', () => {
    const r = foldTrade({ quantity: -2, entryPrice: 100 }, { quantity: 1, price: 80 });
    expect(r.realized).toBe(20); // 1 × (100 − 80)
    expect(r.position).toEqual({ quantity: -1, entryPrice: 100 });
  });

  it('books P&L only on the closed units when flipping through zero', () => {
    const r = foldTrade({ quantity: 1, entryPrice: 100 }, { quantity: -3, price: 50 });
    expect(r.realized).toBe(-50); // closed 1 long at a 50 loss
    expect(r.position).toEqual({ quantity: -2, entryPrice: 50 }); // residual short at trade price
  });
});
