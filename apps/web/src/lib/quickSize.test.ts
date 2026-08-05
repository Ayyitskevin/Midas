import { describe, it, expect } from 'vitest';
import type { Balances, DataReceipt } from '@midas/shared';
import { quickSizeAmount, capBlockReason, trustedFreeBalance } from './quickSize';

describe('quickSizeAmount', () => {
  it('sizes a buy from the free quote balance at the reference price', () => {
    expect(quickSizeAmount('buy', 0.25, 0, 10_000, 50_000)).toBeCloseTo(0.05); // $2.5k of BTC @ 50k
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000)).toBeCloseTo(0.2); // MAX
  });

  it('sizes a sell from the free base balance (price irrelevant)', () => {
    expect(quickSizeAmount('sell', 0.5, 4, 0, 0)).toBe(2);
  });

  it('returns null when it cannot size', () => {
    expect(quickSizeAmount('buy', 0.5, 0, 0, 50_000)).toBeNull(); // no quote balance
    expect(quickSizeAmount('buy', 0.5, 0, 1000, 0)).toBeNull(); // no price
    expect(quickSizeAmount('sell', 0.5, 0, 1000, 50_000)).toBeNull(); // no base balance
    expect(quickSizeAmount('buy', 0, 1, 1000, 50_000)).toBeNull(); // zero fraction
    expect(quickSizeAmount('buy', 0.5, null, null, 50_000)).toBeNull(); // unknown quote balance
    expect(quickSizeAmount('sell', 0.5, null, 1000, 50_000)).toBeNull(); // unknown base balance
  });

  it('reserves the venue taker fee on a buy so 100% fits once fees are deducted', () => {
    // Binance 10 bps: $10,000 / ($50,000 × 1.001) = 0.1998001998... BTC
    const amt = quickSizeAmount('buy', 1, 0, 10_000, 50_000, 'binance');
    expect(amt).toBeCloseTo(0.2 / 1.001, 12);
    expect(amt!).toBeLessThan(0.2);
    // Notional + fee equals the full quote budget exactly.
    expect(amt! * 50_000 * 1.001).toBeCloseTo(10_000, 6);
    // Kraken 80 bps: 0.2 / 1.008
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000, 'kraken')).toBeCloseTo(0.2 / 1.008, 12);
    // Partial fractions reserve proportionally: 25% at Binance.
    expect(quickSizeAmount('buy', 0.25, 0, 10_000, 50_000, 'Binance')).toBeCloseTo(0.05 / 1.001, 12);
  });

  it('keeps the gross-of-fee size when the venue or its fee is unknown', () => {
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000)).toBeCloseTo(0.2); // no venue arg
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000, null)).toBeCloseTo(0.2);
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000, 'mexc')).toBeCloseTo(0.2); // not in schedule
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000, 'mock')).toBeCloseTo(0.2); // demo provider
  });

  it('does not fee-reserve a sell (sized from the base asset)', () => {
    expect(quickSizeAmount('sell', 1, 4, 0, 50_000, 'binance')).toBe(4);
  });
});

const receipt = (state: DataReceipt['freshness']['state'] = 'fresh'): DataReceipt => ({
  schemaVersion: '1.0',
  receiptId: 'rcpt-balances',
  providerId: 'ccxt',
  providerVersion: '1',
  source: 'ccxt:binance',
  venue: 'binance',
  datasetFamily: 'balances',
  instrument: null,
  coverage: 'configured account',
  provenance: 'live',
  derivation: 'observed',
  sourceAsOf: '2026-08-01T12:00:00.000Z',
  observedAt: '2026-08-01T12:00:01.000Z',
  expectedCadenceMs: 30_000,
  maxAgeMs: 60_000,
  freshness: { state, ageMs: 1_000 },
  cache: { status: 'miss', ageMs: null },
  units: { free: 'asset' },
  methodology: null,
  inputReceiptIds: [],
  limitations: [],
  traceId: null,
  note: 'Read-only account balances.',
});

const balances = (dataReceipt: DataReceipt | undefined = receipt()): Balances => ({
  source: 'ccxt:binance',
  provenance: 'live',
  note: null,
  totalValueUsd: 1_000,
  balances: [{ asset: 'USDT', free: 750, used: 250, total: 1_000, valueUsd: 1_000 }],
  asOf: Date.parse('2026-08-01T12:00:00.000Z'),
  receipt: dataReceipt,
});

const EVALUATED_AT = Date.parse('2026-08-01T12:00:01.000Z');
const trusted = (snapshot: Balances, asset: string) =>
  trustedFreeBalance(snapshot, asset, EVALUATED_AT);

describe('trustedFreeBalance', () => {
  it('returns a reported fresh balance, including an explicit zero', () => {
    expect(trusted(balances(), 'USDT')).toBe(750);
    expect(
      trusted(
        { ...balances(), balances: [{ asset: 'USDT', free: 0, used: 0, total: 0, valueUsd: 0 }] },
        'USDT',
      ),
    ).toBe(0);
  });

  it('keeps missing, stale, unavailable and receipt-less balances unknown', () => {
    expect(trusted(balances(), 'BTC')).toBeNull();
    expect(trusted(balances(receipt('stale')), 'USDT')).toBeNull();
    expect(trusted({ ...balances(), provenance: 'unavailable' }, 'USDT')).toBeNull();
    expect(trusted({ ...balances(), receipt: undefined }, 'USDT')).toBeNull();
    expect(trustedFreeBalance(balances(), 'USDT', EVALUATED_AT + 60_001)).toBeNull();
  });
});

describe('capBlockReason', () => {
  const status = { maxOrderUsd: 1000, dailyCapUsd: 5000, dailyUsedUsd: 4500 };

  it('flags a per-order cap breach first', () => {
    expect(capBlockReason(1500, status)).toMatch(/per-order cap/);
  });

  it('flags a daily-cap breach with the remaining budget', () => {
    expect(capBlockReason(900, status)).toMatch(/remaining \$500/);
  });

  it('passes orders that fit, unknown notionals, and uncapped configs', () => {
    expect(capBlockReason(400, status)).toBeNull(); // 4500+400 ≤ 5000
    expect(capBlockReason(null, status)).toBeNull(); // server prices it
    expect(capBlockReason(99_999, { maxOrderUsd: null, dailyCapUsd: null, dailyUsedUsd: 0 })).toBeNull();
    expect(capBlockReason(400, null)).toBeNull();
  });
});
