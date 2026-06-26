import { describe, it, expect } from 'vitest';
import { computeBands, bandsBoard, sortBands } from './bollinger';

// period 3, k 2 throughout. Window [10,20,30] → mean 20, popStdev √(200/3) ≈ 8.165,
// upper ≈ 36.330, lower ≈ 3.670, width ≈ 32.660.
const OVERB = [10, 20, 30]; // close 30 near the upper band
const OVERS = [30, 20, 10]; // close 10 near the lower band
const MIDB = [10, 30, 20]; // close 20 == middle

describe('computeBands', () => {
  it('puts a close near the upper band above 0.8', () => {
    const r = computeBands(OVERB, 3, 2)!;
    expect(r).not.toBeNull();
    expect(r.middle).toBeCloseTo(20, 6);
    expect(r.upper).toBeCloseTo(36.3299, 3);
    expect(r.lower).toBeCloseTo(3.6701, 3);
    expect(r.pctB).toBeCloseTo(0.8062, 4);
    expect(r.bandwidth).toBeCloseTo(1.63299, 4);
    expect(r.squeeze).toBe(false); // only one bandwidth point
    expect(r.n).toBe(3);
  });

  it('puts a close near the lower band below 0.2', () => {
    const r = computeBands(OVERS, 3, 2)!;
    expect(r.pctB).toBeCloseTo(0.1938, 4);
    expect(r.bandwidth).toBeCloseTo(1.63299, 4);
  });

  it('puts a close at the middle band at 0.5', () => {
    const r = computeBands(MIDB, 3, 2)!;
    expect(r.pctB).toBeCloseTo(0.5, 6);
  });

  it('flags a squeeze when the current bandwidth is the narrowest', () => {
    // Bandwidths shrink each step; the last window [19,20,21] is by far the tightest.
    const r = computeBands([0, 100, 50, 19, 20, 21], 3, 2)!;
    expect(r.squeeze).toBe(true);
    expect(r.bwPctile).toBeCloseTo(0, 6);
    expect(r.bandwidth).toBeCloseTo(0.1633, 4);
    expect(r.pctB).toBeCloseTo(0.8062, 4);
    expect(r.n).toBe(6);
  });

  it('returns null with too few closes or a non-positive SMA', () => {
    expect(computeBands([], 3)).toBeNull();
    expect(computeBands([10, 20], 3)).toBeNull();
    expect(computeBands([-10, 0, 10], 3)).toBeNull(); // mean 0
  });

  it('handles a flat window without dividing by zero', () => {
    const r = computeBands([10, 10, 10], 3, 2)!;
    expect(r.pctB).toBe(0.5);
    expect(r.bandwidth).toBe(0);
  });
});

describe('bandsBoard', () => {
  const series = [
    { symbol: 'OVERB', closes: OVERB },
    { symbol: 'OVERS', closes: OVERS },
    { symbol: 'MIDB', closes: MIDB },
  ];

  it('defaults to sorting by %B descending', () => {
    const rows = bandsBoard(series, 'pctB', 3, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['OVERB', 'MIDB', 'OVERS']); // 0.81 > 0.50 > 0.19
  });

  it('sorts by symbol', () => {
    const rows = bandsBoard(series, 'symbol', 3, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['MIDB', 'OVERB', 'OVERS']);
  });

  it('skips symbols with too little history', () => {
    const rows = bandsBoard([
      { symbol: 'OK', closes: OVERB },
      { symbol: 'THIN', closes: [10, 20] },
    ], 'pctB', 3, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortBands', () => {
  it('orders by bwPctile ascending (tightest squeeze first)', () => {
    const rows = [
      { symbol: 'A', bwPctile: 0.6 },
      { symbol: 'B', bwPctile: 0.1 },
      { symbol: 'C', bwPctile: 0.4 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any;
    expect(sortBands(rows, 'bwPctile').map((r: { symbol: string }) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
