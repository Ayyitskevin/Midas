import { describe, it, expect } from 'vitest';
import { dexBadge, summarizeDexPools } from './dexView';
import type { DexPool, DexPools } from '@midas/shared';

const pool = (over: Partial<DexPool> = {}): DexPool => ({
  dex: 'Uniswap v3',
  pair: 'WETH/USDC',
  priceUsd: 100,
  liquidityUsd: 1_000_000,
  volume24hUsd: 500_000,
  feeBps: 5,
  ...over,
});

const feed = (provenance: DexPools['provenance'], note: string | null = null): DexPools => ({
  symbol: 'ETH',
  provenance,
  note,
  pools: [],
});

describe('dexBadge', () => {
  it('maps provenance to a labeled, toned badge', () => {
    expect(dexBadge(feed('live')).tone).toBe('live');
    expect(dexBadge(feed('synthetic')).label).toBe('synthetic');
    expect(dexBadge(feed('unavailable')).tone).toBe('unavailable');
  });

  it('prefers the snapshot note for the detail when present', () => {
    expect(dexBadge(feed('synthetic', 'demo data')).detail).toBe('demo data');
    expect(dexBadge(feed('live')).detail).toBe('Live on-chain data.');
  });
});

describe('summarizeDexPools', () => {
  it('sums TVL/volume and liquidity-weights the price', () => {
    const s = summarizeDexPools([
      pool({ priceUsd: 100, liquidityUsd: 3_000_000, volume24hUsd: 1_000_000 }),
      pool({ priceUsd: 104, liquidityUsd: 1_000_000, volume24hUsd: 500_000 }),
    ]);
    expect(s.poolCount).toBe(2);
    expect(s.totalLiquidityUsd).toBe(4_000_000);
    expect(s.totalVolume24hUsd).toBe(1_500_000);
    expect(s.vwapUsd).toBe(101); // (100*3 + 104*1) / 4
    expect(s.priceSpreadPct).toBeCloseTo(((104 - 100) / 101) * 100, 6);
  });

  it('falls back to a simple mean when no pool has liquidity, and null with no priced pools', () => {
    expect(summarizeDexPools([pool({ priceUsd: 10, liquidityUsd: null }), pool({ priceUsd: 20, liquidityUsd: null })]).vwapUsd).toBe(15);
    const none = summarizeDexPools([pool({ priceUsd: null })]);
    expect(none.vwapUsd).toBeNull();
    expect(none.priceSpreadPct).toBeNull();
    expect(summarizeDexPools([]).poolCount).toBe(0);
  });
});
