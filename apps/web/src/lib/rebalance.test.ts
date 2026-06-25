import { describe, it, expect } from 'vitest';
import { rebalance } from './rebalance';

describe('rebalance', () => {
  it('computes the trades to move from current to target weights', () => {
    const p = rebalance([
      { symbol: 'A', value: 60, targetPct: 50 },
      { symbol: 'B', value: 40, targetPct: 50 },
    ]);
    expect(p.total).toBe(100);
    expect(p.targetSum).toBe(100);
    const a = p.rows.find((r) => r.symbol === 'A')!;
    const b = p.rows.find((r) => r.symbol === 'B')!;
    expect(a.currentPct).toBeCloseTo(60, 10);
    expect(a.targetValue).toBeCloseTo(50, 10);
    expect(a.tradeValue).toBeCloseTo(-10, 10); // sell 10
    expect(a.driftPct).toBeCloseTo(10, 10);
    expect(b.tradeValue).toBeCloseTo(10, 10); // buy 10
    expect(p.totalBuy).toBeCloseTo(10, 10);
    expect(p.totalSell).toBeCloseTo(10, 10);
    expect(p.turnover).toBeCloseTo(10, 10); // one-way, % of book
  });

  it('sells to cash when targets sum below 100%', () => {
    const p = rebalance([
      { symbol: 'A', value: 60, targetPct: 50 },
      { symbol: 'B', value: 40, targetPct: 30 },
    ]);
    expect(p.targetSum).toBe(80);
    expect(p.totalBuy).toBeCloseTo(0, 10);
    expect(p.totalSell).toBeCloseTo(20, 10); // 10 + 10 to cash
  });

  it('produces no trades when already on target', () => {
    const p = rebalance([
      { symbol: 'A', value: 60, targetPct: 60 },
      { symbol: 'B', value: 40, targetPct: 40 },
    ]);
    expect(p.totalBuy).toBeCloseTo(0, 10);
    expect(p.totalSell).toBeCloseTo(0, 10);
    expect(p.turnover).toBeCloseTo(0, 10);
    expect(p.rows.every((r) => Math.abs(r.tradeValue) < 1e-9)).toBe(true);
  });

  it('ignores non-finite values', () => {
    const p = rebalance([
      { symbol: 'A', value: NaN, targetPct: 50 },
      { symbol: 'B', value: 50, targetPct: 100 },
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.total).toBe(50);
    expect(p.rows[0].tradeValue).toBeCloseTo(0, 10);
  });

  it('handles an empty book and a zero total', () => {
    expect(rebalance([]).rows).toHaveLength(0);
    expect(rebalance([]).turnover).toBe(0);
    const zero = rebalance([{ symbol: 'A', value: 0, targetPct: 50 }]);
    expect(zero.total).toBe(0);
    expect(zero.rows[0].currentPct).toBe(0);
    expect(zero.rows[0].tradeValue).toBe(0);
  });
});
