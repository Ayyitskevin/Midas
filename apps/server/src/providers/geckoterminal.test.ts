import { describe, it, expect } from 'vitest';
import { mapGeckoterminal } from './geckoterminal';

/** Shape mirrors GeckoTerminal /api/v2/search/pools (trimmed to what we read). */
const FIXTURE = {
  data: [
    {
      attributes: {
        name: 'WETH / USDC 0.05%',
        base_token_price_usd: '3001.5',
        reserve_in_usd: '250000000',
        volume_usd: { h24: '120000000' },
      },
      relationships: { dex: { data: { id: 'uniswap_v3' } } },
    },
    {
      attributes: {
        name: 'ETH / USDT',
        base_token_price_usd: '3000.2',
        reserve_in_usd: '80000000',
        volume_usd: { h24: '40000000' },
      },
      relationships: { dex: { data: { id: 'curve' } } },
    },
    {
      // Wrong base — a pool where ETH is the quote side.
      attributes: { name: 'PEPE / WETH', base_token_price_usd: '0.00001', reserve_in_usd: '5000000' },
      relationships: { dex: { data: { id: 'uniswap_v2' } } },
    },
    {
      // Dust pool below the liquidity floor.
      attributes: { name: 'WETH / SCAM', base_token_price_usd: '2900', reserve_in_usd: '900' },
      relationships: { dex: { data: { id: 'shadydex' } } },
    },
  ],
};

describe('mapGeckoterminal', () => {
  it('keeps only the asset (and wrapped) as base, parses fee tiers, sorts by liquidity', () => {
    const pools = mapGeckoterminal(FIXTURE, 'ETH');
    expect(pools.map((p) => p.dex)).toEqual(['uniswap_v3', 'curve']);
    expect(pools[0]).toEqual({
      dex: 'uniswap_v3',
      pair: 'WETH/USDC',
      priceUsd: 3001.5,
      liquidityUsd: 250_000_000,
      volume24hUsd: 120_000_000,
      feeBps: 5, // 0.05% parsed from the pool name
    });
    expect(pools[1].feeBps).toBeNull(); // no tier in the name → honest null
  });

  it('degrades on junk payloads instead of throwing', () => {
    expect(mapGeckoterminal(null, 'ETH')).toEqual([]);
    expect(mapGeckoterminal({ data: 'nope' }, 'ETH')).toEqual([]);
    expect(mapGeckoterminal({ data: [{}] }, 'ETH')).toEqual([]);
  });
});
