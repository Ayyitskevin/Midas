/**
 * Shared GeckoTerminal (Solana) access layer for the on-chain market sources —
 * dex.ts (STREND / SOLDEX) and market.ts (SOLMKT). All read-only public-API
 * reads, env-gated upstream by MIDAS_DEX_SOURCE=geckoterminal; the callers own
 * the honesty labels. Extracted so the endpoint, fetch, shape and pair-parsing
 * live in exactly one place.
 */

export const GT_TRENDING_ENDPOINT = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools';
export const GT_SEARCH_ENDPOINT = 'https://api.geckoterminal.com/api/v2/search/pools';
/** The `source` label for a live GeckoTerminal-backed Solana snapshot. */
export const GT_SOURCE = 'geckoterminal:solana';
/** Drop dust / scam pools below this reserve. */
export const MIN_LIQUIDITY_USD = 5_000;
const TIMEOUT_MS = 6000;

/** Defensive numeric coerce — unknown/NaN → null. */
export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
/** Defensive string coerce. */
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A GeckoTerminal pool object — the subset both Solana mappers read. */
export interface GtPool {
  attributes?: {
    name?: unknown;
    base_token_price_usd?: unknown;
    reserve_in_usd?: unknown;
    volume_usd?: { h24?: unknown };
    price_change_percentage?: { h24?: unknown };
  };
  relationships?: {
    dex?: { data?: { id?: unknown } };
    network?: { data?: { id?: unknown } };
  };
}

/** Pull the `data` array out of a GeckoTerminal payload; [] when malformed. */
export function gtData(payload: unknown): GtPool[] {
  const data = (payload as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as GtPool[]) : [];
}

/** "WIF / SOL 0.25%" → { base: 'WIF', quote: 'SOL', feeBps: 25 }. Defensive. */
export function parsePairName(name: string): { base: string; quote: string; feeBps: number | null } {
  const [basePart, rest] = name.split('/').map((s) => s.trim());
  const base = (basePart ?? '').toUpperCase();
  const quote = (rest ?? '').split(/\s+/)[0]?.toUpperCase() || '?';
  const feeMatch = /([\d.]+)\s*%/.exec(rest ?? '');
  const feeBps = feeMatch ? Math.round(Number(feeMatch[1]) * 100) : null;
  return { base, quote, feeBps: feeBps != null && Number.isFinite(feeBps) ? feeBps : null };
}

/**
 * GET a GeckoTerminal endpoint with a timeout; returns the parsed JSON. Throws on
 * transport failure or a non-2xx status — the caller turns any throw into an
 * honest `unavailable` snapshot.
 */
export async function gtFetch(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
