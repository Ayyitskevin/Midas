import type { DexPool, DexPools } from '@midas/shared';

/**
 * Optional live on-chain source: Dexscreener's public, no-key search endpoint.
 * Off by default — only used when MIDAS_DEX_SOURCE=dexscreener — so the seam's
 * default stays the honest mock/unavailable. The mapping is pure and unit-tested
 * against a fixture; the fetch wrapper degrades to a labelled 'unavailable'
 * snapshot on any error/timeout/empty, so a bad response never reads as 'live'.
 */
const ENDPOINT = 'https://api.dexscreener.com/latest/dex/search';
const TIMEOUT_MS = 6000;
const MAX_POOLS = 10;
const MIN_LIQUIDITY_USD = 10_000; // drop dust / scam pools

/** Is the live Dexscreener source enabled? Gated by env; default off. */
export function dexscreenerEnabled(): boolean {
  return (process.env.MIDAS_DEX_SOURCE ?? '').toLowerCase() === 'dexscreener';
}

interface DsPair {
  dexId?: unknown;
  labels?: unknown;
  baseToken?: { symbol?: unknown };
  quoteToken?: { symbol?: unknown };
  priceUsd?: unknown;
  liquidity?: { usd?: unknown };
  volume?: { h24?: unknown };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Map a Dexscreener `/latest/dex/search` payload to our DexPool[] for a base
 * asset: keep only pools whose base token IS the asset (or its wrapped form,
 * e.g. ETH↔WETH), drop dust below the liquidity floor, sort by liquidity, and
 * cap the count. Pure and defensive — unknown/missing fields become null.
 */
export function mapDexscreener(payload: unknown, base: string): DexPool[] {
  const b = base.toUpperCase();
  const wanted = new Set([b, `W${b}`]);
  const pairs = (payload as { pairs?: unknown } | null)?.pairs;
  if (!Array.isArray(pairs)) return [];

  const pools: DexPool[] = [];
  for (const raw of pairs as DsPair[]) {
    const baseSym = str(raw.baseToken?.symbol).toUpperCase();
    if (!wanted.has(baseSym)) continue;
    const liquidityUsd = num(raw.liquidity?.usd);
    if (liquidityUsd != null && liquidityUsd < MIN_LIQUIDITY_USD) continue;
    const label = Array.isArray(raw.labels) && typeof raw.labels[0] === 'string' ? ` ${raw.labels[0]}` : '';
    pools.push({
      dex: `${str(raw.dexId) || 'dex'}${label}`,
      pair: `${baseSym}/${str(raw.quoteToken?.symbol).toUpperCase() || '?'}`,
      priceUsd: num(raw.priceUsd),
      liquidityUsd,
      volume24hUsd: num(raw.volume?.h24),
      feeBps: null, // Dexscreener doesn't expose the pool fee tier
    });
  }
  pools.sort((a, c) => (c.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return pools.slice(0, MAX_POOLS);
}

/** Fetch live DEX pools from Dexscreener; returns an honest 'unavailable' snapshot on any failure. */
export async function fetchDexPools(base: string): Promise<DexPools> {
  const sym = base.toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${ENDPOINT}?q=${encodeURIComponent(sym)}`, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pools = mapDexscreener(await res.json(), sym);
    if (pools.length === 0) {
      return { symbol: sym, provenance: 'unavailable', note: `No DEX pools found for ${sym} on Dexscreener.`, pools: [] };
    }
    return { symbol: sym, provenance: 'live', note: null, pools };
  } catch (err) {
    return {
      symbol: sym,
      provenance: 'unavailable',
      note: `Live DEX source (Dexscreener) unavailable — ${err instanceof Error ? err.message : 'error'}.`,
      pools: [],
    };
  } finally {
    clearTimeout(timer);
  }
}
