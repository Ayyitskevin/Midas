import { describe, it, expect } from 'vitest';
import { createDataReceipt, type FundingRow, type Quote, type TrustDatasetFamily } from '@midas/shared';
import {
  computeCarry,
  computeInspectedCarry,
  sortCarry,
  type CarrySource,
  type CarryRow,
} from '@/lib/carry';
import { annualizedFundingPct } from '@/lib/funding';

const src = (symbol: string, fundingRate: number | null, markPrice: number | null): CarrySource => ({
  symbol,
  fundingRate,
  markPrice,
  openInterestValue: 1_000_000,
  nextFundingTime: null,
});

const srcWithInterval = (
  symbol: string,
  fundingRate: number | null,
  fundingIntervalHours: number | null,
): CarrySource => ({ ...src(symbol, fundingRate, 100), fundingIntervalHours });

describe('computeCarry', () => {
  it('annualizes funding and computes the basis vs spot', () => {
    const r = computeCarry({ ...srcWithInterval('BTC/USDT', 0.0001, 8), markPrice: 101 }, 100);
    expect(r.aprPct).toBeCloseTo(annualizedFundingPct(0.0001, 8)!); // reuses the shared factor
    expect(r.basisPct).toBeCloseTo(1); // 101 vs 100
    expect(r.side).toBe('short-perp'); // positive funding → short the perp to collect
  });

  it('scales the APR with the actual settlement interval (1h/4h/8h)', () => {
    const rate = 0.0001;
    const apr = (h: number) => computeCarry(srcWithInterval('X', rate, h), 100).aprPct!;
    expect(apr(1)).toBeCloseTo(annualizedFundingPct(rate, 1)!); // 24 settlements/day
    expect(apr(4)).toBeCloseTo(annualizedFundingPct(rate, 4)!);
    expect(apr(8)).toBeCloseTo(annualizedFundingPct(rate, 8)!);
    expect(apr(1)).toBeCloseTo(apr(8) * 8); // cadence matters, not an 8h assumption
  });

  it('renders APR null when the interval is unknown — honest beats helpful', () => {
    expect(computeCarry(srcWithInterval('X', 0.0001, null), 100).aprPct).toBeNull();
    expect(computeCarry(src('X', 0.0001, 100), 100).aprPct).toBeNull(); // field omitted
  });

  it('names the long-perp leg when funding is negative, flat when ~0', () => {
    expect(computeCarry(src('X', -0.0002, 100), 100).side).toBe('long-perp');
    expect(computeCarry(src('X', 0, 100), 100).side).toBe('flat');
    expect(computeCarry(src('X', null, 100), 100).side).toBe('flat');
  });

  it('nulls the basis without a usable mark or spot', () => {
    expect(computeCarry(src('X', 0.0001, null), 100).basisPct).toBeNull();
    expect(computeCarry(src('X', 0.0001, 101), null).basisPct).toBeNull();
    expect(computeCarry(src('X', 0.0001, 101), 0).basisPct).toBeNull();
  });
});

