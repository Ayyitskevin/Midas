import type { DexPool, DexPools } from '@midas/shared';
import { fetchJsonWithTimeout } from '../httpJson';

/**
 * Second optional live on-chain source: GeckoTerminal's public, no-key pool
 * search. Used when MIDAS_DEX_SOURCE=geckoterminal, and as the documented
 * fallback when Dexscreener is blocked from your network. Same honesty rules
 * as the Dexscreener source: pure fixture-tested mapping, and any failure
 * degrades to a labelled 'unavailable' snapshot — never a fake 'live'.
 */
const ENDPOINT = 'https://api.geckoterminal.com/api/v2/search/pools';
const TIMEOUT_MS = 6000;
const MAX_POOLS = 10;
const MIN_LIQUIDITY_USD = 10_000; // drop dust / scam pools

/** Is the live GeckoTerminal source enabled? Gated by env; default off. */
export function geckoterminalEnabled(): boolean {
  return (process.env.MIDAS_DEX_SOURCE ?? '').toLowerCase() === 'geckoterminal';
}

interface GtPool {
  attributes?: {
    name?: unknown;
    base_token_price_usd?: unknown;
    reserve_in_usd?: unknown;
    volume_usd?: { h24?: unknown };
  };
  relationships?: {
    dex?: { data?: { id?: unknown } };
  };
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * Map a GeckoTerminal `/search/pools` payload to our DexPool[] for a base
 * asset. Pool names look like "WETH / USDC 0.05%" — keep only pools whose
 * base side IS the asset (or its wrapped form), parse the fee tier from the
 * name when present, drop dust, sort by liquidity, cap. Pure and defensive.
 */
export function mapGeckoterminal(payload: unknown, base: string): DexPool[] {
  const b = base.toUpperCase();
  const wanted = new Set([b, `W${b}`]);
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];

  const pools: DexPool[] = [];
  for (const raw of data as GtPool[]) {
    const name = str(raw.attributes?.name);
    const [basePart, rest] = name.split('/').map((s) => s.trim());
    const baseSym = (basePart ?? '').toUpperCase();
    if (!wanted.has(baseSym)) continue;
    const liquidityUsd = num(raw.attributes?.reserve_in_usd);
    if (liquidityUsd != null && liquidityUsd < MIN_LIQUIDITY_USD) continue;
    // "USDC 0.05%" → quote USDC, fee 0.05% → 5bps
    const quoteSym = (rest ?? '').split(/\s+/)[0]?.toUpperCase() || '?';
    const feeMatch = /([\d.]+)\s*%/.exec(rest ?? '');
    const feeBps = feeMatch ? Math.round(Number(feeMatch[1]) * 100) : null;
    pools.push({
      dex: str(raw.relationships?.dex?.data?.id) || 'dex',
      pair: `${baseSym}/${quoteSym}`,
      priceUsd: num(raw.attributes?.base_token_price_usd),
      liquidityUsd,
      volume24hUsd: num(raw.attributes?.volume_usd?.h24),
      feeBps: feeBps != null && Number.isFinite(feeBps) ? feeBps : null,
    });
  }
  pools.sort((a, c) => (c.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return pools.slice(0, MAX_POOLS);
}

/** Fetch live DEX pools from GeckoTerminal; honest 'unavailable' on any failure. */
export async function fetchGeckoPools(base: string): Promise<DexPools> {
  const sym = base.toUpperCase();
  try {
    const payload = await fetchJsonWithTimeout(`${ENDPOINT}?query=${encodeURIComponent(sym)}`, {
      timeoutMs: TIMEOUT_MS,
    });
    const pools = mapGeckoterminal(payload, sym);
    if (pools.length === 0) {
      return { symbol: sym, provenance: 'unavailable', note: `No DEX pools found for ${sym} on GeckoTerminal.`, pools: [] };
    }
    return { symbol: sym, provenance: 'live', note: null, pools };
  } catch (err) {
    return {
      symbol: sym,
      provenance: 'unavailable',
      note: `Live DEX source (GeckoTerminal) unavailable — ${err instanceof Error ? err.message : 'error'}.`,
      pools: [],
    };
  }
}
