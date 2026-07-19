import { describe, expect, it } from 'vitest';
import { COIN_UNIVERSE, mockCoinUniverse } from './mock/coins';

describe('mockCoinUniverse', () => {
  it('labels the universe as synthetic with a source and note', async () => {
    const u = await mockCoinUniverse(100);
    expect(u.provenance).toBe('synthetic');
    expect(u.source).toBe('mock');
    expect(u.note).toBeTruthy();
    expect(typeof u.asOf).toBe('number');
  });

  it('returns the full curated universe by default and honors a limit', async () => {
    const full = await mockCoinUniverse(1000);
    expect(full.coins).toHaveLength(COIN_UNIVERSE.length);

    const top5 = await mockCoinUniverse(5);
    expect(top5.coins).toHaveLength(5);
    // A non-positive/invalid limit falls back to the full universe.
    const invalid = await mockCoinUniverse(0);
    expect(invalid.coins).toHaveLength(COIN_UNIVERSE.length);
  });

  it('ranks by market cap descending with contiguous 1-based ranks', async () => {
    const { coins } = await mockCoinUniverse(1000);
    for (let i = 0; i < coins.length; i++) {
      expect(coins[i].rank).toBe(i + 1);
      if (i > 0) {
        expect(coins[i - 1].marketCapUsd ?? 0).toBeGreaterThanOrEqual(coins[i].marketCapUsd ?? 0);
      }
    }
    // BTC dominates by cap even under the ±14% daily wiggle, so it is always #1.
    expect(coins[0].base).toBe('BTC');
  });

  it('derives market cap and FDV from price × supply, never fabricating', async () => {
    const { coins } = await mockCoinUniverse(1000);
    for (const c of coins) {
      expect(c.marketCapUsd).toBe(Math.round((c.priceUsd ?? 0) * (c.circulatingSupply ?? 0)));
      if (c.totalSupply == null) {
        expect(c.fdvUsd).toBeNull();
      } else {
        expect(c.fdvUsd).toBe(Math.round((c.priceUsd ?? 0) * c.totalSupply));
        // A capped coin's FDV is at least its circulating-supply cap.
        expect(c.fdvUsd ?? 0).toBeGreaterThanOrEqual(c.marketCapUsd ?? 0);
      }
    }
  });

  it('keeps sub-cent memecoin prices from rounding to zero', async () => {
    const { coins } = await mockCoinUniverse(1000);
    const pepe = coins.find((c) => c.base === 'PEPE');
    expect(pepe).toBeDefined();
    expect(pepe!.priceUsd ?? 0).toBeGreaterThan(0);
    expect(pepe!.marketCapUsd ?? 0).toBeGreaterThan(0);
  });
});
