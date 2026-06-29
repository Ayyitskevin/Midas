import * as ccxt from 'ccxt';
import type { Exchange, Ticker } from 'ccxt';
import type {
  Candle,
  DerivativesInfo,
  LiquidationsProvenance,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  NewsItem,
  OrderBook,
  Quote,
  ScreenerRow,
  SearchResult,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import { INTERVAL_SECONDS, RANGE_SECONDS, sortScreener } from './util';

/**
 * Live crypto market data via CCXT — one integration, ~100+ exchanges, with
 * public market-data endpoints that require no API keys. This is the cornerstone
 * of Midas's crypto-native direction (see VISION.md).
 *
 * Exchange is chosen with MIDAS_CCXT_EXCHANGE (default "binance"). Symbols use
 * CCXT unified form (BASE/QUOTE, e.g. BTC/USDT); a BASE-QUOTE form is also
 * accepted as a convenience.
 *
 * Note: requires outbound network access to the exchange's API. In
 * restricted/sandboxed environments use the `mock` provider instead.
 */
const TIMEFRAME_MAP: Record<Interval, string> = {
  '1m': '1m',
  '2m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '60m': '1h',
  '90m': '1h',
  '1d': '1d',
  '1wk': '1w',
  '1mo': '1M',
};

function num(value: number | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export class CcxtProvider implements DataProvider {
  readonly name: string;
  readonly live = true;
  private readonly exchange: Exchange;
  private marketsPromise: Promise<unknown> | null = null;
  private compareExchanges: Exchange[] | null = null;

  constructor() {
    const id = (process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
    const registry = ccxt as unknown as Record<string, new (config: object) => Exchange>;
    const ExchangeCtor = registry[id];
    if (typeof ExchangeCtor !== 'function') {
      throw new Error(`Unknown ccxt exchange "${id}". See ccxt.exchanges for valid ids.`);
    }
    this.exchange = new ExchangeCtor({ enableRateLimit: true });
    this.name = `ccxt:${id}`;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const s = this.normalize(symbol);
    try {
      const ticker = await this.exchange.fetchTicker(s);
      return this.toQuote(s, ticker);
    } catch (err) {
      throw new ProviderError(this.describe(err, s), 502, s);
    }
  }

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const normalized = symbols.map((s) => this.normalize(s));

    if (this.exchange.has['fetchTickers']) {
      try {
        const dict = await this.exchange.fetchTickers(normalized);
        return normalized
          .map((s) => (dict[s] ? this.toQuote(s, dict[s]) : null))
          .filter((q): q is Quote => q !== null);
      } catch {
        // Some exchanges reject a symbol filter — fall back to per-symbol fetches.
      }
    }

    const settled = await Promise.allSettled(normalized.map((s) => this.getQuote(s)));
    return settled
      .filter((r): r is PromiseFulfilledResult<Quote> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  async getHistory(symbol: string, opts: HistoryOptions): Promise<HistoryResponse> {
    const s = this.normalize(symbol);
    const timeframe = this.resolveTimeframe(opts.interval);
    const rangeSec = RANGE_SECONDS[opts.range];
    const intervalSec = INTERVAL_SECONDS[opts.interval];
    const limit = Math.min(Math.max(Math.floor(rangeSec / intervalSec), 2), 1000);
    const since = Date.now() - rangeSec * 1000;

    try {
      const rows = (await this.exchange.fetchOHLCV(s, timeframe, since, limit)) as number[][];
      const candles: Candle[] = [];
      for (const row of rows) {
        const [ts, open, high, low, close, volume] = row;
        if (close == null) continue;
        const c = num(close);
        candles.push({
          time: Math.floor(num(ts) / 1000),
          open: num(open, c),
          high: num(high, c),
          low: num(low, c),
          close: c,
          volume: num(volume),
        });
      }
      const quote = s.split('/')[1] ?? '';
      return {
        symbol: s,
        interval: opts.interval,
        range: opts.range,
        currency: quote,
        candles,
      };
    } catch (err) {
      throw new ProviderError(this.describe(err, s), 502, s);
    }
  }

  async getOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
    const s = this.normalize(symbol);
    try {
      const ob = await this.exchange.fetchOrderBook(s, depth);
      const toLevels = (rows: number[][]) =>
        rows.slice(0, depth).map(([price, amount]) => ({ price: num(price), amount: num(amount) }));
      return {
        symbol: s,
        bids: toLevels(ob.bids as number[][]),
        asks: toLevels(ob.asks as number[][]),
        timestamp: ob.timestamp ?? Date.now(),
      };
    } catch (err) {
      throw new ProviderError(this.describe(err, s), 502, s);
    }
  }

  async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    const s = this.normalize(symbol);
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueQuote> => {
        const t = await ex.fetchTicker(s);
        return {
          exchange: ex.name ?? ex.id,
          price: num(t.last ?? t.close),
          bid: t.bid ?? null,
          ask: t.ask ?? null,
          changePercent: num(t.percentage),
          volume: t.baseVolume ?? null,
          timestamp: t.timestamp ?? Date.now(),
        };
      }),
    );
    return settled
      .filter((r): r is PromiseFulfilledResult<VenueQuote> => r.status === 'fulfilled')
      .map((r) => r.value);
  }

  async getDerivatives(symbol: string): Promise<DerivativesInfo> {
    const spot = this.normalize(symbol);
    // Derive the USDT-margined perp symbol from a spot pair (BTC/USDT -> BTC/USDT:USDT).
    const perp = spot.includes(':') ? spot : `${spot}:${spot.split('/')[1] ?? 'USDT'}`;
    const out: DerivativesInfo = {
      symbol: perp,
      fundingRate: null,
      nextFundingTime: null,
      markPrice: null,
      indexPrice: null,
      openInterest: null,
      openInterestValue: null,
      recentLiquidations: [],
      timestamp: Date.now(),
    };

    if (this.exchange.has['fetchFundingRate']) {
      try {
        const f = await this.exchange.fetchFundingRate(perp);
        out.fundingRate = f.fundingRate ?? null;
        out.nextFundingTime = f.fundingTimestamp ?? f.nextFundingTimestamp ?? null;
        out.markPrice = f.markPrice ?? null;
        out.indexPrice = f.indexPrice ?? null;
      } catch {
        // funding not available for this market
      }
    }

    if (this.exchange.has['fetchOpenInterest']) {
      try {
        const oi = await this.exchange.fetchOpenInterest(perp);
        out.openInterest = oi.openInterestAmount ?? null;
        out.openInterestValue = oi.openInterestValue ?? null;
      } catch {
        // open interest not available
      }
    }

    if (this.exchange.has['fetchLiquidations']) {
      try {
        const liqs = (await this.exchange.fetchLiquidations(perp, undefined, 20)) as unknown as Array<{
          side?: string;
          price?: number;
          amount?: number;
          contracts?: number;
          timestamp?: number;
        }>;
        out.recentLiquidations = liqs.slice(0, 20).map((l) => ({
          side: l.side === 'sell' ? ('sell' as const) : ('buy' as const),
          price: num(l.price),
          amount: num(l.amount ?? l.contracts),
          timestamp: l.timestamp ?? Date.now(),
        }));
      } catch {
        // public liquidations feed not available
      }
    }

    return out;
  }

  liquidationsProvenance(): LiquidationsProvenance {
    const available = Boolean(this.exchange.has['fetchLiquidations']);
    const note = available
      ? 'Exchange liquidation streams are throttled (~1/sec) and are widely documented to under-report; treat sizes as indicative, not exact.'
      : `${this.name} exposes no public liquidation feed (e.g. Binance removed its public stream in 2021) — showing none. Point MIDAS_CCXT_EXCHANGE at a venue that publishes liquidations, or use cross-exchange aggregation.`;
    return { source: this.name, available, note };
  }

  async getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    const spot = this.normalize(symbol);
    const perp = spot.includes(':') ? spot : `${spot}:${spot.split('/')[1] ?? 'USDT'}`;
    if (!this.exchange.has['fetchFundingRateHistory']) return [];
    const n = Math.min(Math.max(1, Math.floor(limit)), 500);
    try {
      const rows = (await this.exchange.fetchFundingRateHistory(perp, undefined, n)) as unknown as Array<{
        timestamp?: number;
        fundingRate?: number;
      }>;
      return rows
        .filter((r) => r.timestamp != null)
        .map((r) => ({ time: r.timestamp as number, fundingRate: r.fundingRate ?? null }));
    } catch {
      return [];
    }
  }

  async screen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
    const quote = (opts.quote ?? 'USDT').toUpperCase();
    try {
      await this.ensureMarkets();
      const tickers = await this.exchange.fetchTickers();
      const rows: ScreenerRow[] = [];
      for (const [sym, t] of Object.entries(tickers)) {
        if (!sym.endsWith(`/${quote}`)) continue;
        rows.push({
          symbol: sym,
          name: sym,
          price: num(t.last ?? t.close),
          changePercent: num(t.percentage),
          volume: t.baseVolume ?? null,
          quoteVolume: t.quoteVolume ?? null,
        });
      }
      return sortScreener(rows, opts.sort).slice(0, opts.limit ?? 50);
    } catch (err) {
      throw new ProviderError(this.describe(err), 502);
    }
  }

  async search(query: string): Promise<SearchResult[]> {
    const q = query.trim().toUpperCase();
    if (!q) return [];

    try {
      await this.ensureMarkets();
    } catch (err) {
      throw new ProviderError(this.describe(err), 502);
    }

    const exchangeName = this.exchange.name ?? this.exchange.id;
    const results: SearchResult[] = [];
    for (const sym of this.exchange.symbols ?? []) {
      if (!sym.toUpperCase().includes(q)) continue;
      const market = this.exchange.markets?.[sym];
      if (market && market.active === false) continue;
      results.push({
        symbol: sym,
        name: sym,
        exchange: exchangeName,
        type: (market?.type ?? 'crypto').toUpperCase(),
      });
      if (results.length >= 25) break;
    }
    return results;
  }

  async getNews(): Promise<NewsItem[]> {
    // CCXT is market-data only; crypto news is sourced from a separate provider.
    return [];
  }

  // -- internals -----------------------------------------------------------

  /** BTC-USD → BTC/USD; already-unified symbols pass through. */
  private normalize(symbol: string): string {
    const s = symbol.trim().toUpperCase();
    return s.includes('/') ? s : s.replace('-', '/');
  }

  private ensureMarkets(): Promise<unknown> {
    if (!this.marketsPromise) {
      this.marketsPromise = this.exchange.loadMarkets().catch((err: unknown) => {
        this.marketsPromise = null; // allow retry on next request
        throw err;
      });
    }
    return this.marketsPromise;
  }

  private toQuote(symbol: string, t: Ticker): Quote {
    const [base, quote] = symbol.split('/');
    const price = num(t.last ?? t.close);
    const previousClose = num(t.previousClose ?? t.open ?? price, price);
    const change = num(t.change, price - previousClose);
    const changePercent = num(
      t.percentage,
      previousClose ? (change / previousClose) * 100 : 0,
    );

    return {
      symbol,
      name: base && quote ? `${base} / ${quote}` : symbol,
      currency: quote ?? '',
      exchange: this.exchange.name ?? this.exchange.id,
      marketState: 'REGULAR', // crypto trades 24/7
      price,
      previousClose,
      open: t.open ?? null,
      dayHigh: t.high ?? null,
      dayLow: t.low ?? null,
      change,
      changePercent,
      volume: t.baseVolume ?? null,
      marketCap: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      asOf: t.timestamp ?? Date.now(),
    };
  }

  /** Lazily build the set of exchanges used for the multi-exchange compare. */
  private getCompareExchanges(): Exchange[] {
    if (!this.compareExchanges) {
      const ids = (process.env.MIDAS_CCXT_COMPARE ?? 'binance,coinbase,kraken,bitfinex,okx,kucoin')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      const registry = ccxt as unknown as Record<string, new (config: object) => Exchange>;
      this.compareExchanges = ids
        .map((id) => {
          const Ctor = registry[id];
          return typeof Ctor === 'function' ? new Ctor({ enableRateLimit: true }) : null;
        })
        .filter((e): e is Exchange => e !== null);
    }
    return this.compareExchanges;
  }

  private resolveTimeframe(interval: Interval): string {
    const wanted = TIMEFRAME_MAP[interval];
    const supported = this.exchange.timeframes as Record<string, unknown> | undefined;
    if (supported && !(wanted in supported)) {
      if ('1d' in supported) return '1d';
      if ('1h' in supported) return '1h';
      const first = Object.keys(supported)[0];
      if (first) return first;
    }
    return wanted;
  }

  private describe(err: unknown, symbol?: string): string {
    const base = err instanceof Error ? err.message : String(err);
    const ctx = symbol ? ` for ${symbol}` : '';
    return (
      `ccxt (${this.exchange.id}) request failed${ctx}: ${base}. ` +
      `Check the symbol format (e.g. BTC/USDT) and that the exchange is reachable.`
    );
  }
}
