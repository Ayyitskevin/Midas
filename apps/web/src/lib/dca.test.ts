import { describe, it, expect } from 'vitest';
import { computeDca, qtyToReachAverage, type DcaLeg } from '@/lib/dca';

const legs = (xs: Array<[number, number]>): DcaLeg[] => xs.map(([price, qty]) => ({ price, qty }));

describe('computeDca', () => {
  it('blends fills into a weighted average entry', () => {
    const r = computeDca({ side: 'long', legs: legs([[100, 1], [50, 1]]) });
    expect(r.valid).toBe(true);
    expect(r.totalQty).toBe(2);
    expect(r.totalCost).toBe(150);
    expect(r.avgPrice).toBe(75);
  });

  it('weights by size, not just price', () => {
    const r = computeDca({ side: 'long', legs: legs([[100, 1], [50, 3]]) });
    expect(r.totalQty).toBe(4);
    expect(r.avgPrice).toBe((100 + 150) / 4); // 62.5
  });

  it('computes side-aware unrealized P&L at the mark', () => {
    const long = computeDca({ side: 'long', legs: legs([[100, 1], [50, 1]]), markPrice: 80 });
    expect(long.markPnl).toBe(10); // (80-75)*2
    expect(long.markPnlPct).toBeCloseTo((10 / 150) * 100);

    const short = computeDca({ side: 'short', legs: legs([[100, 1], [50, 1]]), markPrice: 80 });
    expect(short.markPnl).toBe(-10); // (75-80)*2
  });

  it('derives an isolated-margin liquidation from the blended entry', () => {
    const r = computeDca({ side: 'long', legs: legs([[100, 1], [50, 1]]), leverage: 10 });
    expect(r.liqPrice).toBeCloseTo(67.5); // 75 * (1 - 0.1)
    expect(r.liqDistancePct).toBe(10);
  });

  it('liquidates a short above the average and ignores leverage ≤ 1', () => {
    expect(computeDca({ side: 'short', legs: legs([[100, 1]]), leverage: 5 }).liqPrice).toBeCloseTo(120);
    expect(computeDca({ side: 'long', legs: legs([[100, 1]]), leverage: 1 }).liqPrice).toBeNull();
  });

  it('drops legs with non-positive price or size, and rejects an empty set', () => {
    const r = computeDca({ side: 'long', legs: legs([[100, 1], [0, 5], [50, 0]]) });
    expect(r.legCount).toBe(1);
    expect(r.avgPrice).toBe(100);

    const empty = computeDca({ side: 'long', legs: legs([[0, 0]]) });
    expect(empty.valid).toBe(false);
    expect(empty.avgPrice).toBe(0);
  });
});

describe('qtyToReachAverage', () => {
  it('solves the size needed to pull the average to a target', () => {
    // 1 unit @ 100, buy more @ 50 to reach avg 75 → need 1 unit.
    const s = qtyToReachAverage(1, 100, 50, 75);
    expect(s.valid).toBe(true);
    expect(s.qty).toBeCloseTo(1);
    expect(s.resultingQty).toBeCloseTo(2);
    expect(s.resultingAvg).toBeCloseTo(75);
  });

  it('rejects a target the next-buy price cannot reach', () => {
    // Can't pull the average down to 40 by buying at 50.
    expect(qtyToReachAverage(1, 100, 50, 40).valid).toBe(false);
  });

  it('rejects a target equal to the next-buy price', () => {
    expect(qtyToReachAverage(1, 100, 50, 50).valid).toBe(false);
  });

  it('guards non-positive inputs', () => {
    expect(qtyToReachAverage(0, 100, 50, 75).valid).toBe(false);
    expect(qtyToReachAverage(1, 0, 50, 75).valid).toBe(false);
    expect(qtyToReachAverage(1, 100, 0, 75).valid).toBe(false);
    expect(qtyToReachAverage(1, 100, 50, 0).valid).toBe(false);
  });
});
