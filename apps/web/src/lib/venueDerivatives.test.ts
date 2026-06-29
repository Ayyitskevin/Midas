import { describe, it, expect } from 'vitest';
import { summarizeVenueDerivatives } from './venueDerivatives';
import type { VenueDerivatives } from '@midas/shared';

const mk = (
  exchange: string,
  fundingRate: number | null,
  openInterestValue: number | null,
): VenueDerivatives => ({
  exchange,
  fundingRate,
  nextFundingTime: null,
  markPrice: null,
  openInterestValue,
  timestamp: 0,
});

describe('summarizeVenueDerivatives', () => {
  it('finds the funding extremes, the cross-venue spread, and total OI', () => {
    const rows = [
      mk('Binance', 0.0001, 1_000_000),
      mk('OKX', -0.00005, 500_000),
      mk('Bybit', 0.0003, 250_000),
    ];
    const s = summarizeVenueDerivatives(rows);
    expect(s.maxFunding).toBeCloseTo(0.0003, 10);
    expect(s.maxVenue).toBe('Bybit');
    expect(s.minFunding).toBeCloseTo(-0.00005, 10);
    expect(s.minVenue).toBe('OKX');
    expect(s.spread).toBeCloseTo(0.00035, 10); // 0.0003 − (−0.00005)
    expect(s.totalOi).toBe(1_750_000);
    expect(s.venues).toBe(3);
  });

  it('ignores venues with missing funding / OI', () => {
    const rows = [mk('A', null, null), mk('B', 0.0002, 100), mk('C', 0.0002, null)];
    const s = summarizeVenueDerivatives(rows);
    expect(s.maxFunding).toBeCloseTo(0.0002, 10);
    expect(s.minFunding).toBeCloseTo(0.0002, 10);
    expect(s.spread).toBeCloseTo(0, 10); // two funded venues, equal
    expect(s.totalOi).toBe(100);
    expect(s.venues).toBe(3);
  });

  it('returns null spread with fewer than two funding venues', () => {
    expect(summarizeVenueDerivatives([mk('A', 0.0001, 10)]).spread).toBeNull();
    expect(summarizeVenueDerivatives([mk('A', null, 10), mk('B', null, 20)]).spread).toBeNull();
  });

  it('handles an empty set', () => {
    const s = summarizeVenueDerivatives([]);
    expect(s.maxFunding).toBeNull();
    expect(s.spread).toBeNull();
    expect(s.totalOi).toBe(0);
    expect(s.venues).toBe(0);
  });
});
