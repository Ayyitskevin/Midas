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
  LiquidationSourceCapability,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  NewsItem,
  OiDelta,
  OiDeltaWindow,
  OpenOrders,
  OptionsChain,
  OrderBook,
  OrderRequest,
  PlacedOrder,
  ProviderCapabilityManifest,
  Quote,
  ScreenerRow,
  VenueScreen,
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
  VenueDerivatives,
  VenueLiquidations,
  VenueQuote,
} from '@midas/shared';
import { partialEvidenceLimitation } from '@midas/shared';
import type { DataProvider, HistoryOptions, ScreenerOptions } from './types';
import { ProviderError } from './types';
import {
  buildProviderCapabilities,
  providerReceipt,
  providerUnavailableReceipt,
  withProviderDerivedReceipt,
  withProviderReceipt,
  type CapabilityDefinition,
} from './receipts';
import {
  getDexPools,
  getSolanaDexPools,
  getSolanaMarket,
  getSolanaNetwork,
  getSolanaQuote,
  getSolanaStaking,
  getSolanaToken,
  getSolanaTrending,
  getSolanaValidators,
  getSolanaWallet,
} from './ccxt/onchain';
import { STABLES, ccxtKeysConfigured, mapCcxtBalanceWithDiagnostics, sumValueUsd, unpricedCaveat } from './balances';
import {
  mapMyTradesWithDiagnostics,
  mapOpenOrdersWithDiagnostics,
  mapPositionsWithDiagnostics,
  mergeVenueRows,
  sumUnrealizedPnl,
} from './accountReads';
import { mapPlacedOrder } from '../trading';
import { INTERVAL_SECONDS, RANGE_SECONDS, sortScreener } from './util';

import {
  TIMEFRAME_MAP,
  ccxtRegistry,
  isKnownExchange,
  safeErrorLabel,
  tickerPrice,
  timeframeSeconds,
} from './ccxt/helpers';
import { fetchDvol, fetchFuturesTermStructure, fetchOptionsChain } from './ccxt/options';
import { fetchOiDelta } from './ccxt/oiDelta';
import {
  getVenueLiquidations,
  liquidationSourceCapabilities,
  liquidationsProvenance,
} from './ccxt/liquidations';
import {
  fetchDerivatives,
  fetchFundingHistory,
} from './ccxt/derivatives';
import {
  buildCompareExchanges,
  getExchangeQuotes,
  getVenueDerivatives,
  getVenueScreen,
} from './ccxt/venueCompare';
import { cancelOrder, placeOrder } from './ccxt/trading';

// Re-exported so existing import sites stay stable: providers/ccxt.test.ts
// pulls safeErrorLabel + toPerpSymbol, and keys/routes.ts pulls isKnownExchange.
export { compareExchangeIds, isKnownExchange, safeErrorLabel, toPerpSymbol } from './ccxt/helpers';
import {
  aggregateCandles,
  intervalForSeconds,
  finiteOrNull,
  nonNegativeFiniteOrNull,
  positiveFiniteOrNull,
  sourceTimestampOrNull,
} from './ccxt/coerce';


interface MappingSummary {
  rows: unknown[];
  inputValid: boolean;
  attempted: number;
  omitted: number;
}

function assertUsableAccountMapping(mapping: MappingSummary, label: string): void {
  if (!mapping.inputValid || (mapping.attempted > 0 && mapping.rows.length === 0 && mapping.omitted > 0)) {
    throw new ProviderError(`Malformed ${label} payload from the configured exchange.`, 502, undefined, 'malformed-upstream');
  }
}

function accountOmissionCaveat(mapping: MappingSummary | null, label: string): string | null {
  if (!mapping || mapping.omitted === 0) return null;
  return partialEvidenceLimitation(
    `${mapping.omitted} of ${mapping.attempted} ${label} row(s) were malformed and omitted; aggregates are partial.`,
  );
}

/** Explicit credentials for a per-user provider instance (hosted-tier groundwork). */
export interface CcxtUserCreds {
  exchange: string;
  apiKey: string;
  secret: string;
  password?: string;
}

export interface CcxtProviderDeps {
  /** Hermetic test seam; production constructs the configured ccxt exchange. */
  exchange?: Exchange;
  /** Hermetic cross-venue fan-out clients. */
  compareExchanges?: Exchange[];
  /** Hermetic Deribit public client for options tests. */
  deribit?: Exchange;
  now?: () => number;
}

export const CCXT_PROVIDER_VERSION = '1.0.0';

