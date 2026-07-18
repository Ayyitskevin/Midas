import { describe, it, expect } from 'vitest';
import { computeOiConcentration, type VenueDerivatives } from '@midas/shared';

const d = (exchange: string, oi: number | null): VenueDerivatives => ({
  exchange,
  fundingRate: 0,
  nextFundingTime: 0,
  markPrice: 100,
  openInterestValue: oi,
  timestamp: 0,
});

describe('computeOiConcentration', () => {
  it('aggregates OI, per-venue share, top venue and the Herfindahl index', () => {
    const row = computeOiConcentration('BTC/USDT', [d('a', 5000), d('b', 3000), d('c', 2000)]);
    expect(row.totalOiValue).toBe(10_000);
    expect(row.topVenue).toBe('a');
    expect(row.topVenueShare).toBeCloseTo(0.5, 10);
    expect(row.venueCount).toBe(3);
    // venues sorted largest-first with shares
    expect(row.venues.map((v) => v.exchange)).toEqual(['a', 'b', 'c']);
    expect(row.venues.map((v) => v.share)).toEqual([0.5, 0.3, 0.2]);
    // HHI = 0.5² + 0.3² + 0.2² = 0.38
    expect(row.herfindahl).toBeCloseTo(0.38, 10);
  });

  it('treats a single reporting venue as maximum crowding (share 1, HHI 1)', () => {
    const row = computeOiConcentration('ETH/USDT', [d('binance', 1000)]);
    expect(row.totalOiValue).toBe(1000);
    expect(row.topVenueShare).toBe(1);
    expect(row.herfindahl).toBe(1);
    expect(row.venueCount).toBe(1);
  });

  it('returns nulls (never NaN) when no venue reports OI', () => {
    const row = computeOiConcentration('DOGE/USDT', [d('a', null), d('b', null)]);
    expect(row.totalOiValue).toBeNull();
    expect(row.topVenue).toBeNull();
    expect(row.topVenueShare).toBeNull();
    expect(row.herfindahl).toBeNull();
    expect(row.venueCount).toBe(0);
    expect(row.venues).toEqual([]);
  });

  it('ignores venues with null or non-positive OI', () => {
    const row = computeOiConcentration('SOL/USDT', [d('a', 4000), d('b', null), d('c', 0), d('d', 6000)]);
    expect(row.venueCount).toBe(2);
    expect(row.totalOiValue).toBe(10_000);
    expect(row.topVenue).toBe('d'); // 6000 > 4000
    expect(row.topVenueShare).toBeCloseTo(0.6, 10);
    expect(row.herfindahl).toBeCloseTo(0.6 * 0.6 + 0.4 * 0.4, 10);
  });
});
