import type { CoinRef, CoinUniverseProvenance } from '@midas/shared';

/** Sortable columns of the TOP (market-cap reference) board. */
export type CoinSortKey = 'rank' | 'price' | 'change' | 'marketCap' | 'fdv' | 'supply';

const VALUE: Record<CoinSortKey, (c: CoinRef) => number | null> = {
  rank: (c) => c.rank,
  price: (c) => c.priceUsd,
  change: (c) => c.change24hPct,
  marketCap: (c) => c.marketCapUsd,
  fdv: (c) => c.fdvUsd,
  supply: (c) => c.circulatingSupply,
};

/**
 * Sort coins by a column. Nulls always sort last (regardless of direction), so a
 * coin missing FDV/supply never floats to the top of a descending sort, and ties
 * fall back to rank so the order is stable. Pure — returns a new array.
 */
export function sortCoins(coins: CoinRef[], key: CoinSortKey, dir: 'asc' | 'desc'): CoinRef[] {
  const val = VALUE[key];
  const sign = dir === 'asc' ? 1 : -1;
  return [...coins].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av == null && bv == null) return a.rank - b.rank;
    if (av == null) return 1; // nulls last
    if (bv == null) return -1;
    if (av === bv) return a.rank - b.rank;
    return (av - bv) * sign;
  });
}

/** Data-honesty badge label + tone for a coin universe's provenance. */
export function coinBadge(p: CoinUniverseProvenance): { label: string; tone: 'live' | 'demo' | 'off' } {
  if (p === 'live') return { label: 'LIVE', tone: 'live' };
  if (p === 'synthetic') return { label: 'DEMO', tone: 'demo' };
  return { label: 'UNAVAILABLE', tone: 'off' };
}
