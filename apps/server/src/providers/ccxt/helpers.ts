import * as ccxt from 'ccxt';
import type { Exchange } from 'ccxt';
import type { Interval } from '@midas/shared';
import { ProviderError } from '../types';

/**
 * Stateless helpers extracted from the CcxtProvider module: the client-facing
 * error sanitizer, the interval map, the exchange-id allowlist, small numeric
 * coercion, the ccxt constructor registry, the perp-symbol derivation, and the
 * read-only funding / open-interest readers. None touch provider instance
 * state, so they live here and the provider (with its two exchange writes)
 * stays whole in ccxt.ts.
 */

/**
 * A ccxt error can carry raw upstream detail — a signed request URL (including the
 * HMAC `signature=` and the API key), the raw response body, internal hostnames.
 * None of that may reach a client. This returns a bounded, safe label — the error's
 * allowlisted class category (e.g. `AuthenticationError`, `NetworkError`) —
 * for use in a client-facing message or an `unavailable` snapshot `note`. An explicit
 * ProviderError is ours and already safe, so its message is preserved.
 */
const SAFE_CCXT_ERROR_LABELS = new Set([
  'ArgumentsRequired',
  'AuthenticationError',
  'BadRequest',
  'BadResponse',
  'BadSymbol',
  'DDoSProtection',
  'ExchangeError',
  'ExchangeNotAvailable',
  'InsufficientFunds',
  'InvalidAddress',
  'InvalidNonce',
  'InvalidOrder',
  'NetworkError',
  'NotSupported',
  'OperationFailed',
  'OrderNotFound',
  'PermissionDenied',
  'RateLimitExceeded',
  'RequestTimeout',
]);

export function safeErrorLabel(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  return err instanceof Error && SAFE_CCXT_ERROR_LABELS.has(err.name) ? err.name : 'error';
}

const DEFAULT_COMPARE_EXCHANGES = 'binance,coinbase,kraken,bitfinex,okx,kucoin';

