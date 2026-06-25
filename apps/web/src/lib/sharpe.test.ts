import { describe, it, expect } from 'vitest';
import {
  mean,
  stdev,
  downsideDeviation,
  computeRatios,
  sharpeBoard,
  sortSharpe,
  type SharpeRow,
} from '@/lib/sharpe';

describe('basic stats', () => {
  it('mean / stdev', () => {
    expect(mean([1, 2, 3])).toBeCloseTo(2, 6);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2, 6);
  });

  it('downside deviation only penalizes returns below target', () => {
    // only −0.02 and −0.01 count: rms = √((0.0004+0.0001)/4)
    expect(downsideDeviation([0.03, -0.02, 0.05, -0.01], 0)).toBeCloseTo(Math.sqrt(0.0005 / 4), 9);
    expect(downsideDeviation([0.01, 0.02, 0.03], 0)).toBe(0); // no downside
  });
});

describe('computeRatios', () => {
  it('annualizes by √periods and keeps Sortino ≥ Sharpe when mean > 0', () => {
    const r = computeRatios([0.02, -0.01, 0.03, 0.0], 365);
    expect(r.sharpe).not.toBeNull();
    expect(r.sharpe!).toBeGreaterThan(0);
    // downside σ ≤ total σ ⇒ Sortino ≥ Sharpe for a positive mean
    expect(r.sortino!).toBeGreaterThanOrEqual(r.sharpe!);
    expect(r.annReturn).toBeCloseTo(mean([0.02, -0.01, 0.03, 0.0]) * 365, 6);
    expect(r.annVol).toBeCloseTo(stdev([0.02, -0.01, 0.03, 0.0]) * Math.sqrt(365), 6);
  });

  it('returns null Sharpe for zero variance and null Sortino with no downside', () => {
    expect(computeRatios([0.01, 0.01, 0.01], 365).sharpe).toBeNull();
    expect(computeRatios([0.01, 0.02, 0.03], 365).sortino).toBeNull();
  });
});

describe('sharpeBoard', () => {
  const series = [
    { symbol: 'UP/USDT', closes: [100, 102, 104, 106, 108] }, // steady gainer
    { symbol: 'CHOP/USDT', closes: [100, 96, 103, 95, 104] }, // volatile
    { symbol: 'SHORT/USDT', closes: [100, 101] }, // too short
  ];

  it('skips short series and rates the rest', () => {
    const rows = sharpeBoard(series, 365);
    expect(rows.map((r) => r.symbol).sort()).toEqual(['CHOP/USDT', 'UP/USDT']);
  });

  it('ranks the steady gainer above the chop by Sharpe', () => {
    const rows = sharpeBoard(series, 365, 'sharpe');
    expect(rows[0].symbol).toBe('UP/USDT');
  });
});

describe('sortSharpe', () => {
  const rows: SharpeRow[] = [
    { symbol: 'A', sharpe: 1.2, sortino: 2.0, annReturn: 0.5, annVol: 0.4 },
    { symbol: 'B', sharpe: 2.5, sortino: null, annReturn: 0.9, annVol: 0.3 },
    { symbol: 'C', sharpe: -0.4, sortino: -0.6, annReturn: -0.1, annVol: 0.6 },
  ];

  it('orders by key with nulls last', () => {
    expect(sortSharpe(rows, 'sharpe').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortSharpe(rows, 'sortino').map((r) => r.symbol)).toEqual(['A', 'C', 'B']); // null → last
    expect(sortSharpe(rows, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });

  it('does not mutate input', () => {
    const before = rows.map((r) => r.symbol);
    sortSharpe(rows, 'annVol');
    expect(rows.map((r) => r.symbol)).toEqual(before);
  });
});
