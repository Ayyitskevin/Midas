import { describe, it, expect } from 'vitest';
import { stdev, computeBeta, betaBoard, sortBeta, type BetaRow } from '@/lib/beta';

describe('stdev', () => {
  it('is zero for fewer than two points', () => {
    expect(stdev([])).toBe(0);
    expect(stdev([5])).toBe(0);
  });
  it('computes the population standard deviation', () => {
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });
});

describe('computeBeta', () => {
  const bench = [0.01, -0.02, 0.03, -0.01, 0.02];

  it('recovers a 2× amplifier with perfect correlation', () => {
    const asset = bench.map((r) => 2 * r);
    const s = computeBeta(asset, bench)!;
    expect(s.beta).toBeCloseTo(2, 6);
    expect(s.correlation).toBeCloseTo(1, 6);
    expect(s.r2).toBeCloseTo(1, 6);
  });

  it('recovers an inverse asset', () => {
    const asset = bench.map((r) => -r);
    const s = computeBeta(asset, bench)!;
    expect(s.beta).toBeCloseTo(-1, 6);
    expect(s.correlation).toBeCloseTo(-1, 6);
    expect(s.r2).toBeCloseTo(1, 6);
  });

  it('returns null when the benchmark is constant', () => {
    expect(computeBeta([0.01, -0.02, 0.03], [0, 0, 0])).toBeNull();
  });

  it('returns null with fewer than two overlapping points', () => {
    expect(computeBeta([0.01], [0.01])).toBeNull();
  });
});

describe('betaBoard', () => {
  // BTC up/down; A amplifies, B inverts.
  const series = [
    { symbol: 'BTC/USDT', closes: [100, 110, 99, 108, 102] },
    { symbol: 'A/USDT', closes: [100, 120, 80, 110, 95] }, // moves with, bigger
    { symbol: 'B/USDT', closes: [100, 90, 101, 92, 99] }, // moves against
  ];

  it('omits the benchmark and rates the others', () => {
    const rows = betaBoard(series, 'BTC/USDT');
    expect(rows.map((r) => r.symbol).sort()).toEqual(['A/USDT', 'B/USDT']);
    const a = rows.find((r) => r.symbol === 'A/USDT')!;
    const b = rows.find((r) => r.symbol === 'B/USDT')!;
    expect(a.beta).toBeGreaterThan(0); // co-moves with BTC
    expect(b.beta).toBeLessThan(0); // inverse to BTC
  });

  it('returns [] when the benchmark series is missing', () => {
    expect(betaBoard([series[1], series[2]], 'BTC/USDT')).toEqual([]);
  });

  it('sorts by beta descending by default', () => {
    const rows = betaBoard(series, 'BTC/USDT');
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].beta).toBeGreaterThanOrEqual(rows[i].beta);
    }
  });
});

describe('sortBeta', () => {
  const rows: BetaRow[] = [
    { symbol: 'A', beta: 0.5, correlation: 0.4, r2: 0.16, vol: 0.02 },
    { symbol: 'B', beta: 1.8, correlation: 0.9, r2: 0.81, vol: 0.05 },
    { symbol: 'C', beta: -0.3, correlation: -0.2, r2: 0.04, vol: 0.01 },
  ];

  it('orders by the chosen key', () => {
    expect(sortBeta(rows, 'beta').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortBeta(rows, 'r2').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortBeta(rows, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
    expect(sortBeta(rows, 'vol').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });

  it('does not mutate the input', () => {
    const before = rows.map((r) => r.symbol);
    sortBeta(rows, 'symbol');
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
