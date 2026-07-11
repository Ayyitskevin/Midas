import type { DataProvider } from '../providers';

// Real instruments across providers: BTC/USDT:USDT, BRK-B, ^GSPC, EURUSD=X.
const SYMBOL_RE = /^[A-Z0-9/:^=._-]{1,64}$/;

/**
 * Uppercase + bound every symbol at the API edge. Anything outside the
 * charset/length is junk that would otherwise flow unbounded into provider
 * lookups, stream keys and error messages; it normalizes to '' and the
 * routes answer 400.
 */
export function normalizeSymbol(raw: string): string {
  const s = raw.trim().toUpperCase();
  return SYMBOL_RE.test(s) ? s : '';
}

// Base-58 alphabet (no 0/O/I/l) — a Solana address is 32–44 of these chars.
const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Bound a Solana address at the API edge. Unlike symbols, base-58 is
 * CASE-SENSITIVE — uppercasing corrupts a valid address — so this only trims
 * and charset/length-checks. It's a sanity gate, not full validity (the RPC is
 * the source of truth); junk normalizes to '' and the route answers 400.
 */
export function normalizeSolanaAddress(raw: string): string {
  const s = raw.trim();
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
