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
  DvolSnapshot,
  DvolSymbol,
  LiquidationsProvenance,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  NewsItem,
  OpenOrders,
  OptionsChain,
  OptionsChainEntry,
  OrderBook,
  OrderRequest,
  PlacedOrder,
  Quote,
  ScreenerRow,
  SearchResult,
  SolanaMarket,
  SolanaNetwork,
  SolanaStaking,
  SolanaSwapQuote,
  SolanaTokenInfo,
  SolanaTrending,
  SolanaValidators,
  SolanaWallet,
  TermStructure,
  TermStructurePoint,
  VenueDerivatives,
  VenueQuote,
} from '@midas/shared';
import { annualizedBasisPct, computeMaxPainStrike, computePutCallOiRatio } from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import { dexscreenerEnabled, fetchDexPools } from './dexscreener';
import { fetchGeckoPools, geckoterminalEnabled } from './geckoterminal';
import { fetchSolanaNetwork } from '../solana/network';
import { fetchSolanaWallet } from '../solana/wallet';
import { fetchSolanaPools, fetchSolanaTrending } from '../solana/dex';
import { fetchSolanaStaking, fetchSolanaValidators } from '../solana/staking';
import { fetchSolanaToken } from '../solana/token';
import { fetchSolanaQuote } from '../solana/jupiter';
import { fetchSolanaMarket } from '../solana/market';
import { STABLES, ccxtKeysConfigured, mapCcxtBalance, sumValueUsd, unpricedCaveat } from './balances';
import { mapMyTrades, mapOpenOrders, mapPositions, mergeVenueRows, sumUnrealizedPnl } from './accountReads';
import { EXECUTION_SAFETY_HOLD_REASON, mapPlacedOrder } from '../trading';
import { INTERVAL_SECONDS, RANGE_SECONDS, sortScreener } from './util';

import {
  TIMEFRAME_MAP,
  ccxtRegistry,
  isKnownExchange,
  num,
  readFunding,
  readOpenInterest,
  safeErrorLabel,
  tickerPrice,
  timeframeSeconds,
  toPerpSymbol,
} from './ccxt/helpers';

// Re-exported so existing import sites stay stable: providers/ccxt.test.ts
// pulls safeErrorLabel + toPerpSymbol, and keys/routes.ts pulls isKnownExchange.
export { isKnownExchange, safeErrorLabel, toPerpSymbol } from './ccxt/helpers';

/**
 * Aggregate fine-grained candles into larger buckets — standard OHLCV rollup
 * (open=first, high=max, low=min, close=last, volume=sum, time=bucket start).
 * Input must be time-ascending (ccxt's fetchOHLCV contract).
 */
