import { describe, it, expect, afterEach } from 'vitest';
import { mapDexscreener, dexscreenerEnabled } from './dexscreener';

// A representative slice of a Dexscreener /latest/dex/search?q=ETH response.
const FIXTURE = {
  schemaVersion: '1.0.0',
  pairs: [
    {
      dexId: 'uniswap',
      labels: ['v3'],
      baseToken: { symbol: 'WETH' },
      quoteToken: { symbol: 'USDC' },
      priceUsd: '3501.20',
      liquidity: { usd: 25_000_000 },
      volume: { h24: 80_000_000 },
    },
    {
      dexId: 'curve',
      baseToken: { symbol: 'WETH' },
      quoteToken: { symbol: 'USDT' },
      priceUsd: '3500.05',
      liquidity: { usd: 12_000_000 },
      volume: { h24: 30_000_000 },
    },
    // dust below the floor → dropped
    {
      dexId: 'sushiswap',
      baseToken: { symbol: 'WETH' },
      quoteToken: { symbol: 'DAI' },
      priceUsd: '3499.9',
      liquidity: { usd: 5_000 },
      volume: { h24: 1_000 },
    },
    // ETH is the *quote*, not the base → dropped
    {
      dexId: 'someswap',
      baseToken: { symbol: 'USDC' },
      quoteToken: { symbol: 'WETH' },
      priceUsd: '1.0',
      liquidity: { usd: 9_000_000 },
      volume: { h24: 1 },
    },
  ],
};

describe('mapDexscreener', () => {
  it('keeps base/wrapped-base pools above the dust floor, sorted by liquidity', () => {
    const pools = mapDexscreener(FIXTURE, 'ETH');
    expect(pools.map((p) => p.dex)).toEqual(['uniswap v3', 'curve']); // dust + quote-side ETH dropped
    expect(pools[0]).toEqual({
      dex: 'uniswap v3',
      pair: 'WETH/USDC',
      priceUsd: 3501.2,
      liquidityUsd: 25_000_000,
      volume24hUsd: 80_000_000,
      feeBps: null,
    });
  });

  it('returns [] for malformed/empty payloads (defensive)', () => {
    expect(mapDexscreener({}, 'ETH')).toEqual([]);
    expect(mapDexscreener({ pairs: 'nope' }, 'ETH')).toEqual([]);
    expect(mapDexscreener(null, 'ETH')).toEqual([]);
  });
});

describe('dexscreenerEnabled', () => {
  const prev = process.env.MIDAS_DEX_SOURCE;
  afterEach(() => {
    if (prev === undefined) delete process.env.MIDAS_DEX_SOURCE;
    else process.env.MIDAS_DEX_SOURCE = prev;
  });

  it('is off unless MIDAS_DEX_SOURCE=dexscreener', () => {
    delete process.env.MIDAS_DEX_SOURCE;
    expect(dexscreenerEnabled()).toBe(false);
    process.env.MIDAS_DEX_SOURCE = 'dexscreener';
    expect(dexscreenerEnabled()).toBe(true);
    process.env.MIDAS_DEX_SOURCE = 'DexScreener';
    expect(dexscreenerEnabled()).toBe(true); // case-insensitive
  });
});
