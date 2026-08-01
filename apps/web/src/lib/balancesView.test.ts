import { describe, it, expect } from 'vitest';
import {
  balancesBadge,
  allocations,
  inspectAccountEquity,
  inspectAllocations,
} from './balancesView';
import { createDataReceipt, type AccountPositions, type Balances, type TrustDatasetFamily } from '@midas/shared';

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

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function evidence(family: TrustDatasetFamily, ageMs = 1_000) {
  return createDataReceipt(
    {
      providerId: 'ccxt',
      providerVersion: '1',
      source: 'ccxt:binance',
      venue: 'binance',
      datasetFamily: family,
      provenance: 'live',
      sourceAsOf: NOW - ageMs,
      observedAt: NOW - ageMs,
      maxAgeMs: 5_000,
    },
    NOW,
  );
}

const valuedBalances = (): Balances =>
  make({
    provenance: 'live',
    source: 'ccxt:binance',
    totalValueUsd: 10_000,
    balances: [
      { asset: 'BTC', free: 0.1, used: 0, total: 0.1, valueUsd: 6_000 },
      { asset: 'USDT', free: 4_000, used: 0, total: 4_000, valueUsd: 4_000 },
    ],
    receipt: evidence('balances'),
  });

const positions = (ageMs = 1_000): AccountPositions => ({
  source: 'ccxt:binance',
  provenance: 'live',
  note: null,
  totalUnrealizedPnlUsd: 250,
  positions: [],
  asOf: NOW - ageMs,
  receipt: evidence('account-positions', ageMs),
});

describe('inspected balance derivations', () => {
  it('retains both account inputs for equity and names the formula', () => {
    const balances = valuedBalances();
    const positionSnapshot = positions();
    const inspected = inspectAccountEquity(balances, positionSnapshot, NOW);
    expect(inspected.value).toBe(10_250);
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      methodology: { id: 'account-equity', version: '1.0' },
      inputReceiptIds: [balances.receipt!.receiptId, positionSnapshot.receipt!.receiptId],
    });
    expect(inspected.actionable).toBe(true);
  });

  it('suppresses equity for a missing or stale required input', () => {
    expect(inspectAccountEquity(valuedBalances(), { ...positions(), receipt: undefined }, NOW)).toEqual({
      value: null,
      receipt: null,
      actionable: false,
    });
    expect(inspectAccountEquity(valuedBalances(), positions(5_001), NOW)).toMatchObject({
      value: null,
      actionable: false,
      receipt: { freshness: { state: 'stale' } },
    });
  });

  it('makes allocation percentages inspectable and suppresses stale evidence', () => {
    const balances = valuedBalances();
    const inspected = inspectAllocations(balances, NOW);
    expect(inspected.rows.map((row) => row.pct)).toEqual([60, 40]);
    expect(inspected.receipt).toMatchObject({
      methodology: { id: 'balance-allocation', version: '1.0' },
      inputReceiptIds: [balances.receipt!.receiptId],
    });
    expect(
      inspectAllocations({ ...balances, receipt: evidence('balances', 5_001) }, NOW).rows,
    ).toEqual([]);
  });
});