function aggregateCandles(candles: Candle[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

/** The Interval whose length is exactly `sec` (INTERVAL_SECONDS values are unique), or null. */
function intervalForSeconds(sec: number): Interval | null {
  for (const [key, value] of Object.entries(INTERVAL_SECONDS)) {
    if (value === sec) return key as Interval;
  }
  return null;
}

/**
 * The provider-level execution safety hold, in the exact shape the route layer
 * returns for POST /api/orders (error name TradingSafetyHold, the shared
 * reason constant, 503) so clients cannot tell the two layers apart. Placement
 * only — cancellation is live under the cancel-only posture.
 */
function tradingSafetyHold(): ProviderError {
  const err = new ProviderError(EXECUTION_SAFETY_HOLD_REASON, 503);
  err.name = 'TradingSafetyHold';
  return err;
}

/**
 * Map a failed cancel attempt to an honest outcome. The raw ccxt error message
 * is inspected ONLY for classification — it can embed the signed request URL
 * (HMAC signature / API key), so client-facing text is always rebuilt.
 *
 * - no exchange verdict (timeout/network) → 502 "outcome unknown": the cancel
 *   may or may not have landed; never claim canceled when unknown.
 * - order no longer open (filled / already canceled) → 409.
 * - any other rejection → 502: the cancel did NOT happen, order still open.
 */
function classifyCancelError(err: unknown, id: string, symbol: string): ProviderError {
  if (err instanceof ProviderError) return err;
  const name = err instanceof Error ? err.name : '';
  const rawMsg = err instanceof Error ? err.message : '';
  if (
    err instanceof ccxt.NetworkError ||
    ['RequestTimeout', 'ExchangeNotAvailable', 'DDoSProtection', 'NetworkError'].includes(name)
  ) {
    return new ProviderError(
      `Cancel outcome UNKNOWN for order ${id} on ${symbol} — the exchange did not confirm (${safeErrorLabel(err)}). ` +
        'Check the exchange for the true order state before assuming it is open or canceled.',
      502,
      symbol,
    );
  }
  if (
    name === 'OrderNotFound' ||
    name === 'InvalidOrder' ||
    /already (filled|cancelled|canceled|closed)|order does not exist|unknown order/i.test(rawMsg)
  ) {
    return new ProviderError(
      `Order ${id} on ${symbol} is no longer open — already filled or canceled (it may also rest on another venue of this account).`,
      409,
      symbol,
    );
  }
  return new ProviderError(
    `Cancel rejected by the exchange for order ${id} on ${symbol} (${safeErrorLabel(err)}) — the order should still be open.`,
    502,
    symbol,
  );
}

/** Explicit credentials for a per-user provider instance (hosted-tier groundwork). */
export interface CcxtUserCreds {
  exchange: string;
  apiKey: string;
  secret: string;
  password?: string;
}

/** The fields the options surface reads off a ccxt option-chain entry. */
interface DeribitOptionQuote {
  openInterest?: number;
  markPrice?: number;
  underlyingPrice?: number;
  info?: { mark_iv?: number };
}

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
export class CcxtProvider implements DataProvider {
  readonly name: string;
  readonly live = true;
  private readonly exchange: Exchange;
  private readonly exchangeId: string;
  /** True when constructed from explicit per-user creds (vs operator env). */
  private readonly userKeyed: boolean;
  private marketsPromise: Promise<unknown> | null = null;
  private compareExchanges: Exchange[] | null = null;

  constructor(creds?: CcxtUserCreds) {
    const id = (creds?.exchange ?? process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
    // Allowlist against ccxt's own registry — NOT a `typeof === 'function'`
    // check. `registry['constructor']` (and 'toString', 'valueOf', …) are
    // inherited Object members that ARE functions, so a crafted exchange id
    // would slip past a typeof guard and `new Object(config)` silently. The
    // exchanges array is the authoritative set of real ids.
    if (!isKnownExchange(id)) {
      throw new Error(`Unknown ccxt exchange "${id}". See ccxt.exchanges for valid ids.`);
    }
    const registry = ccxtRegistry();
    const ExchangeCtor = registry[id];
    // Optional READ-ONLY API keys for account reads (balances). Supplied via the
    // operator's own environment — or, for a per-user instance, via explicit
    // creds that must NEVER mix with the env (a user-keyed provider gets no
    // operator secondary venue and no operator stream, below). Midas is
    // non-custodial and the keyed path only ever calls read methods.
    const exchangeConfig: Record<string, unknown> = { enableRateLimit: true };
    const apiKey = creds?.apiKey ?? process.env.MIDAS_CCXT_API_KEY;
    const secret = creds?.secret ?? process.env.MIDAS_CCXT_SECRET;
    const password = creds ? creds.password : process.env.MIDAS_CCXT_PASSWORD;
    if (apiKey && secret) {
      exchangeConfig.apiKey = apiKey;
      exchangeConfig.secret = secret;
      if (password) exchangeConfig.password = password;
    }
    this.exchange = new ExchangeCtor(exchangeConfig);
    this.exchangeId = id;
    this.userKeyed = Boolean(creds);
    this.name = `ccxt:${id}`;

    // Optional SECOND keyed venue for the multi-venue account view. Same
    // non-custodial rules: read-only keys from the operator's env, account
    // reads only — the trading write path never touches this client.
    const id2 = (process.env.MIDAS_CCXT_EXCHANGE_2 ?? '').toLowerCase();
    const key2 = process.env.MIDAS_CCXT_API_KEY_2;
    const secret2 = process.env.MIDAS_CCXT_SECRET_2;
    if (!this.userKeyed && id2 && id2 !== id && isKnownExchange(id2) && key2 && secret2) {
      const Ctor2 = registry[id2];
      if (typeof Ctor2 === 'function') {
        const cfg2: Record<string, unknown> = { enableRateLimit: true, apiKey: key2, secret: secret2 };
        if (process.env.MIDAS_CCXT_PASSWORD_2) cfg2.password = process.env.MIDAS_CCXT_PASSWORD_2;
        this.secondary = { ex: new Ctor2(cfg2), id: id2 };
      }
    }
  }

  private readonly secondary: { ex: Exchange; id: string } | null = null;

  /** Whether THIS instance can make keyed account reads (creds or operator env). */
  private hasKeys(): boolean {
    return this.userKeyed || ccxtKeysConfigured();
  }

  /**
   * Run the same account read against the second venue. A secondary failure
   * never breaks the primary result — it comes back as an honest note.
   */
  private async fromSecondary<Row>(
    read: (ex: Exchange) => Promise<Row[]>,
  ): Promise<{ rows: Row[]; note: string | null } | null> {
    if (!this.secondary) return null;
    try {
      return { rows: await read(this.secondary.ex), note: null };
    } catch (err) {
      return {
        rows: [],
        note: `Second venue (${this.secondary.id}) unreadable — ${safeErrorLabel(err)}.`,
      };
    }
  }

  /**
   * Best-effort account-change nudge via ccxt.pro watchOrders. READ-ONLY —
   * the stream only tells us "something changed"; the watcher's REST poll
   * stays the source of truth, so a broken stream degrades to plain polling.
   */
  streamAccountNudge(onChange: () => void): (() => void) | null {
    if (this.userKeyed || !ccxtKeysConfigured()) return null;
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
          .map((s) => {
            const t = dict[s];
            if (!t) return null;
            try {
              return this.toQuote(s, t);
            } catch {
              // A ticker with no usable price is dropped from the batch rather
              // than failing every symbol — and never zeroed into a fake quote.
              return null;
            }
          })
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
    // Size the window from the ACTUALLY-fetched timeframe, not the requested
    // interval (they differ when a timeframe is substituted). ccxt returns bars
    // starting AT `since` capped at `limit`, so anchoring `since` at the full
    // range start while clamping `limit` to 1000 drops the NEWEST bars. Derive
    // `since` from the clamped bar count so the window is always the most recent.
    const barSec = timeframeSeconds(timeframe) || INTERVAL_SECONDS[opts.interval];
    const limit = Math.min(Math.max(Math.floor(rangeSec / barSec), 2), 1000);
    const since = Date.now() - limit * barSec * 1000;

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
      // Strip the perp settle suffix so BTC/USDT:USDT reports currency 'USDT'.
      const quote = (s.split('/')[1] ?? '').replace(/:.*$/, '');
      // The response interval must honestly describe its candles. When the
      // fetched timeframe differs from the requested interval (TIMEFRAME_MAP
      // substitution or an exchange capability fallback), aggregate the fetched
      // bars up to the requested bucket; when the requested interval is not a
      // clean multiple of the fetched timeframe (e.g. 90m from 1h bars), label
      // the response with the timeframe actually served instead of mislabeling.
      const intervalSec = INTERVAL_SECONDS[opts.interval];
      let interval: Interval = opts.interval;
      let out = candles;
      if (barSec > 0 && barSec !== intervalSec) {
        if (intervalSec % barSec === 0) {
          out = aggregateCandles(candles, intervalSec);
        } else {
          const actual = intervalForSeconds(barSec);
          if (!actual) {
            throw new ProviderError(
              `${this.name} cannot serve ${opts.interval} history for ${s}: the fetched timeframe ${timeframe} has no clean label.`,
              502,
              s,
            );
          }
          interval = actual;
        }
      }
      return {
        symbol: s,
        interval,
        range: opts.range,
        currency: quote,
        candles: out,
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
        const price = tickerPrice(t);
        // Drop a venue whose ticker carries no usable price rather than
        // fabricating 0 — a fake 0 reads as a ~100% cross-venue discrepancy.
        if (price == null) throw new ProviderError(`${ex.id} ${s}: ticker has no price`, 502, s);
        return {
          exchange: ex.name ?? ex.id,
          price,
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
    const perp = toPerpSymbol(this.normalize(symbol));
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueDerivatives> => {
        const timestamp = Date.now();
        // Sequential (funding then OI), matching the original single-venue read.
        const funding = await readFunding(ex, perp);
        const oi = await readOpenInterest(ex, perp);
        return {
          exchange: ex.name ?? ex.id,
          fundingRate: funding.fundingRate,
          fundingIntervalHours: funding.fundingIntervalHours,
          nextFundingTime: funding.nextFundingTime,
          markPrice: funding.markPrice,
          openInterestValue: oi.openInterestValue,
          timestamp,
        };
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
    const perp = toPerpSymbol(this.normalize(symbol));
    const out: DerivativesInfo = {
      symbol: perp,
      fundingRate: null,
      fundingIntervalHours: null,
      nextFundingTime: null,
      markPrice: null,
      indexPrice: null,
      openInterest: null,
      openInterestValue: null,
      recentLiquidations: [],
      timestamp: Date.now(),
    };

    const funding = await readFunding(this.exchange, perp);
    out.fundingRate = funding.fundingRate;
    out.fundingIntervalHours = funding.fundingIntervalHours;
    out.nextFundingTime = funding.nextFundingTime;
    out.markPrice = funding.markPrice;
    out.indexPrice = funding.indexPrice;

    const oi = await readOpenInterest(this.exchange, perp);
    out.openInterest = oi.openInterest;
    out.openInterestValue = oi.openInterestValue;

    if (this.exchange.has['fetchLiquidations']) {
      try {
        const liqs = (await this.exchange.fetchLiquidations(perp, undefined, 20)) as unknown as Array<{
          side?: string;
          price?: number;
          amount?: number;
          contracts?: number;
          timestamp?: number;
          info?: { side?: string };
        }>;
        // ccxt's unified liquidation shape has no top-level `side` — it lives,
        // venue-specifically, inside `info`. Read it from there; when the side
        // (or a usable price) can't be determined, drop the row rather than
        // fabricating 'buy' (which would render every liquidation as a short).
        const recent: DerivativesInfo['recentLiquidations'] = [];
        for (const l of liqs.slice(0, 20)) {
          const rawSide = (l.side ?? l.info?.side ?? '').toString().toLowerCase();
          const side = rawSide === 'sell' ? ('sell' as const) : rawSide === 'buy' ? ('buy' as const) : null;
          const price = num(l.price);
          if (!side || !(price > 0)) continue;
          recent.push({ side, price, amount: num(l.amount ?? l.contracts), timestamp: l.timestamp ?? Date.now() });
        }
        out.recentLiquidations = recent;
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
    if (geckoterminalEnabled()) return fetchGeckoPools(base);
    return {
      symbol: base,
      provenance: 'unavailable',
      note: `On-chain/DEX pools need an on-chain source; ${this.name} reads centralized exchanges only. Set MIDAS_DEX_SOURCE=dexscreener for a live read.`,
      pools: [],
    };
  }

  /** Read-only Solana network health (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaNetwork(): Promise<SolanaNetwork> {
    const solPriceUsd = await this.solPrice();
    return fetchSolanaNetwork(solPriceUsd);
  }

  /** Read-only Solana wallet inspector (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaWallet(address: string): Promise<SolanaWallet> {
    // Price only SOL (from this exchange) + stablecoins (pinned in the mapper);
    // exotic SPL tokens are honestly left unpriced rather than guessed.
    const solPriceUsd = await this.solPrice();
    return fetchSolanaWallet(address, (sym) => (sym === 'SOL' ? solPriceUsd : null));
  }

  /** Trending Solana tokens (env-gated live GeckoTerminal; honest 'unavailable' otherwise). */
  async getSolanaTrending(): Promise<SolanaTrending> {
    return fetchSolanaTrending();
  }

  /** Solana-network DEX pools for an asset (env-gated live GeckoTerminal; honest otherwise). */
  async getSolanaDexPools(symbol: string): Promise<DexPools> {
    const base = this.normalize(symbol).split('/')[0].replace(/:.*$/, '');
    return fetchSolanaPools(base);
  }

  /** Solana validator leaderboard (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaValidators(): Promise<SolanaValidators> {
    return fetchSolanaValidators();
  }

  /** Solana native staking economics (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaStaking(): Promise<SolanaStaking> {
    return fetchSolanaStaking();
  }

  /** SPL token (mint) explorer (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaToken(mint: string): Promise<SolanaTokenInfo> {
    // Price only SOL (from this exchange) + stablecoins (pinned in the mapper);
    // exotic mints are honestly left unpriced rather than guessed.
    const solPriceUsd = await this.solPrice();
    return fetchSolanaToken(mint, (sym) => (sym === 'SOL' ? solPriceUsd : null));
  }

  /** Read-only Jupiter swap quote — QUOTE ONLY, never a swap tx (env-gated; honest otherwise). */
  async getSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
    return fetchSolanaQuote(input, output, amount);
  }

  /** Solana ecosystem market overview (env-gated live GeckoTerminal; honest otherwise). */
  async getSolanaMarket(): Promise<SolanaMarket> {
    return fetchSolanaMarket(await this.solPrice());
  }

  /** Best-effort SOL/USDT spot from this exchange for USD valuation; null on failure. */
  private async solPrice(): Promise<number | null> {
    try {
      return (await this.getQuote('SOL/USDT')).price;
    } catch {
      return null;
    }
  }

  async getBalances(): Promise<Balances> {
    if (!this.hasKeys()) {
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
      const readBalances = async (ex: Exchange): Promise<ReturnType<typeof mapCcxtBalance>> => {
        const raw = await ex.fetchBalance();
        const totals = (raw as { total?: Record<string, unknown> }).total ?? {};
        const assets = Object.keys(totals).filter((a) => {
          const n = Number((totals as Record<string, unknown>)[a]);
          return Number.isFinite(n) && n > 0;
        });
        const prices = await this.priceAssetsUsd(assets, ex);
        return mapCcxtBalance(raw, (asset) => prices.get(asset.toUpperCase()) ?? null);
      };
      let balances = await readBalances(this.exchange);
      const second = await this.fromSecondary(readBalances);
      if (second) {
        balances = mergeVenueRows(balances, this.exchangeId, second.rows, this.secondary!.id, (b) => b.valueUsd);
      }
      return {
        source: this.name,
        provenance: 'live',
        // Honest total: assets with no /USDT market are excluded from the sum,
        // so when any exist the note must say the total is a floor.
        note: [second?.note, unpricedCaveat(balances)].filter(Boolean).join(' ') || null,
        totalValueUsd: sumValueUsd(balances),
        balances,
        asOf: Date.now(),
      };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Balance read failed — ${safeErrorLabel(err)}. Check that the API key is valid and has read access (read-only is sufficient).`,
        totalValueUsd: null,
        balances: [],
        asOf: Date.now(),
      };
    }
  }

  /** Best-effort USD prices for a set of assets (stables = $1; others via ASSET/USDT tickers). */
  private async priceAssetsUsd(assets: string[], exchange: Exchange = this.exchange): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    const need: string[] = [];
    for (const a of assets) {
      const up = a.toUpperCase();
      if (STABLES.has(up)) map.set(up, 1);
      else need.push(up);
    }
    if (need.length === 0) return map;
    try {
      const tickers = await exchange.fetchTickers(need.map((a) => `${a}/USDT`));
      for (const a of need) {
        const px = tickerPrice(tickers[`${a}/USDT`] ?? {});
        if (px != null) map.set(a, px);
      }
    } catch {
      // The batched fetchTickers rejects the WHOLE request when any one symbol
      // is invalid (a delisted/dust asset with no /USDT market), which would
      // otherwise leave EVERY balance unpriced. Fall back to per-symbol reads
      // so one bad asset only unprices itself.
      await Promise.all(
        need.map(async (a) => {
          try {
            const px = tickerPrice(await exchange.fetchTicker(`${a}/USDT`));
            if (px != null) map.set(a, px);
          } catch {
            // leave this one asset unpriced (valueUsd: null)
          }
        }),
      );
    }
    return map;
  }

  async getOpenOrders(): Promise<OpenOrders> {
    const asOf = Date.now();
    if (!this.hasKeys()) {
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
      let orders = mapOpenOrders(raw);
      const second = await this.fromSecondary(async (ex) =>
        ex.has['fetchOpenOrders'] ? mapOpenOrders(await ex.fetchOpenOrders()) : [],
      );
      if (second) {
        orders = mergeVenueRows(orders, this.exchangeId, second.rows, this.secondary!.id, (o) => o.timestamp);
      }
      return { source: this.name, provenance: 'live', note: second?.note ?? null, orders, asOf };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Open-orders read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
        orders: [],
        asOf,
      };
    }
  }

  async getPositions(): Promise<AccountPositions> {
    const asOf = Date.now();
    if (!this.hasKeys()) {
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
      let positions = mapPositions(raw);
      const second = await this.fromSecondary(async (ex) =>
        ex.has['fetchPositions'] ? mapPositions(await ex.fetchPositions()) : [],
      );
      if (second) {
        positions = mergeVenueRows(positions, this.exchangeId, second.rows, this.secondary!.id, (p) => p.notionalUsd);
      }
      return {
        source: this.name,
        provenance: 'live',
        note: second?.note ?? null,
        totalUnrealizedPnlUsd: sumUnrealizedPnl(positions),
        positions,
        asOf,
      };
    } catch (err) {
      return {
        source: this.name,
        provenance: 'unavailable',
        note: `Positions read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
    }
  }

  async getFills(symbol?: string): Promise<AccountFills> {
    const asOf = Date.now();
    if (!this.hasKeys()) {
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
      const sym = symbol ? this.normalize(symbol) : undefined;
      const raw = await this.exchange.fetchMyTrades(sym, undefined, 100);
      let fills = mapMyTrades(raw);
      const second = await this.fromSecondary(async (ex) =>
        ex.has['fetchMyTrades'] ? mapMyTrades(await ex.fetchMyTrades(sym, undefined, 100)) : [],
      );
      if (second) {
        fills = mergeVenueRows(fills, this.exchangeId, second.rows, this.secondary!.id, (f) => f.timestamp);
      }
      return { source: this.name, provenance: 'live', note: second?.note ?? null, fills, asOf };
    } catch (err) {
      // Inspect the raw message internally to detect the "symbol required" case,
      // but never place it in the note — it can carry the signed request URL.
      const rawMsg = err instanceof Error ? err.message : '';
      const needsSymbol = /symbol|argument/i.test(rawMsg) && !symbol;
      return {
        source: this.name,
        provenance: 'unavailable',
        note: needsSymbol
          ? `${this.name} requires a symbol for fills — open FILLS with a symbol (e.g. BTC/USDT FILLS).`
          : `Fills read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
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
    try {
      const raw = await this.exchange.fetchOrder(id, sym);
      return mapPlacedOrder(raw, { symbol: sym, side: 'buy', type: 'limit', amount: 0, price: null });
    } catch (err) {
      // Sanitize like every other keyed read in this file — a raw ccxt error
      // embeds the signed request URL (HMAC signature / API key) and response
      // body; describe()/safeErrorLabel strip it.
      throw err instanceof ProviderError ? err : new ProviderError(this.describe(err, sym), 502, sym);
    }
  }

  /**
   * Cancel a resting order. LIVE under the cancel-only posture: the route
   * (routes/account.ts) proves the id sits in the caller's OWN open-orders
   * list before this is ever called, so this write can only reduce the
   * caller's exposure — it moves no funds, needs no notional cap.
   *
   * Outcomes are honest: exchange confirmation → CancelResult; already
   * filled/canceled → 409; timeout/network → 502 "outcome unknown" (never a
   * claimed cancel); other rejections → 502 with the order still open.
   * Errors are classified WITHOUT leaking the raw ccxt message (signed URLs).
   */
  async cancelOrder(id: string, symbol: string): Promise<CancelResult> {
    if (!this.exchange.has['cancelOrder']) {
      throw new ProviderError(`${this.name} does not support order cancellation.`, 501);
    }
    const sym = this.normalize(symbol);
    try {
      const raw = (await this.exchange.cancelOrder(id, sym)) as unknown as Record<string, unknown> | null;
      const o = raw ?? {};
      const strField = (v: unknown): string => (typeof v === 'string' ? v : '');
      return {
        id: strField(o.id) || id,
        symbol: strField(o.symbol) || sym,
        status: strField(o.status) || 'canceled',
      };
    } catch (err) {
      throw classifyCancelError(err, id, sym);
    }
  }

  /**
   * Place a LIVE order. FAIL-CLOSED under the execution safety hold: throws
   * the same TradingSafetyHold shape the route layer returns (routes/account.ts).
   * Defense in depth — the POST /api/orders route returns its 503 before ever
   * reaching this method, and this provider throw guarantees no other caller
   * (present or future) can execute a live write while the hold stands.
   */
  async placeOrder(_req: OrderRequest): Promise<PlacedOrder> {
    throw tradingSafetyHold();
  }

  async getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    const perp = toPerpSymbol(this.normalize(symbol));
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

  // -- Deribit options / DVOL / term structure ------------------------------
  //
  // Options and dated-futures boards are read from DERIBIT regardless of
  // MIDAS_CCXT_EXCHANGE: Deribit is where BTC/ETH options and the DVOL index
  // actually trade (the configured venue — e.g. binance — lists no European
  // options and no volatility index). A dedicated, public (keyless) client is
  // used, built lazily so a non-crypto deployment never constructs it. Every
  // read is READ-ONLY market data; failures degrade to an honest 'unavailable'
  // snapshot with a sanitized note — never a fabricated level, basis or OI.

  private deribitClient: Exchange | null = null;

  /** The lazy, public Deribit client for the options surface. */
  private deribit(): Exchange {
    if (!this.deribitClient) {
      this.deribitClient = new (ccxtRegistry()['deribit'])({ enableRateLimit: true });
    }
    return this.deribitClient;
  }

  /** Base asset of any symbol form — BTC/USDT, BTC-USD or BTC all give BTC. */
  private baseAsset(symbol: string): string {
    return this.normalize(symbol).split('/')[0].replace(/:.*$/, '');
  }

  private async dvolUnavailable(symbol: DvolSymbol, note: string): Promise<DvolSnapshot> {
    return { symbol, value: null, history: [], asOf: null, provenance: 'unavailable', source: 'ccxt:deribit', note };
  }

  /**
   * The Deribit DVOL volatility index (30-day forward-looking implied vol).
   * ccxt exposes no unified method for it, so this uses the deribit client's
   * implicit get_volatility_index_data endpoint — guarded by a typeof check,
   * and any failure is an honest 'unavailable', never a synthesized level.
   */
  async getDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
    const ex = this.deribit() as Exchange & {
      publicGetGetVolatilityIndexData?: (params: Record<string, unknown>) => Promise<unknown>;
    };
    if (typeof ex.publicGetGetVolatilityIndexData !== 'function') {
      return this.dvolUnavailable(symbol, 'The installed ccxt build exposes no Deribit volatility-index endpoint — DVOL is unavailable.');
    }
    try {
      const end = Date.now();
      const res = (await ex.publicGetGetVolatilityIndexData({
        currency: symbol,
        start_timestamp: end - 40 * 86_400_000,
        end_timestamp: end,
        resolution: '1D',
      })) as { result?: { data?: unknown } };
      // Rows are [timestamp_ms, open, high, low, close] — the daily index fixes.
      const rows = Array.isArray(res?.result?.data) ? (res.result.data as number[][]) : [];
      const history = rows
        .filter((r) => Array.isArray(r) && Number.isFinite(r[0]) && Number.isFinite(r[4]) && r[4] > 0)
        .map((r) => ({ time: r[0], value: r[4] }));
      const last = history[history.length - 1];
      if (!last) {
        return this.dvolUnavailable(symbol, `Deribit returned no DVOL fixes for ${symbol} — nothing to show.`);
      }
      return {
        symbol,
        value: last.value,
        history,
        asOf: last.time,
        provenance: 'live',
        source: 'ccxt:deribit',
        note: null,
      };
    } catch (err) {
      return this.dvolUnavailable(symbol, `Deribit DVOL read failed — ${safeErrorLabel(err)}.`);
    }
  }

  /**
   * Dated-futures term structure for an underlying from Deribit: the listed
   * futures (swap:false, future:true) priced from their tickers, with the
   * annualized basis vs the perpetual mark. Futures with no usable price are
   * dropped rather than shown with a fabricated basis; an underlying with no
   * dated futures is an honest 'unavailable'.
   */
  async getFuturesTermStructure(symbol: string): Promise<TermStructure> {
    const base = this.baseAsset(symbol);
    const now = Date.now();
    const unavailable = (note: string): TermStructure => ({
      underlying: base,
      referencePrice: null,
      perpPrice: null,
      points: [],
      asOf: null,
      provenance: 'unavailable',
      source: 'ccxt:deribit',
      note,
    });
    const ex = this.deribit();
    try {
      await ex.loadMarkets();
    } catch (err) {
      return unavailable(`Deribit markets unreadable — ${safeErrorLabel(err)}.`);
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
    try {
      Object.assign(tickers, await ex.fetchTickers(wanted));
    } catch {
      await Promise.all(
        wanted.map(async (s) => {
          try {
            tickers[s] = await ex.fetchTicker(s);
          } catch {
            // leave this instrument unpriced — its point is dropped below
          }
        }),
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
    return {
      underlying: base,
      referencePrice: perpPrice,
      perpPrice,
      points: points.slice(0, 12),
      asOf: now,
      provenance: 'live',
      source: 'ccxt:deribit',
      note: perpPrice == null ? 'No Deribit perpetual price — basis could not be referenced to the perp.' : null,
    };
  }

  /**
   * Options chain for an underlying at one expiry (nearest by default), from
   * Deribit's single book-summary-by-currency read: strikes around the money
   * with call/put OI and marks, plus max pain and the put/call OI ratio from
   * the shared helpers. Marks convert from the inverse (base-currency) quote
   * to USD via the underlying price. IV is passed through only when the venue
   * reports it (mark_iv) — never implied from the mark.
   */
  async getOptionsChain(symbol: string, expiry: number | 'nearest' = 'nearest'): Promise<OptionsChain> {
    const base = this.baseAsset(symbol);
    const now = Date.now();
    const unavailable = (note: string): OptionsChain => ({
      underlying: base,
      expiry: typeof expiry === 'number' ? expiry : 0,
      underlyingPrice: null,
      entries: [],
      maxPainStrike: null,
      putCallOiRatio: null,
      asOf: null,
      provenance: 'unavailable',
      source: 'ccxt:deribit',
      note,
    });
    const ex = this.deribit();
    if (!ex.has['fetchOptionChain']) {
      return unavailable('The installed ccxt build exposes no Deribit option-chain read.');
    }
    try {
      await ex.loadMarkets();
    } catch (err) {
      return unavailable(`Deribit markets unreadable — ${safeErrorLabel(err)}.`);
    }
    const markets = Object.values(ex.markets ?? {}) as Array<{
      symbol: string;
      base?: string;
      active?: boolean;
      option?: boolean;
      expiry?: number;
      strike?: number;
      optionType?: string;
    }>;
    const options = markets.filter(
      (m) => m.option === true && m.base === base && m.active !== false && typeof m.expiry === 'number' && m.expiry > now && typeof m.strike === 'number',
    );
    if (options.length === 0) {
      return unavailable(`Deribit lists no active ${base} options — no chain to show.`);
    }
    const target = expiry === 'nearest' ? Math.min(...options.map((m) => m.expiry!)) : expiry;
    const chainMarkets = options.filter((m) => m.expiry === target);
    if (chainMarkets.length === 0) {
      return unavailable(`Deribit lists no ${base} options for the requested expiry.`);
    }
    let chain: Record<string, DeribitOptionQuote>;
    try {
      chain = (await ex.fetchOptionChain(base)) as unknown as Record<string, DeribitOptionQuote>;
    } catch (err) {
      return unavailable(`Deribit option-chain read failed — ${safeErrorLabel(err)}.`);
    }
    // The venue's own underlying price, from any entry that reports it.
    let underlyingPrice: number | null = null;
    for (const m of chainMarkets) {
      const p = chain[m.symbol]?.underlyingPrice;
      if (typeof p === 'number' && Number.isFinite(p) && p > 0) {
        underlyingPrice = p;
        break;
      }
    }
    const byStrike = new Map<number, OptionsChainEntry>();
    for (const m of chainMarkets) {
      const q = chain[m.symbol];
      const entry = byStrike.get(m.strike!) ?? { strike: m.strike!, expiry: target, callOi: null, putOi: null, callMark: null, putMark: null, iv: null };
      const oi = q && Number.isFinite(q.openInterest) ? q.openInterest! : null;
      // Deribit inverse options quote marks in the base currency → USD via the
      // underlying price; without it the mark stays null, never a raw BTC number.
      const markUsd = q && Number.isFinite(q.markPrice) && underlyingPrice != null ? q.markPrice! * underlyingPrice : null;
      const iv = q && Number.isFinite(q.info?.mark_iv) ? q.info!.mark_iv! : null;
      if (m.optionType === 'call') {
        entry.callOi = oi;
        entry.callMark = markUsd;
      } else {
        entry.putOi = oi;
        entry.putMark = markUsd;
      }
      if (iv != null) entry.iv = iv;
      byStrike.set(m.strike!, entry);
    }
    // Bound to the strikes around the money: sort by distance from the
    // underlying (or by OI when no underlying price) and keep the closest 24.
    const all = [...byStrike.values()];
    const kept = (
      underlyingPrice != null
        ? all.sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))
        : all.sort((a, b) => (b.callOi ?? 0) + (b.putOi ?? 0) - ((a.callOi ?? 0) + (a.putOi ?? 0)))
    ).slice(0, 24);
    kept.sort((a, b) => a.strike - b.strike);
    return {
      underlying: base,
      expiry: target,
      underlyingPrice,
      entries: kept,
      maxPainStrike: computeMaxPainStrike(kept),
      putCallOiRatio: computePutCallOiRatio(kept),
      asOf: now,
      provenance: 'live',
      source: 'ccxt:deribit',
      note: underlyingPrice == null ? 'No underlying price reported — USD marks are unavailable.' : null,
    };
  }

  async screen(opts: ScreenerOptions): Promise<ScreenerRow[]> {
    const quote = (opts.quote ?? 'USDT').toUpperCase();
    try {
      await this.ensureMarkets();
      const tickers = await this.exchange.fetchTickers();
      const rows: ScreenerRow[] = [];
      for (const [sym, t] of Object.entries(tickers)) {
        if (!sym.endsWith(`/${quote}`)) continue;
        const price = tickerPrice(t);
        if (price == null) continue; // skip pairs with no usable price, not price 0
        rows.push({
          symbol: sym,
          name: sym,
          price,
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
    const [base, rawQuote] = symbol.split('/');
    const quote = (rawQuote ?? '').replace(/:.*$/, ''); // strip perp settle suffix
    // mid-from-bid/ask before giving up — and null must NEVER become 0: a
    // fabricated $0.00 would flow to clients as a real live quote (the same
    // rule getExchangeQuotes enforces per venue).
    const price = tickerPrice(t);
    if (price == null) throw new ProviderError(`${this.name} ${symbol}: ticker has no price`, 502, symbol);
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
      const registry = ccxtRegistry();
      this.compareExchanges = ids
        .map((id) => {
          // Same allowlist the primary-exchange constructor uses: `registry[id]`
          // for an inherited Object member (constructor, toString, …) IS a
          // function, so the typeof guard alone is bypassable.
          if (!isKnownExchange(id)) return null;
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
      // Prefer the nearest finer timeframe ('1h') over jumping to daily, so a
      // request for a minute/hour interval doesn't silently return daily bars.
      if ('1h' in supported) return '1h';
      if ('1d' in supported) return '1d';
      const first = Object.keys(supported)[0];
      if (first) return first;
    }
    return wanted;
  }

  private describe(err: unknown, symbol?: string): string {
    if (err instanceof ProviderError) return err.message;
    const ctx = symbol ? ` for ${symbol}` : '';
    // Never interpolate the raw err.message — it can leak the signed request URL
    // (HMAC signature, API key) and response body to the client. Use a safe label.
    return (
      `ccxt (${this.exchange.id}) request failed${ctx} (${safeErrorLabel(err)}). ` +
      `Check the symbol format (e.g. BTC/USDT) and that the exchange is reachable.`
    );
  }
}
