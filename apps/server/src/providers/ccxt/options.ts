import type { Exchange, Ticker } from 'ccxt';
import type { DvolSnapshot, DvolSymbol, TermStructure, TermStructurePoint } from '@midas/shared';
import { annualizedBasisPct, partialEvidenceLimitation } from '@midas/shared';
import type { DataProvider } from '../types';
import { ProviderError } from '../types';
import { providerReceipt, providerUnavailableReceipt, withProviderDerivedReceipt, withProviderReceipt } from '../receipts';
import { safeErrorLabel, tickerPrice } from './helpers';

/**
 * The slice of CcxtProvider the extracted ccxt/* readers need, beyond the
 * DataProvider surface the receipt helpers already take (receipt identity:
 * `withProviderReceipt(ctx, …)` must keep embedding the provider's own
 * name/capabilities, so functions receive the provider instance, never a bare
 * Exchange). CcxtProvider satisfies this structurally; later decomposition
 * steps extend it (exchange, exchangeId, compareExchanges) as their modules
 * land.
 *
 * Convention (decided in step 2a, copied by later steps): ctx exposes
 * `normalize(symbol)` and each module derives its own base/perp forms from
 * it — delegates pass the raw caller symbol, never a pre-normalized one.
 */
export interface CcxtReadContext extends DataProvider {
  /** Injected clock (CcxtProviderDeps.now) — extracted code never calls Date.now. */
  readonly now: () => number;
  /** BTC-USD → BTC/USD; already-unified symbols pass through. */
  normalize(symbol: string): string;
  /** The lazy, public Deribit client backing the options surface. */
  deribit(): Exchange;
}

/** The fields the options surface reads off a ccxt option-chain entry. */
export interface DeribitOptionQuote {
  openInterest?: number;
  markPrice?: number;
  underlyingPrice?: number;
  timestamp?: number;
  info?: { mark_iv?: number };
}

/** Base asset of any symbol form — BTC/USDT, BTC-USD or BTC all give BTC. */
export function baseAsset(ctx: CcxtReadContext, symbol: string): string {
  return ctx.normalize(symbol).split('/')[0].replace(/:.*$/, '');
}

// Local copies of the ccxt.ts module-scope coercion helpers, pending step 1's
// shared providers/ccxt/coerce.ts (imported from there once it lands on main).
function sourceTimestampOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

async function dvolUnavailable(ctx: CcxtReadContext, symbol: DvolSymbol, note: string): Promise<DvolSnapshot> {
  const value: DvolSnapshot = {
    symbol, value: null, history: [], asOf: null, provenance: 'unavailable', source: 'ccxt:deribit', note,
  };
  return { ...value, receipt: providerUnavailableReceipt(ctx, {
    datasetFamily: 'options', source: 'ccxt:deribit', instrument: symbol, venue: 'deribit',
    coverage: 'Deribit DVOL level and history', units: { value: 'annualized-volatility-percent' }, note,
  }, ctx.now()) };
}

/**
 * The Deribit DVOL volatility index (30-day forward-looking implied vol).
 * ccxt exposes no unified method for it, so this uses the deribit client's
 * implicit get_volatility_index_data endpoint — guarded by a typeof check,
 * Unsupported capability is an honest unavailable result. Operational and
 * malformed upstream failures throw a sanitized ProviderError so status can
 * distinguish them from ordinary lack of support.
 */
