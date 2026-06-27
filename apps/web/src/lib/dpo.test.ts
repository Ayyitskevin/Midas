import { describe, it, expect } from 'vitest';
import { computeDpo, dpoBoard, dpoShift, sortDpo, type DpoRow } from './dpo';

describe('dpoShift', () => {
  it('is floor(period/2) + 1', () => {
    expect(dpoShift(20)).toBe(11);
    expect(dpoShift(21)).toBe(11);
    expect(dpoShift(4)).toBe(3);
  });
});

describe('computeDpo', () => {
  it('compares the shifted past close to the current SMA', () => {
    // period 4 → shift 3. closes [10,12,14,16,18]: SMA(last 4)=15, past=closes[1]=12 → −3
    const r = computeDpo([10, 12, 14, 16, 18], 4)!;
    expect(r.sma).toBeCloseTo(15, 6);
    expect(r.dpo).toBeCloseTo(-3, 6);
    expect(r.dpoPct).toBeCloseTo(-20, 6);
    expect(r.side).toBe('down');
    expect(r.n).toBe(5);
  });

  it('goes positive when the shifted bar sat above the average (a cycle high)', () => {
    // closes [10,20,12,11,10]: SMA(last 4)=13.25, past=closes[1]=20 → +6.75
    const r = computeDpo([10, 20, 12, 11, 10], 4)!;
    expect(r.dpo).toBeCloseTo(6.75, 6);
    expect(r.dpoPct).toBeCloseTo((6.75 / 13.25) * 100, 6);
    expect(r.side).toBe('up');
  });

  it('works at the minimum bar count', () => {
    // n=4, period 4 → SMA=13, past=closes[0]=10 → −3
    const r = computeDpo([10, 12, 14, 16], 4)!;
    expect(r.dpo).toBeCloseTo(-3, 6);
  });

  it('returns null with too little history', () => {
    expect(computeDpo([10, 12, 14], 4)).toBeNull(); // n < max(period, shift+1)
    expect(computeDpo([], 4)).toBeNull();
  });
});

describe('dpoBoard', () => {
  const series = [
    { symbol: 'HIGH', closes: [10, 20, 12, 11, 10] }, // +50.9%
    { symbol: 'LOW', closes: [10, 12, 14, 16, 18] }, // −20%
  ];

  it('defaults to sorting by DPO% descending', () => {
    const rows = dpoBoard(series, 'dpo', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
    expect(rows[0].side).toBe('up');
    expect(rows[1].side).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = dpoBoard(series, 'symbol', 4);
    expect(rows.map((r) => r.symbol)).toEqual(['HIGH', 'LOW']);
  });

  it('skips symbols with too little history', () => {
    const rows = dpoBoard(
      [
        { symbol: 'OK', closes: [10, 12, 14, 16, 18] },
        { symbol: 'THIN', closes: [10, 12, 14] },
      ],
      'dpo',
      4,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortDpo', () => {
  it('orders by DPO% descending', () => {
    const rows = [
      { symbol: 'A', dpoPct: 5 },
      { symbol: 'B', dpoPct: 20 },
      { symbol: 'C', dpoPct: -10 },
    ] as DpoRow[];
    expect(sortDpo(rows, 'dpo').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
