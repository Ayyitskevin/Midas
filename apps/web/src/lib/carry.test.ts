import { describe, it, expect } from 'vitest';
import { computeCarry, sortCarry, type CarrySource, type CarryRow } from '@/lib/carry';
import { annualizedFundingPct } from '@/lib/funding';

const src = (symbol: string, fundingRate: number | null, markPrice: number | null): CarrySource => ({
  symbol,
  fundingRate,
  markPrice,
  openInterestValue: 1_000_000,
  nextFundingTime: null,
});

describe('computeCarry', () => {
  it('annualizes funding and computes the basis vs spot', () => {
    const r = computeCarry(src('BTC/USDT', 0.0001, 101), 100);
    expect(r.aprPct).toBeCloseTo(annualizedFundingPct(0.0001)!); // reuses the shared factor
    expect(r.basisPct).toBeCloseTo(1); // 101 vs 100
    expect(r.side).toBe('short-perp'); // positive funding → short the perp to collect
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
    computeCarry(src('A', 0.0001, 100), 100), // apr+
    computeCarry(src('B', -0.0003, 100), 100), // apr−
    computeCarry(src('C', 0.0002, 100), 100), // apr++
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
