import { describe, it, expect } from 'vitest';
import { CcxtProvider } from './ccxt';

/**
 * Coverage for the Deribit options surface (DVOL, futures term structure,
 * options chain) with a fully stubbed Deribit client — no exchange is ever
 * contacted. Verifies the honest-degradation contract: live only when the
 * venue actually answered, 'unavailable' with a sanitized note otherwise, and
 * never a fabricated level, basis or OI.
 */

const DAY = 86_400_000;
const NOW = Date.now();

/** A provider whose lazy Deribit client is swapped for the given stub. */
const makeProvider = (deribit: Record<string, unknown>): CcxtProvider => {
  const p = new CcxtProvider({ exchange: 'binance', apiKey: 'test-key', secret: 'test-secret' });
  (p as unknown as { deribitClient: unknown }).deribitClient = deribit;
  return p;
};

const ticker = (last: number | null) => ({ last, bid: null, ask: null, close: null });

describe('CcxtProvider.getDvol', () => {
  it('reads the index level and history from the volatility-index endpoint', async () => {
    const p = makeProvider({
      publicGetGetVolatilityIndexData: async () => ({
        result: {
          data: [
            [NOW - 2 * DAY, 50, 52, 49, 51],
            [NOW - DAY, 51, 54, 50, 53],
            [NOW, 53, 56, 52, 55],
          ],
        },
      }),
    });
    const snap = await p.getDvol('BTC');
    expect(snap.provenance).toBe('live');
    expect(snap.source).toBe('ccxt:deribit');
    expect(snap.note).toBeNull();
    expect(snap.value).toBe(55);
    expect(snap.history).toHaveLength(3);
    expect(snap.asOf).toBe(NOW);
  });

  it('is honestly unavailable when the ccxt build lacks the endpoint', async () => {
    const p = makeProvider({});
    const snap = await p.getDvol('ETH');
    expect(snap.provenance).toBe('unavailable');
    expect(snap.value).toBeNull();
    expect(snap.history).toEqual([]);
    expect(snap.note).toMatch(/no Deribit volatility-index endpoint/);
  });

  it('is honestly unavailable on empty data or a failed read — never a fabricated level', async () => {
    const empty = await makeProvider({
      publicGetGetVolatilityIndexData: async () => ({ result: { data: [] } }),
    }).getDvol('BTC');
    expect(empty.provenance).toBe('unavailable');
    expect(empty.value).toBeNull();

    const err = new Error('GET https://www.deribit.com/api/v2/x?signature=deadbeef 500');
    err.name = 'ExchangeNotAvailable';
    const failed = await makeProvider({
      publicGetGetVolatilityIndexData: async () => {
        throw err;
      },
    }).getDvol('BTC');
    expect(failed.provenance).toBe('unavailable');
    expect(failed.note).toContain('ExchangeNotAvailable');
    expect(failed.note).not.toContain('signature='); // sanitized, like every ccxt path
    expect(failed.note).not.toContain('deribit.com');
  });
});

describe('CcxtProvider.getFuturesTermStructure', () => {
  const markets: Record<string, unknown> = {};
  const perpSym = 'BTC/USD:BTC';
  const f1 = { symbol: 'BTC/USD:BTC-F1', base: 'BTC', future: true, swap: false, active: true, expiry: NOW + 36.5 * DAY };
  const f2 = { symbol: 'BTC/USD:BTC-F2', base: 'BTC', future: true, swap: false, active: true, expiry: NOW + 182.5 * DAY };
  const expired = { symbol: 'BTC/USD:BTC-OLD', base: 'BTC', future: true, swap: false, active: true, expiry: NOW - DAY };
  const ethFut = { symbol: 'ETH/USD:ETH-F1', base: 'ETH', future: true, swap: false, active: true, expiry: NOW + 36.5 * DAY };
  for (const m of [
    { symbol: perpSym, base: 'BTC', swap: true, active: true },
    f1,
    f2,
    expired,
    ethFut,
  ]) {
    markets[(m as { symbol: string }).symbol] = m;
  }

  const stub = {
    loadMarkets: async () => markets,
    markets,
    fetchTickers: async () => ({
      [perpSym]: ticker(100),
      [f1.symbol]: ticker(100.5),
      [f2.symbol]: ticker(103),
    }),
  };

  it('prices the calendar curve with annualized basis vs the perp', async () => {
    const ts = await makeProvider(stub).getFuturesTermStructure('BTC/USDT');
    expect(ts.provenance).toBe('live');
    expect(ts.underlying).toBe('BTC');
    expect(ts.perpPrice).toBe(100);
    expect(ts.referencePrice).toBe(100);
    // The expired contract is excluded; both live futures appear nearest-first.
    expect(ts.points.map((p) => p.futureSymbol)).toEqual([f1.symbol, f2.symbol]);
    // 0.5% over 36.5 days → 5% annualized; 3% over 182.5 days → 6% annualized.
    // (module-load NOW vs provider Date.now() drift keeps this off exact 5/6)
    expect(ts.points[0].annualizedBasisPct).toBeCloseTo(5, 6);
    expect(ts.points[1].annualizedBasisPct).toBeCloseTo(6, 6);
  });

  it('drops a future with no usable price rather than fabricating a basis', async () => {
    const ts = await makeProvider({
      ...stub,
      fetchTickers: async () => ({ [perpSym]: ticker(100), [f1.symbol]: ticker(null), [f2.symbol]: ticker(103) }),
    }).getFuturesTermStructure('BTC');
    expect(ts.points.map((p) => p.futureSymbol)).toEqual([f2.symbol]);
  });

  it('is honestly unavailable for an underlying with no dated futures', async () => {
    const ts = await makeProvider(stub).getFuturesTermStructure('DOGE/USDT');
    expect(ts.provenance).toBe('unavailable');
    expect(ts.points).toEqual([]);
    expect(ts.note).toMatch(/no active dated DOGE futures/);
  });
});

