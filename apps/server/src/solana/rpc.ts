/**
 * Minimal read-only Solana JSON-RPC client — the shared core for the network
 * and wallet reads. Opt-in and default OFF: a live read happens only when the
 * operator sets MIDAS_SOLANA_RPC to a node URL. Every method used here is
 * READ-ONLY (getEpochInfo, getSupply, getBalance, …) — Midas is non-custodial
 * and never signs or sends a transaction, so no write method is reachable.
 *
 * The one Solana-specific gotcha the honest-degradation pattern must handle:
 * a Solana node returns HTTP 200 even on a logical failure, carrying
 * `{ error: {...} }` in the body — so {@link jsonRpc} inspects `json.error` and
 * throws, or a failed lookup would be mislabeled as a live read.
 */

const TIMEOUT_MS = 6000;
export const LAMPORTS_PER_SOL = 1_000_000_000;

/** The configured RPC URL, or '' when the live Solana source is off. */
export function solanaRpcUrl(): string {
  return (process.env.MIDAS_SOLANA_RPC ?? '').trim();
}

/** Is a live Solana RPC read enabled? Gated by env; default off (mirrors dexscreenerEnabled). */
export function solanaEnabled(): boolean {
  return solanaRpcUrl() !== '';
}

/**
 * The `source` label for an RPC-backed snapshot, derived from the node host
 * (best-effort), e.g. 'rpc:api.mainnet-beta.solana.com'. Shared by every
 * RPC-backed reader so the label stays consistent.
 */
export function solanaSourceLabel(): string {
  try {
    return `rpc:${new URL(solanaRpcUrl()).host}`;
  } catch {
    return 'rpc';
  }
}

/** Defensive numeric coerce — unknown/NaN → null (copied per-file per house convention). */
export function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Defensive string coerce (copied per-file per house convention). */
export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * POST a single JSON-RPC 2.0 request and return `result`. Throws on transport
 * failure, non-2xx, or a logical `error` in a 200 body — the caller turns any
 * throw into an honest `unavailable` snapshot.
 */
export async function jsonRpc<T = unknown>(method: string, params: unknown[]): Promise<T> {
  const url = solanaRpcUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: unknown } };
    if (body.error) throw new Error(str(body.error.message) || `RPC error (${method})`);
    return body.result as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A tiny registry of well-known SPL mints so wallet holdings can be labeled and
 * the stablecoins priced. Anything not listed is shown by a shortened mint with
 * an honest null price — Midas never invents a value it can't source.
 */
export const KNOWN_MINTS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 'USDC',
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 'USDT',
  So11111111111111111111111111111111111111112: 'SOL', // wrapped SOL
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 'mSOL',
  '7dHbWXmci3dT8UFYWYZweBLXgycu7Y3iL6trKn1Y7ARj': 'stSOL',
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 'JUP',
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 'BONK',
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: 'JTO',
};

/** USD-pinned mints for pricing (only stablecoins are safe to pin at $1). */
export const STABLE_SYMBOLS = new Set(['USDC', 'USDT']);

/** The two SPL token programs (classic and Token-2022). */
export const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Decimals for well-known mints. The Jupiter quote endpoint returns amounts in
 * raw base units and does NOT include decimals, so a swap quote must know each
 * mint's decimals independently to render a human price. Kept alongside
 * KNOWN_MINTS so the two stay in step.
 */
export const MINT_DECIMALS: Record<string, number> = {
  So11111111111111111111111111111111111111112: 9, // SOL / wSOL
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 6, // USDC
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: 6, // USDT
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: 5, // BONK
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: 6, // JUP
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: 9, // JTO
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: 9, // mSOL
};

/** Reverse of KNOWN_MINTS: ticker → mint, for symbol-driven lookups (e.g. swap quotes). */
export const MINT_BY_SYMBOL: Record<string, string> = Object.fromEntries(
  Object.entries(KNOWN_MINTS).map(([mint, sym]) => [sym, mint]),
);

/** Shorten a base-58 address for display, e.g. 'EPjFWd…Dt1v'. */
export function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}