export async function fetchDvol(ctx: CcxtReadContext, symbol: DvolSymbol): Promise<DvolSnapshot> {
  const ex = ctx.deribit() as Exchange & {
    publicGetGetVolatilityIndexData?: (params: Record<string, unknown>) => Promise<unknown>;
  };
  if (typeof ex.publicGetGetVolatilityIndexData !== 'function') {
    return dvolUnavailable(ctx, symbol, 'The installed ccxt build exposes no Deribit volatility-index endpoint — DVOL is unavailable.');
  }
  try {
    const end = ctx.now();
    const res = (await ex.publicGetGetVolatilityIndexData({
      currency: symbol,
      start_timestamp: end - 40 * 86_400_000,
      end_timestamp: end,
      resolution: '1D',
    })) as { result?: { data?: unknown } };
    // Rows are [timestamp_ms, open, high, low, close] — the daily index fixes.
    if (!Array.isArray(res?.result?.data)) {
      throw new ProviderError(
        `Deribit returned a malformed DVOL response for ${symbol}.`,
        502,
        symbol,
        'malformed-upstream',
      );
    }
    const rows = res.result.data as number[][];
    const history = rows
      .filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[4]) && r[4] > 0)
      .map((r) => ({ time: r[0], value: r[4] }));
    const last = history[history.length - 1];
    if (!last) {
      if (rows.length > 0) {
        throw new ProviderError(
          `Deribit returned malformed DVOL fixes for ${symbol}.`,
          502,
          symbol,
          'malformed-upstream',
        );
      }
      return dvolUnavailable(ctx, symbol, `Deribit returned no DVOL fixes for ${symbol} — nothing to show.`);
    }
    const omitted = rows.length - history.length;
    const value: DvolSnapshot = {
      symbol,
      value: last.value,
      history,
      asOf: last.time,
      provenance: 'live',
      source: 'ccxt:deribit',
      note: null,
    };
    return withProviderReceipt(ctx, value, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: symbol, venue: 'deribit',
      provenance: 'live', sourceAsOf: last.time, coverage: 'Deribit DVOL level and history',
      units: { value: 'annualized-volatility-percent' },
      limitations: omitted > 0
        ? [partialEvidenceLimitation(
            `DVOL read attempted ${rows.length} fix row(s); ${history.length} returned usable evidence and ${omitted} were malformed and omitted.`,
          )]
        : [],
    }, end);
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`Deribit DVOL read failed — ${safeErrorLabel(err)}.`, 502, symbol);
  }
}

/**
 * Dated-futures term structure for an underlying from Deribit: the listed
 * futures (swap:false, future:true) priced from their tickers, with the
 * annualized basis vs the perpetual mark. Futures with no usable price are
 * dropped rather than shown with a fabricated basis; an underlying with no
 * dated futures is an honest 'unavailable'.
 */
