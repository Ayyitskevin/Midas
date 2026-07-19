import { describe, expect, it } from 'vitest';
import type { CoinRef } from '@midas/shared';
import { coinBadge, sortCoins } from './coins';

function coin(over: Partial<CoinRef> & { base: string; rank: number }): CoinRef {
  return {
    rank: over.rank,
    base: over.base,
    name: over.base,
    priceUsd: over.priceUsd ?? 1,
    marketCapUsd: over.marketCapUsd ?? 0,
    circulatingSupply: over.circulatingSupply ?? 0,
    totalSupply: over.totalSupply ?? null,
    fdvUsd: over.fdvUsd ?? null,
    change24hPct: over.change24hPct ?? 0,
    category: over.category ?? null,
  };
}

const SAMPLE: CoinRef[] = [
  coin({ base: 'BTC', rank: 1, marketCapUsd: 1_300_000, priceUsd: 67_000, change24hPct: -1.2, fdvUsd: 1_400_000 }),
  coin({ base: 'ETH', rank: 2, marketCapUsd: 420_000, priceUsd: 3_500, change24hPct: 3.4, fdvUsd: null }),
  coin({ base: 'SOL', rank: 3, marketCapUsd: 70_000, priceUsd: 150, change24hPct: 5.1, fdvUsd: 90_000 }),
];

describe('sortCoins', () => {
  it('sorts by market cap descending', () => {
    const out = sortCoins(SAMPLE, 'marketCap', 'desc');
    expect(out.map((c) => c.base)).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('sorts by 24h change ascending', () => {
    const out = sortCoins(SAMPLE, 'change', 'asc');
    expect(out.map((c) => c.base)).toEqual(['BTC', 'ETH', 'SOL']);
  });

  it('keeps nulls last even on a descending sort', () => {
    const out = sortCoins(SAMPLE, 'fdv', 'desc');
    // BTC (1.4M) and SOL (90k) have FDV; ETH (null) must land last.
    expect(out.map((c) => c.base)).toEqual(['BTC', 'SOL', 'ETH']);
  });

  it('does not mutate the input array', () => {
    const before = SAMPLE.map((c) => c.base);
    sortCoins(SAMPLE, 'price', 'asc');
    expect(SAMPLE.map((c) => c.base)).toEqual(before);
  });

  it('breaks ties by rank for a stable order', () => {
    const tied = [
      coin({ base: 'A', rank: 3, marketCapUsd: 100 }),
      coin({ base: 'B', rank: 1, marketCapUsd: 100 }),
      coin({ base: 'C', rank: 2, marketCapUsd: 100 }),
    ];
    expect(sortCoins(tied, 'marketCap', 'desc').map((c) => c.base)).toEqual(['B', 'C', 'A']);
  });
});

describe('coinBadge', () => {
  it('maps every provenance to a label and tone', () => {
    expect(coinBadge('live')).toEqual({ label: 'LIVE', tone: 'live' });
    expect(coinBadge('synthetic')).toEqual({ label: 'DEMO', tone: 'demo' });
    expect(coinBadge('unavailable')).toEqual({ label: 'UNAVAILABLE', tone: 'off' });
  });
});
