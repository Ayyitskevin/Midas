import { describe, it, expect } from 'vitest';
import { projectFunding } from '@/lib/fundingPnl';

describe('projectFunding', () => {
  const base = { notional: 10_000, rate: 0.0001, intervalHours: 8, horizonDays: 10 };

  it('a long pays positive funding; a short receives it', () => {
    const long = projectFunding({ ...base, side: 'long' });
    const short = projectFunding({ ...base, side: 'short' });
    // 10,000 × 0.0001 = $1 per settlement
    expect(long.perInterval).toBeCloseTo(-1, 9);
    expect(short.perInterval).toBeCloseTo(1, 9);
    expect(long.receives).toBe(false);
    expect(short.receives).toBe(true);
  });

  it('counts settlements and sums the carry over the horizon', () => {
    const p = projectFunding({ ...base, side: 'short' });
    expect(p.intervalsPerDay).toBe(3); // 24 / 8h
    expect(p.intervals).toBe(30); // 10 days × 3
    expect(p.daily).toBeCloseTo(3, 9);
    expect(p.horizonTotal).toBeCloseTo(30, 9);
    expect(p.points).toHaveLength(30);
    expect(p.points[29].cum).toBeCloseTo(30, 9);
  });

  it('annualizes the carry as APR and a yearly total', () => {
    const p = projectFunding({ ...base, side: 'short' });
    // 0.0001 × 3/day × 365 × 100 = 10.95% APR
    expect(p.aprPct).toBeCloseTo(10.95, 6);
    expect(p.annualTotal).toBeCloseTo(10_000 * 0.0001 * 3 * 365, 6);
  });

  it('flips signs for a negative funding rate', () => {
    const longNeg = projectFunding({ ...base, side: 'long', rate: -0.0002 });
    expect(longNeg.receives).toBe(true); // long receives when funding is negative
    expect(longNeg.aprPct).toBeGreaterThan(0);
  });

  it('respects a non-8h interval', () => {
    const p = projectFunding({ ...base, side: 'short', intervalHours: 1 });
    expect(p.intervalsPerDay).toBe(24);
    expect(p.intervals).toBe(240); // 10 days × 24
  });

  it('is invalid for a non-positive notional or horizon', () => {
    expect(projectFunding({ ...base, side: 'long', notional: 0 }).valid).toBe(false);
    expect(projectFunding({ ...base, side: 'long', horizonDays: 0 }).valid).toBe(false);
  });
});
