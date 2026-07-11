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
 * class name (e.g. `AuthenticationError`, `NetworkError`) — for use in a
 * client-facing message or an `unavailable` snapshot `note`. An explicit
 * ProviderError is ours and already safe, so its message is preserved.
 */
export function safeErrorLabel(err: unknown): string {
  if (err instanceof ProviderError) return err.message;
  return err instanceof Error && err.name ? err.name : 'error';
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

/** A perp's funding snapshot; every field null when unavailable. */
export interface FundingSnapshot {
  fundingRate: number | null;
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
  const empty: FundingSnapshot = { fundingRate: null, nextFundingTime: null, markPrice: null, indexPrice: null };
  if (!ex.has['fetchFundingRate']) return empty;
  try {
    const f = await ex.fetchFundingRate(perp);
    return {
      fundingRate: f.fundingRate ?? null,
      nextFundingTime: f.fundingTimestamp ?? f.nextFundingTimestamp ?? null,
      markPrice: f.markPrice ?? null,
      indexPrice: f.indexPrice ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * Read a perp's open interest from one exchange — base amount + quote notional.
 * READ-ONLY (fetchOpenInterest only). Both null when unavailable.
 */
export async function readOpenInterest(
  ex: Exchange,
  perp: string,
): Promise<{ openInterest: number | null; openInterestValue: number | null }> {
  const empty = { openInterest: null, openInterestValue: null };
  if (!ex.has['fetchOpenInterest']) return empty;
  try {
    const oi = await ex.fetchOpenInterest(perp);
    return { openInterest: oi.openInterestAmount ?? null, openInterestValue: oi.openInterestValue ?? null };
  } catch {
    return empty;
  }
}