describe('CcxtProvider.getOptionsChain', () => {
  const expiry = NOW + 7 * DAY;
  const later = expiry + 7 * DAY;
  const optionMarket = (strike: number, type: 'call' | 'put', exp = expiry) => ({
    symbol: `BTC/USD:BTC-${exp}-${strike}-${type === 'call' ? 'C' : 'P'}`,
    base: 'BTC',
    option: true,
    active: true,
    expiry: exp,
    strike,
    optionType: type,
  });
  const strikes = [90, 95, 100, 105, 110];
  const markets: Record<string, unknown> = {};
  for (const k of strikes) {
    for (const t of ['call', 'put'] as const) markets[optionMarket(k, t).symbol] = optionMarket(k, t);
  }
  // A later-expiry option that must not leak into the nearest chain.
  const laterCall = optionMarket(100, 'call', later);
  markets[laterCall.symbol] = laterCall;

  // OI: calls cluster at 100, puts cluster at 100 → max pain at 100.
  const quote = (oi: number, markBtc: number) => ({
    openInterest: oi,
    markPrice: markBtc,
    underlyingPrice: 100,
    info: { mark_iv: 55 },
  });
  const chain: Record<string, unknown> = {};
  for (const k of strikes) {
    chain[optionMarket(k, 'call').symbol] = quote(k === 100 ? 1000 : 100, 0.01);
    chain[optionMarket(k, 'put').symbol] = quote(k === 100 ? 900 : 90, 0.02);
  }
  chain[laterCall.symbol] = quote(5000, 0.01);

  const stub = {
    has: { fetchOptionChain: true },
    loadMarkets: async () => markets,
    markets,
    fetchOptionChain: async (code: string) => (code === 'BTC' ? chain : {}),
  };

  it('groups strikes, converts inverse marks to USD and derives max pain / PCR', async () => {
    const c = await makeProvider(stub).getOptionsChain('BTC');
    expect(c.provenance).toBe('live');
    expect(c.underlying).toBe('BTC');
    expect(c.expiry).toBe(expiry);
    expect(c.underlyingPrice).toBe(100);
    expect(c.entries.map((e) => e.strike)).toEqual(strikes);
    // The later-expiry contract never leaks into the nearest chain.
    expect(c.entries.every((e) => e.expiry === expiry)).toBe(true);
    expect(c.entries.find((e) => e.strike === 100)!.callOi).toBe(1000);
    // Inverse mark 0.01 BTC × underlying 100 → 1 USD; IV passes through.
    expect(c.entries.find((e) => e.strike === 100)!.callMark).toBeCloseTo(1, 10);
    expect(c.entries.find((e) => e.strike === 100)!.iv).toBe(55);
    expect(c.maxPainStrike).toBe(100);
    expect(c.putCallOiRatio).toBeCloseTo((900 + 90 * 4) / (1000 + 100 * 4), 10);
  });

  it('honours an explicit expiry', async () => {
    const c = await makeProvider(stub).getOptionsChain('BTC', later);
    expect(c.expiry).toBe(later);
    expect(c.entries.map((e) => e.strike)).toEqual([100]);
    expect(c.entries[0].callOi).toBe(5000);
  });

  it('is honestly unavailable when options are unsupported, unlisted or the read fails', async () => {
    const noSupport = await makeProvider({ has: {}, loadMarkets: async () => ({}), markets: {} }).getOptionsChain('BTC');
    expect(noSupport.provenance).toBe('unavailable');

    const unlisted = await makeProvider(stub).getOptionsChain('DOGE');
    expect(unlisted.provenance).toBe('unavailable');
    expect(unlisted.entries).toEqual([]);
    expect(unlisted.note).toMatch(/no active DOGE options/);

    const err = new Error('deribit GET https://www.deribit.com/api?signature=abc 429');
    err.name = 'DDoSProtection';
    const failed = await makeProvider({
      ...stub,
      fetchOptionChain: async () => {
        throw err;
      },
    }).getOptionsChain('BTC');
    expect(failed.provenance).toBe('unavailable');
    expect(failed.note).toContain('DDoSProtection');
    expect(failed.note).not.toContain('signature=');
  });
});
