import { describe, it, expect } from 'vitest';
import { computeMfi, mfiZone, mfiBoard, sortMfi, type MfiBar } from './mfi';

// Flat candles (high = low = close) so typical price == close.
const flat = (closes: number[], vol = 100): MfiBar[] =>
  closes.map((c) => ({ high: c, low: c, close: c, volume: vol }));

const allUp = flat(Array.from({ length: 15 }, (_, i) => i + 1)); // TP rises every bar
const allDown = flat(Array.from({ length: 15 }, (_, i) => 15 - i)); // TP falls every bar
const mid = flat(Array.from({ length: 15 }, (_, i) => (i % 2 === 0 ? 10 : 11))); // alternating

describe('computeMfi', () => {
  it('returns 100 when all money flow is positive', () => {
    expect(computeMfi(allUp, 14)).toBeCloseTo(100, 6);
  });

  it('returns 0 when all money flow is negative', () => {
    expect(computeMfi(allDown, 14)).toBeCloseTo(0, 6);
  });

  it('weights typical price by volume', () => {
    // TP: 10 → 13 (up, rmf 13·100=1300) → 11 (down, rmf 11·200=2200).
    const bars: MfiBar[] = [
      { high: 12, low: 8, close: 10, volume: 100 },
      { high: 15, low: 11, close: 13, volume: 100 },
      { high: 13, low: 9, close: 11, volume: 200 },
    ];
    expect(computeMfi(bars, 2)).toBeCloseTo(37.1429, 3); // 100·1300 / (1300+2200)
  });

  it('returns null with too little history or no money flow', () => {
    expect(computeMfi([], 14)).toBeNull();
    expect(computeMfi(allUp.slice(0, 10), 14)).toBeNull(); // < period + 1
    expect(computeMfi(flat([5, 5, 5, 5, 5]), 2)).toBeNull(); // flat → no directional flow
  });
});

describe('mfiZone', () => {
  it('classifies by the 80/20 thresholds', () => {
    expect(mfiZone(85)).toBe('overbought');
    expect(mfiZone(15)).toBe('oversold');
    expect(mfiZone(50)).toBe('neutral');
  });
});

describe('mfiBoard', () => {
  const series = [
    { symbol: 'UP', bars: allUp },
    { symbol: 'DOWN', bars: allDown },
    { symbol: 'MID', bars: mid },
  ];

  it('defaults to sorting by MFI descending', () => {
    const rows = mfiBoard(series, 'mfi', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'MID', 'DOWN']); // 100 > ~52 > 0
    expect(rows[0].zone).toBe('overbought');
    expect(rows[2].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = mfiBoard(series, 'symbol', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'MID', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = mfiBoard(
      [
        { symbol: 'OK', bars: allUp },
        { symbol: 'THIN', bars: flat([1, 2, 3]) },
      ],
      'mfi',
      14,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortMfi', () => {
  it('orders by MFI descending', () => {
    const rows = [
      { symbol: 'A', mfi: 45, zone: 'neutral' as const, n: 20 },
      { symbol: 'B', mfi: 88, zone: 'overbought' as const, n: 20 },
      { symbol: 'C', mfi: 12, zone: 'oversold' as const, n: 20 },
    ];
    expect(sortMfi(rows, 'mfi').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
