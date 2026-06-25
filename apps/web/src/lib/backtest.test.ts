import { describe, it, expect } from 'vitest';
import { backtestSmaCross } from './backtest';

describe('backtestSmaCross', () => {
  it('goes long after the cross and compounds the move (1-bar lag)', () => {
    // fast(2) crosses above slow(3) at index 3 → long from bar 4.
    const r = backtestSmaCross([1, 1, 1, 2, 3, 4], { fast: 2, slow: 3 })!;
    expect(r).not.toBeNull();
    expect(r.n).toBe(6);
    expect(r.position).toEqual([0, 0, 0, 0, 1, 1]);
    expect(r.equity).toHaveLength(6);
    expect(r.equity[0]).toBe(1);
    expect(r.equity[5]).toBeCloseTo(2, 9); // 1.5 × 4/3
    expect(r.stratReturn).toBeCloseTo(1, 9);
    expect(r.benchmark[5]).toBeCloseTo(4, 9); // buy & hold 1 → 4
    expect(r.benchReturn).toBeCloseTo(3, 9);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entryPrice).toBe(2); // bought at the prior close
    expect(r.wins).toBe(1);
    expect(r.winRate).toBe(1);
    expect(r.exposure).toBeCloseTo(1 / 3, 10);
    expect(r.maxDD).toBe(0); // monotonic equity
  });

  it('books a losing trade and the drawdown it caused', () => {
    const r = backtestSmaCross([1, 1, 1, 2, 3, 1], { fast: 2, slow: 3 })!;
    expect(r.stratReturn).toBeCloseTo(-0.5, 9); // 1.5 then ×(1/3)
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].ret).toBeCloseTo(-0.5, 9); // 2 → 1
    expect(r.wins).toBe(0);
    expect(r.winRate).toBe(0);
    expect(r.maxDD).toBeCloseTo(2 / 3, 9); // 1.5 → 0.5
  });

  it('returns null on invalid params or thin history', () => {
    expect(backtestSmaCross([1, 2, 3], { fast: 2, slow: 3 })).toBeNull(); // n < slow+1
    expect(backtestSmaCross([1, 2, 3, 4, 5], { fast: 5, slow: 3 })).toBeNull(); // fast ≥ slow
    expect(backtestSmaCross([1, 2, 3, 4, 5], { fast: 0, slow: 3 })).toBeNull(); // fast < 1
  });
});
