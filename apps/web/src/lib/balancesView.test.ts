import { describe, it, expect } from 'vitest';
import { balancesBadge, allocations } from './balancesView';
import type { Balances } from '@midas/shared';

const make = (over: Partial<Balances>): Balances => ({
  source: 'mock',
  provenance: 'synthetic',
  note: null,
  totalValueUsd: null,
  balances: [],
  asOf: 0,
  ...over,
});

describe('balancesBadge', () => {
  it('labels a live keyed read green, naming the source', () => {
    const v = balancesBadge(make({ provenance: 'live', source: 'ccxt:binance', note: null }));
    expect(v.tone).toBe('live');
    expect(v.label).toBe('live');
    expect(v.detail).toMatch(/ccxt:binance/);
  });

  it('labels a synthetic demo book amber as not real', () => {
    const v = balancesBadge(make({ provenance: 'synthetic', note: 'Synthetic demo balances — not a real account.' }));
    expect(v.tone).toBe('synthetic');
    expect(v.label).toBe('demo');
    expect(v.detail).toMatch(/not a real account/i);
  });

  it('labels unavailable dim, surfacing the provider note (e.g. how to enable)', () => {
    const v = balancesBadge(make({ provenance: 'unavailable', note: 'Set MIDAS_CCXT_API_KEY…' }));
    expect(v.tone).toBe('unavailable');
    expect(v.label).toBe('unavailable');
    expect(v.detail).toBe('Set MIDAS_CCXT_API_KEY…');
  });
});

describe('allocations', () => {
  it('computes each priced holding’s share of the total, largest first', () => {
    const rows = allocations(
      make({
        balances: [
          { asset: 'ETH', free: 3, used: 0, total: 3, valueUsd: 9_000 },
          { asset: 'BTC', free: 0.5, used: 0, total: 0.5, valueUsd: 30_000 },
          { asset: 'USDT', free: 1000, used: 0, total: 1000, valueUsd: 1_000 },
        ],
      }),
    );
    expect(rows.map((r) => r.asset)).toEqual(['BTC', 'ETH', 'USDT']); // sorted by value desc
    expect(rows[0].pct).toBeCloseTo(75); // 30k / 40k
    expect(rows[1].pct).toBeCloseTo(22.5); // 9k / 40k
    expect(rows[2].pct).toBeCloseTo(2.5); // 1k / 40k
  });

  it('excludes unpriced holdings and returns [] when nothing is priced', () => {
    expect(allocations(make({ balances: [{ asset: 'WIF', free: 1, used: 0, total: 1, valueUsd: null }] }))).toEqual([]);
  });
});
