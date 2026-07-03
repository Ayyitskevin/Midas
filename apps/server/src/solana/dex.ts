import type { DexPool, DexPools, SolanaTrending, SolanaTrendingToken } from '@midas/shared';
import { geckoterminalEnabled } from '../providers/geckoterminal';

/**
 * Solana DeFi markets — trending tokens (STREND) and per-token Solana DEX pools
 * (SOLDEX) — from GeckoTerminal's Solana network endpoints. Same honesty rules
 * as the other on-chain sources: pure fixture-tested mappers, env-gated live
 * fetch (reuses MIDAS_DEX_SOURCE=geckoterminal), and any failure degrades to a
 * labeled 'unavailable' snapshot — never a fabricated 'live'. Read-only market
 * data; no key, no signing.
 */

const TRENDING_ENDPOINT = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools';
const SEARCH_ENDPOINT = 'https://api.geckoterminal.com/api/v2/search/pools';
const TIMEOUT_MS = 6000;
const MAX_TRENDING = 15;
const MAX_POOLS = 10;
const MIN_LIQUIDITY_USD = 5_000; // drop dust / scam pools

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

interface GtPool {
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

/** "WIF / SOL 0.25%" → { base: 'WIF', quote: 'SOL', feeBps: 25 }. Defensive. */
function parsePairName(name: string): { base: string; quote: string; feeBps: number | null } {
  const [basePart, rest] = name.split('/').map((s) => s.trim());
  const base = (basePart ?? '').toUpperCase();
  const quote = (rest ?? '').split(/\s+/)[0]?.toUpperCase() || '?';
  const feeMatch = /([\d.]+)\s*%/.exec(rest ?? '');
  const feeBps = feeMatch ? Math.round(Number(feeMatch[1]) * 100) : null;
  return { base, quote, feeBps: feeBps != null && Number.isFinite(feeBps) ? feeBps : null };
}

/**
 * Map a GeckoTerminal trending_pools payload to trending tokens. Pure. One row
 * per pool (its base token), sorted by 24h volume, dust dropped, capped.
 */
export function mapSolanaTrending(payload: unknown): SolanaTrendingToken[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: SolanaTrendingToken[] = [];
  for (const raw of data as GtPool[]) {
    const { base, quote } = parsePairName(str(raw.attributes?.name));
    if (!base || base === '?') continue;
    const liquidityUsd = num(raw.attributes?.reserve_in_usd);
    if (liquidityUsd != null && liquidityUsd < MIN_LIQUIDITY_USD) continue;
    out.push({
      symbol: base,
      pair: `${base}/${quote}`,
      dex: str(raw.relationships?.dex?.data?.id) || 'dex',
      priceUsd: num(raw.attributes?.base_token_price_usd),
      change24hPct: num(raw.attributes?.price_change_percentage?.h24),
      volume24hUsd: num(raw.attributes?.volume_usd?.h24),
      liquidityUsd,
    });
  }
  out.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  return out.slice(0, MAX_TRENDING);
}

/**
 * Map a GeckoTerminal /search/pools payload to Solana-only DexPool[] for a base
 * asset. Filters to network 'solana', keeps pools whose base side IS the asset
 * (or its wrapped form), drops dust, sorts by liquidity, caps. Pure.
 */
export function mapSolanaPools(payload: unknown, base: string): DexPool[] {
  const b = base.toUpperCase();
  const wanted = new Set([b, `W${b}`]);
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return [];
  const pools: DexPool[] = [];
  for (const raw of data as GtPool[]) {
    if (str(raw.relationships?.network?.data?.id).toLowerCase() !== 'solana') continue;
    const { base: baseSym, quote, feeBps } = parsePairName(str(raw.attributes?.name));
    if (!wanted.has(baseSym)) continue;
    const liquidityUsd = num(raw.attributes?.reserve_in_usd);
    if (liquidityUsd != null && liquidityUsd < MIN_LIQUIDITY_USD) continue;
    pools.push({
      dex: str(raw.relationships?.dex?.data?.id) || 'dex',
      pair: `${baseSym}/${quote}`,
      priceUsd: num(raw.attributes?.base_token_price_usd),
      liquidityUsd,
      volume24hUsd: num(raw.attributes?.volume_usd?.h24),
      feeBps,
    });
  }
  pools.sort((a, c) => (c.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return pools.slice(0, MAX_POOLS);
}

async function gtFetch(url: string): Promise<unknown> {
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

/** Fetch trending Solana tokens; honest 'unavailable' when off or on any failure. */
export async function fetchSolanaTrending(): Promise<SolanaTrending> {
  if (!geckoterminalEnabled()) {
    return {
      source: 'none',
      provenance: 'unavailable',
      note: 'Live Solana DEX data needs a DEX source — set MIDAS_DEX_SOURCE=geckoterminal.',
      tokens: [],
      asOf: Date.now(),
    };
  }
  try {
    const tokens = mapSolanaTrending(await gtFetch(TRENDING_ENDPOINT));
    if (tokens.length === 0) {
      return { source: 'geckoterminal:solana', provenance: 'unavailable', note: 'No trending Solana pools returned.', tokens: [], asOf: Date.now() };
    }
    return { source: 'geckoterminal:solana', provenance: 'live', note: null, tokens, asOf: Date.now() };
  } catch (err) {
    return {
      source: 'geckoterminal:solana',
      provenance: 'unavailable',
      note: `Live Solana DEX source (GeckoTerminal) unavailable — ${err instanceof Error ? err.message : 'error'}.`,
      tokens: [],
      asOf: Date.now(),
    };
  }
}

/** Fetch Solana DEX pools for a base asset; honest 'unavailable' when off or on any failure. */
export async function fetchSolanaPools(base: string): Promise<DexPools> {
  const sym = base.toUpperCase();
  if (!geckoterminalEnabled()) {
    return { symbol: sym, provenance: 'unavailable', note: 'Live Solana DEX pools need MIDAS_DEX_SOURCE=geckoterminal.', pools: [] };
  }
  try {
    const pools = mapSolanaPools(await gtFetch(`${SEARCH_ENDPOINT}?query=${encodeURIComponent(sym)}`), sym);
    if (pools.length === 0) {
      return { symbol: sym, provenance: 'unavailable', note: `No Solana DEX pools found for ${sym}.`, pools: [] };
    }
    return { symbol: sym, provenance: 'live', note: null, pools };
  } catch (err) {
    return {
      symbol: sym,
      provenance: 'unavailable',
      note: `Live Solana DEX source (GeckoTerminal) unavailable — ${err instanceof Error ? err.message : 'error'}.`,
      pools: [],
    };
  }
}
