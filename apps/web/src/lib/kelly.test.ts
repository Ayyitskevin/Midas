import { describe, it, expect } from 'vitest';
import { kelly } from './kelly';

describe('kelly', () => {
  it('sizes a classic 50% win / 2:1 payoff bet at quarter bankroll', () => {
    const r = kelly({ winRate: 0.5, payoff: 2 });
    // f* = (2·0.5 − 0.5) / 2 = 0.25
    expect(r.valid).toBe(true);
    expect(r.raw).toBeCloseTo(0.25, 10);
    expect(r.fraction).toBeCloseTo(0.25, 10);
    expect(r.half).toBeCloseTo(0.125, 10);
    expect(r.quarter).toBeCloseTo(0.0625, 10);
    // expectancy = 0.5·2 − 0.5 = 0.5 R
    expect(r.expectancy).toBeCloseTo(0.5, 10);
    expect(r.edge).toBe(true);
    // breakeven win = 1 / (1 + 2)
    expect(r.breakevenWin).toBeCloseTo(1 / 3, 10);
  });

  it('returns a zero edge at a coin-flip with even money', () => {
    const r = kelly({ winRate: 0.5, payoff: 1 });
    expect(r.raw).toBeCloseTo(0, 10);
    expect(r.fraction).toBeCloseTo(0, 10);
    expect(r.expectancy).toBeCloseTo(0, 10);
    expect(r.edge).toBe(false);
    expect(r.breakevenWin).toBeCloseTo(0.5, 10);
  });

  it('clamps the actionable fraction to zero when the edge is negative', () => {
    const r = kelly({ winRate: 0.3, payoff: 1 });
    // raw = (1·0.3 − 0.7) / 1 = −0.4, expectancy = 0.3 − 0.7 = −0.4
    expect(r.raw).toBeCloseTo(-0.4, 10);
    expect(r.fraction).toBe(0);
    expect(r.half).toBe(0);
    expect(r.quarter).toBe(0);
    expect(r.expectancy).toBeCloseTo(-0.4, 10);
    expect(r.edge).toBe(false);
  });

  it('grows the fraction as the payoff improves at a fixed win rate', () => {
    const a = kelly({ winRate: 0.6, payoff: 1 });
    const b = kelly({ winRate: 0.6, payoff: 3 });
    expect(b.fraction).toBeGreaterThan(a.fraction);
    // 60% at even money: f* = 0.6 − 0.4 = 0.2
    expect(a.fraction).toBeCloseTo(0.2, 10);
    // 60% at 3:1: f* = (3·0.6 − 0.4) / 3 = 1.4/3
    expect(b.raw).toBeCloseTo(1.4 / 3, 10);
  });

  it('caps the fraction at the full bankroll for a sure-thing payoff', () => {
    const r = kelly({ winRate: 1, payoff: 0.5 });
    // raw = (0.5·1 − 0) / 0.5 = 1, already at the cap
    expect(r.raw).toBeCloseTo(1, 10);
    expect(r.fraction).toBe(1);
    expect(r.half).toBe(0.5);
  });

  it('rejects out-of-range probabilities and non-positive payoffs', () => {
    for (const bad of [
      { winRate: 1.5, payoff: 2 },
      { winRate: -0.1, payoff: 2 },
      { winRate: 0.5, payoff: 0 },
      { winRate: 0.5, payoff: -1 },
      { winRate: NaN, payoff: 2 },
      { winRate: 0.5, payoff: NaN },
    ]) {
      const r = kelly(bad);
      expect(r.valid).toBe(false);
      expect(r.fraction).toBe(0);
      expect(r.edge).toBe(false);
    }
  });
});
