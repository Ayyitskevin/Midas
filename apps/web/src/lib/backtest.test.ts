import { describe, it, expect } from 'vitest';
import {
  backtestSmaCross,
  backtestRsiReversion,
  backtestBollinger,
  bollingerBands,
  rsiSeries,
} from './backtest';
import { rsi } from './signals';

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
    expect(backtestSmaCross([1, 2, 3, 4, 5], { fast: NaN, slow: 3 })).toBeNull(); // NaN (cleared field)
  });
});

describe('rsiSeries', () => {
  it('is NaN until period changes, then 100/0/50 for up/down/flat windows', () => {
    expect(rsiSeries([1, 2, 3, 4, 5], 2)).toEqual([NaN, NaN, 100, 100, 100]);
    expect(rsiSeries([5, 4, 3, 2, 1], 2)).toEqual([NaN, NaN, 0, 0, 0]);
    expect(rsiSeries([5, 5, 5, 5], 2)).toEqual([NaN, NaN, 50, 50]);
  });

  it('matches a hand-computed mixed window', () => {
    // [10,11,10,12] p2: i=2 gain1/loss1 → 50; i=3 gain2/loss1 → 100−100/3.
    const s = rsiSeries([10, 11, 10, 12], 2);
    expect(s[2]).toBeCloseTo(50, 12);
    expect(s[3]).toBeCloseTo(100 - 100 / 3, 12);
  });

  it('agrees with the scanner rsi at the last bar', () => {
    const closes = [10, 11, 9, 12, 11, 13, 10, 14];
    const s = rsiSeries(closes, 3);
    expect(s[s.length - 1]).toBeCloseTo(rsi(closes, 3)!, 12);
  });
});

describe('backtestRsiReversion', () => {
  it('buys the dip below oversold and exits above the exit line (1-bar lag)', () => {
    // [10,9,8,9,10] p2 → rsi [NaN,NaN,0,50,100].
    // <40 at i=2 → long bar 3; >45 at i=3 → flat bar 4.
    const r = backtestRsiReversion([10, 9, 8, 9, 10], { period: 2, oversold: 40, exit: 45 })!;
    expect(r).not.toBeNull();
    expect(r.position).toEqual([0, 0, 0, 1, 0]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entryPrice).toBe(8); // prior close at entry
    expect(r.trades[0].exitPrice).toBe(9);
    expect(r.trades[0].ret).toBeCloseTo(0.125, 9);
    expect(r.stratReturn).toBeCloseTo(0.125, 9);
    expect(r.wins).toBe(1);
    expect(r.winRate).toBe(1);
    expect(r.exposure).toBeCloseTo(1 / 5, 10);
    expect(r.n).toBe(5);
  });

  it('holds to the last bar when RSI never recovers past the exit', () => {
    // Monotonic decline → rsi pinned at 0, dips in and never exits.
    const r = backtestRsiReversion([10, 9, 8, 7, 6], { period: 2, oversold: 40, exit: 60 })!;
    expect(r.position).toEqual([0, 0, 0, 1, 1]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitIdx).toBe(4); // closed at the final bar
    expect(r.trades[0].ret).toBeCloseTo(6 / 8 - 1, 9);
  });

  it('stays flat when RSI never reaches oversold', () => {
    const r = backtestRsiReversion([1, 2, 3, 4, 5], { period: 2, oversold: 30, exit: 70 })!;
    expect(r.position).toEqual([0, 0, 0, 0, 0]);
    expect(r.trades).toHaveLength(0);
    expect(r.stratReturn).toBe(0);
    expect(r.exposure).toBe(0);
  });

  it('returns null on invalid params or thin history', () => {
    expect(backtestRsiReversion([10, 9, 8], { period: 2, oversold: 40, exit: 60 })).toBeNull(); // n < period+2
    expect(backtestRsiReversion([10, 9, 8, 9, 10], { period: 2, oversold: 50, exit: 40 })).toBeNull(); // exit ≤ oversold
    expect(backtestRsiReversion([10, 9, 8, 9, 10], { period: 0, oversold: 40, exit: 60 })).toBeNull(); // period < 1
    expect(backtestRsiReversion([10, 9, 8, 9, 10], { period: 2, oversold: 0, exit: 60 })).toBeNull(); // oversold ≤ 0
    expect(backtestRsiReversion([10, 9, 8, 9, 10], { period: 2, oversold: 40, exit: 120 })).toBeNull(); // exit > 100
    expect(backtestRsiReversion([10, 9, 8, 9, 10], { period: NaN, oversold: 40, exit: 60 })).toBeNull(); // NaN period
  });
});

describe('bollingerBands', () => {
  it('is NaN until the window fills, then SMA ± mult·stdev', () => {
    // [2,4,6] p2: i=1 mean 3 sd 1; i=2 mean 5 sd 1.
    const b = bollingerBands([2, 4, 6], 2, 1);
    expect(b.mid[0]).toBeNaN();
    expect(b.mid[1]).toBeCloseTo(3, 12);
    expect(b.lower[1]).toBeCloseTo(2, 12);
    expect(b.upper[1]).toBeCloseTo(4, 12);
    expect(b.mid[2]).toBeCloseTo(5, 12);
    expect(b.lower[2]).toBeCloseTo(4, 12);
  });
});

describe('backtestBollinger', () => {
  it('buys the close below the lower band and exits above the middle (1-bar lag)', () => {
    // [20,20,20,10,20,20] p3 m1 → close[3]=10 < lower[3] → long bar 4;
    // close[4]=20 > mid[4] → flat bar 5.
    const r = backtestBollinger([20, 20, 20, 10, 20, 20], { period: 3, mult: 1 })!;
    expect(r).not.toBeNull();
    expect(r.position).toEqual([0, 0, 0, 0, 1, 0]);
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].entryPrice).toBe(10); // prior close at entry
    expect(r.trades[0].exitPrice).toBe(20);
    expect(r.trades[0].ret).toBeCloseTo(1, 9);
    expect(r.stratReturn).toBeCloseTo(1, 9);
    expect(r.wins).toBe(1);
    expect(r.exposure).toBeCloseTo(1 / 6, 10);
    expect(r.n).toBe(6);
  });

  it('stays flat when price never pierces the lower band', () => {
    const r = backtestBollinger([10, 11, 12, 13, 14], { period: 2, mult: 1 })!;
    expect(r.position).toEqual([0, 0, 0, 0, 0]);
    expect(r.trades).toHaveLength(0);
    expect(r.stratReturn).toBe(0);
  });

  it('returns null on invalid params or thin history', () => {
    expect(backtestBollinger([20, 20, 10], { period: 3, mult: 1 })).toBeNull(); // n < period+1
    expect(backtestBollinger([20, 20, 20, 10], { period: 1, mult: 1 })).toBeNull(); // period < 2
    expect(backtestBollinger([20, 20, 20, 10], { period: 3, mult: 0 })).toBeNull(); // width ≤ 0
    expect(backtestBollinger([20, 20, 20, 10], { period: NaN, mult: 1 })).toBeNull(); // NaN period
    expect(backtestBollinger([20, 20, 20, 10], { period: 3, mult: NaN })).toBeNull(); // NaN width
  });
});
