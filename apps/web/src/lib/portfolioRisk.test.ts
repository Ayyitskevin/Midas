import { describe, it, expect } from 'vitest';
import { positionRisk, aggregateRisk, type RiskPosition } from '@/lib/portfolioRisk';

const pos = (symbol: string, quantity: number, entryPrice: number): RiskPosition => ({ symbol, quantity, entryPrice });

describe('positionRisk', () => {
  it('marks a long to market', () => {
    const r = positionRisk(pos('BTC', 2, 100), 110, null);
    expect(r.side).toBe('long');
    expect(r.qty).toBe(2);
    expect(r.notional).toBeCloseTo(220);
    expect(r.uPnl).toBeCloseTo(20);
    expect(r.uPnlPct).toBeCloseTo(10);
    expect(r.liqPrice).toBeNull();
  });

  it('marks a short to market (profit when price falls)', () => {
    const r = positionRisk(pos('BTC', -2, 100), 90, null);
    expect(r.side).toBe('short');
    expect(r.qty).toBe(2);
    expect(r.uPnl).toBeCloseTo(20); // (90-100)*-2
    expect(r.uPnlPct).toBeCloseTo(10);
  });

  it('estimates a liquidation distance under leverage', () => {
    const long = positionRisk(pos('BTC', 2, 100), 110, 10);
    expect(long.liqPrice).toBeCloseTo(90); // 100*(1-1/10)
    expect(long.liqDistancePct).toBeCloseTo((110 - 90) / 110 * 100);

    const short = positionRisk(pos('BTC', -2, 100), 90, 10);
    expect(short.liqPrice).toBeCloseTo(110); // 100*(1+1/10)
    expect(short.liqDistancePct).toBeCloseTo((110 - 90) / 90 * 100); // positive = safe
  });

  it('nulls mark-derived fields without a price', () => {
    const r = positionRisk(pos('BTC', 2, 100), null, 10);
    expect(r.notional).toBeNull();
    expect(r.uPnl).toBeNull();
    expect(r.liqPrice).toBeCloseTo(90); // still derivable from entry
    expect(r.liqDistancePct).toBeNull();
  });
});

describe('aggregateRisk', () => {
  it('sums P&L and computes gross/net exposure and concentration', () => {
    const rows = [
      positionRisk(pos('BTC', 2, 100), 110, null), // long, notional 220, uPnl 20
      positionRisk(pos('ETH', -10, 50), 48, null), // short, notional 480, uPnl 20
    ];
    const agg = aggregateRisk(rows);
    expect(agg.totalUPnl).toBeCloseTo(40);
    expect(agg.grossNotional).toBeCloseTo(700);
    expect(agg.longNotional).toBeCloseTo(220);
    expect(agg.shortNotional).toBeCloseTo(480);
    expect(agg.netNotional).toBeCloseTo(-260); // 220 - 480
    expect(agg.maxWeightPct).toBeCloseTo((480 / 700) * 100);
  });

  it('handles an empty book', () => {
    const agg = aggregateRisk([]);
    expect(agg.totalUPnl).toBe(0);
    expect(agg.grossNotional).toBe(0);
    expect(agg.maxWeightPct).toBeNull();
  });
});
