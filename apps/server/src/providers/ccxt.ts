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
  DataReceipt,
  Liquidation,
  LiquidationsProvenance,
  LiquidationSourceCapability,
  FundingHistoryPoint,
  HistoryResponse,
  Interval,
  NewsItem,
  OiDelta,
  OiDeltaPoint,
  OiDeltaWindow,
  OpenOrders,
  OptionsChain,
  OptionsChainEntry,
  OrderBook,
  OrderRequest,
  PlacedOrder,
  ProviderCapabilityManifest,
  Quote,
  ScreenerRow,
  VenueScreen,
  VenueScreenRow,
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
  VenueLiquidations,
  VenueQuote,
} from '@midas/shared';
import { annualizedBasisPct, computeMaxPainStrike, computePutCallOiRatio, OI_DELTA_WINDOW_MS, partialEvidenceLimitation, summarizeOiDelta, withReceiptLimitations } from '@midas/shared';
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
import { dexscreenerEnabled, fetchDexPools } from './dexscreener';
import { fetchGeckoPools, geckoterminalEnabled } from './geckoterminal';
import { fetchSolanaNetwork } from '../solana/network';
import { fetchSolanaWallet } from '../solana/wallet';
import { fetchSolanaPools, fetchSolanaTrending } from '../solana/dex';
import { fetchSolanaStaking, fetchSolanaValidators } from '../solana/staking';
import { fetchSolanaToken } from '../solana/token';
import { fetchSolanaQuote } from '../solana/jupiter';
import { fetchSolanaMarket } from '../solana/market';
import { STABLES, ccxtKeysConfigured, mapCcxtBalanceWithDiagnostics, sumValueUsd, unpricedCaveat } from './balances';
import {
  mapMyTradesWithDiagnostics,
  mapOpenOrdersWithDiagnostics,
  mapPositionsWithDiagnostics,
  mergeVenueRows,
  sumUnrealizedPnl,
} from './accountReads';
import { EXECUTION_SAFETY_HOLD_REASON, mapPlacedOrder } from '../trading';
import { INTERVAL_SECONDS, RANGE_SECONDS, sortScreener } from './util';

import {
  TIMEFRAME_MAP,
  ccxtRegistry,
  compareExchangeIds,
  isKnownExchange,
  fundingIntervalHours,
  readFunding,
  readOpenInterest,
  safeErrorLabel,
  tickerPrice,
  timeframeSeconds,
  toPerpSymbol,
} from './ccxt/helpers';

// Re-exported so existing import sites stay stable: providers/ccxt.test.ts
// pulls safeErrorLabel + toPerpSymbol, and keys/routes.ts pulls isKnownExchange.
export { compareExchangeIds, isKnownExchange, safeErrorLabel, toPerpSymbol } from './ccxt/helpers';

const HOUR_MS = 3_600_000;

/**
 * The one caveat every publishing venue carries: public liquidation streams are
 * throttled and documented to under-report many-fold. Shared by the feed-level
 * provenance note and each per-source capability so they cannot drift apart.
 */
const LIQUIDATION_THROTTLE_NOTE =
  'Exchange liquidation streams are throttled (~1/sec) and are widely documented to under-report; treat sizes as indicative, not exact.';

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

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonNegativeFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function positiveFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function sourceTimestampOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Parse a ccxt `fetchLiquidations` response into the unified shape.
 *
 * Shared by the single-venue derivatives snapshot and the cross-venue fan-out so
 * the two cannot drift into disagreeing about what counts as a usable event.
 *
 * ccxt's unified liquidation shape has no top-level `side` — it lives,
 * venue-specifically, inside `info`. A row whose side, price, amount or
 * timestamp cannot be read is dropped and counted, never defaulted: guessing
 * 'buy' would render every liquidation as a short.
 */
function parseLiquidationRows(response: unknown): { recent: Liquidation[]; omitted: number } {
  if (!Array.isArray(response)) throw new Error('malformed liquidation response');
  const rows = response as Array<{
    side?: string;
    price?: number;
    amount?: number;
    contracts?: number;
    timestamp?: number;
    info?: { side?: string };
  }>;
  const recent: Liquidation[] = [];
  let omitted = 0;
  for (const l of rows.slice(0, 20)) {
    const rawSide = (l.side ?? l.info?.side ?? '').toString().toLowerCase();
    const side = rawSide === 'sell' ? ('sell' as const) : rawSide === 'buy' ? ('buy' as const) : null;
    const price = positiveFiniteOrNull(l.price);
    const amount = positiveFiniteOrNull(l.amount ?? l.contracts);
    const timestamp = sourceTimestampOrNull(l.timestamp);
    if (!side || price === null || amount === null || timestamp === null) {
      omitted += 1;
      continue;
    }
    recent.push({ side, price, amount, timestamp });
  }
  return { recent, omitted };
}

function crossVenuePartialLimitation(
  family: 'quote' | 'derivatives' | 'liquidations',
  attempted: number,
  returned: number,
  failed: number,
): string {
  const unsupportedOrEmpty = attempted - returned - failed;
  return partialEvidenceLimitation(
    `Cross-venue ${family} fan-out attempted ${attempted} venue(s); ${returned} returned usable evidence, ` +
    `${failed} failed, and ${unsupportedOrEmpty} returned unsupported or empty evidence.`,
  );
}

function withRowReceiptLimitation<T extends { receipt?: DataReceipt }>(
  value: T,
  limitation: string,
  instrument: string,
): T & { receipt: DataReceipt } {
  if (!value.receipt) {
    throw new ProviderError(
      `Cross-venue provider returned unreceipted evidence for ${instrument}`,
      502,
      instrument,
      'malformed-upstream',
    );
  }
  return { ...value, receipt: withReceiptLimitations(value.receipt, [limitation]) };
}

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

function normalizedFieldOmission(
  label: string,
  state: 'ok' | 'unsupported' | 'error',
  fields: readonly unknown[],
): string | null {
  if (state !== 'ok') return null;
  const returned = fields.filter((field) => field !== null).length;
  const omitted = fields.length - returned;
  if (omitted === 0) return null;
  return partialEvidenceLimitation(
    `${label} observation attempted ${fields.length} evidence field(s); ${returned} returned usable evidence and ${omitted} were missing or malformed.`,
  );
}