export async function fetchFuturesTermStructure(ctx: CcxtReadContext, symbol: string): Promise<TermStructure> {
  const base = baseAsset(ctx, symbol);
  const now = ctx.now();
  const unavailable = (note: string): TermStructure => {
    const value: TermStructure = {
      underlying: base, referencePrice: null, perpPrice: null, points: [], asOf: null,
      provenance: 'unavailable', source: 'ccxt:deribit', note,
    };
    return { ...value, receipt: providerUnavailableReceipt(ctx, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
      coverage: 'Deribit dated-futures term structure', units: { price: 'USD', annualizedBasisPct: 'percent' }, note,
    }, now) };
  };
  const ex = ctx.deribit();
  try {
    await ex.loadMarkets();
  } catch (err) {
    throw new ProviderError(`Deribit markets read failed — ${safeErrorLabel(err)}.`, 502, base);
  }
  const markets = Object.values(ex.markets ?? {}) as Array<{
    symbol: string;
    base?: string;
    active?: boolean;
    swap?: boolean;
    future?: boolean;
    expiry?: number;
  }>;
  const futures = markets.filter(
    (m) => m.future === true && m.swap !== true && m.base === base && m.active !== false && typeof m.expiry === 'number' && m.expiry > now,
  );
  if (futures.length === 0) {
    return unavailable(`Deribit lists no active dated ${base} futures — no term structure to show.`);
  }
  const perp = markets.find((m) => m.swap === true && m.base === base);
  const wanted = [...futures.map((f) => f.symbol), ...(perp ? [perp.symbol] : [])];
  // One batched read; a venue that rejects the batch falls back per-symbol so
  // one bad instrument doesn't sink the board (same pattern as priceAssetsUsd).
  const tickers: Record<string, Ticker> = {};
  let tickerReadFailures = 0;
  let batchFailureLabel: string | null = null;
  try {
    Object.assign(tickers, await ex.fetchTickers(wanted));
  } catch (error) {
    batchFailureLabel = safeErrorLabel(error);
    await Promise.all(
      wanted.map(async (s) => {
        try {
          tickers[s] = await ex.fetchTicker(s);
        } catch {
          tickerReadFailures += 1;
          // leave this instrument unpriced — its point is dropped below
        }
      }),
    );
  }
  if (wanted.length > 0 && Object.keys(tickers).length === 0) {
    throw new ProviderError(
      `Deribit futures ticker read failed — ${batchFailureLabel ?? 'error'}.`,
      502,
      base,
    );
  }
  const perpPrice = perp ? tickerPrice(tickers[perp.symbol] ?? {}) : null;
  const points: TermStructurePoint[] = [];
  for (const f of futures) {
    const price = tickerPrice(tickers[f.symbol] ?? {});
    const days = (f.expiry! - now) / 86_400_000;
    const basis = annualizedBasisPct(price, perpPrice, days);
    // No price or no basis → the point is dropped, never zeroed in.
    if (price == null || basis == null) continue;
    points.push({ expiry: f.expiry!, futureSymbol: f.symbol, price, annualizedBasisPct: basis, daysToExpiry: days });
  }
  points.sort((a, b) => a.expiry - b.expiry);
  if (points.length === 0) {
    if (perp && Object.keys(tickers).length > 0) {
      throw new ProviderError(
        `Deribit returned malformed or unpriced ${base} futures tickers.`,
        502,
        base,
        'malformed-upstream',
      );
    }
    return unavailable(`Deribit returned no usable, perp-referenced ${base} futures prices.`);
  }
  const usableTickerCount = wanted.filter((tickerSymbol) => tickerPrice(tickers[tickerSymbol] ?? {}) !== null).length;
  const omittedTickerCount = wanted.length - usableTickerCount;
  const contributingTickers = [
    ...(perp ? [tickers[perp.symbol]] : []),
    ...points.map((point) => tickers[point.futureSymbol]),
  ].filter((ticker): ticker is Ticker => ticker != null);
  const tickerTimes = contributingTickers.map((ticker) => sourceTimestampOrNull(ticker.timestamp));
  const sourceAsOf = tickerTimes.length > 0 && tickerTimes.every((timestamp) => timestamp !== null)
    ? Math.min(...tickerTimes as number[])
    : null;
  const value: TermStructure = {
    underlying: base,
    referencePrice: perpPrice,
    perpPrice,
    points: points.slice(0, 12),
    asOf: sourceAsOf,
    provenance: 'live',
    source: 'ccxt:deribit',
    note: perpPrice == null ? 'No Deribit perpetual price — basis could not be referenced to the perp.' : null,
  };
  const rawInput = providerReceipt(ctx, {
    datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
    provenance: 'live', sourceAsOf, coverage: 'raw Deribit futures and perpetual ticker prices',
    units: { price: 'USD' },
    limitations: [
      ...(sourceAsOf === null ? ['One or more contributing Deribit tickers omitted a source timestamp.'] : []),
      ...(omittedTickerCount > 0
        ? [partialEvidenceLimitation(
            `Futures ticker fan-out attempted ${wanted.length} instrument(s); ${usableTickerCount} returned usable prices, ${tickerReadFailures} reads failed, and ${Math.max(0, omittedTickerCount - tickerReadFailures)} were missing or malformed.`,
          )]
        : []),
    ],
  }, now);
  return withProviderDerivedReceipt(ctx, value, {
    datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
    provenance: 'live', inputReceipts: [rawInput], sourceAsOf,
    coverage: 'Deribit dated-futures term structure',
    units: { price: 'USD', annualizedBasisPct: 'percent' },
    methodology: {
      id: 'midas.annualized-simple-basis', version: '1.0.0',
      formula: '(F/S - 1) * 365/days * 100',
    },
    note: value.note,
  }, now);
}
