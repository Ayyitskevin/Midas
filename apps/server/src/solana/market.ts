import type { SolanaMarket, SolanaMarketToken } from '@midas/shared';
import { geckoterminalEnabled } from '../providers/geckoterminal';

/**
 * Solana ecosystem market overview (SOLMKT) — SOL's spot price up top, an
 * aggregate 24h-volume / liquidity roll-up across the busiest tokens, and a
 * compact top-tokens list. The macro companion to STREND's ranked list, built
 * from the same GeckoTerminal Solana trending feed (env-gated by
 * MIDAS_DEX_SOURCE=geckoterminal) plus the market provider's SOL price. Same
 * honesty rules: a pure fixture-tested mapper and honest `unavailable`
 * degradation — never a fabricated `live`. Read-only; no key, no signing.
 */

const TRENDING_ENDPOINT = 'https://api.geckoterminal.com/api/v2/networks/solana/trending_pools';
const TIMEOUT_MS = 6000;
const MAX_TOKENS = 12;
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
}

/** "WIF / SOL 0.25%" → base ticker 'WIF' (or '' when unparseable). */
function baseTicker(name: string): string {
  return (name.split('/')[0] ?? '').trim().toUpperCase();
}

/**
 * Map a GeckoTerminal trending_pools payload to a SolanaMarket roll-up. Pure.
 * One row per DISTINCT base token (the first/highest-volume pool wins, so the
 * list reads as tokens not pools), sorted by 24h volume, dust dropped, capped;
 * the aggregate volume/liquidity and token count sum the surviving rows. SOL's
 * price is injected by the caller (the mapper stays IO-free).
 */
export function mapSolanaMarket(inputs: { payload: unknown; solPriceUsd: number | null; now: number }): SolanaMarket {
  const data = (inputs.payload as { data?: unknown } | null)?.data;
  const rows: SolanaMarketToken[] = [];
  const seen = new Set<string>();
  if (Array.isArray(data)) {
    for (const raw of data as GtPool[]) {
      const symbol = baseTicker(str(raw.attributes?.name));
      if (!symbol || seen.has(symbol)) continue;
      const liquidityUsd = num(raw.attributes?.reserve_in_usd);
      if (liquidityUsd != null && liquidityUsd < MIN_LIQUIDITY_USD) continue;
      seen.add(symbol);
      rows.push({
        symbol,
        priceUsd: num(raw.attributes?.base_token_price_usd),
        change24hPct: num(raw.attributes?.price_change_percentage?.h24),
        volume24hUsd: num(raw.attributes?.volume_usd?.h24),
        liquidityUsd,
      });
    }
  }
  rows.sort((a, b) => (b.volume24hUsd ?? 0) - (a.volume24hUsd ?? 0));
  const tokens = rows.slice(0, MAX_TOKENS);

  const totalVolume24hUsd = tokens.reduce((s, t) => s + (t.volume24hUsd ?? 0), 0);
  const totalLiquidityUsd = tokens.reduce((s, t) => s + (t.liquidityUsd ?? 0), 0);

  return {
    source: 'geckoterminal:solana',
    provenance: 'live',
    note: null,
    solPriceUsd: inputs.solPriceUsd,
    totalVolume24hUsd: tokens.length ? Math.round(totalVolume24hUsd) : null,
    totalLiquidityUsd: tokens.length ? Math.round(totalLiquidityUsd) : null,
    tokenCount: tokens.length,
    tokens,
    asOf: inputs.now,
  };
}

function unavailable(note: string, solPriceUsd: number | null): SolanaMarket {
  return {
    source: geckoterminalEnabled() ? 'geckoterminal:solana' : 'none',
    provenance: 'unavailable',
    note,
    solPriceUsd,
    totalVolume24hUsd: null,
    totalLiquidityUsd: null,
    tokenCount: null,
    tokens: [],
    asOf: Date.now(),
  };
}

/**
 * Fetch the live Solana ecosystem overview. Honest `unavailable` when the DEX
 * source is off or on any failure — SOL's price (from the market provider) is
 * still carried through so the header is useful even when the token feed is off.
 */
export async function fetchSolanaMarket(solPriceUsd: number | null = null): Promise<SolanaMarket> {
  if (!geckoterminalEnabled()) {
    return unavailable('Live Solana market data needs a DEX source — set MIDAS_DEX_SOURCE=geckoterminal.', solPriceUsd);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(TRENDING_ENDPOINT, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const market = mapSolanaMarket({ payload: await res.json(), solPriceUsd, now: Date.now() });
    if (market.tokens.length === 0) {
      return unavailable('No Solana market data returned.', solPriceUsd);
    }
    return market;
  } catch (err) {
    return unavailable(`Live Solana market source (GeckoTerminal) unavailable — ${err instanceof Error ? err.message : 'error'}.`, solPriceUsd);
  } finally {
    clearTimeout(timer);
  }
}
