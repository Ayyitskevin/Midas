import type { DataProvider } from '../providers';

/**
 * First usable string from a raw request value. Fastify's default query parser
 * yields `string | string[] | undefined` — a repeated param (`?quote=a&quote=b`)
 * arrives as an array, and a body field can be any JSON type. Calling a string
 * method on that (`.toUpperCase()`, `.split()`, `.trim()`) throws a TypeError
 * that surfaces as a 500. This collapses arrays to their first element and any
 * non-string to '', so every edge read is total.
 */
export function firstStr(v: unknown): string {
  const first = Array.isArray(v) ? v[0] : v;
  return typeof first === 'string' ? first : '';
}

// Real instruments across providers: BTC/USDT:USDT, BRK-B, ^GSPC, EURUSD=X.
const SYMBOL_RE = /^[A-Z0-9/:^=._-]{1,64}$/;

/**
 * Uppercase + bound every symbol at the API edge. Accepts an unknown raw value
 * (path param, repeated query param, or arbitrary body field) and coerces it
 * safely first. Anything outside the charset/length is junk that would
 * otherwise flow unbounded into provider lookups, stream keys and error
 * messages; it normalizes to '' and the routes answer 400.
 */
export function normalizeSymbol(raw: unknown): string {
  const s = firstStr(raw).trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : '';
}

// A quote-currency ticker: USDT, USDC, BTC, USD… Kept short and alphanumeric.
const QUOTE_RE = /^[A-Z0-9]{1,10}$/;

/**
 * Normalize a quote-currency query param. Beyond safety, this bounds what can
 * become a TTL-cache key on the fan-out boards (funding-dispersion, venue-arb,
 * oi-concentration): an unvalidated quote lets a spray of distinct junk strings
 * grow the cache without limit. Junk or absent → the 'USDT' default.
 */
export function normalizeQuote(raw: unknown): string {
  const s = firstStr(raw).trim().toUpperCase();
  return QUOTE_RE.test(s) ? s : 'USDT';
}

// Base-58 alphabet (no 0/O/I/l) — a Solana address is 32–44 of these chars.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Bound a Solana address at the API edge. Unlike symbols, base-58 is
 * CASE-SENSITIVE — uppercasing corrupts a valid address — so this only trims
 * and charset/length-checks. It's a sanity gate, not full validity (the RPC is
 * the source of truth); junk normalizes to '' and the route answers 400.
 */
export function normalizeSolanaAddress(raw: unknown): string {
  const s = firstStr(raw).trim();
  return SOLANA_ADDRESS_RE.test(s) ? s : '';
}

/** Resolves account providers without crossing a per-user tenant boundary. */
export interface ProviderResolver {
  accountFor(userId: string | undefined): DataProvider | null;
  /** The user's OWN provider or null — never a base fallback (trading path). */
  userFor(userId: string | undefined): DataProvider | null;
}

/** Stored-key facts the trading gate needs; secrets never pass through here. */
export type KeyMetaLookup = (userId: string) => { canTrade: boolean } | null;
