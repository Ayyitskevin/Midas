import { describe, it, expect } from 'vitest';
import {
  computeVenueArbRow,
  createDataReceipt,
  netSpreadBps,
  roundTripFeesBps,
  takerFeeBps,
  type VenueQuote,
} from '@midas/shared';

// Coverage for the net-of-fees arb view: the static reference taker schedule
// (fees.ts) and the feeBps/netSpreadBps/netCrossed fields computeVenueArbRow
// derives from it — the same computation the ARB panel and XARB screener render.
const v = (
  exchange: string,
  bid: number | null,
  ask: number | null,
  price: number,
  bidSize: number | null = 1,
  askSize: number | null = 1,
  timestamp = 1_000,
): VenueQuote => ({
  exchange,
  bid,
  ask,
  price,
  changePercent: 0,
  volume: null,
  bidSize,
  askSize,
  timestamp,
  receipt: createDataReceipt(
    {
      providerId: 'test',
      providerVersion: '1',
      source: `test:${exchange.toLowerCase()}`,
      venue: exchange,
      datasetFamily: 'venue-quotes',
      instrument: 'BTC/USDT',
      provenance: 'live',
      sourceAsOf: timestamp,
      observedAt: timestamp,
      maxAgeMs: 30_000,
    },
    timestamp,
  ),
});

describe('takerFeeBps (reference schedule)', () => {
  it('returns the reference base-tier taker fee for known venues, case-insensitively', () => {
    expect(takerFeeBps('Binance')).toBe(10);
    expect(takerFeeBps('binance')).toBe(10);
    expect(takerFeeBps('Coinbase')).toBe(60);
    expect(takerFeeBps('kraken')).toBe(80);
    expect(takerFeeBps('OKX')).toBe(10);
    expect(takerFeeBps('Bybit')).toBe(10);
    expect(takerFeeBps('Bitfinex')).toBe(20);
    expect(takerFeeBps('KuCoin')).toBe(10);
  });

  it('returns null for unknown or missing venues — never assumes 0', () => {
    expect(takerFeeBps('mexc')).toBeNull();
    expect(takerFeeBps('')).toBeNull();
    expect(takerFeeBps(null)).toBeNull();
    expect(takerFeeBps(undefined)).toBeNull();
  });

  it('covers every venue id the compare path produces (drift guard)', () => {
    // Mirrors COMPARE_VENUES in apps/server/src/providers/mock/fixtures.ts —
    // the mock compare set — and the ccxt display names / lowercase ids the
    // live compare path reports (ex.name ?? ex.id). If the compare set grows,
    // add the venue here AND an explicit tier in shared/src/fees.ts.
    const compareVenueIds = ['Binance', 'Coinbase', 'Kraken', 'Bitfinex', 'OKX', 'KuCoin'];
    const ccxtIds = ['binance', 'coinbase', 'kraken', 'bitfinex', 'okx', 'kucoin', 'bybit'];
    for (const id of [...compareVenueIds, ...ccxtIds]) {
      expect(takerFeeBps(id), `venue ${id} needs an explicit reference tier in fees.ts`).not.toBeNull();
    }
  });
});

describe('roundTripFeesBps / netSpreadBps', () => {
  it('sums the taker fees of the buy and sell legs', () => {
    expect(roundTripFeesBps('Binance', 'OKX')).toBe(20); // 10 + 10
    expect(roundTripFeesBps('Coinbase', 'Binance')).toBe(70); // 60 + 10
    expect(roundTripFeesBps('Kraken', 'Coinbase')).toBe(140); // 80 + 60
  });

  it('returns null when either leg venue is unknown', () => {
    expect(roundTripFeesBps('Binance', 'mexc')).toBeNull();
    expect(roundTripFeesBps('mexc', 'Binance')).toBeNull();
  });

  it('subtracts the round trip from the gross spread', () => {
    expect(netSpreadBps(200, 'Binance', 'OKX')).toBe(180);
    expect(netSpreadBps(50, 'Coinbase', 'Binance')).toBe(-20); // crossed gross, net negative
  });

  it('returns null for a missing spread or unknown venue, not 0', () => {
    expect(netSpreadBps(null, 'Binance', 'OKX')).toBeNull();
    expect(netSpreadBps(200, 'Binance', 'mexc')).toBeNull();
  });
});

