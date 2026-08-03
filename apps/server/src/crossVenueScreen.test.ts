import { describe, it, expect } from 'vitest';
import {
  computeCrossVenueScreen,
  sortCrossVenueScreen,
  type VenueScreen,
  type VenueScreenRow,
} from '@midas/shared';

const row = (
  symbol: string,
  price: number,
  over: Partial<VenueScreenRow> = {},
): VenueScreenRow => ({
  symbol,
  name: symbol,
  price,
  changePercent: 0,
  volume: null,
  quoteVolume: null,
  ...over,
});

const venue = (exchange: string, rows: VenueScreenRow[], available = true): VenueScreen => ({
  exchange,
  available,
  rows,
  timestamp: null,
});

const bySymbol = <T extends { symbol: string }>(rows: T[], symbol: string): T => {
  const found = rows.find((r) => r.symbol === symbol);
  if (!found) throw new Error(`no row for ${symbol}`);
  return found;
};

describe('computeCrossVenueScreen — volume sums, price does not', () => {
  it('sums quote volume across venues rather than averaging it', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100, { quoteVolume: 300, volume: 3 })]),
      venue('kraken', [row('BTC/USDT', 100, { quoteVolume: 700, volume: 7 })]),
    ]);
    // Each venue's traded volume is its own — the union is the scale signal.
    expect(bySymbol(rows, 'BTC/USDT').totalQuoteVolume).toBe(1_000);
    expect(bySymbol(rows, 'BTC/USDT').totalVolume).toBe(10);
  });

  it('weights price by quote volume instead of summing it', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100, { quoteVolume: 750 })]),
      venue('kraken', [row('BTC/USDT', 200, { quoteVolume: 250 })]),
    ]);
    const btc = bySymbol(rows, 'BTC/USDT');
    // 100*0.75 + 200*0.25 = 125. A sum (300) would be meaningless for a price.
    expect(btc.price).toBe(125);
    expect(btc.basis).toBe('volume-weighted');
  });

  it('weights the 24h change too, and ignores venues that omit it', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100, { quoteVolume: 900, changePercent: 10 })]),
      venue('kraken', [row('BTC/USDT', 100, { quoteVolume: 100, changePercent: 0 })]),
      // Omits change but still contributes price and volume.
      venue('bitfinex', [row('BTC/USDT', 100, { quoteVolume: 1_000, changePercent: null })]),
    ]);
    const btc = bySymbol(rows, 'BTC/USDT');
    expect(btc.changePercent).toBe(9);
    expect(btc.totalQuoteVolume).toBe(2_000);
    expect(btc.venueCount).toBe(3);
  });

  it('falls back to an unweighted median and says so when no volume is reported', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100)]),
      venue('kraken', [row('BTC/USDT', 200)]),
      venue('bitfinex', [row('BTC/USDT', 300)]),
    ]);
    const btc = bySymbol(rows, 'BTC/USDT');
    expect(btc.price).toBe(200);
    // Labeled, not silently passed off as the volume-weighted figure.
    expect(btc.basis).toBe('median');
  });

  it('labels a single-venue listing rather than presenting it as market-wide', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('OBSCURE/USDT', 5, { quoteVolume: 10 })]),
      venue('kraken', [row('BTC/USDT', 100, { quoteVolume: 10 })]),
    ]);
    const obscure = bySymbol(rows, 'OBSCURE/USDT');
    expect(obscure.venueCount).toBe(1);
    expect(obscure.basis).toBe('single-venue');
    expect(obscure.priceDispersionBps).toBeNull();
  });
});

describe('computeCrossVenueScreen — dispersion and evidence handling', () => {
  it('measures price disagreement in basis points', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100)]),
      venue('kraken', [row('BTC/USDT', 101)]),
    ]);
    expect(bySymbol(rows, 'BTC/USDT').priceDispersionBps).toBeCloseTo(100, 6);
  });

  it('leaves dispersion null for a single venue — not zero', () => {
    const rows = computeCrossVenueScreen([venue('okx', [row('BTC/USDT', 100)])]);
    // Zero would claim the venues agree; there is only one venue.
    expect(bySymbol(rows, 'BTC/USDT').priceDispersionBps).toBeNull();
  });

  it('drops a venue with no usable price instead of admitting a zero', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100, { quoteVolume: 10 })]),
      venue('broken', [row('BTC/USDT', 0, { quoteVolume: 10 })]),
      venue('nan', [row('BTC/USDT', Number.NaN, { quoteVolume: 10 })]),
    ]);
    const btc = bySymbol(rows, 'BTC/USDT');
    // A 0 would read as a 100% cross-venue dispersion.
    expect(btc.venueCount).toBe(1);
    expect(btc.priceDispersionBps).toBeNull();
    expect(btc.price).toBe(100);
  });

  it('skips a venue that could not be screened at all', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100)]),
      venue('down', [row('BTC/USDT', 999)], false),
    ]);
    expect(bySymbol(rows, 'BTC/USDT').venueCount).toBe(1);
    expect(bySymbol(rows, 'BTC/USDT').price).toBe(100);
  });

  it('leaves totals null, never zero, when no venue reports volume', () => {
    const rows = computeCrossVenueScreen([venue('okx', [row('BTC/USDT', 100)])]);
    expect(bySymbol(rows, 'BTC/USDT').totalQuoteVolume).toBeNull();
    expect(bySymbol(rows, 'BTC/USDT').totalVolume).toBeNull();
  });

  it('unions the symbol set across venues', () => {
    const rows = computeCrossVenueScreen([
      venue('okx', [row('BTC/USDT', 100), row('ETH/USDT', 10)]),
      venue('kraken', [row('BTC/USDT', 100), row('SOL/USDT', 1)]),
    ]);
    expect(rows.map((r) => r.symbol).sort()).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
  });
});

describe('sortCrossVenueScreen', () => {
  const board = () =>
    computeCrossVenueScreen([
      venue('okx', [
        row('BTC/USDT', 100, { quoteVolume: 900, changePercent: 1 }),
        row('ETH/USDT', 10, { quoteVolume: 500, changePercent: 9 }),
        row('THIN/USDT', 1, { quoteVolume: 5, changePercent: 2 }),
      ]),
      venue('kraken', [
        row('BTC/USDT', 102, { quoteVolume: 100, changePercent: 1 }),
        row('ETH/USDT', 10, { quoteVolume: 100, changePercent: 9 }),
      ]),
    ]);

  it('ranks by each key, descending', () => {
    expect(sortCrossVenueScreen(board(), 'volume').map((r) => r.symbol)).toEqual([
      'BTC/USDT', 'ETH/USDT', 'THIN/USDT',
    ]);
    expect(sortCrossVenueScreen(board(), 'change')[0].symbol).toBe('ETH/USDT');
    expect(sortCrossVenueScreen(board(), 'price')[0].symbol).toBe('BTC/USDT');
    expect(sortCrossVenueScreen(board(), 'dispersion')[0].symbol).toBe('BTC/USDT');
  });

  it('ranks breadth by venue count', () => {
    const ranked = sortCrossVenueScreen(board(), 'venues');
    expect(ranked[ranked.length - 1].symbol).toBe('THIN/USDT');
  });

  it('sorts unknown metrics last rather than coercing them to zero', () => {
    // THIN is quoted by one venue, so its dispersion is unknown — it must not
    // outrank a symbol measured at a real (possibly small) dispersion.
    const ranked = sortCrossVenueScreen(board(), 'dispersion');
    expect(ranked[ranked.length - 1].symbol).toBe('THIN/USDT');
    expect(ranked[ranked.length - 1].priceDispersionBps).toBeNull();
  });
});
