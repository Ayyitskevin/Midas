import { describe, it, expect, afterEach } from 'vitest';
import { mapSolanaMarket, fetchSolanaMarket } from './market';

const payload = {
  data: [
    { attributes: { name: 'WIF / SOL', base_token_price_usd: '2.4', reserve_in_usd: '2000000', volume_usd: { h24: '900000' }, price_change_percentage: { h24: '5' } } },
    { attributes: { name: 'WIF / USDC', base_token_price_usd: '2.39', reserve_in_usd: '1000000', volume_usd: { h24: '400000' }, price_change_percentage: { h24: '4' } } }, // dup symbol → dropped
    { attributes: { name: 'BONK / SOL', base_token_price_usd: '0.000023', reserve_in_usd: '3000000', volume_usd: { h24: '1500000' }, price_change_percentage: { h24: '-3' } } },
    { attributes: { name: 'DUST / SOL', base_token_price_usd: '1', reserve_in_usd: '100', volume_usd: { h24: '50' } } }, // below MIN_LIQUIDITY → dropped
  ],
};

describe('mapSolanaMarket', () => {
  it('dedupes per symbol, sorts by volume, aggregates, carries SOL price', () => {
    const m = mapSolanaMarket({ payload, solPriceUsd: 152.5, now: 1_782_000_000_000 });
    expect(m.provenance).toBe('live');
    expect(m.solPriceUsd).toBe(152.5);
    // WIF (twice) → one row; BONK → one; DUST dropped for dust liquidity.
    expect(m.tokens.map((t) => t.symbol)).toEqual(['BONK', 'WIF']); // BONK first (higher volume)
    expect(m.tokenCount).toBe(2);
    // Aggregates over the surviving rows (WIF's kept pool + BONK).
    expect(m.totalVolume24hUsd).toBe(900_000 + 1_500_000);
    expect(m.totalLiquidityUsd).toBe(2_000_000 + 3_000_000);
  });

  it('is defensive against a garbage payload', () => {
    const m = mapSolanaMarket({ payload: null, solPriceUsd: null, now: 1 });
    expect(m.tokens).toEqual([]);
    expect(m.tokenCount).toBe(0);
    expect(m.totalVolume24hUsd).toBeNull();
  });
});

describe('fetchSolanaMarket gate', () => {
  afterEach(() => {
    delete process.env.MIDAS_DEX_SOURCE;
  });

  it('is honest "unavailable" when no DEX source is set — but still carries SOL price', async () => {
    delete process.env.MIDAS_DEX_SOURCE;
    const m = await fetchSolanaMarket(150);
    expect(m.provenance).toBe('unavailable');
    expect(m.note).toMatch(/MIDAS_DEX_SOURCE/);
    expect(m.solPriceUsd).toBe(150); // header stays useful even when the token feed is off
    expect(m.tokens).toEqual([]);
  });
});
