import { describe, it, expect } from 'vitest';
import { computeAdx, adxBoard, sortAdx, type AdxBar, type AdxRow } from './adx';

// Perfect up-trend, no bar-to-bar overlap: +DM each bar, −DM zero → DX 100 → ADX 100.
const up: AdxBar[] = Array.from({ length: 30 }, (_, i) => ({ high: 10 + 2 * i, low: 8 + 2 * i, close: 9 + 2 * i }));
// Perfect down-trend: −DM each bar, +DM zero.
const down: AdxBar[] = Array.from({ length: 30 }, (_, i) => ({ high: 100 - 2 * i, low: 98 - 2 * i, close: 99 - 2 * i }));
// Choppy: oscillates between two bars → +DM and −DM alternate → DX ~0 → ADX low.
const choppy: AdxBar[] = Array.from({ length: 30 }, (_, i) =>
  i % 2 === 0 ? { high: 12, low: 8, close: 10 } : { high: 11, low: 7, close: 9 },
);

describe('computeAdx', () => {
  it('scores a clean up-trend at ADX 100, +DI leading', () => {
    const r = computeAdx(up, 14)!;
    expect(r).not.toBeNull();
    expect(r.adx).toBeCloseTo(100, 6);
    expect(r.plusDI).toBeCloseTo(66.6667, 3); // 100 · 28 / 42
    expect(r.minusDI).toBe(0);
    expect(r.trending).toBe(true);
    expect(r.bullish).toBe(true);
    expect(r.n).toBe(30);
  });

  it('scores a clean down-trend at ADX 100, −DI leading', () => {
    const r = computeAdx(down, 14)!;
    expect(r.adx).toBeCloseTo(100, 6);
    expect(r.minusDI).toBeCloseTo(66.6667, 3);
    expect(r.plusDI).toBe(0);
    expect(r.bullish).toBe(false);
  });

  it('scores a choppy range as a weak trend', () => {
    const r = computeAdx(choppy, 14)!;
    expect(r.adx).toBeLessThan(25);
    expect(r.trending).toBe(false);
    expect(Math.abs(r.plusDI - r.minusDI)).toBeLessThan(10);
  });

  it('returns null with too little history', () => {
    expect(computeAdx([], 14)).toBeNull();
    expect(computeAdx(up.slice(0, 20), 14)).toBeNull(); // < 2·period + 1
  });
});

describe('adxBoard', () => {
  const series = [
    { symbol: 'STRONG', bars: up },
    { symbol: 'WEAK', bars: choppy },
  ];

  it('defaults to sorting by ADX descending (strongest trends first)', () => {
    const rows = adxBoard(series, 'adx', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['STRONG', 'WEAK']);
    expect(rows[0].trending).toBe(true);
    expect(rows[1].trending).toBe(false);
  });

  it('sorts by symbol', () => {
    const rows = adxBoard(series, 'symbol', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['STRONG', 'WEAK']);
  });

  it('skips symbols with too little history', () => {
    const rows = adxBoard(
      [
        { symbol: 'OK', bars: up },
        { symbol: 'THIN', bars: up.slice(0, 10) },
      ],
      'adx',
      14,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortAdx', () => {
  it('orders by ADX descending and by +DI descending', () => {
    const rows = [
      { symbol: 'A', adx: 30, plusDI: 10 },
      { symbol: 'B', adx: 55, plusDI: 40 },
      { symbol: 'C', adx: 12, plusDI: 25 },
    ] as AdxRow[];
    expect(sortAdx(rows, 'adx').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortAdx(rows, 'plusDI').map((r) => r.symbol)).toEqual(['B', 'C', 'A']);
  });
});