describe('sortCarry', () => {
  const rows: CarryRow[] = [
    computeCarry(srcWithInterval('A', 0.0001, 8), 100), // apr+
    computeCarry(srcWithInterval('B', -0.0003, 8), 100), // apr−
    computeCarry(srcWithInterval('C', 0.0002, 8), 100), // apr++
  ];

  it('ranks by APR descending by default direction', () => {
    const sorted = sortCarry(rows, 'apr', 'desc');
    expect(sorted.map((r) => r.symbol)).toEqual(['C', 'A', 'B']);
  });

  it('sorts symbols alphabetically', () => {
    expect(sortCarry(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('pushes null metrics to the bottom on a descending sort', () => {
    const withNull = [...rows, computeCarry(src('Z', null, 100), 100)];
    const sorted = sortCarry(withNull, 'apr', 'desc');
    expect(sorted[sorted.length - 1].symbol).toBe('Z');
  });
});

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function evidence(
  family: TrustDatasetFamily,
  instrument = 'BTC/USDT',
  ageMs = 1_000,
  provenance: 'live' | 'synthetic' = 'live',
) {
  return createDataReceipt(
    {
      providerId: provenance === 'synthetic' ? 'mock' : 'ccxt',
      providerVersion: '1',
      source: provenance === 'synthetic' ? 'mock' : 'ccxt:binance',
      venue: provenance === 'synthetic' ? null : 'binance',
      datasetFamily: family,
      instrument,
      provenance,
      sourceAsOf: NOW - ageMs,
      observedAt: NOW - ageMs,
      maxAgeMs: 5_000,
      units: {},
      limitations: provenance === 'synthetic' ? ['Synthetic test evidence.'] : [],
      note: provenance === 'synthetic' ? 'Synthetic test evidence.' : null,
    },
    NOW,
  );
}

function fundingRow(receipt = evidence('funding')): FundingRow {
  return {
    symbol: 'BTC/USDT',
    fundingRate: 0.0001,
    fundingIntervalHours: 8,
    nextFundingTime: NOW + 3_600_000,
    markPrice: 101,
    openInterestValue: 1_000_000,
    receipt,
  };
}

function quote(receipt = evidence('quote')): Quote {
  return {
    symbol: 'BTC/USDT',
    name: 'BTC / USDT',
    currency: 'USDT',
    exchange: 'Binance',
    marketState: 'REGULAR',
    price: 100,
    previousClose: 99,
    open: 99,
    dayHigh: 102,
    dayLow: 98,
    change: 1,
    changePercent: 1.01,
    volume: 1_000,
    marketCap: null,
    fiftyTwoWeekHigh: null,
    fiftyTwoWeekLow: null,
    asOf: NOW - 1_000,
    receipt,
  };
}

describe('computeInspectedCarry', () => {
  it('retains both funding and quote lineage with a versioned formula', () => {
    const funding = fundingRow();
    const spot = quote();
    const inspected = computeInspectedCarry(funding, spot, NOW);
    expect(inspected.receipt).toMatchObject({
      derivation: 'derived',
      provenance: 'live',
      freshness: { state: 'fresh' },
      methodology: { id: 'funding-carry', version: '1.0' },
      inputReceiptIds: [funding.receipt!.receiptId, spot.receipt!.receiptId],
    });
    expect(inspected.basisPct).toBeCloseTo(1);
    expect(inspected.aprPct).not.toBeNull();
    expect(inspected.actionable).toBe(true);
  });

  it('suppresses the derived signal when either required input is stale', () => {
    const staleQuote = quote(evidence('quote', 'BTC/USDT', 5_001));
    const inspected = computeInspectedCarry(fundingRow(), staleQuote, NOW);
    expect(inspected.receipt?.freshness.state).toBe('stale');
    expect(inspected).toMatchObject({ aprPct: null, basisPct: null, side: 'flat', actionable: false });
    expect(inspected.fundingRate).toBe(0.0001);
  });

  it('fails closed for missing or mismatched evidence instead of inventing values', () => {
    expect(computeInspectedCarry({ ...fundingRow(), receipt: undefined }, quote(), NOW)).toMatchObject({
      receipt: null,
      aprPct: null,
      basisPct: null,
      actionable: false,
    });
    expect(
      computeInspectedCarry(fundingRow(), { ...quote(evidence('quote', 'ETH/USDT')), symbol: 'ETH/USDT' }, NOW),
    ).toMatchObject({ receipt: null, aprPct: null, basisPct: null, actionable: false });
  });

  it('keeps synthetic demo evidence visible but non-actionable', () => {
    const inspected = computeInspectedCarry(
      fundingRow(evidence('funding', 'BTC/USDT', 1_000, 'synthetic')),
      quote(evidence('quote', 'BTC/USDT', 1_000, 'synthetic')),
      NOW,
    );
    expect(inspected.receipt?.provenance).toBe('synthetic');
    expect(inspected.basisPct).toBeCloseTo(1);
    expect(inspected.actionable).toBe(false);
  });
});
