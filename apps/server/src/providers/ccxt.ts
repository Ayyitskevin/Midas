import * as ccxt from 'ccxt';
import type { Exchange, Ticker } from 'ccxt';
import type {
  AccountFills,
  AccountPositions,
  Balances,
  CancelResult,
  Candle,
  DerivativesInfo,
  DexPools,
  LiquidationsProvenance,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  NewsItem,
  OpenOrders,
  OrderBook,
  OrderRequest,
  PlacedOrder,
  Quote,
  ScreenerRow,
  SearchResult,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import { dexscreenerEnabled, fetchDexPools } from './dexscreener';
import { STABLES, ccxtKeysConfigured, mapCcxtBalance, sumValueUsd } from './balances';
import { mapMyTrades, mapOpenOrders, mapPositions, sumUnrealizedPnl } from './accountReads';
import { mapPlacedOrder } from '../trading';
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
  private readonly exchangeId: string;
  private marketsPromise: Promise<unknown> | null = null;
  private compareExchanges: Exchange[] | null = null;

  constructor() {
    const id = (process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
    const registry = ccxt as unknown as Record<string, new (config: object) => Exchange>;
    const ExchangeCtor = registry[id];
    if (typeof ExchangeCtor !== 'function') {
      throw new Error(`Unknown ccxt exchange "${id}". See ccxt.exchanges for valid ids.`);
    }
    // Optional READ-ONLY API keys for account reads (balances). Supplied via the
    // operator's own environment; Midas is non-custodial and only ever calls read
    // methods — it never places orders or moves funds. Without keys the exchange
    // is constructed key-less and only public market data is available.
    const exchangeConfig: Record<string, unknown> = { enableRateLimit: true };
    const apiKey = process.env.MIDAS_CCXT_API_KEY;
    const secret = process.env.MIDAS_CCXT_SECRET;
    const password = process.env.MIDAS_CCXT_PASSWORD; // some venues (OKX, KuCoin) require a passphrase
    if (apiKey && secret) {
      exchangeConfig.apiKey = apiKey;
      exchangeConfig.secret = secret;
      if (password) exchangeConfig.password = password;
    }
    this.exchange = new ExchangeCtor(exchangeConfig);
    this.exchangeId = id;
    this.name = `ccxt:${id}`;
  }

  /**
   * Best-effort account-change nudge via ccxt.pro watchOrders. READ-ONLY —
   * the stream only tells us "something changed"; the watcher's REST poll
   * stays the source of truth, so a broken stream degrades to plain polling.
   */
  streamAccountNudge(onChange: () => void): (() => void) | null {
    if (!ccxtKeysConfigured()) return null;
    const pro = (ccxt as unknown as { pro?: Record<string, new (config: object) => Exchange> }).pro;
    const Ctor = pro?.[this.exchangeId];
    if (typeof Ctor !== 'function') return null;
    const config: Record<string, unknown> = {
      enableRateLimit: true,
      apiKey: process.env.MIDAS_CCXT_API_KEY,
      secret: process.env.MIDAS_CCXT_SECRET,
    };
    if (process.env.MIDAS_CCXT_PASSWORD) config.password = process.env.MIDAS_CCXT_PASSWORD;
    const ws = new Ctor(config) as Exchange & {
      watchOrders?: () => Promise<unknown>;
      close?: () => Promise<void>;
    };
    if (!ws.has['watchOrders'] || typeof ws.watchOrders !== 'function') {
      void ws.close?.();
      return null;
    }
    let stopped = false;
    void (async () => {
      while (!stopped) {
        try {
          await ws.watchOrders!();
          if (!stopped) onChange();
        } catch {
          // Stream hiccup — back off, then resubscribe; polling covers the gap.
          await new Promise((resolve) => setTimeout(resolve, 5000).unref?.());
        }
      }
    })();
    return () => {
      stopped = true;
      void ws.close?.();
    };
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

  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    const spot = this.normalize(symbol);
    const perp = spot.includes(':') ? spot : `${spot}:${spot.split('/')[1] ?? 'USDT'}`;
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueDerivatives> => {
        const out: VenueDerivatives = {
          exchange: ex.name ?? ex.id,
          fundingRate: null,
          nextFundingTime: null,
          markPrice: null,
          openInterestValue: null,
          timestamp: Date.now(),
        };
        if (ex.has['fetchFundingRate']) {
          try {
            const f = await ex.fetchFundingRate(perp);
            out.fundingRate = f.fundingRate ?? null;
            out.nextFundingTime = f.fundingTimestamp ?? f.nextFundingTimestamp ?? null;
            out.markPrice = f.markPrice ?? null;
          } catch {
            // funding not available on this venue (e.g. spot-only exchange)
          }
        }
        if (ex.has['fetchOpenInterest']) {
          try {
            const oi = await ex.fetchOpenInterest(perp);
            out.openInterestValue = oi.openInterestValue ?? null;
          } catch {
            // open interest not available on this venue
          }
        }
        return out;
      }),
    );
    // Keep venues that reported any perp field (funding, OI, mark or next-funding);
    // drop only the all-null spot-only venues. A venue can answer fetchFundingRate
    // with a markPrice/next time but a null fundingRate (the ccxt fields are
    // independently optional), so don't gate solely on fundingRate/OI.
    return settled
      .filter((r): r is PromiseFulfilledResult<VenueDerivatives> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter(
        (v) =>
          v.fundingRate !== null ||
          v.openInterestValue !== null ||
          v.markPrice !== null ||
          v.nextFundingTime !== null,
      );
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

  async getDexPools(symbol: string): Promise<DexPools> {
    const base = this.normalize(symbol).split('/')[0].replace(/:.*$/, '');
    // Opt-in live on-chain read (Dexscreener); otherwise honestly unavailable.
    if (dexscreenerEnabled()) return fetchDexPools(base);
    return {
      symbol: base,
      provenance: 'unavailable',
      note: `On-chain/DEX pools need an on-chain source; ${this.name} reads centralized exchanges only. Set MIDAS_DEX_SOURCE=dexscreener for a live read.`,
      pools: [],
    };
  }

  async getBalances(): Promise<Balances> {
    if (!ccxtKeysConfigured()) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only balances need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never places orders and never holds your funds).',
        totalValueUsd: null,
        balances: [],
        asOf: Date.now(),
      };
    }
    try {
      // READ-ONLY account read. Midas is non-custodial: this calls only
      // fetchBalance — never createOrder or any write/withdraw method.
      const raw = await this.exchange.fetchBalance();
      const totals = (raw as { total?: Record<string, unknown> }).total ?? {};
      const assets = Object.keys(totals).filter((a) => {
        const n = Number((totals as Record<string, unknown>)[a]);
        return Number.isFinite(n) && n > 0;
      });
      const prices = await this.priceAssetsUsd(assets);
      const balances = mapCcxtBalance(raw, (asset) => prices.get(asset.toUpperCase()) ?? null);
      return {
        source: this.name,
        provenance: 'live',
        note: null,
        totalValueUsd: sumValueUsd(balances),
        balances,
        asOf: Date.now(),
      };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Balance read failed — ${err instanceof Error ? err.message : 'error'}. Check that the API key is valid and has read access (read-only is sufficient).`,
        totalValueUsd: null,
        balances: [],
        asOf: Date.now(),
      };
    }
  }

  /** Best-effort USD prices for a set of assets (stables = $1; others via ASSET/USDT tickers). */
  private async priceAssetsUsd(assets: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const need: string[] = [];
    for (const a of assets) {
      const up = a.toUpperCase();
      if (STABLES.has(up)) map.set(up, 1);
      else need.push(up);
    }
    if (need.length === 0) return map;
    try {
      const tickers = await this.exchange.fetchTickers(need.map((a) => `${a}/USDT`));
      for (const a of need) {
        const t = tickers[`${a}/USDT`];
        const px = t ? t.last ?? t.close : null;
        if (typeof px === 'number' && Number.isFinite(px) && px > 0) map.set(a, px);
      }
    } catch {
      // Best-effort valuation: any failure just leaves those assets unpriced
      // (valueUsd: null) rather than failing the whole balances read.
    }
    return map;
  }

  async getOpenOrders(): Promise<OpenOrders> {
    const asOf = Date.now();
    if (!ccxtKeysConfigured()) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only open orders need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never places or cancels orders).',
        orders: [],
        asOf,
      };
    }
    if (!this.exchange.has['fetchOpenOrders']) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchOpenOrders endpoint.`,
        orders: [],
        asOf,
      };
    }
    try {
      // READ-ONLY: fetchOpenOrders only — never createOrder/cancelOrder/editOrder.
      const raw = await this.exchange.fetchOpenOrders();
      return { source: this.name, provenance: 'live', note: null, orders: mapOpenOrders(raw), asOf };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Open-orders read failed — ${err instanceof Error ? err.message : 'error'}. Check the API key (read access is sufficient).`,
        orders: [],
        asOf,
      };
    }
  }

  async getPositions(): Promise<AccountPositions> {
    const asOf = Date.now();
    if (!ccxtKeysConfigured()) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only positions need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never opens or closes positions).',
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
    }
    if (!this.exchange.has['fetchPositions']) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchPositions endpoint (spot-only account or exchange).`,
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
    }
    try {
      // READ-ONLY: fetchPositions only — never any order/position write method.
      const raw = await this.exchange.fetchPositions();
      const positions = mapPositions(raw);
      return {
        source: this.name,
        provenance: 'live',
        note: null,
        totalUnrealizedPnlUsd: sumUnrealizedPnl(positions),
        positions,
        asOf,
      };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Positions read failed — ${err instanceof Error ? err.message : 'error'}. Check the API key (read access is sufficient).`,
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
    }
  }

  async getFills(symbol?: string): Promise<AccountFills> {
    const asOf = Date.now();
    if (!ccxtKeysConfigured()) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only fills need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(read-only keys are sufficient — Midas never moves funds).',
        fills: [],
        asOf,
      };
    }
    if (!this.exchange.has['fetchMyTrades']) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchMyTrades endpoint.`,
        fills: [],
        asOf,
      };
    }
    try {
      // READ-ONLY: fetchMyTrades only. Many venues (e.g. Binance) require a
      // symbol for this endpoint — surface that honestly instead of guessing.
      const raw = await this.exchange.fetchMyTrades(symbol ? this.normalize(symbol) : undefined, undefined, 100);
      return { source: this.name, provenance: 'live', note: null, fills: mapMyTrades(raw), asOf };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      const needsSymbol = /symbol|argument/i.test(msg) && !symbol;
      return {
        source: this.name,
        provenance: 'unavailable',
        note: needsSymbol
          ? `${this.name} requires a symbol for fills — open FILLS with a symbol (e.g. BTC/USDT FILLS).`
          : `Fills read failed — ${msg}. Check the API key (read access is sufficient).`,
        fills: [],
        asOf,
      };
    }
  }

  /**
   * Look up one order's current state. READ-ONLY — fetchOrder only; feeds the
   * account watcher's closed-order resolution and TICKET's status tracking.
   * The mapPlacedOrder fallbacks only apply to fields the exchange omits.
   */
  async getOrder(id: string, symbol: string): Promise<PlacedOrder> {
    if (!this.exchange.has['fetchOrder']) {
      throw new ProviderError(`${this.name} does not support single-order lookup.`, 501);
    }
    const sym = this.normalize(symbol);
    const raw = await this.exchange.fetchOrder(id, sym);
    return mapPlacedOrder(raw, { symbol: sym, side: 'buy', type: 'limit', amount: 0, price: null });
  }

  /**
   * Cancel a resting order. A risk-REDUCING write, gated by the route behind
   * the same trading switches as placement — a trader who can place a limit
   * order must be able to pull it.
   */
  async cancelOrder(id: string, symbol: string): Promise<CancelResult> {
    if (!this.exchange.has['cancelOrder']) {
      throw new ProviderError(`${this.name} does not support order cancellation.`, 501);
    }
    const sym = this.normalize(symbol);
    const raw = (await this.exchange.cancelOrder(id, sym)) as unknown as Record<string, unknown> | undefined;
    const status = typeof raw?.status === 'string' && raw.status ? raw.status : 'canceled';
    return { id: typeof raw?.id === 'string' && raw.id ? raw.id : id, symbol: sym, status };
  }

  /**
   * Place a LIVE order — with cancelOrder above, one of the only two writes in
   * Midas (place / cancel; never withdraw or transfer). Reached only after the
   * route confirms live trading is enabled and the request has been validated
   * and notional-capped — this method does not re-gate, it executes.
   */
  async placeOrder(req: OrderRequest): Promise<PlacedOrder> {
    if (!this.exchange.has['createOrder']) {
      throw new ProviderError(`${this.name} does not support order placement.`, 501);
    }
    const symbol = this.normalize(req.symbol);
    const params: Record<string, unknown> = {};
    if (req.clientOrderId) params.clientOrderId = req.clientOrderId;
    const raw = await this.exchange.createOrder(
      symbol,
      req.type,
      req.side,
      req.amount,
      req.type === 'limit' ? req.price ?? undefined : undefined,
      params,
    );
    return mapPlacedOrder(raw, { ...req, symbol });
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
