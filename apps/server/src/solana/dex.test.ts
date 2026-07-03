import { describe, it, expect, afterEach } from 'vitest';
import { mapSolanaTrending, mapSolanaPools, fetchSolanaTrending, fetchSolanaPools } from './dex';

// A representative GeckoTerminal /networks/solana/trending_pools slice.
const TRENDING = {
  data: [
    {
      attributes: {
        name: 'WIF / SOL',
        base_token_price_usd: '2.41',
        reserve_in_usd: '8000000',
        volume_usd: { h24: '40000000' },
        price_change_percentage: { h24: '12.5' },
      },
      relationships: { dex: { data: { id: 'raydium' } } },
    },
    {
      attributes: {
        name: 'BONK / USDC',
        base_token_price_usd: '0.000023',
        reserve_in_usd: '3000000',
        volume_usd: { h24: '15000000' },
        price_change_percentage: { h24: '-4.2' },
      },
      relationships: { dex: { data: { id: 'orca' } } },
    },
    // dust below the floor → dropped
    { attributes: { name: 'SCAM / SOL', reserve_in_usd: '100', volume_usd: { h24: '5' } }, relationships: { dex: { data: { id: 'x' } } } },
  ],
};

describe('mapSolanaTrending', () => {
  it('maps + sorts by 24h volume and drops dust', () => {
    const t = mapSolanaTrending(TRENDING);
    expect(t).toHaveLength(2); // dust dropped
    expect(t[0].symbol).toBe('WIF'); // higher volume first
    expect(t[0].pair).toBe('WIF/SOL');
    expect(t[0].dex).toBe('raydium');
    expect(t[0].priceUsd).toBeCloseTo(2.41);
    expect(t[0].change24hPct).toBeCloseTo(12.5);
    expect(t[0].volume24hUsd).toBe(40_000_000);
    expect(t[1].symbol).toBe('BONK');
    expect(t[1].change24hPct).toBeCloseTo(-4.2);
  });

  it('is defensive against malformed/empty payloads', () => {
    expect(mapSolanaTrending(null)).toEqual([]);
    expect(mapSolanaTrending({ data: 'nope' })).toEqual([]);
    expect(mapSolanaTrending({ data: [{ attributes: {} }] })).toEqual([]); // no name → skipped
  });
});

const SEARCH = {
  data: [
    {
      attributes: { name: 'WIF / SOL 0.25%', base_token_price_usd: '2.4', reserve_in_usd: '8000000', volume_usd: { h24: '9000000' } },
      relationships: { dex: { data: { id: 'raydium' } }, network: { data: { id: 'solana' } } },
    },
    // right token, WRONG network → dropped
    {
      attributes: { name: 'WIF / USDC', base_token_price_usd: '2.4', reserve_in_usd: '5000000' },
      relationships: { dex: { data: { id: 'uniswap' } }, network: { data: { id: 'ethereum' } } },
    },
    // wrong base → dropped
    {
      attributes: { name: 'JUP / SOL', reserve_in_usd: '5000000' },
      relationships: { network: { data: { id: 'solana' } } },
    },
  ],
};

describe('mapSolanaPools', () => {
  it('keeps only Solana-network pools for the requested base, parses fee', () => {
    const pools = mapSolanaPools(SEARCH, 'WIF');
    expect(pools).toHaveLength(1); // ethereum + wrong-base dropped
    expect(pools[0].dex).toBe('raydium');
    expect(pools[0].pair).toBe('WIF/SOL');
    expect(pools[0].feeBps).toBe(25); // "0.25%" → 25 bps
    expect(pools[0].liquidityUsd).toBe(8_000_000);
  });

  it('is defensive against malformed payloads', () => {
    expect(mapSolanaPools(null, 'WIF')).toEqual([]);
    expect(mapSolanaPools({ data: [{}] }, 'WIF')).toEqual([]);
  });
});

describe('fetch gates default off', () => {
  afterEach(() => {
    delete process.env.MIDAS_DEX_SOURCE;
  });

  it('trending is honest "unavailable" when no DEX source is set', async () => {
    delete process.env.MIDAS_DEX_SOURCE;
    const t = await fetchSolanaTrending();
    expect(t.provenance).toBe('unavailable');
    expect(t.note).toMatch(/MIDAS_DEX_SOURCE/);
    expect(t.tokens).toEqual([]);
  });

  it('pools is honest "unavailable" when no DEX source is set', async () => {
    delete process.env.MIDAS_DEX_SOURCE;
    const p = await fetchSolanaPools('WIF');
    expect(p.provenance).toBe('unavailable');
    expect(p.symbol).toBe('WIF');
    expect(p.pools).toEqual([]);
  });
});