describe('computeVenueArbRow — net-of-fees fields', () => {
  it('nets the spread against both legs’ reference taker fees', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('Binance', 100, 101, 100.5),
      v('OKX', 102, 103, 102.5), // highest bid → sell here
      v('Kraken', 99, 100, 99.5), // lowest ask → buy here
    ], 1_000);
    expect(r.spreadBps).toBeCloseTo(200); // (102 − 100) / 100 × 10 000
    expect(r.feeBps).toBe(90); // buy Kraken 80 + sell OKX 10
    expect(r.netSpreadBps).toBeCloseTo(110);
    expect(r.netCrossed).toBe(true);
  });

  it('a gross-crossed book inside the fee round trip is NOT net-crossed', () => {
    // 0.5% gross spread, but Coinbase↔Kraken taker round trip is 140 bps.
    const r = computeVenueArbRow('BTC/USDT', [
      v('Coinbase', 100.5, 101, 100.75), // highest bid → sell here
      v('Kraken', 99.9, 100, 99.95), // lowest ask → buy here
    ], 1_000);
    expect(r.crossed).toBe(true); // gross arb…
    expect(r.spreadBps).toBeCloseTo(50);
    expect(r.feeBps).toBe(140);
    expect(r.netSpreadBps).toBeCloseTo(-90);
    expect(r.netCrossed).toBe(false); // …that fees consume
  });

  it('reports null net fields when a leg venue is missing from the schedule', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('mexc', 102, 103, 102.5), // unknown venue, highest bid
      v('Binance', 99, 100, 99.5),
    ], 1_000);
    expect(r.crossed).toBe(true); // gross signal still computed
    expect(r.feeBps).toBeNull();
    expect(r.netSpreadBps).toBeNull();
    expect(r.netCrossed).toBe(false); // unknown fees ⇒ not actionable, not green
  });

  it('withholds net evidence when executable size is unknown', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('Binance', 102, 103, 102.5, null, null),
      v('OKX', 99, 100, 99.5, null, null),
    ], 1_000);
    expect(r.crossed).toBe(true);
    expect(r.feeBps).toBe(20);
    expect(r.executableSize).toBeNull();
    expect(r.netSpreadBps).toBeNull();
    expect(r.netCrossed).toBe(false);
    expect(r.netLimitations).toContain('Executable bid/ask size is unknown.');
  });

  it('withholds net evidence when selected leg timestamps are too far apart', () => {
    const r = computeVenueArbRow('BTC/USDT', [
      v('Binance', 102, 103, 102.5, 2, 2, 20_001),
      v('OKX', 99, 100, 99.5, 2, 2, 10_000),
    ], 20_001);
    expect(r.timestampSkewMs).toBe(10_001);
    expect(r.netSpreadBps).toBeNull();
    expect(r.netLimitations.join(' ')).toMatch(/timestamps/i);
  });

  it('withholds net evidence for aligned but stale or future-dated legs', () => {
    const stale = computeVenueArbRow('BTC/USDT', [
      v('Binance', 102, 103, 102.5, 2, 2, 1_000),
      v('OKX', 99, 100, 99.5, 2, 2, 1_000),
    ], 31_001);
    expect(stale.netSpreadBps).toBeNull();
    expect(stale.netLimitations.join(' ')).toMatch(/old/i);

    const future = computeVenueArbRow('BTC/USDT', [
      v('Binance', 102, 103, 102.5, 2, 2, 2_000),
      v('OKX', 99, 100, 99.5, 2, 2, 2_000),
    ], 1_000);
    expect(future.netSpreadBps).toBeNull();
    expect(future.netLimitations.join(' ')).toMatch(/clock skew/i);
  });

  it('keeps the same-venue-leg guard: no spread, no fees, no net', () => {
    const r = computeVenueArbRow('BTC/USDT', [v('Binance', 105, 100, 102), v('OKX', 101, 102, 101.5)]);
    expect(r.bestBid?.exchange).toBe('Binance');
    expect(r.bestAsk?.exchange).toBe('Binance');
    expect(r.spreadBps).toBeNull();
    expect(r.feeBps).toBeNull();
    expect(r.netSpreadBps).toBeNull();
    expect(r.netCrossed).toBe(false);
  });

  it('computes fees even for a non-crossed cross-venue book (negative net)', () => {
    const r = computeVenueArbRow('BTC/USDT', [v('Binance', 100, 101, 100.5), v('OKX', 100.5, 101.5, 101)], 1_000);
    expect(r.crossed).toBe(false);
    expect(r.feeBps).toBe(20);
    expect(r.netSpreadBps).toBeLessThan(0);
    expect(r.netCrossed).toBe(false);
  });

  it('an empty venue set yields null net fields', () => {
    const r = computeVenueArbRow('BTC/USDT', []);
    expect(r.feeBps).toBeNull();
    expect(r.netSpreadBps).toBeNull();
    expect(r.netCrossed).toBe(false);
  });
});