function fundingOmission(funding: Awaited<ReturnType<typeof readFunding>>): string | null {
  return normalizedFieldOmission('Funding', funding.state, [
    funding.fundingRate,
    funding.fundingIntervalHours,
    funding.nextFundingTime,
    funding.markPrice,
    funding.indexPrice,
  ]);
}

function openInterestOmission(oi: Awaited<ReturnType<typeof readOpenInterest>>): string | null {
  return normalizedFieldOmission('Open-interest', oi.state, [oi.openInterest, oi.openInterestValue]);
}

function optionOiScore(value: OptionsChainEntry): number {
  const known = [value.callOi, value.putOi].filter((oi): oi is number => oi !== null);
  return known.length > 0 ? known.reduce((sum, oi) => sum + oi, 0) : Number.NEGATIVE_INFINITY;
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
      'upstream-unavailable',
      'cancel-outcome-unknown',
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

/** The fields the options surface reads off a ccxt option-chain entry. */
interface DeribitOptionQuote {
  openInterest?: number;
  markPrice?: number;
  underlyingPrice?: number;
  timestamp?: number;
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
  readonly capabilities: ProviderCapabilityManifest;
  private readonly exchange: Exchange;
  private readonly exchangeId: string;
  /** True when constructed from explicit per-user creds (vs operator env). */
  private readonly userKeyed: boolean;
  private marketsPromise: Promise<unknown> | null = null;
  private compareExchanges: Exchange[] | null = null;
  private readonly now: () => number;

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
    if (deps.compareExchanges) this.compareExchanges = deps.compareExchanges;
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
    const s = this.normalize(symbol);
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueQuote> => {
        const t = await ex.fetchTicker(s);
        const price = tickerPrice(t);
        // Drop a venue whose ticker carries no usable price rather than
        // fabricating 0 — a fake 0 reads as a ~100% cross-venue discrepancy.
        if (price == null) {
          throw new ProviderError(`${ex.id} ${s}: ticker has no price`, 502, s, 'malformed-upstream');
        }
        const previousClose = positiveFiniteOrNull(t.previousClose) ?? positiveFiniteOrNull(t.open);
        const changePercent = finiteOrNull(t.percentage) ??
          (previousClose === null ? null : ((price - previousClose) / previousClose) * 100);
        if (changePercent === null) {
          throw new ProviderError(
            `${ex.id} ${s}: ticker has no change-percent evidence`,
            502,
            s,
            'malformed-upstream',
          );
        }
        const sourceTimestamp = sourceTimestampOrNull(t.timestamp);
        const sizes = t as Ticker & { bidVolume?: number | null; askVolume?: number | null };
        const value: VenueQuote = {
          exchange: ex.name ?? ex.id,
          price,
          bid: positiveFiniteOrNull(t.bid),
          ask: positiveFiniteOrNull(t.ask),
          bidSize: positiveFiniteOrNull(sizes.bidVolume),
          askSize: positiveFiniteOrNull(sizes.askVolume),
          changePercent,
          volume: nonNegativeFiniteOrNull(t.baseVolume),
          timestamp: sourceTimestamp,
        };
        return withProviderReceipt(this, value, {
          datasetFamily: 'venue-quotes',
          source: `ccxt:${ex.id}`,
          instrument: s,
          venue: ex.id,
          provenance: 'live',
          sourceAsOf: sourceTimestamp,
          units: {
            price: 'quote-asset', bid: 'quote-asset', ask: 'quote-asset',
            bidSize: 'base-asset', askSize: 'base-asset', volume: 'base-asset',
          },
          limitations: [
            ...(sourceTimestamp === null ? ['The venue ticker omitted its source timestamp.'] : []),
            ...(value.volume === null
              ? [partialEvidenceLimitation('The venue ticker omitted valid 24-hour base volume.')]
              : []),
            ...(value.bid === null || value.ask === null
              ? [partialEvidenceLimitation('The venue ticker omitted a valid bid or ask.')]
              : []),
            ...(value.bidSize === null || value.askSize === null
              ? [partialEvidenceLimitation('The venue ticker omitted executable top-of-book size.')]
              : []),
          ],
        }, this.now());
      }),
    );
    const values = settled
      .filter((r): r is PromiseFulfilledResult<VenueQuote> => r.status === 'fulfilled')
      .map((r) => r.value);
    const failures = settled.length - values.length;
    if (values.length === 0 && failures > 0) {
      const category = settled.every(
        (result) => result.status === 'rejected' &&
          result.reason instanceof ProviderError &&
          result.reason.dataHealthCategory === 'malformed-upstream',
      ) ? 'malformed-upstream' : 'upstream-unavailable';
      throw new ProviderError(`${this.name} ${s}: every configured venue quote read failed`, 502, s, category);
    }
    if (failures === 0) return values;
    const limitation = crossVenuePartialLimitation('quote', settled.length, values.length, failures);
    return values.map((value) => withRowReceiptLimitation(value, limitation, s));
  }

  async getVenueDerivatives(symbol: string): Promise<VenueDerivatives[]> {
    const perp = toPerpSymbol(this.normalize(symbol));
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueDerivatives> => {
        // Sequential (funding then OI), matching the original single-venue read.
        const funding = await readFunding(ex, perp);
        const oi = await readOpenInterest(ex, perp);
        if ((funding.state === 'error' && oi.state !== 'ok') || (oi.state === 'error' && funding.state !== 'ok')) {
          throw new ProviderError(`${ex.id} ${perp}: derivatives upstream read failed`, 502, perp);
        }
        const sourceTimes = [
          ...(funding.state === 'ok' ? [funding.sourceAsOf] : []),
          ...(oi.state === 'ok' ? [oi.sourceAsOf] : []),
        ];
        const sourceTimestamp = sourceTimes.length > 0 && sourceTimes.every((timestamp) => timestamp !== null)
          ? Math.min(...sourceTimes as number[])
          : null;
        const value: VenueDerivatives = {
          exchange: ex.name ?? ex.id,
          fundingRate: funding.fundingRate,
          fundingIntervalHours: funding.fundingIntervalHours,
          nextFundingTime: funding.nextFundingTime,
          markPrice: funding.markPrice,
          openInterestValue: oi.openInterestValue,
          timestamp: sourceTimestamp,
        };
        const hasEvidence =
          value.fundingRate !== null || value.openInterestValue !== null ||
          value.markPrice !== null || value.nextFundingTime !== null;
        if (!hasEvidence && (funding.state === 'ok' || oi.state === 'ok')) {
          throw new ProviderError(
            `${ex.id} ${perp}: malformed empty derivatives response`,
            502,
            perp,
            'malformed-upstream',
          );
        }
        return withProviderReceipt(this, value, {
          datasetFamily: 'venue-derivatives',
          source: `ccxt:${ex.id}`,
          instrument: perp,
          venue: ex.id,
          provenance: 'live',
          sourceAsOf: sourceTimestamp,
          units: {
            fundingRate: 'fraction-per-interval', markPrice: 'quote-asset',
            openInterestValue: 'quote-asset',
          },
          limitations: [
            ...(funding.state === 'unsupported'
              ? [partialEvidenceLimitation('The venue does not support unified funding-rate reads.')]
              : []),
            ...(funding.state === 'error'
              ? [partialEvidenceLimitation('The venue funding-rate upstream read failed.')]
              : []),
            ...(fundingOmission(funding) ? [fundingOmission(funding)!] : []),
            ...(oi.state === 'unsupported'
              ? [partialEvidenceLimitation('The venue does not support unified open-interest reads.')]
              : []),
            ...(oi.state === 'error'
              ? [partialEvidenceLimitation('The venue open-interest upstream read failed.')]
              : []),
            ...(openInterestOmission(oi) ? [openInterestOmission(oi)!] : []),
            ...(sourceTimestamp === null ? ['The venue omitted source timestamps for derivatives evidence.'] : []),
          ],
        }, this.now());
      }),
    );
    // Keep venues that reported any perp field (funding, OI, mark or next-funding);
    // drop only the all-null spot-only venues. A venue can answer fetchFundingRate
    // with a markPrice/next time but a null fundingRate (the ccxt fields are
    // independently optional), so don't gate solely on fundingRate/OI.
    const values = settled
      .filter((r): r is PromiseFulfilledResult<VenueDerivatives> => r.status === 'fulfilled')
      .map((r) => r.value)
      .filter(
        (v) =>
          v.fundingRate !== null ||
          v.openInterestValue !== null ||
          v.markPrice !== null ||
          v.nextFundingTime !== null,
      );
    if (values.length === 0 && settled.some((result) => result.status === 'rejected')) {
      const category = settled.every(
        (result) => result.status === 'rejected' &&
          result.reason instanceof ProviderError &&
          result.reason.dataHealthCategory === 'malformed-upstream',
      ) ? 'malformed-upstream' : 'upstream-unavailable';
      throw new ProviderError(`${this.name} ${perp}: every configured venue derivatives read failed`, 502, perp, category);
    }
    const failures = settled.filter((result) => result.status === 'rejected').length;
    if (values.length === settled.length) return values;
    const limitation = crossVenuePartialLimitation('derivatives', settled.length, values.length, failures);
    return values.map((value) => withRowReceiptLimitation(value, limitation, perp));
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
      timestamp: null,
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

    let liquidationsState: 'ok' | 'unsupported' | 'error' = 'unsupported';
    let liquidationsSourceAsOf: number | null = null;
    let omittedLiquidations = 0;
    let liquidationsMalformed = false;
    if (this.exchange.has['fetchLiquidations']) {
      try {
        const response = await this.exchange.fetchLiquidations(perp, undefined, 20);
        const { recent, omitted } = parseLiquidationRows(response);
        omittedLiquidations += omitted;
        out.recentLiquidations = recent;
        liquidationsState = 'ok';
        liquidationsMalformed = (response as unknown[]).length > 0 && recent.length === 0;
        liquidationsSourceAsOf = recent.length > 0
          ? Math.max(...recent.map((liquidation) => liquidation.timestamp))
          : null;
      } catch {
        liquidationsState = 'error';
      }
    }

    const fundingHasEvidence = funding.state === 'ok' && [
      funding.fundingRate, funding.fundingIntervalHours, funding.nextFundingTime,
      funding.markPrice, funding.indexPrice,
    ].some((field) => field !== null);
    const oiHasEvidence = oi.state === 'ok' && [oi.openInterest, oi.openInterestValue].some((field) => field !== null);
    const fundingMalformed = funding.state === 'ok' && !fundingHasEvidence;
    const oiMalformed = oi.state === 'ok' && !oiHasEvidence;
    const hasSuccessfulInput =
      fundingHasEvidence || oiHasEvidence || (liquidationsState === 'ok' && !liquidationsMalformed);
    const hasFailedInput =
      funding.state === 'error' || oi.state === 'error' || liquidationsState === 'error' ||
      fundingMalformed || oiMalformed || liquidationsMalformed;
    if (hasFailedInput && !hasSuccessfulInput) {
      const category =
        (fundingMalformed || oiMalformed || liquidationsMalformed) &&
        funding.state !== 'error' && oi.state !== 'error' && liquidationsState !== 'error'
          ? 'malformed-upstream'
          : 'upstream-unavailable';
      throw new ProviderError(`${this.name} ${perp}: derivatives upstream read failed`, 502, perp, category);
    }
    const successfulTimestamps = [
      ...(fundingHasEvidence ? [funding.sourceAsOf] : []),
      ...(oiHasEvidence ? [oi.sourceAsOf] : []),
      ...(liquidationsState === 'ok' && !liquidationsMalformed ? [liquidationsSourceAsOf] : []),
    ];
    const allSuccessfulInputsTimestamped = successfulTimestamps.every((timestamp) => timestamp !== null);
    const sourceTimestamp =
      successfulTimestamps.length > 0 && allSuccessfulInputsTimestamped
        ? Math.min(...successfulTimestamps as number[])
        : null;
    out.timestamp = sourceTimestamp;
    const provenance = hasSuccessfulInput ? 'live' : 'unavailable';
    return withProviderReceipt(this, out, {
      datasetFamily: 'derivatives',
      instrument: perp,
      venue: this.exchangeId,
      provenance,
      sourceAsOf: sourceTimestamp,
      coverage: 'funding, open interest and recent public liquidations where supported',
      units: {
        fundingRate: 'fraction-per-interval', markPrice: 'quote-asset', indexPrice: 'quote-asset',
        openInterest: 'base-asset', openInterestValue: 'quote-asset', liquidationAmount: 'base-asset',
      },
      limitations: [
        ...(funding.state === 'unsupported'
          ? [partialEvidenceLimitation('The configured venue does not support unified funding-rate reads.')]
          : []),
        ...(funding.state === 'error'
          ? [partialEvidenceLimitation('The funding-rate upstream read failed; this snapshot is partial.')]
          : []),
        ...(fundingOmission(funding) ? [fundingOmission(funding)!] : []),
        ...(oi.state === 'unsupported'
          ? [partialEvidenceLimitation('The configured venue does not support unified open-interest reads.')]
          : []),
        ...(oi.state === 'error'
          ? [partialEvidenceLimitation('The open-interest upstream read failed; this snapshot is partial.')]
          : []),
        ...(openInterestOmission(oi) ? [openInterestOmission(oi)!] : []),
        ...(liquidationsState === 'unsupported'
          ? [partialEvidenceLimitation('The configured venue does not expose a public liquidation feed.')]
          : []),
        ...(liquidationsState === 'error'
          ? [partialEvidenceLimitation('The liquidation upstream read failed; this snapshot is partial.')]
          : []),
        ...(liquidationsMalformed
          ? [partialEvidenceLimitation('The liquidation response contained rows, but none carried complete side, price, amount, and timestamp evidence.')]
          : []),
        ...(omittedLiquidations > 0
          ? [partialEvidenceLimitation(`${omittedLiquidations} malformed liquidation rows were omitted.`)]
          : []),
      ],
      note: provenance === 'unavailable' ? 'No configured derivatives endpoint is supported by this venue.' : null,
    }, this.now());
  }

  /**
   * Every venue this provider is configured to read liquidations from — the
   * primary exchange plus the compare set. This is the honest denominator of
   * source coverage: the feed currently samples only the primary, and saying so
   * requires knowing what the other configured venues are.
   *
   * Capability only, no network: `getCompareExchanges()` constructs ccxt
   * instances from the local registry and `has['fetchLiquidations']` is a static
   * declaration, so this stays safe to call from a synchronous provenance read.
   */
  private liquidationSourceCapabilities(): LiquidationSourceCapability[] {
    const seen = new Set<string>();
    const out: LiquidationSourceCapability[] = [];
    const push = (id: string, exchange: Exchange) => {
      const key = id.trim().toLowerCase();
      if (key === '' || seen.has(key)) return;
      seen.add(key);
      const available = Boolean(exchange.has['fetchLiquidations']);
      out.push({
        source: id,
        available,
        // Capability-derived: a venue that publishes a public liquidation feed
        // publishes a throttled one. Never inferred from observed event counts.
        throttled: available,
        synthetic: false,
        note: available ? LIQUIDATION_THROTTLE_NOTE : `${id} exposes no public liquidation feed.`,
      });
    };
    push(this.exchangeId, this.exchange);
    try {
      for (const exchange of this.getCompareExchanges()) push(exchange.id, exchange);
    } catch {
      // A malformed MIDAS_CCXT_COMPARE must not take down the liquidations
      // feed; the primary venue alone is still an honest (narrower) denominator.
    }
    return out;
  }

  /**
   * Recent public liquidations for one perp across the configured venue set.
   *
   * Cost is bounded by capability, not by policy: a venue that does not declare
   * `fetchLiquidations` returns `available: false` with **zero network cost**,
   * and on the default compare set most venues are in exactly that state. The
   * fan-out is therefore far narrower than N venues in practice, and the route's
   * single-flight TTL collapses concurrent callers onto one sweep.
   *
   * `Promise.allSettled` per venue: one dead venue degrades to `available:false`
   * and is visible as reduced coverage. It never fails the feed — losing five
   * good venues because a sixth timed out is the opposite of honest.
   */
  async getVenueLiquidations(symbol: string): Promise<VenueLiquidations[]> {
    const perp = toPerpSymbol(this.normalize(symbol));
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueLiquidations> => {
        const available = Boolean(ex.has['fetchLiquidations']);
        if (!available) {
          return withProviderReceipt(this, {
            exchange: ex.id,
            available: false,
            liquidations: [],
            timestamp: null,
          }, {
            datasetFamily: 'liquidations',
            source: `ccxt:${ex.id}`,
            instrument: perp,
            venue: ex.id,
            provenance: 'unavailable',
            sourceAsOf: null,
            coverage: 'venue publishes no public liquidation feed',
            units: { price: 'quote-asset', amount: 'base-asset' },
            note: `${ex.id} exposes no public liquidation feed.`,
          }, this.now());
        }
        const { recent, omitted } = parseLiquidationRows(
          await ex.fetchLiquidations(perp, undefined, 20),
        );
        const sourceAsOf = recent.length > 0
          ? Math.max(...recent.map((liquidation) => liquidation.timestamp))
          : null;
        return withProviderReceipt(this, {
          exchange: ex.id,
          available: true,
          liquidations: recent,
          timestamp: sourceAsOf,
        }, {
          datasetFamily: 'liquidations',
          source: `ccxt:${ex.id}`,
          instrument: perp,
          venue: ex.id,
          provenance: 'live',
          sourceAsOf,
          coverage: `${recent.length} recent public liquidation event(s)`,
          units: { price: 'quote-asset', amount: 'base-asset' },
          limitations: [
            ...(omitted > 0
              ? [partialEvidenceLimitation(`${omitted} malformed liquidation row(s) were omitted.`)]
              : []),
            LIQUIDATION_THROTTLE_NOTE,
          ],
        }, this.now());
      }),
    );
    const values = settled
      .filter((result): result is PromiseFulfilledResult<VenueLiquidations> => result.status === 'fulfilled')
      .map((result) => result.value);
    const failures = settled.length - values.length;
    if (values.length === 0 && settled.length > 0) {
      throw new ProviderError(
        `${this.name} ${perp}: every configured venue liquidation read failed`,
        502,
        perp,
      );
    }
    if (failures === 0) return values;
    const limitation = crossVenuePartialLimitation('liquidations', settled.length, values.length, failures);
    return values.map((value) => withRowReceiptLimitation(value, limitation, perp));
  }

  liquidationsProvenance(): LiquidationsProvenance {
    const sources = this.liquidationSourceCapabilities();
    const publishing = sources.filter((capability) => capability.available);
    // Availability is now a property of the configured SET, not the primary
    // venue. The default primary (Binance) publishes nothing, but the compare
    // set may — gating the fan-out on the primary alone is what made a stock
    // install show an empty feed while venues with real data sat unread.
    const available = publishing.length > 0;
    const primaryPublishes = Boolean(this.exchange.has['fetchLiquidations']);
    const note = !available
      ? `No configured venue exposes a public liquidation feed (e.g. Binance removed its public stream in 2021) — showing none. Point MIDAS_CCXT_EXCHANGE or MIDAS_CCXT_COMPARE at venues that publish liquidations.`
      : primaryPublishes
        ? LIQUIDATION_THROTTLE_NOTE
        : `${this.exchangeId} publishes no public liquidation feed; events come from ${publishing.length} other configured venue(s). ${LIQUIDATION_THROTTLE_NOTE}`;
    const receipt = available
      ? providerReceipt(this, {
          datasetFamily: 'liquidations',
          venue: this.exchangeId,
          provenance: 'live',
          sourceAsOf: null,
          coverage: 'public liquidation-feed capability declaration',
          units: { price: 'quote-asset', amount: 'base-asset' },
          note,
        }, this.now())
      : providerUnavailableReceipt(this, {
          datasetFamily: 'liquidations',
          venue: this.exchangeId,
          coverage: 'public liquidation-feed capability declaration',
          units: { price: 'quote-asset', amount: 'base-asset' },
          note,
        }, this.now());
    return {
      source: this.name,
      available,
      note,
      // Every venue the fan-out will attempt — the denominator of coverage.
      sources,
      // The primary venue: the M2 denominator, i.e. what a single-source feed
      // would have shown. Not a claim that only this venue is read.
      sampledSource: this.exchangeId,
      receipt,
    };
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
      const response = await this.exchange.fetchFundingRateHistory(perp, undefined, n);
      if (!Array.isArray(response)) {
        throw new ProviderError(
          `${this.name} ${perp}: malformed funding-history response`,
          502,
          perp,
          'malformed-upstream',
        );
      }
      const rows = response as unknown as Array<{
        timestamp?: number;
        fundingRate?: number;
        interval?: unknown;
        fundingInterval?: unknown;
      }>;
      const valid = rows.filter(
        (row) => sourceTimestampOrNull(row.timestamp) !== null && finiteOrNull(row.fundingRate) !== null,
      );
      if (rows.length > 0 && valid.length === 0) {
        throw new ProviderError(
          `${this.name} ${perp}: malformed funding-history response`,
          502,
          perp,
          'malformed-upstream',
        );
      }
      const omitted = rows.length - valid.length;
      const completeness = omitted > 0
        ? partialEvidenceLimitation(
            `Funding-history read attempted ${rows.length} row(s); ${valid.length} returned usable evidence and ${omitted} were malformed and omitted.`,
          )
        : null;
      return valid
        .map((r) => {
          const time = r.timestamp as number;
          const intervalHours = fundingIntervalHours(r.interval ?? r.fundingInterval);
          const value: FundingHistoryPoint = {
            time,
            fundingRate: r.fundingRate as number,
            fundingIntervalHours: intervalHours,
          };
          return withProviderReceipt(this, value, {
            datasetFamily: 'funding-history', instrument: perp, venue: this.exchangeId,
            provenance: 'live', sourceAsOf: time,
            expectedCadenceMs: intervalHours === null ? undefined : intervalHours * HOUR_MS,
            maxAgeMs: intervalHours === null ? undefined : intervalHours * HOUR_MS * 2,
            units: { fundingRate: 'fraction-per-settlement', fundingIntervalHours: 'hours' },
            limitations: [
              ...(completeness ? [completeness] : []),
              ...(intervalHours === null
                ? [partialEvidenceLimitation('The venue omitted the funding settlement interval; annualized funding is unavailable.')]
                : []),
            ],
          }, this.now());
        });
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`${this.name} ${perp}: funding-history upstream read failed (${safeErrorLabel(err)})`, 502, perp);
    }
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
    const perp = toPerpSymbol(this.normalize(symbol));
    const source = `ccxt:${this.exchange.id ?? 'unknown'}`;
    const now = this.now();
    const unavailable = (note: string): OiDelta => {
      const value: OiDelta = {
        symbol: perp,
        window,
        oiNow: null,
        oiThen: null,
        oiChangePct: null,
        priceChangePct: null,
        classification: null,
        points: [],
        asOf: null,
        provenance: 'unavailable',
        source,
        note,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'open-interest-delta', instrument: perp, venue: this.exchangeId,
        coverage: `${window} OI/price alignment`,
        units: { openInterestValue: 'quote-asset', price: 'quote-asset', change: 'percent' },
        note,
      }, this.now()) };
    };
    if (!this.exchange.has['fetchOpenInterestHistory']) {
      return unavailable(
        `${source} publishes no open-interest history (fetchOpenInterestHistory unsupported) — an OI delta needs real history, not two snapshots.`,
      );
    }
    // OI granularity per window: fine enough for a sparkline, coarse enough to
    // stay within the venues' published OI-history timeframes.
    const oiTimeframe = ({ '1h': '5m', '4h': '15m', '24h': '1h', '7d': '4h' } as Record<OiDeltaWindow, string>)[window];
    const bucketMs = timeframeSeconds(oiTimeframe) * 1000;
    const since = now - OI_DELTA_WINDOW_MS[window];
    let rows: Array<{ timestamp?: number; openInterestValue?: number }>;
    try {
      const response = await this.exchange.fetchOpenInterestHistory(perp, oiTimeframe, since, 500);
      if (!Array.isArray(response)) {
        throw new ProviderError(
          `${source} returned a malformed open-interest history response.`,
          502,
          perp,
          'malformed-upstream',
        );
      }
      rows = response as unknown as Array<{
        timestamp?: number;
        openInterestValue?: number;
      }>;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`OI-history read failed — ${safeErrorLabel(err)}.`, 502, perp);
    }
    const oiRows = rows.filter(
      (r) => sourceTimestampOrNull(r?.timestamp) !== null && positiveFiniteOrNull(r?.openInterestValue) !== null,
    );
    const omittedOiRows = rows.length - oiRows.length;
    if (rows.length > 0 && oiRows.length === 0) {
      throw new ProviderError(
        `${source} returned a malformed open-interest history response.`,
        502,
        perp,
        'malformed-upstream',
      );
    }
    if (oiRows.length === 0) {
      return unavailable(`${source} returned no open-interest history for ${perp} — nothing to delta.`);
    }
    oiRows.sort((a, b) => (a.timestamp as number) - (b.timestamp as number));
    const outOfWindow = oiRows.filter((row) => {
      const timestamp = row.timestamp as number;
      return timestamp < since - bucketMs || timestamp > now;
    });
    if (outOfWindow.length > 0) {
      throw new ProviderError(
        `${source} returned out-of-window open-interest history observations.`,
        502,
        perp,
        'malformed-upstream',
      );
    }
    const earliestOi = oiRows[0].timestamp as number;
    const latestOi = oiRows[oiRows.length - 1].timestamp as number;
    if (earliestOi > since + bucketMs || latestOi < now - bucketMs) {
      return unavailable(
        `${source} did not cover the requested ${window} window within the ${oiTimeframe} endpoint tolerance — no delta was classified.`,
      );
    }
    const actualCoverageMs = latestOi - earliestOi;

    // Price leg: OHLCV closes over the same window, perp first, the spot pair
    // as fallback (a venue may not candle its perp on the same symbol form).
    // A failed price leg degrades the price points to null — the OI change and
    // history stay live, the price change honestly null.
    let candles: Array<[number, number, number, number, number, number]> = [];
    let priceReadErrors = 0;
    let attemptedPriceRows = 0;
    let omittedPriceRows = 0;
    for (const cand of [perp, this.normalize(symbol)]) {
      try {
        const response = await this.exchange.fetchOHLCV(cand, oiTimeframe, since, 500);
        if (!Array.isArray(response)) throw new Error('malformed OHLCV response');
        const got = response as unknown as Array<
          [number, number, number, number, number, number]
        >;
        attemptedPriceRows += got.length;
        const usable = got.filter(
          (row) => sourceTimestampOrNull(row?.[0]) !== null && positiveFiniteOrNull(row?.[4]) !== null,
        );
        omittedPriceRows += got.length - usable.length;
        if (usable.length > 0) {
          candles = usable;
          break;
        }
      } catch {
        priceReadErrors += 1;
        // try the next symbol form
      }
    }
    const closeByBucket = new Map<number, number>();
    for (const c of candles) {
      if (Number.isFinite(c[0]) && Number.isFinite(c[4]) && c[4] > 0) {
        closeByBucket.set(Math.floor(c[0] / bucketMs) * bucketMs, c[4]);
      }
    }

    const points: OiDeltaPoint[] = oiRows.map((r) => {
      const ts = r.timestamp as number;
      const b = Math.floor(ts / bucketMs) * bucketMs;
      // Period-end vs period-start convention: fall back one bucket (see the
      // method doc for the alignment tolerance).
      const price = closeByBucket.get(b) ?? closeByBucket.get(b - bucketMs) ?? null;
      return { timestamp: ts, openInterestValue: r.openInterestValue as number, price };
    });
    points.sort((a, b) => a.timestamp - b.timestamp);

    const value: OiDelta = {
      symbol: perp,
      window,
      ...summarizeOiDelta(points),
      points,
      provenance: 'live',
      source,
      note: null,
    };
    const oiSourceAsOf = points.at(-1)?.timestamp ?? null;
    const priceSourceAsOf = candles
      .map((candle) => sourceTimestampOrNull(candle[0]))
      .filter((timestamp): timestamp is number => timestamp !== null)
      .sort((a, b) => b - a)[0] ?? null;
    const oiInput = providerReceipt(this, {
      datasetFamily: 'open-interest-history', instrument: perp, venue: this.exchangeId,
      provenance: 'live', sourceAsOf: oiSourceAsOf,
      expectedCadenceMs: bucketMs,
      maxAgeMs: bucketMs * 2,
      coverage: `${window} requested; ${actualCoverageMs}ms actual OI endpoint coverage`,
      units: { openInterestValue: 'quote-asset' },
      limitations: omittedOiRows > 0
        ? [partialEvidenceLimitation(
            `Open-interest history attempted ${rows.length} row(s); ${oiRows.length} returned usable evidence and ${omittedOiRows} were malformed and omitted.`,
          )]
        : [],
    }, now);
    const priceInput = providerReceipt(this, {
      datasetFamily: 'history', instrument: perp, venue: this.exchangeId,
      provenance: 'live', sourceAsOf: priceSourceAsOf, coverage: `${window} aligned price history`,
      expectedCadenceMs: bucketMs,
      maxAgeMs: bucketMs * 2,
      units: { price: 'quote-asset' },
      limitations: [
        ...(candles.length === 0
          ? [partialEvidenceLimitation('No usable OHLCV price history was returned for OI alignment.')]
          : []),
        ...(priceReadErrors > 0
          ? [partialEvidenceLimitation('One or more OHLCV upstream reads failed during price alignment.')]
          : []),
        ...(omittedPriceRows > 0
          ? [partialEvidenceLimitation(
              `Price-history alignment attempted ${attemptedPriceRows} row(s); ${attemptedPriceRows - omittedPriceRows} returned usable evidence and ${omittedPriceRows} were malformed and omitted.`,
            )]
          : []),
      ],
    }, now);
    return withProviderDerivedReceipt(this, value, {
      datasetFamily: 'open-interest-delta', instrument: perp, venue: this.exchangeId,
      provenance: 'live', inputReceipts: [oiInput, priceInput],
      expectedCadenceMs: bucketMs,
      maxAgeMs: bucketMs * 2,
      coverage: `${window} requested; ${actualCoverageMs}ms actual aligned endpoint coverage`,
      units: { openInterestValue: 'quote-asset', price: 'quote-asset', change: 'percent' },
      methodology: {
        id: 'midas.oi-delta', version: '1.0.0',
        formula: '(now/then - 1) * 100; quadrant(sign(ΔOI), sign(Δprice))',
      },
    }, now);
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
    const value: DvolSnapshot = {
      symbol, value: null, history: [], asOf: null, provenance: 'unavailable', source: 'ccxt:deribit', note,
    };
    return { ...value, receipt: providerUnavailableReceipt(this, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: symbol, venue: 'deribit',
      coverage: 'Deribit DVOL level and history', units: { value: 'annualized-volatility-percent' }, note,
    }, this.now()) };
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
    const ex = this.deribit() as Exchange & {
      publicGetGetVolatilityIndexData?: (params: Record<string, unknown>) => Promise<unknown>;
    };
    if (typeof ex.publicGetGetVolatilityIndexData !== 'function') {
      return this.dvolUnavailable(symbol, 'The installed ccxt build exposes no Deribit volatility-index endpoint — DVOL is unavailable.');
    }
    try {
      const end = this.now();
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
        return this.dvolUnavailable(symbol, `Deribit returned no DVOL fixes for ${symbol} — nothing to show.`);
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
      return withProviderReceipt(this, value, {
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
  async getFuturesTermStructure(symbol: string): Promise<TermStructure> {
    const base = this.baseAsset(symbol);
    const now = this.now();
    const unavailable = (note: string): TermStructure => {
      const value: TermStructure = {
        underlying: base, referencePrice: null, perpPrice: null, points: [], asOf: null,
        provenance: 'unavailable', source: 'ccxt:deribit', note,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
        coverage: 'Deribit dated-futures term structure', units: { price: 'USD', annualizedBasisPct: 'percent' }, note,
      }, now) };
    };
    const ex = this.deribit();
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
    const rawInput = providerReceipt(this, {
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
    return withProviderDerivedReceipt(this, value, {
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
    const now = this.now();
    const unavailable = (note: string): OptionsChain => {
      const value: OptionsChain = {
        underlying: base, expiry: typeof expiry === 'number' ? expiry : 0,
        underlyingPrice: null, entries: [], maxPainStrike: null, putCallOiRatio: null,
        asOf: null, provenance: 'unavailable', source: 'ccxt:deribit', note,
      };
      return { ...value, receipt: providerUnavailableReceipt(this, {
        datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
        coverage: 'Deribit options chain',
        units: { strike: 'USD', openInterest: 'contracts', mark: 'USD', iv: 'percent' }, note,
      }, now) };
    };
    const ex = this.deribit();
    if (!ex.has['fetchOptionChain']) {
      return unavailable('The installed ccxt build exposes no Deribit option-chain read.');
    }
    try {
      await ex.loadMarkets();
    } catch (err) {
      throw new ProviderError(`Deribit options markets read failed — ${safeErrorLabel(err)}.`, 502, base);
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
    const optionCandidates = markets.filter(
      (market) => market.option === true && market.base === base && market.active !== false,
    );
    const options = optionCandidates.filter(
      (market) =>
        typeof market.expiry === 'number' && Number.isFinite(market.expiry) && market.expiry > now &&
        typeof market.strike === 'number' && Number.isFinite(market.strike) && market.strike > 0 &&
        (market.optionType === 'call' || market.optionType === 'put'),
    );
    const omittedMarketDefinitions = optionCandidates.length - options.length;
    if (options.length === 0) {
      if (omittedMarketDefinitions > 0) {
        throw new ProviderError(
          `Deribit returned malformed ${base} option market definitions.`,
          502,
          base,
          'malformed-upstream',
        );
      }
      return unavailable(`Deribit lists no active ${base} options — no chain to show.`);
    }
    const target = expiry === 'nearest' ? Math.min(...options.map((m) => m.expiry!)) : expiry;
    const chainMarkets = options.filter((m) => m.expiry === target);
    if (chainMarkets.length === 0) {
      return unavailable(`Deribit lists no ${base} options for the requested expiry.`);
    }
    let chain: Record<string, DeribitOptionQuote>;
    try {
      const response = await ex.fetchOptionChain(base);
      if (response == null || typeof response !== 'object' || Array.isArray(response)) {
        throw new ProviderError(
          `Deribit returned a malformed ${base} option-chain response.`,
          502,
          base,
          'malformed-upstream',
        );
      }
      chain = response as unknown as Record<string, DeribitOptionQuote>;
    } catch (err) {
      if (err instanceof ProviderError) throw err;
      throw new ProviderError(`Deribit option-chain read failed — ${safeErrorLabel(err)}.`, 502, base);
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
    const usableMarkets: typeof chainMarkets = [];
    for (const m of chainMarkets) {
      const q = chain[m.symbol];
      const oi = nonNegativeFiniteOrNull(q?.openInterest);
      // Deribit inverse options quote marks in the base currency → USD via the
      // underlying price; without it the mark stays null, never a raw BTC number.
      const mark = positiveFiniteOrNull(q?.markPrice);
      const markUsd = mark !== null && underlyingPrice != null ? mark * underlyingPrice : null;
      const iv = nonNegativeFiniteOrNull(q?.info?.mark_iv);
      if (oi === null && mark === null && iv === null) continue;
      usableMarkets.push(m);
      const entry = byStrike.get(m.strike!) ?? { strike: m.strike!, expiry: target, callOi: null, putOi: null, callMark: null, putMark: null, iv: null };
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
    if (usableMarkets.length === 0) {
      throw new ProviderError(
        `Deribit returned no usable ${base} option observations.`,
        502,
        base,
        'malformed-upstream',
      );
    }
    // Bound to the strikes around the money: sort by distance from the
    // underlying (or by OI when no underlying price) and keep the closest 24.
    const all = [...byStrike.values()];
    const kept = (
      underlyingPrice != null
        ? all.sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))
        : all.sort((a, b) => optionOiScore(b) - optionOiScore(a))
    ).slice(0, 24);
    kept.sort((a, b) => a.strike - b.strike);
    const sourceTimes = usableMarkets.map((market) => sourceTimestampOrNull(chain[market.symbol]?.timestamp));
    const sourceAsOf = sourceTimes.length > 0 && sourceTimes.every((timestamp) => timestamp !== null)
      ? Math.min(...sourceTimes as number[])
      : null;
    const value: OptionsChain = {
      underlying: base,
      expiry: target,
      underlyingPrice,
      entries: kept,
      maxPainStrike: computeMaxPainStrike(kept),
      putCallOiRatio: computePutCallOiRatio(kept),
      asOf: sourceAsOf,
      provenance: 'live',
      source: 'ccxt:deribit',
      note: underlyingPrice == null ? 'No underlying price reported — USD marks are unavailable.' : null,
    };
    const omittedObservations = chainMarkets.length - usableMarkets.length;
    const keptStrikes = new Set(kept.map((entry) => entry.strike));
    const summaryMarkets = usableMarkets.filter((market) => keptStrikes.has(market.strike!));
    const knownOi = summaryMarkets.filter(
      (market) => nonNegativeFiniteOrNull(chain[market.symbol]?.openInterest) !== null,
    ).length;
    const missingOi = summaryMarkets.length - knownOi;
    const incompleteSummaryOi = kept.some((entry) => entry.callOi === null || entry.putOi === null);
    const rawInput = providerReceipt(this, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
      provenance: 'live', sourceAsOf, coverage: 'raw Deribit option marks and open interest',
      units: { strike: 'USD', openInterest: 'contracts', mark: 'base-asset', iv: 'percent' },
      limitations: [
        ...(sourceAsOf === null ? ['One or more contributing Deribit option rows omitted a source timestamp.'] : []),
        ...(omittedObservations > 0
          ? [partialEvidenceLimitation(
              `Options read attempted ${chainMarkets.length} listed contract observation(s); ${usableMarkets.length} returned usable evidence and ${omittedObservations} were missing or malformed.`,
            )]
          : []),
        ...(omittedMarketDefinitions > 0
          ? [partialEvidenceLimitation(
              `Options markets attempted ${optionCandidates.length} active contract definition(s); ${options.length} were usable and ${omittedMarketDefinitions} were malformed and omitted.`,
            )]
          : []),
        ...(missingOi > 0
          ? [partialEvidenceLimitation(
              `Options summary attempted ${summaryMarkets.length} contract open-interest field(s); ${knownOi} returned usable evidence and ${missingOi} were missing or malformed.`,
            )]
          : []),
        ...(incompleteSummaryOi
          ? [partialEvidenceLimitation(
              'Max-pain and put/call OI summaries were withheld because at least one included strike lacked explicit call or put OI; missing OI was not coerced to zero.',
            )]
          : []),
      ],
    }, now);
    return withProviderDerivedReceipt(this, value, {
      datasetFamily: 'options', source: 'ccxt:deribit', instrument: base, venue: 'deribit',
      provenance: 'live', inputReceipts: [rawInput], sourceAsOf,
      coverage: 'Deribit options chain with derived summaries',
      units: { strike: 'USD', openInterest: 'contracts', mark: 'USD', iv: 'percent' },
      methodology: {
        id: 'midas.options-chain-summary', version: '1.0.0',
        formula: 'max-pain payout minimization; put open interest / call open interest',
      },
      note: value.note,
    }, now);
  }

  /**
   * Screen every configured venue in one sweep.
   *
   * Cheap by construction: `fetchTickers()` returns a venue's whole ticker set
   * in ONE call, so this costs one request per venue — not one per symbol. That
   * is why a cross-venue screener is affordable where a cross-venue per-symbol
   * board would not be.
   *
   * `Promise.allSettled`: a venue that fails drops to `available: false` and
   * shows up as reduced coverage rather than failing the board.
   */
  async getVenueScreen(opts: ScreenerOptions): Promise<VenueScreen[]> {
    const quote = (opts.quote ?? 'USDT').toUpperCase();
    const settled = await Promise.allSettled(
      this.getCompareExchanges().map(async (ex): Promise<VenueScreen> => {
        // No explicit loadMarkets: ccxt loads them inside fetchTickers, and the
        // sibling getExchangeQuotes fan-out doesn't either. One fewer upstream
        // call per venue, per refresh.
        const tickers = await ex.fetchTickers();
        const rows: VenueScreenRow[] = [];
        let newest: number | null = null;
        for (const [sym, t] of Object.entries(tickers)) {
          if (!sym.endsWith(`/${quote}`)) continue;
          const price = tickerPrice(t);
          // Skip pairs with no usable price rather than admitting a 0 that
          // would read as a 100% cross-venue dispersion.
          if (price == null) continue;
          const timestamp = sourceTimestampOrNull(t.timestamp);
          if (timestamp !== null && (newest === null || timestamp > newest)) newest = timestamp;
          rows.push({
            symbol: sym,
            name: sym,
            price,
            // Unlike the single-venue screener this keeps a row whose 24h change
            // the venue omitted: the symbol still contributes price, volume and
            // breadth. Null stays null — a 0 here would read as "flat", a claim
            // the venue never made.
            changePercent: finiteOrNull(t.percentage),
            volume: nonNegativeFiniteOrNull(t.baseVolume),
            quoteVolume: nonNegativeFiniteOrNull(t.quoteVolume),
          });
        }
        return withProviderReceipt(this, {
          exchange: ex.id,
          available: true,
          rows,
          timestamp: newest,
        }, {
          datasetFamily: 'venue-screener',
          source: `ccxt:${ex.id}`,
          venue: ex.id,
          provenance: 'live',
          sourceAsOf: newest,
          coverage: `${rows.length} ${quote} pair(s) from the venue ticker set`,
          units: { price: 'quote-asset', volume: 'base-asset', quoteVolume: 'quote-asset' },
          limitations: [
            'Exchange-reported 24h volume is widely documented as inflated; treat it as a scale signal, not a verified total.',
          ],
        }, this.now());
      }),
    );
    const values = settled
      .filter((result): result is PromiseFulfilledResult<VenueScreen> => result.status === 'fulfilled')
      .map((result) => result.value);
    if (values.length === 0 && settled.length > 0) {
      throw new ProviderError(`${this.name}: every configured venue screener read failed`, 502);
    }
    return values;
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

  /** Lazily build the set of exchanges used for the multi-exchange compare. */
  private getCompareExchanges(): Exchange[] {
    if (!this.compareExchanges) {
      const ids = compareExchangeIds(process.env.MIDAS_CCXT_COMPARE);
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
