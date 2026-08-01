import { describe, it, expect } from 'vitest';
import type { FundingRow } from '@midas/shared';
import { annualizedFundingPct, sortFundingRows } from '@/lib/funding';

const row = (symbol: string, fundingRate: number | null, oi: number | null): FundingRow => ({
  symbol,
  fundingRate,
  nextFundingTime: null,
  markPrice: null,
  openInterestValue: oi,
});

describe('annualizedFundingPct', () => {
  it('annualizes an 8h funding rate', () => {
    expect(annualizedFundingPct(0.0001)).toBeCloseTo(10.95); // 0.01% × 3 × 365
    expect(annualizedFundingPct(0.0001, 8)).toBeCloseTo(10.95);
  });

  it('annualizes hourly funding at 8x the 8h factor', () => {
    expect(annualizedFundingPct(0.0001, 1)).toBeCloseTo(87.6); // 0.01% × 24 × 365
  });

  it('annualizes 4h funding at 2x the 8h factor', () => {
    expect(annualizedFundingPct(0.0001, 4)).toBeCloseTo(21.9); // 0.01% × 6 × 365
  });

  it('returns null when the interval is unknown rather than assuming 8h', () => {
    expect(annualizedFundingPct(0.0001, null)).toBeNull();
  });

  it('returns null for a non-positive interval', () => {
    expect(annualizedFundingPct(0.0001, 0)).toBeNull();
  });

  it('passes null through', () => {
    expect(annualizedFundingPct(null)).toBeNull();
    expect(annualizedFundingPct(null, 8)).toBeNull();
  });
});

describe('sortFundingRows', () => {
  const rows = [row('AAA', 0.0002, 100), row('BBB', -0.0001, 900), row('CCC', null, 400)];

  it('sorts by funding descending, nulls last', () => {
    expect(sortFundingRows(rows, 'funding', 'desc').map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('sorts by OI descending', () => {
    expect(sortFundingRows(rows, 'oi', 'desc').map((r) => r.symbol)).toEqual(['BBB', 'CCC', 'AAA']);
  });

  it('sorts by symbol ascending and does not mutate input', () => {
    const before = rows.map((r) => r.symbol);
    expect(sortFundingRows(rows, 'symbol', 'asc').map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
