import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { computeMacd, macdCross, macdBoard, sortMacd, type MacdRow } from './macdBoard';

const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

const ascending = mk(Array.from({ length: 40 }, (_, i) => 100 + i));
// Decline for 28 bars then a sharp rally → MACD turns up → histogram positive.
const bull = mk([
  ...Array.from({ length: 28 }, (_, i) => 100 - i),
  ...Array.from({ length: 12 }, (_, i) => 72 + (i + 1) * 7),
]);
// Rally for 28 bars then a sharp drop → MACD turns down → histogram negative.
const bear = mk([
  ...Array.from({ length: 28 }, (_, i) => 60 + i),
  ...Array.from({ length: 12 }, (_, i) => 88 - (i + 1) * 7),
]);

describe('macdCross', () => {
  it('detects bullish and bearish histogram sign flips', () => {
    expect(macdCross(-1, 1)).toBe('bull');
    expect(macdCross(0, 1)).toBe('bull');
    expect(macdCross(1, -1)).toBe('bear');
    expect(macdCross(0, -1)).toBe('bear');
  });

  it('returns none when the histogram keeps its sign', () => {
    expect(macdCross(1, 2)).toBe('none');
    expect(macdCross(-2, -1)).toBe('none');
    expect(macdCross(-1, 0)).toBe('none'); // 0 is neither > 0 nor < 0
  });
});

describe('computeMacd', () => {
  it('returns null with too little history', () => {
    expect(computeMacd([])).toBeNull();
    expect(computeMacd(mk(Array.from({ length: 20 }, (_, i) => i)))).toBeNull(); // < slow + 2
  });

  it('keeps its fields self-consistent', () => {
    const r = computeMacd(ascending)!;
    expect(r).not.toBeNull();
    expect(r.hist).toBeCloseTo(r.macd - r.signal, 9);
    expect(r.histPct).toBeCloseTo((r.hist / 139) * 100, 9); // last close = 139
    expect(r.bullish).toBe(r.hist > 0);
    expect(r.n).toBe(40);
    expect(r.cross).toMatch(/^(bull|bear|none)$/);
  });

  it('reads positive momentum after an upside reversal', () => {
    const r = computeMacd(bull)!;
    expect(r.hist).toBeGreaterThan(0);
    expect(r.bullish).toBe(true);
    expect(r.histPct).toBeGreaterThan(0);
  });

  it('reads negative momentum after a downside reversal', () => {
    const r = computeMacd(bear)!;
    expect(r.hist).toBeLessThan(0);
    expect(r.bullish).toBe(false);
  });
});

describe('macdBoard', () => {
  const series = [
    { symbol: 'UP', candles: bull },
    { symbol: 'DOWN', candles: bear },
  ];

  it('defaults to sorting by histogram % descending', () => {
    const rows = macdBoard(series);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].bullish).toBe(true);
    expect(rows[1].bullish).toBe(false);
  });

  it('skips symbols with too little history', () => {
    const rows = macdBoard([
      { symbol: 'OK', candles: bull },
      { symbol: 'THIN', candles: mk([1, 2, 3, 4, 5]) },
    ]);
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortMacd', () => {
  it('orders by histPct descending and by symbol', () => {
    const rows = [
      { symbol: 'A', histPct: 0.5 },
      { symbol: 'B', histPct: 2.1 },
      { symbol: 'C', histPct: -1.3 },
    ] as MacdRow[];
    expect(sortMacd(rows, 'histPct').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
    expect(sortMacd(rows, 'symbol').map((r) => r.symbol)).toEqual(['A', 'B', 'C']);
  });
});