/** Normalize and deduplicate the configured public compare-venue set. */
export function compareExchangeIds(configured: string | undefined): string[] {
  return Array.from(
    new Set(
      (configured ?? DEFAULT_COMPARE_EXCHANGES)
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export const TIMEFRAME_MAP: Record<Interval, string> = {
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

/**
 * ccxt's own registry of real exchange ids, as a Set for O(1) allowlist
 * checks. Exported so the key-save route can reject an unknown exchange at
 * the API edge — before any credential is encrypted and stored — rather than
 * letting it fail later inside provider construction.
 */
// `ccxt.exchanges` is a string[] of ids at runtime, but where it lands under
// `import * as ccxt` depends on the CJS/ESM interop: the namespace itself
// under tsx/node, or `namespace.default` under vite/vitest. Resolve from
// whichever actually holds the array so the allowlist works under every
// loader (an empty set would wrongly reject every exchange).
function resolveKnownExchanges(): Set<string> {
  const ns = ccxt as unknown as { exchanges?: unknown; default?: { exchanges?: unknown } };
  const list = Array.isArray(ns.exchanges)
    ? ns.exchanges
    : Array.isArray(ns.default?.exchanges)
      ? ns.default!.exchanges
      : [];
  return new Set<string>(list as string[]);
}

const KNOWN_EXCHANGES = resolveKnownExchanges();

export function isKnownExchange(id: string): boolean {
  return KNOWN_EXCHANGES.has(id);
}

export function num(value: number | undefined | null, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const TF_UNIT_SECONDS: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 };

/**
 * Seconds in a ccxt timeframe string ('1m', '1h', '1d', '1w', '1M'); 0 if
 * unparseable. Case matters — 'm' is minute, 'M' is month. Used to size the
 * candle window from the ACTUALLY-fetched timeframe, not the requested one.
 */
export function timeframeSeconds(tf: string): number {
  const m = /^(\d+)([mhdwM])$/.exec(tf);
  return m ? Number(m[1]) * (TF_UNIT_SECONDS[m[2]] ?? 0) : 0;
}

/**
 * Best available price from a ticker: last, else close, else the bid/ask mid;
 * null when a ticker carries none of them (some venues return bid/ask-only
 * tickers for illiquid pairs). Callers must treat null as "no price" rather
 * than coercing it to 0 — a fabricated 0 flows into compare rows, the screener
 * and alert readings as a real live price.
 */
export function tickerPrice(t: {
  last?: number | null;
  close?: number | null;
  bid?: number | null;
  ask?: number | null;
}): number | null {
  const lastOrClose = t.last ?? t.close;
  if (typeof lastOrClose === 'number' && Number.isFinite(lastOrClose) && lastOrClose > 0) return lastOrClose;
  if (typeof t.bid === 'number' && typeof t.ask === 'number' && t.bid > 0 && t.ask > 0) return (t.bid + t.ask) / 2;
  return null;
}

/**
 * ccxt's exchange-constructor registry, typed for `registry[id]` lookups. The
 * `as unknown as` cast is unavoidable (ccxt's namespace isn't indexable in its
 * own types); centralizing it keeps that one unsafe cast in a single named place.
 */
export function ccxtRegistry(): Record<string, new (config: object) => Exchange> {
  return ccxt as unknown as Record<string, new (config: object) => Exchange>;
}

/**
 * Derive the USDT-margined perpetual symbol from a spot pair — BTC/USDT →
 * BTC/USDT:USDT — so the derivatives reads (funding, open interest, funding
 * history) can key off a plain spot symbol. An already-perp symbol (one holding
 * a ':' settle suffix) passes through unchanged; a malformed pair with no quote
 * falls back to a USDT settle.
 */
export function toPerpSymbol(spot: string): string {
  return spot.includes(':') ? spot : `${spot}:${spot.split('/')[1] ?? 'USDT'}`;
}

/**
 * Normalize a ccxt funding interval to hours. The unified `interval` field is
 * a cadence string ('1h', '4h', '8h'), but some venues expose a millisecond
 * number instead (e.g. via a `fundingInterval` field); both normalize here.
 * Anything unrecognized returns null — funding cadence varies by venue, so
 * callers must never fall back to the common 8h assumption.
 */
export function fundingIntervalHours(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return raw / 3_600_000; // millisecond cadence, e.g. 28_800_000 → 8
  }
  if (typeof raw === 'string') {
    const m = /^(\d+(?:\.\d+)?)\s*([smhd])$/i.exec(raw.trim());
    if (!m) return null;
    const n = Number(m[1]);
    const unit = m[2].toLowerCase();
    const hours = unit === 's' ? n / 3600 : unit === 'm' ? n / 60 : unit === 'h' ? n : n * 24;
    return hours > 0 ? hours : null;
  }
  return null;
}

/** A perp's funding snapshot; every field null when unavailable. */
export type ProviderReadState = 'ok' | 'unsupported' | 'error';

export interface FundingSnapshot {
  state: ProviderReadState;
  /** Timestamp attached by the upstream response, not local receipt time. */
  sourceAsOf: number | null;
  fundingRate: number | null;
  /** Settlement interval in hours; null when the venue does not report it. */
  fundingIntervalHours: number | null;
  nextFundingTime: number | null;
  markPrice: number | null;
  indexPrice: number | null;
}

/**
 * Read a perp's funding snapshot from one exchange. READ-ONLY (fetchFundingRate
 * only). Returns all-null when the venue lacks the endpoint or the call fails, so
 * a spot-only venue degrades a field rather than throwing.
 */
export async function readFunding(ex: Exchange, perp: string): Promise<FundingSnapshot> {
  const empty: FundingSnapshot = {
    state: 'unsupported',
    sourceAsOf: null,
    fundingRate: null,
    fundingIntervalHours: null,
    nextFundingTime: null,
    markPrice: null,
    indexPrice: null,
  };
  if (!ex.has['fetchFundingRate']) return empty;
  try {
    const f = await ex.fetchFundingRate(perp);
    // ccxt's unified field is `interval`; a few venues carry `fundingInterval`
    // instead — read both, never assume a cadence.
    const rawInterval =
      f.interval ?? (f as unknown as { fundingInterval?: unknown }).fundingInterval ?? null;
    return {
      state: 'ok',
      sourceAsOf: finiteNonNegativeOrNull(f.timestamp),
      fundingRate: finiteOrNull(f.fundingRate),
      fundingIntervalHours: fundingIntervalHours(rawInterval),
      nextFundingTime: finiteNonNegativeOrNull(f.fundingTimestamp ?? f.nextFundingTimestamp),
      markPrice: finitePositiveOrNull(f.markPrice),
      indexPrice: finitePositiveOrNull(f.indexPrice),
    };
  } catch {
    return { ...empty, state: 'error' };
  }
}

/**
 * Read a perp's open interest from one exchange — base amount + quote notional.
 * READ-ONLY (fetchOpenInterest only). Both null when unavailable.
 */
export async function readOpenInterest(
  ex: Exchange,
  perp: string,
): Promise<{
  state: ProviderReadState;
  sourceAsOf: number | null;
  openInterest: number | null;
  openInterestValue: number | null;
}> {
  const empty = { state: 'unsupported' as const, sourceAsOf: null, openInterest: null, openInterestValue: null };
  if (!ex.has['fetchOpenInterest']) return empty;
  try {
    const oi = await ex.fetchOpenInterest(perp);
    return {
      state: 'ok',
      sourceAsOf: finiteNonNegativeOrNull(oi.timestamp),
      openInterest: finiteNonNegativeOrNull(oi.openInterestAmount),
      openInterestValue: finiteNonNegativeOrNull(oi.openInterestValue),
    };
  } catch {
    return { ...empty, state: 'error' as const };
  }
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finiteNonNegativeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function finitePositiveOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