function ccxtCapability(input: Partial<CapabilityDefinition> & Pick<CapabilityDefinition, 'method' | 'support' | 'auth' | 'mode' | 'coverage'>): CapabilityDefinition {
  return {
    venue: null,
    expectedCadenceMs: null,
    maxAgeMs: null,
    cacheTtlMs: null,
    methodology: null,
    caveats: [],
    ...input,
  };
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
  readonly capabilities: ProviderCapabilityManifest;
  // `exchange`, `exchangeId` and `now` are public so the extracted ccxt/*
  // readers can take this provider as their CcxtReadContext (visibility-only).
  readonly exchange: Exchange;
  readonly exchangeId: string;
  /** True when constructed from explicit per-user creds (vs operator env). */
  private readonly userKeyed: boolean;
  private marketsPromise: Promise<unknown> | null = null;
  private compareExchangesCache: Exchange[] | null = null;
  /** Injected clock; public so extracted ccxt/* readers satisfy CcxtReadContext. */
  readonly now: () => number;

  constructor(creds?: CcxtUserCreds, deps: CcxtProviderDeps = {}) {
    const id = (creds?.exchange ?? deps.exchange?.id ?? process.env.MIDAS_CCXT_EXCHANGE ?? 'binance').toLowerCase();
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
    this.exchange = deps.exchange ?? new ExchangeCtor(exchangeConfig);
    this.exchangeId = id;
    this.userKeyed = Boolean(creds);
    this.name = `ccxt:${id}`;
    this.now = deps.now ?? Date.now;
    if (deps.compareExchanges) this.compareExchangesCache = deps.compareExchanges;
    if (deps.deribit) this.deribitClient = deps.deribit;

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
    const keyed = this.hasKeys();
    const has = this.exchange.has;
    const runtimeMode = (supported: boolean): 'live' | 'unavailable' => supported ? 'live' : 'unavailable';
    const conditional = (
      method: string,
      supported: boolean,
      coverage: string,
      expectedCadenceMs: number,
      maxAgeMs: number,
      caveats: string[] = [],
    ): CapabilityDefinition =>
      ccxtCapability({
        method,
        support: 'conditional',
        auth: 'public',
        mode: runtimeMode(supported),
        venue: id,
        coverage,
        expectedCadenceMs,
        maxAgeMs,
        caveats,
      });
    const account = (method: string, supported: boolean, coverage: string): CapabilityDefinition =>
      ccxtCapability({
        method,
        support: 'conditional',
        auth: 'credentials-required',
        mode: runtimeMode(keyed && supported),
        venue: id,
        coverage,
        expectedCadenceMs: 15_000,
        maxAgeMs: 60_000,
        caveats: [
          ...(keyed ? [] : ['Read-only exchange credentials are not configured for this provider instance.']),
          'Account snapshot endpoints may omit an authoritative source timestamp; receipt freshness is unknown when omitted.',
        ],
      });
    this.capabilities = buildProviderCapabilities({
      providerId: 'ccxt',
      providerVersion: CCXT_PROVIDER_VERSION,
      source: this.name,
      capabilities: {
        quote: ccxtCapability({ method: 'getQuote', support: 'supported', auth: 'public', mode: 'live', venue: id, coverage: 'configured exchange markets', expectedCadenceMs: 5_000, maxAgeMs: 30_000, caveats: ['Ticker timestamps are venue-dependent and may be absent.'] }),
        history: conditional('getHistory', Boolean(has['fetchOHLCV']), 'configured exchange OHLCV/timeframes', 60_000, 300_000),
        funding: conditional('getDerivatives', Boolean(has['fetchFundingRate']), 'funding projection from configured-exchange derivatives snapshot', 60_000, 300_000),
        'funding-history': conditional('getFundingHistory', Boolean(has['fetchFundingRateHistory']), 'configured exchange funding settlements', 28_800_000, 57_600_000),
        'open-interest': conditional('getDerivatives', Boolean(has['fetchOpenInterest']), 'OI projection from configured-exchange derivatives snapshot', 60_000, 300_000),
        'open-interest-history': conditional('getOiDelta', Boolean(has['fetchOpenInterestHistory']), 'configured exchange OI history', 300_000, 28_800_000),
        'open-interest-delta': conditional('getOiDelta', Boolean(has['fetchOpenInterestHistory']), '1h, 4h, 24h and 7d aligned OI/price windows', 300_000, 28_800_000),
        derivatives: conditional('getDerivatives', Boolean(has['fetchFundingRate'] || has['fetchOpenInterest'] || has['fetchLiquidations']), 'bundled funding, OI and liquidation snapshot', 60_000, 300_000),
        'venue-derivatives': ccxtCapability({ method: 'getVenueDerivatives', support: 'conditional', auth: 'public', mode: 'live', coverage: 'configured public compare-exchange set', expectedCadenceMs: 60_000, maxAgeMs: 300_000, caveats: ['Each venue independently exposes funding/OI fields; partial rows are possible.'] }),
        liquidations: conditional('liquidationsProvenance|getDerivatives', Boolean(has['fetchLiquidations']), 'recent public liquidation events', 1_000, 60_000, ['Many exchanges expose no public feed or throttle it, so observed events can undercount the market.']),
        'venue-screener': ccxtCapability({ method: 'getVenueScreen', support: 'conditional', auth: 'public', mode: 'live', coverage: 'whole ticker set per configured compare venue', expectedCadenceMs: 5_000, maxAgeMs: 60_000, caveats: ['Exchange-reported 24h volume is widely documented as inflated; treat it as a scale signal, not a verified total.', 'A venue that fails is reported as reduced coverage rather than failing the board.'] }),
        'venue-quotes': ccxtCapability({ method: 'getExchangeQuotes', support: 'conditional', auth: 'public', mode: 'live', coverage: 'configured public compare-exchange set', expectedCadenceMs: 5_000, maxAgeMs: 30_000, caveats: ['Venue failures are represented by partial coverage rather than fabricated quotes.'] }),
        'venue-arbitrage': ccxtCapability({ method: 'getExchangeQuotes', support: 'conditional', auth: 'public', mode: 'live', coverage: 'derived from contemporaneous executable venue quotes', expectedCadenceMs: 5_000, maxAgeMs: 30_000, methodology: { id: 'midas.venue-arbitrage-top-of-book', version: '1.0', formula: 'grossBps = (bestBid - bestAsk) / bestAsk * 10000; netBps = grossBps - referenceTakerFeesBps' }, caveats: ['Actionability additionally requires known fees, top-of-book size and bounded timestamp skew.'] }),
        options: ccxtCapability({ method: 'getDvol|getFuturesTermStructure|getOptionsChain', support: 'conditional', auth: 'public', mode: 'live', source: 'ccxt:deribit', venue: 'deribit', coverage: 'Deribit BTC/ETH public options, DVOL and dated futures', expectedCadenceMs: 60_000, maxAgeMs: 300_000, caveats: ['Options availability depends on the installed ccxt Deribit public methods and listed instruments.'] }),
        balances: account('getBalances', Boolean(has['fetchBalance']), 'configured exchange account balances'),
        'account-orders': account('getOpenOrders', Boolean(has['fetchOpenOrders']), 'configured exchange resting orders'),
        'account-positions': account('getPositions', Boolean(has['fetchPositions']), 'configured exchange open positions'),
        'account-fills': account('getFills', Boolean(has['fetchMyTrades']), 'configured exchange recent fills'),
      },
    });
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
      if (err instanceof ProviderError) throw err;
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
    const since = this.now() - limit * barSec * 1000;

    try {
      const rows = (await this.exchange.fetchOHLCV(s, timeframe, since, limit)) as number[][];
      if (!Array.isArray(rows)) {
        throw new ProviderError(`${this.name} ${s}: malformed OHLCV response`, 502, s, 'malformed-upstream');
      }
      const candles: Candle[] = [];
      let omitted = 0;
      for (const row of rows) {
        const [ts, open, high, low, close, volume] = row;
        if (
          sourceTimestampOrNull(ts) === null ||
          positiveFiniteOrNull(open) === null ||
          positiveFiniteOrNull(high) === null ||
          positiveFiniteOrNull(low) === null ||
          positiveFiniteOrNull(close) === null ||
          nonNegativeFiniteOrNull(volume) === null
        ) {
          omitted += 1;
          continue;
        }
        candles.push({
          time: Math.floor(ts / 1000),
          open,
          high,
          low,
          close,
          volume,
        });
      }
      if (rows.length === 0) {
        throw new ProviderError(`${this.name} ${s}: upstream returned no OHLCV rows`, 502, s, 'upstream-unavailable');
      }
      if (candles.length === 0) {
        throw new ProviderError(
          `${this.name} ${s}: upstream returned only malformed OHLCV rows`,
          502,
          s,
          'malformed-upstream',
        );
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
      const value: HistoryResponse = {
        symbol: s,
        interval,
        range: opts.range,
        currency: quote,
        candles: out,
      };
      const last = out.at(-1);
      return withProviderReceipt(this, value, {
        datasetFamily: 'history',
        instrument: s,
        venue: this.exchangeId,
        provenance: 'live',
        sourceAsOf: last == null ? null : last.time * 1000,
        coverage: `${interval} candles over ${opts.range}`,
        expectedCadenceMs: barSec * 1_000,
        maxAgeMs: barSec * 2_000,
        units: { time: 'unix-seconds', ohlc: quote || 'quote-asset', volume: 'base-asset' },
        limitations: [
          ...(omitted > 0
            ? [partialEvidenceLimitation(`${omitted} malformed upstream OHLCV rows were omitted.`)]
            : []),
          ...(last == null ? ['No complete upstream OHLCV row was returned; source as-of is unknown.'] : []),
        ],
      }, this.now());
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(this.describe(err, s), 502, s);
    }
  }

  async getOrderBook(symbol: string, depth = 25): Promise<OrderBook> {
    const s = this.normalize(symbol);
    try {
      const ob = await this.exchange.fetchOrderBook(s, depth);
      const toLevels = (rows: number[][]) =>
        rows
          .slice(0, depth)
          .map(([price, amount]) => ({ price: positiveFiniteOrNull(price), amount: positiveFiniteOrNull(amount) }))
          .filter((level): level is { price: number; amount: number } => level.price !== null && level.amount !== null);
      return {
        symbol: s,
        bids: toLevels(ob.bids as number[][]),
        asks: toLevels(ob.asks as number[][]),
        timestamp: ob.timestamp ?? this.now(),
      };
    } catch (err) {
      throw new ProviderError(this.describe(err, s), 502, s);
    }
  }

  async getExchangeQuotes(symbol: string): Promise<VenueQuote[]> {
    return getExchangeQuotes(this, symbol);
  }

  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    return getVenueDerivatives(this, symbol);
  }

  async getDerivatives(symbol: string): Promise<DerivativesInfo> {
    return fetchDerivatives(this, symbol);
  }

  /** Public so the extracted ccxt/liquidations.ts reader satisfies CcxtReadContext. */
  liquidationSourceCapabilities(): LiquidationSourceCapability[] {
    return liquidationSourceCapabilities(this);
  }

  async getVenueLiquidations(symbol: string): Promise<VenueLiquidations[]> {
    return getVenueLiquidations(this, symbol);
  }

  liquidationsProvenance(): LiquidationsProvenance {
    return liquidationsProvenance(this);
  }

  async getDexPools(symbol: string): Promise<DexPools> {
    return getDexPools(this, symbol);
  }

  /** Read-only Solana network health (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaNetwork(): Promise<SolanaNetwork> {
    return getSolanaNetwork(this);
  }

  /** Read-only Solana wallet inspector (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaWallet(address: string): Promise<SolanaWallet> {
    return getSolanaWallet(this, address);
  }

  /** Trending Solana tokens (env-gated live GeckoTerminal; honest 'unavailable' otherwise). */
  async getSolanaTrending(): Promise<SolanaTrending> {
    return getSolanaTrending();
  }

  /** Solana-network DEX pools for an asset (env-gated live GeckoTerminal; honest otherwise). */
  async getSolanaDexPools(symbol: string): Promise<DexPools> {
    return getSolanaDexPools(this, symbol);
  }

  /** Solana validator leaderboard (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaValidators(): Promise<SolanaValidators> {
    return getSolanaValidators();
  }

  /** Solana native staking economics (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaStaking(): Promise<SolanaStaking> {
    return getSolanaStaking();
  }

  /** SPL token (mint) explorer (env-gated live RPC; honest 'unavailable' otherwise). */
  async getSolanaToken(mint: string): Promise<SolanaTokenInfo> {
    return getSolanaToken(this, mint);
  }

  /** Read-only Jupiter swap quote — QUOTE ONLY, never a swap tx (env-gated; honest otherwise). */
  async getSolanaQuote(input: string, output: string, amount: number): Promise<SolanaSwapQuote> {
    return getSolanaQuote(input, output, amount);
  }

  /** Solana ecosystem market overview (env-gated live GeckoTerminal; honest otherwise). */
  async getSolanaMarket(): Promise<SolanaMarket> {
    return getSolanaMarket(this);
  }

  async getBalances(): Promise<Balances> {
    if (!this.hasKeys()) {
      const value: Balances = {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only balances need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never places orders and never holds your funds).',
        totalValueUsd: null,
        balances: [],
        asOf: this.now(),
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'balances',
        venue: this.exchangeId,
        units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
        note: value.note ?? 'Read-only balances are not configured.',
      }, value.asOf) };
    }
    try {
      // READ-ONLY account read. Midas is non-custodial: this calls only
      // fetchBalance — never createOrder or any write/withdraw method.
      let primarySourceAsOf: number | null = null;
      let secondarySourceAsOf: number | null = null;
      let primaryMapping: ReturnType<typeof mapCcxtBalanceWithDiagnostics> | null = null;
      let secondaryMapping: ReturnType<typeof mapCcxtBalanceWithDiagnostics> | null = null;
      const readBalances = async (ex: Exchange): Promise<ReturnType<typeof mapCcxtBalanceWithDiagnostics>['rows']> => {
        const raw = await ex.fetchBalance();
        if (ex === this.exchange) {
          primarySourceAsOf = sourceTimestampOrNull((raw as { timestamp?: unknown }).timestamp);
        } else {
          secondarySourceAsOf = sourceTimestampOrNull((raw as { timestamp?: unknown }).timestamp);
        }
        const totals = (raw as { total?: Record<string, unknown> }).total ?? {};
        const assets = Object.keys(totals).filter((a) => {
          const n = Number((totals as Record<string, unknown>)[a]);
          return Number.isFinite(n) && n > 0;
        });
        const prices = await this.priceAssetsUsd(assets, ex);
        const mapping = mapCcxtBalanceWithDiagnostics(raw, (asset) => prices.get(asset.toUpperCase()) ?? null);
        if (ex === this.exchange) primaryMapping = mapping;
        else secondaryMapping = mapping;
        assertUsableAccountMapping(mapping, 'balance');
        return mapping.rows;
      };
      let balances = await readBalances(this.exchange);
      const second = await this.fromSecondary(readBalances);
      if (second) {
        balances = mergeVenueRows(balances, this.exchangeId, second.rows, this.secondary!.id, (b) => b.valueUsd);
      }
      const sourceAsOf = second == null
        ? primarySourceAsOf
        : primarySourceAsOf !== null && secondarySourceAsOf !== null
          ? Math.min(primarySourceAsOf, secondarySourceAsOf)
          : null;
      const value: Balances = {
        source: this.name,
        provenance: 'live',
        // Honest total: assets with no /USDT market are excluded from the sum,
        // so when any exist the note must say the total is a floor.
        note: [
          second?.note,
          accountOmissionCaveat(primaryMapping, 'held balance'),
          accountOmissionCaveat(secondaryMapping, 'held balance'),
          unpricedCaveat(balances),
        ].filter(Boolean).join(' ') || null,
        totalValueUsd: sumValueUsd(balances),
        balances,
        asOf: this.now(),
      };
      const rawBalanceInput = providerReceipt(this, {
        datasetFamily: 'balances', venue: this.exchangeId, provenance: 'live', sourceAsOf,
        coverage: 'raw exchange asset quantities',
        units: { free: 'asset-units', used: 'asset-units', total: 'asset-units' },
      }, value.asOf);
      const pricingInput = providerReceipt(this, {
        datasetFamily: 'quote', venue: this.exchangeId, provenance: 'live', sourceAsOf: null,
        coverage: 'USDT ticker prices and explicit USD-stablecoin parity assumptions',
        units: { price: 'USD-per-asset' },
        limitations: ['Individual valuation-ticker source timestamps are not retained by this aggregate.'],
      }, value.asOf);
      return withProviderDerivedReceipt(this, value, {
        datasetFamily: 'balances', venue: this.exchangeId, provenance: 'live',
        inputReceipts: [rawBalanceInput, pricingInput], sourceAsOf: null,
        units: { free: 'asset-units', used: 'asset-units', total: 'asset-units', valueUsd: 'USD' },
        methodology: {
          id: 'midas.balance-usd-valuation', version: '1.0.0',
          formula: 'valueUsd = total * USD price; totalValueUsd = sum(known valueUsd)',
        },
        note: value.note,
      }, value.asOf);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Balance read failed — ${safeErrorLabel(err)}. Check that the API key is valid and has read access (read-only is sufficient).`,
        502,
      );
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
    const asOf = this.now();
    if (!this.hasKeys()) {
      const value: OpenOrders = {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only open orders need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never places or cancels orders).',
        orders: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-orders', venue: this.exchangeId,
        units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
        note: value.note ?? 'Read-only open orders are not configured.',
      }, asOf) };
    }
    if (!this.exchange.has['fetchOpenOrders']) {
      const value: OpenOrders = {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchOpenOrders endpoint.`,
        orders: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-orders', venue: this.exchangeId,
        units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
        note: value.note ?? 'Open-orders reads are unsupported.',
      }, asOf) };
    }
    try {
      // READ-ONLY: fetchOpenOrders only — never createOrder/cancelOrder/editOrder.
      const raw = await this.exchange.fetchOpenOrders();
      const primaryMapping = mapOpenOrdersWithDiagnostics(raw);
      assertUsableAccountMapping(primaryMapping, 'open-orders');
      let orders = primaryMapping.rows;
      let secondaryMapping: ReturnType<typeof mapOpenOrdersWithDiagnostics> | null = null;
      const second = await this.fromSecondary(async (ex) => {
        if (!ex.has['fetchOpenOrders']) return [];
        secondaryMapping = mapOpenOrdersWithDiagnostics(await ex.fetchOpenOrders());
        assertUsableAccountMapping(secondaryMapping, 'open-orders');
        return secondaryMapping.rows;
      });
      if (second) {
        orders = mergeVenueRows(orders, this.exchangeId, second.rows, this.secondary!.id, (o) => o.timestamp);
      }
      const value: OpenOrders = {
        source: this.name,
        provenance: 'live',
        note: [
          second?.note,
          accountOmissionCaveat(primaryMapping, 'open-order'),
          accountOmissionCaveat(secondaryMapping, 'open-order'),
        ].filter(Boolean).join(' ') || null,
        orders,
        asOf,
      };
      const rawInput = providerReceipt(this, {
        datasetFamily: 'account-orders', venue: this.exchangeId, provenance: 'live', sourceAsOf: null,
        coverage: 'raw configured-exchange open-order rows',
        units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
        note: value.note,
      }, asOf);
      return withProviderDerivedReceipt(this, value, {
        datasetFamily: 'account-orders', venue: this.exchangeId, provenance: 'live', sourceAsOf: null,
        inputReceipts: [rawInput],
        units: { price: 'quote-asset', amount: 'base-asset', filled: 'base-asset', remaining: 'base-asset' },
        methodology: {
          id: 'midas.open-order-normalization', version: '1.0.0',
          formula: 'remaining = reported remaining or max(amount - filled, 0); value = price * amount',
        },
        note: value.note,
      }, asOf);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Open-orders read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
        502,
      );
    }
  }

  async getPositions(): Promise<AccountPositions> {
    const asOf = this.now();
    if (!this.hasKeys()) {
      const value: AccountPositions = {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only positions need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(use read-only keys — Midas never opens or closes positions).',
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-positions', venue: this.exchangeId,
        units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
        note: value.note ?? 'Read-only positions are not configured.',
      }, asOf) };
    }
    if (!this.exchange.has['fetchPositions']) {
      const value: AccountPositions = {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchPositions endpoint (spot-only account or exchange).`,
        totalUnrealizedPnlUsd: null,
        positions: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-positions', venue: this.exchangeId,
        units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
        note: value.note ?? 'Position reads are unsupported.',
      }, asOf) };
    }
    try {
      // READ-ONLY: fetchPositions only — never any order/position write method.
      const raw = await this.exchange.fetchPositions();
      const primaryMapping = mapPositionsWithDiagnostics(raw);
      assertUsableAccountMapping(primaryMapping, 'positions');
      let positions = primaryMapping.rows;
      let secondaryMapping: ReturnType<typeof mapPositionsWithDiagnostics> | null = null;
      const second = await this.fromSecondary(async (ex) => {
        if (!ex.has['fetchPositions']) return [];
        secondaryMapping = mapPositionsWithDiagnostics(await ex.fetchPositions());
        assertUsableAccountMapping(secondaryMapping, 'positions');
        return secondaryMapping.rows;
      });
      if (second) {
        positions = mergeVenueRows(positions, this.exchangeId, second.rows, this.secondary!.id, (p) => p.notionalUsd);
      }
      const value: AccountPositions = {
        source: this.name,
        provenance: 'live',
        note: [
          second?.note,
          accountOmissionCaveat(primaryMapping, 'position'),
          accountOmissionCaveat(secondaryMapping, 'position'),
        ].filter(Boolean).join(' ') || null,
        totalUnrealizedPnlUsd: sumUnrealizedPnl(positions),
        positions,
        asOf,
      };
      const rawInput = providerReceipt(this, {
        datasetFamily: 'account-positions', venue: this.exchangeId, provenance: 'live', sourceAsOf: null,
        coverage: 'raw configured-exchange position rows',
        units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
        note: value.note,
      }, asOf);
      return withProviderDerivedReceipt(this, value, {
        datasetFamily: 'account-positions', venue: this.exchangeId, provenance: 'live', sourceAsOf: null,
        inputReceipts: [rawInput],
        units: { contracts: 'contracts-or-base', notionalUsd: 'USD', markPrice: 'quote-asset', unrealizedPnlUsd: 'USD' },
        methodology: {
          id: 'midas.position-normalization', version: '1.0.0',
          formula: 'contracts = abs(reported contracts); totalUnrealizedPnlUsd = sum(known unrealizedPnlUsd)',
        },
        note: value.note,
      }, asOf);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(
        `Positions read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
        502,
      );
    }
  }

  async getFills(symbol?: string): Promise<AccountFills> {
    const asOf = this.now();
    if (!this.hasKeys()) {
      const value: AccountFills = {
        source: this.name,
        provenance: 'unavailable',
        note:
          'Read-only fills need exchange API keys. Set MIDAS_CCXT_API_KEY and MIDAS_CCXT_SECRET ' +
          '(read-only keys are sufficient — Midas never moves funds).',
        fills: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-fills', instrument: symbol ?? null, venue: this.exchangeId,
        units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
        note: value.note ?? 'Read-only fills are not configured.',
      }, asOf) };
    }
    if (!this.exchange.has['fetchMyTrades']) {
      const value: AccountFills = {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} does not expose a fetchMyTrades endpoint.`,
        fills: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-fills', instrument: symbol ?? null, venue: this.exchangeId,
        units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
        note: value.note ?? 'Fill reads are unsupported.',
      }, asOf) };
    }
    try {
      // READ-ONLY: fetchMyTrades only. Many venues (e.g. Binance) require a
      // symbol for this endpoint — surface that honestly instead of guessing.
      const sym = symbol ? this.normalize(symbol) : undefined;
      const raw = await this.exchange.fetchMyTrades(sym, undefined, 100);
      const primaryMapping = mapMyTradesWithDiagnostics(raw);
      assertUsableAccountMapping(primaryMapping, 'fills');
      let fills = primaryMapping.rows;
      let secondaryMapping: ReturnType<typeof mapMyTradesWithDiagnostics> | null = null;
      const second = await this.fromSecondary(async (ex) => {
        if (!ex.has['fetchMyTrades']) return [];
        secondaryMapping = mapMyTradesWithDiagnostics(await ex.fetchMyTrades(sym, undefined, 100));
        assertUsableAccountMapping(secondaryMapping, 'fills');
        return secondaryMapping.rows;
      });
      if (second) {
        fills = mergeVenueRows(fills, this.exchangeId, second.rows, this.secondary!.id, (f) => f.timestamp);
      }
      const value: AccountFills = {
        source: this.name,
        provenance: 'live',
        note: [
          second?.note,
          accountOmissionCaveat(primaryMapping, 'fill'),
          accountOmissionCaveat(secondaryMapping, 'fill'),
        ].filter(Boolean).join(' ') || null,
        fills,
        asOf,
      };
      const rawInput = providerReceipt(this, {
        datasetFamily: 'account-fills', instrument: sym ?? null, venue: this.exchangeId,
        provenance: 'live', sourceAsOf: null,
        coverage: 'raw configured-exchange trade/fill rows',
        units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
        note: value.note,
      }, asOf);
      return withProviderDerivedReceipt(this, value, {
        datasetFamily: 'account-fills', instrument: sym ?? null, venue: this.exchangeId,
        provenance: 'live', sourceAsOf: null,
        inputReceipts: [rawInput],
        units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
        methodology: {
          id: 'midas.fill-normalization', version: '1.0.0',
          formula: 'cost = reported cost or price * amount; fee fields remain null when unreported',
        },
        note: value.note,
      }, asOf);
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      // Inspect the raw message internally to detect the "symbol required" case,
      // but never place it in the note — it can carry the signed request URL.
      const rawMsg = err instanceof Error ? err.message : '';
      const needsSymbol = /symbol|argument/i.test(rawMsg) && !symbol;
      if (!needsSymbol) {
        throw new ProviderError(
          `Fills read failed — ${safeErrorLabel(err)}. Check the API key (read access is sufficient).`,
          502,
        );
      }
      const value: AccountFills = {
        source: this.name,
        provenance: 'unavailable',
        note: `${this.name} requires a symbol for fills — open FILLS with a symbol (e.g. BTC/USDT FILLS).`,
        fills: [],
        asOf,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'account-fills', instrument: null, venue: this.exchangeId,
        units: { price: 'quote-asset', amount: 'base-asset', cost: 'quote-asset', fee: 'fee-currency' },
        note: value.note ?? 'A symbol is required for fill reads.',
      }, asOf) };
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
    return cancelOrder(this, id, symbol);
  }

  /**
   * Place a LIVE order. FAIL-CLOSED under the execution safety hold: throws
   * the same TradingSafetyHold shape the route layer returns (routes/account.ts).
   * Defense in depth — the POST /api/orders route returns its 503 before ever
   * reaching this method, and this provider throw guarantees no other caller
   * (present or future) can execute a live write while the hold stands.
   */
  async placeOrder(_req: OrderRequest): Promise<PlacedOrder> {
    return placeOrder(_req);
  }

  async getFundingHistory(symbol: string, limit: number): Promise<FundingHistoryPoint[]> {
    return fetchFundingHistory(this, symbol, limit);
  }

  /**
   * OI-delta positioning for a perp over a lookback window: the venue's OI
   * history (fetchOpenInterestHistory, where the venue publishes one — Binance,
   * Bybit, OKX, Gate do; Deribit and Kraken Futures do not) paired with OHLCV
   * closes over the same window, then reduced to the ΔOI × Δprice quadrant by
   * the shared summarizeOiDelta helper.
   *
   * Alignment: each OI observation is paired with the close of the price bar
   * whose floor-aligned bucket it falls into — bucket width = the OI timeframe
   * (5m/15m/1h/4h per window). Some venues timestamp OI at the PERIOD END while
   * OHLCV bars are stamped at the period start, so an observation one bucket
   * ahead of its bar is paired back one bucket; anything further off is left
   * price-null. Classification requires prices at the exact first and last OI
   * endpoints; inner priced points never shorten the requested comparison.
   *
   * A venue without an OI-history read, an empty history, or a failed read is
   * an honest 'unavailable' — a delta is NEVER synthesized from two
   * point-in-time snapshots and presented as history.
   */
  async getOiDelta(symbol: string, window: OiDeltaWindow): Promise<OiDelta> {
    return fetchOiDelta(this, symbol, window);
  }

  // -- Deribit options / DVOL / term structure ------------------------------
  //
  // Options and dated-futures boards are read from DERIBIT regardless of
  // MIDAS_CCXT_EXCHANGE: Deribit is where BTC/ETH options and the DVOL index
  // actually trade (the configured venue — e.g. binance — lists no European
  // options and no volatility index). A dedicated, public (keyless) client is
  // used, built lazily so a non-crypto deployment never constructs it. Every
  // read is READ-ONLY market data; unsupported/unlisted data is unavailable,
  // while transport or malformed upstream failures throw sanitized errors.

  private deribitClient: Exchange | null = null;

  /** The lazy, public Deribit client for the options surface (CcxtReadContext). */
  deribit(): Exchange {
    if (!this.deribitClient) {
      this.deribitClient = new (ccxtRegistry()['deribit'])({ enableRateLimit: true });
    }
    return this.deribitClient;
  }

  /**
   * The Deribit DVOL volatility index (30-day forward-looking implied vol).
   * ccxt exposes no unified method for it, so this uses the deribit client's
   * implicit get_volatility_index_data endpoint — guarded by a typeof check,
   * Unsupported capability is an honest unavailable result. Operational and
   * malformed upstream failures throw a sanitized ProviderError so status can
   * distinguish them from ordinary lack of support.
   */
  async getDvol(symbol: DvolSymbol): Promise<DvolSnapshot> {
    return fetchDvol(this, symbol);
  }

  /**
   * Dated-futures term structure for an underlying from Deribit: the listed
   * futures (swap:false, future:true) priced from their tickers, with the
   * annualized basis vs the perpetual mark. Futures with no usable price are
   * dropped rather than shown with a fabricated basis; an underlying with no
   * dated futures is an honest 'unavailable'.
   */
  async getFuturesTermStructure(symbol: string): Promise<TermStructure> {
    return fetchFuturesTermStructure(this, symbol);
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
    return fetchOptionsChain(this, symbol, expiry);
  }

  async getVenueScreen(opts: ScreenerOptions): Promise<VenueScreen[]> {
    return getVenueScreen(this, opts);
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
        const changePercent = finiteOrNull(t.percentage);
        if (changePercent === null) continue;
        rows.push({
          symbol: sym,
          name: sym,
          price,
          changePercent,
          volume: nonNegativeFiniteOrNull(t.baseVolume),
          quoteVolume: nonNegativeFiniteOrNull(t.quoteVolume),
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

  /** BTC-USD → BTC/USD; already-unified symbols pass through. Public for CcxtReadContext. */
  normalize(symbol: string): string {
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
    if (price == null) {
      throw new ProviderError(`${this.name} ${symbol}: ticker has no price`, 502, symbol, 'malformed-upstream');
    }
    const reportedPreviousClose = positiveFiniteOrNull(t.previousClose);
    const reportedOpen = positiveFiniteOrNull(t.open);
    const previousClose = reportedPreviousClose ?? reportedOpen;
    if (previousClose === null) {
      throw new ProviderError(
        `${this.name} ${symbol}: ticker has no previous-close evidence`,
        502,
        symbol,
        'malformed-upstream',
      );
    }
    const change = finiteOrNull(t.change) ?? price - previousClose;
    const changePercent = finiteOrNull(t.percentage) ?? (change / previousClose) * 100;
    const sourceTimestamp = sourceTimestampOrNull(t.timestamp);
    const observedAt = this.now();

    const value: Quote = {
      symbol,
      name: base && quote ? `${base} / ${quote}` : symbol,
      currency: quote ?? '',
      exchange: this.exchange.name ?? this.exchange.id,
      marketState: 'REGULAR', // crypto trades 24/7
      price,
      previousClose,
      open: reportedOpen,
      dayHigh: positiveFiniteOrNull(t.high),
      dayLow: positiveFiniteOrNull(t.low),
      change,
      changePercent,
      volume: nonNegativeFiniteOrNull(t.baseVolume),
      marketCap: null,
      fiftyTwoWeekHigh: null,
      fiftyTwoWeekLow: null,
      asOf: sourceTimestamp,
    };
    return withProviderReceipt(this, value, {
      datasetFamily: 'quote',
      instrument: symbol,
      venue: this.exchangeId,
      provenance: 'live',
      sourceAsOf: sourceTimestamp,
      units: { price: quote || 'quote-asset', volume: 'base-asset' },
      limitations: [
        ...(reportedPreviousClose === null
          ? [partialEvidenceLimitation('Previous close was unavailable; venue open was used as the comparison basis.')]
          : []),
        ...(sourceTimestamp === null ? ['The venue ticker omitted its source timestamp.'] : []),
        ...(value.volume === null
          ? [partialEvidenceLimitation('The venue ticker omitted valid 24-hour base volume.')]
          : []),
      ],
    }, observedAt);
  }

  /**
   * The set of exchanges used for the multi-exchange compare, built once and
   * cached. Public so extracted ccxt/* readers satisfy CcxtReadContext.
   */
  compareExchanges(): Exchange[] {
    if (!this.compareExchangesCache) {
      this.compareExchangesCache = buildCompareExchanges();
    }
    return this.compareExchangesCache;
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
