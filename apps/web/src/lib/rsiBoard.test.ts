import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { latestRsi, rsiZone, rsiBoard, sortRsi } from './rsiBoard';

// Build minimal candles from a close series (RSI only reads close + time).
const mk = (closes: number[]): Candle[] =>
  closes.map((close, i) => ({ time: i, open: close, high: close, low: close, close, volume: 0 }));

const upClose = mk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]); // 15 closes, all gains
const downClose = mk([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]); // all losses
const alt = mk([100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100]); // 7 up / 7 down

describe('latestRsi', () => {
  it('returns 100 when every change is a gain', () => {
    expect(latestRsi(upClose, 14)).toBeCloseTo(100, 6);
  });

  it('returns 0 when every change is a loss', () => {
    expect(latestRsi(downClose, 14)).toBeCloseTo(0, 6);
  });

  it('returns 50 when average gain equals average loss', () => {
    expect(latestRsi(alt, 14)).toBeCloseTo(50, 6);
  });

  it('applies Wilder smoothing for later bars', () => {
    // period 2 on [10,11,10,13]: seed avgGain/avgLoss 0.5/0.5, then +3 →
    // avgGain 1.75, avgLoss 0.25, RS 7 → RSI 87.5.
    expect(latestRsi(mk([10, 11, 10, 13]), 2)).toBeCloseTo(87.5, 6);
  });

  it('returns null with too little history', () => {
    expect(latestRsi(mk([1, 2, 3]), 14)).toBeNull();
    expect(latestRsi([], 14)).toBeNull();
  });
});

describe('rsiZone', () => {
  it('classifies by the 70/30 thresholds', () => {
    expect(rsiZone(80)).toBe('overbought');
    expect(rsiZone(20)).toBe('oversold');
    expect(rsiZone(50)).toBe('neutral');
  });
});

describe('rsiBoard', () => {
  const series = [
    { symbol: 'HOT', candles: upClose },
    { symbol: 'COLD', candles: downClose },
    { symbol: 'MID', candles: alt },
  ];

  it('defaults to sorting by RSI descending (most overbought first)', () => {
    const rows = rsiBoard(series, 'rsi', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['HOT', 'MID', 'COLD']); // 100 > 50 > 0
    expect(rows[0].zone).toBe('overbought');
    expect(rows[2].zone).toBe('oversold');
  });

  it('sorts by symbol', () => {
    const rows = rsiBoard(series, 'symbol', 14);
    expect(rows.map((r) => r.symbol)).toEqual(['COLD', 'HOT', 'MID']);
  });

  it('skips symbols with too little history', () => {
    const rows = rsiBoard(
      [
        { symbol: 'OK', candles: upClose },
        { symbol: 'THIN', candles: mk([1, 2, 3]) },
      ],
      'rsi',
      14,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortRsi', () => {
  it('orders by RSI descending', () => {
    const rows = [
      { symbol: 'A', rsi: 45, zone: 'neutral' as const },
      { symbol: 'B', rsi: 82, zone: 'overbought' as const },
      { symbol: 'C', rsi: 12, zone: 'oversold' as const },
    ];
    expect(sortRsi(rows, 'rsi').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
