import { describe, it, expect } from 'vitest';
import type { Exchange } from 'ccxt';
import { CcxtProvider } from './ccxt';

/**
 * Coverage for the Deribit options surface (DVOL, futures term structure,
 * options chain) with a fully stubbed Deribit client — no exchange is ever
 * contacted. Verifies the honest-degradation contract: live only when the
 * venue actually answered, 'unavailable' with a sanitized note otherwise, and
 * never a fabricated level, basis or OI.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-08-01T12:00:00.000Z');

/** A provider with injected primary, Deribit, and clock seams; no network access. */
const makeProvider = (deribit: Record<string, unknown>): CcxtProvider =>
  new CcxtProvider(undefined, {
    exchange: { id: 'binance', name: 'Binance', has: {} } as unknown as Exchange,
    compareExchanges: [],
    deribit: deribit as unknown as Exchange,
    now: () => NOW,
  });

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

  it('is honestly unavailable on an empty successful read but throws on operational failure', async () => {
    const empty = await makeProvider({
      publicGetGetVolatilityIndexData: async () => ({ result: { data: [] } }),
    }).getDvol('BTC');
    expect(empty.provenance).toBe('unavailable');
    expect(empty.value).toBeNull();

    const err = new Error('GET https://www.deribit.com/api/v2/x?signature=deadbeef 500');
    err.name = 'ExchangeNotAvailable';
    const failed = makeProvider({
      publicGetGetVolatilityIndexData: async () => {
        throw err;
      },
    });
    const failure = await failed.getDvol('BTC').catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ name: 'ProviderError', statusCode: 502 });
    expect((failure as Error).message).toContain('ExchangeNotAvailable');
    expect((failure as Error).message).not.toContain('signature=');
    expect((failure as Error).message).not.toContain('deribit.com');
  });

  it('marks mixed malformed fixes partial and rejects wholly malformed fixes', async () => {
    const mixed = await makeProvider({
      publicGetGetVolatilityIndexData: async () => ({ result: { data: [[NOW - DAY, 1, 1, 1, null], [NOW, 1, 1, 1, 55]] } }),
    }).getDvol('BTC');
    expect(mixed.value).toBe(55);
    expect(mixed.receipt?.limitations.join(' ')).toMatch(/attempted 2.*1 returned.*1.*malformed/i);

    await expect(makeProvider({
      publicGetGetVolatilityIndexData: async () => ({ result: { data: [[NOW, 1, 1, 1, null]] } }),
    }).getDvol('BTC')).rejects.toMatchObject({ name: 'ProviderError', statusCode: 502 });
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
    expect(ts.points[0].annualizedBasisPct).toBeCloseTo(5, 6);
    expect(ts.points[1].annualizedBasisPct).toBeCloseTo(6, 6);
  });

  it('drops a future with no usable price rather than fabricating a basis', async () => {
    const ts = await makeProvider({
      ...stub,
      fetchTickers: async () => ({ [perpSym]: ticker(100), [f1.symbol]: ticker(null), [f2.symbol]: ticker(103) }),
    }).getFuturesTermStructure('BTC');
    expect(ts.points.map((p) => p.futureSymbol)).toEqual([f2.symbol]);
    expect(ts.receipt?.limitations.join(' ')).toMatch(/attempted 3.*2 returned.*1.*missing or malformed/i);
  });

  it('is honestly unavailable for an underlying with no dated futures', async () => {
    const ts = await makeProvider(stub).getFuturesTermStructure('DOGE/USDT');
    expect(ts.provenance).toBe('unavailable');
    expect(ts.points).toEqual([]);
    expect(ts.note).toMatch(/no active dated DOGE futures/);
  });

  it('throws sanitized errors for market-read and total ticker-read failures', async () => {
    const marketError = new Error('signature=secret-value');
    marketError.name = 'NetworkError';
    const failedMarkets = makeProvider({ loadMarkets: async () => { throw marketError; } });
    const first = await failedMarkets.getFuturesTermStructure('BTC').catch((caught: unknown) => caught);
    expect(first).toMatchObject({ name: 'ProviderError', statusCode: 502 });
    expect((first as Error).message).toContain('NetworkError');
    expect((first as Error).message).not.toContain('secret-value');

    const failedTickers = makeProvider({
      ...stub,
      fetchTickers: async () => { throw marketError; },
      fetchTicker: async () => { throw marketError; },
    });
    const second = await failedTickers.getFuturesTermStructure('BTC').catch((caught: unknown) => caught);
    expect(second).toMatchObject({ name: 'ProviderError', statusCode: 502 });
    expect((second as Error).message).not.toContain('secret-value');
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

  it('is honestly unavailable when options are unsupported or unlisted', async () => {
    const noSupport = await makeProvider({ has: {}, loadMarkets: async () => ({}), markets: {} }).getOptionsChain('BTC');
    expect(noSupport.provenance).toBe('unavailable');

    const unlisted = await makeProvider(stub).getOptionsChain('DOGE');
    expect(unlisted.provenance).toBe('unavailable');
    expect(unlisted.entries).toEqual([]);
    expect(unlisted.note).toMatch(/no active DOGE options/);

  });

  it('throws sanitized operational failures and wholly malformed observations', async () => {
    const err = new Error('deribit GET https://www.deribit.com/api?signature=abc 429');
    err.name = 'DDoSProtection';
    const failed = makeProvider({
      ...stub,
      fetchOptionChain: async () => {
        throw err;
      },
    });
    const failure = await failed.getOptionsChain('BTC').catch((caught: unknown) => caught);
    expect(failure).toMatchObject({ name: 'ProviderError', statusCode: 502 });
    expect((failure as Error).message).toContain('DDoSProtection');
    expect((failure as Error).message).not.toContain('signature=');

    const failedMarkets = makeProvider({
      has: { fetchOptionChain: true },
      loadMarkets: async () => {
        throw err;
      },
    });
    await expect(failedMarkets.getOptionsChain('BTC')).rejects.toMatchObject({
      name: 'ProviderError',
      statusCode: 502,
      dataHealthCategory: 'upstream-unavailable',
    });

    const emptyObservations = Object.fromEntries(Object.keys(chain).map((key) => [key, {}]));
    await expect(makeProvider({
      ...stub,
      fetchOptionChain: async () => emptyObservations,
    }).getOptionsChain('BTC')).rejects.toMatchObject({
      name: 'ProviderError', statusCode: 502, dataHealthCategory: 'malformed-upstream',
    });
  });

  it('records attempted/returned counts when listed option observations are partial', async () => {
    const partialChain = { ...chain };
    delete partialChain[optionMarket(90, 'put').symbol];
    const result = await makeProvider({
      ...stub,
      fetchOptionChain: async () => partialChain,
    }).getOptionsChain('BTC');
    expect(result.maxPainStrike).toBeNull();
    expect(result.putCallOiRatio).toBeNull();
    expect(result.receipt?.limitations.join(' ')).toMatch(/attempted 10.*9 returned.*1.*missing or malformed/i);
    expect(result.receipt?.limitations.join(' ')).toMatch(/summaries were withheld.*not coerced to zero/i);
  });

  it('withholds OI summaries when a returned contract omits open interest', async () => {
    const partialOiChain = {
      ...chain,
      [optionMarket(90, 'put').symbol]: {
        ...(chain[optionMarket(90, 'put').symbol] as Record<string, unknown>),
        openInterest: undefined,
      },
    };
    const result = await makeProvider({
      ...stub,
      fetchOptionChain: async () => partialOiChain,
    }).getOptionsChain('BTC');
    expect(result.entries.find((entry) => entry.strike === 90)?.putOi).toBeNull();
    expect(result.maxPainStrike).toBeNull();
    expect(result.putCallOiRatio).toBeNull();
    expect(result.receipt?.limitations.join(' ')).toMatch(/summary attempted 10.*9 returned.*1.*missing or malformed/i);
    expect(result.receipt?.limitations.join(' ')).toMatch(/summaries were withheld.*not coerced to zero/i);
  });

  it('omits an unknown optionType instead of fabricating it as put evidence', async () => {
    const unknown = {
      symbol: `BTC/USD:BTC-${expiry}-100-X`, base: 'BTC', option: true,
      active: true, expiry, strike: 100, optionType: 'mystery',
    };
    const marketsWithUnknown = { ...markets, [unknown.symbol]: unknown };
    const chainWithUnknown = { ...chain, [unknown.symbol]: quote(50_000, 0.02) };
    const result = await makeProvider({
      ...stub,
      markets: marketsWithUnknown,
      loadMarkets: async () => marketsWithUnknown,
      fetchOptionChain: async () => chainWithUnknown,
    }).getOptionsChain('BTC');
    expect(result.putCallOiRatio).toBeCloseTo((900 + 90 * 4) / (1000 + 100 * 4), 10);
    expect(result.receipt?.limitations.join(' ')).toMatch(/market.*attempted 12.*11 were usable.*1.*malformed/i);
  });
});
