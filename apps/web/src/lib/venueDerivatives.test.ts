import { describe, it, expect } from 'vitest';
import { createDataReceipt, type DataReceipt, type VenueDerivatives } from '@midas/shared';
import { inspectVenueDerivativesSummary, summarizeVenueDerivatives } from './venueDerivatives';

const mk = (
  exchange: string,
  fundingRate: number | null,
  openInterestValue: number | null,
  fundingIntervalHours: number | null = 8,
): VenueDerivatives => ({
  exchange,
  fundingRate,
  fundingIntervalHours,
  nextFundingTime: null,
  markPrice: null,
  openInterestValue,
  timestamp: 0,
});

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function receipt(venue: string, ageMs = 1_000): DataReceipt {
  return createDataReceipt(
    {
      providerId: 'ccxt',
      providerVersion: '1',
      source: `ccxt:${venue.toLowerCase()}`,
      venue,
      datasetFamily: 'venue-derivatives',
      instrument: 'BTC/USDT',
      provenance: 'live',
      sourceAsOf: NOW - ageMs,
      observedAt: NOW - ageMs,
      maxAgeMs: 5_000,
    },
    NOW,
  );
}

describe('inspectVenueDerivativesSummary', () => {
  const rows = (): VenueDerivatives[] => [
    { ...mk('Binance', 0.0001, 1_000_000, 8), receipt: receipt('Binance') },
    { ...mk('OKX', -0.00005, 500_000, 8), receipt: receipt('OKX') },
  ];

  it('retains every venue input and the normalized formula', () => {
    const input = rows();
    const inspected = inspectVenueDerivativesSummary(input, 'BTC/USDT', NOW);
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      freshness: { state: 'fresh' },
      methodology: { id: 'cross-venue-derivatives-summary', version: '1.0' },
      inputReceiptIds: input.map((row) => row.receipt!.receiptId),
    });
    expect(inspected.stats.spread).not.toBeNull();
    expect(inspected.actionable).toBe(true);
  });

  it('suppresses aggregate signals when an input is stale', () => {
    const input = rows();
    input[1] = { ...input[1], receipt: receipt('OKX', 5_001) };
    const inspected = inspectVenueDerivativesSummary(input, 'BTC/USDT', NOW);
    expect(inspected.receipt?.freshness.state).toBe('stale');
    expect(inspected.stats).toMatchObject({ spread: null, totalOi: null, minVenue: null, maxVenue: null });
    expect(inspected.actionable).toBe(false);
  });

  it('fails closed for missing or incongruent venue evidence', () => {
    const missing = rows();
    missing[0] = { ...missing[0], receipt: undefined };
    expect(inspectVenueDerivativesSummary(missing, 'BTC/USDT', NOW)).toMatchObject({
      receipt: null,
      stats: { spread: null, totalOi: null },
    });
    const wrongVenue = rows();
    wrongVenue[0] = { ...wrongVenue[0], receipt: receipt('Kraken') };
    expect(inspectVenueDerivativesSummary(wrongVenue, 'BTC/USDT', NOW).receipt).toBeNull();
  });
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

  it('normalizes mixed settlement intervals before ranking funding', () => {
    const s = summarizeVenueDerivatives([
      mk('Hourly', 0.0001, null, 1),
      mk('EightHour', 0.0002, null, 8),
    ]);
    expect(s.maxVenue).toBe('Hourly');
    expect(s.maxFunding).toBeCloseTo(0.0008, 10);
    expect(s.minVenue).toBe('EightHour');
    expect(s.spread).toBeCloseTo(0.0006, 10);
  });

  it('excludes unknown cadence and preserves all-unknown OI as null', () => {
    const s = summarizeVenueDerivatives([
      mk('UnknownCadence', 0.0005, null, null),
      mk('EightHour', 0.0002, null, 8),
    ]);
    expect(s.spread).toBeNull();
    expect(s.totalOi).toBeNull();
  });

  it('returns null spread with fewer than two funding venues', () => {
    expect(summarizeVenueDerivatives([mk('A', 0.0001, 10)]).spread).toBeNull();
    expect(summarizeVenueDerivatives([mk('A', null, 10), mk('B', null, 20)]).spread).toBeNull();
  });

  it('handles an empty set', () => {
    const s = summarizeVenueDerivatives([]);
    expect(s.maxFunding).toBeNull();
    expect(s.spread).toBeNull();
    expect(s.totalOi).toBeNull();
    expect(s.venues).toBe(0);
  });
});
