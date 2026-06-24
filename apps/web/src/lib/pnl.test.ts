import { describe, it, expect } from 'vitest';
import { computePnl, type PnlInput } from '@/lib/pnl';

const base: PnlInput = {
  side: 'long',
  entry: 100,
  exit: 110,
  size: 10,
  entryFeePct: 0.1,
  exitFeePct: 0.1,
  leverage: null,
};

describe('computePnl', () => {
  it('computes gross/net P&L and fees for a long', () => {
    const r = computePnl(base);
    expect(r.valid).toBe(true);
    expect(r.grossPnl).toBe(100); // (110-100)*10
    expect(r.entryFee).toBeCloseTo(1); // 1000 * 0.1%
    expect(r.exitFee).toBeCloseTo(1.1); // 1100 * 0.1%
    expect(r.totalFees).toBeCloseTo(2.1);
    expect(r.netPnl).toBeCloseTo(97.9);
  });

  it('reports ROE against notional for spot', () => {
    const r = computePnl(base);
    expect(r.margin).toBe(1000);
    expect(r.grossRoePct).toBeCloseTo(10);
    expect(r.netRoePct).toBeCloseTo(9.79);
  });

  it('reports ROE against margin when leveraged', () => {
    const r = computePnl({ ...base, leverage: 10, entryFeePct: 0, exitFeePct: 0 });
    expect(r.margin).toBe(100); // 1000 / 10x
    expect(r.netRoePct).toBeCloseTo(100); // 100 profit on 100 margin
  });

  it('computes a short P&L (profit when price falls)', () => {
    const r = computePnl({ ...base, side: 'short', exit: 90 });
    expect(r.grossPnl).toBe(100); // (100-90)*10
    expect(r.exitFee).toBeCloseTo(0.9); // 900 * 0.1%
    expect(r.netPnl).toBeCloseTo(98.1);
  });

  it('solves a fee-inclusive break-even above entry for a long, below for a short', () => {
    const long = computePnl(base);
    expect(long.breakEvenPrice).toBeCloseTo((100 * 1.001) / 0.999); // ≈ 100.2002
    expect(long.breakEvenPrice).toBeGreaterThan(100);

    const short = computePnl({ ...base, side: 'short', exit: 90 });
    expect(short.breakEvenPrice).toBeCloseTo((100 * 0.999) / 1.001); // ≈ 99.8002
    expect(short.breakEvenPrice).toBeLessThan(100);
  });

  it('equals gross P&L and breaks even at entry with zero fees', () => {
    const r = computePnl({ ...base, entryFeePct: 0, exitFeePct: 0 });
    expect(r.netPnl).toBe(r.grossPnl);
    expect(r.breakEvenPrice).toBeCloseTo(100);
  });

  it('clamps absurd fees so break-even stays finite', () => {
    const r = computePnl({ ...base, exitFeePct: 200 });
    expect(Number.isFinite(r.breakEvenPrice)).toBe(true);
  });

  it('rejects non-positive entry, exit and size', () => {
    expect(computePnl({ ...base, entry: 0 }).valid).toBe(false);
    expect(computePnl({ ...base, exit: -1 }).valid).toBe(false);
    expect(computePnl({ ...base, size: 0 }).valid).toBe(false);
  });
});
