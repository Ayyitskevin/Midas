import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { computeKeltner, keltnerBoard, sortKeltner, type KeltRow } from './keltner';

const candle = (close: number, high: number, low: number, i: number): Candle => ({
  time: i,
  open: close,
  high,
  low,
  close,
  volume: 0,
});
const flatN = (count: number, price: number): Candle[] =>
  Array.from({ length: count }, (_, i) => candle(price, price, price, i));

// 25 flat bars at 100, then a bar that spikes well above / below the channel.
const spikeUp = [...flatN(25, 100), candle(130, 130, 100, 25)];
const spikeDown = [...flatN(25, 100), candle(70, 100, 70, 25)];

describe('computeKeltner', () => {
  it('handles a flat series without dividing by zero', () => {
    const r = computeKeltner(flatN(26, 100), 20, 2)!;
    expect(r).not.toBeNull();
    expect(r.middle).toBeCloseTo(100, 6);
    expect(r.width).toBe(0); // ATR 0 → zero-width channel
    expect(r.pos).toBe(50);
    expect(r.breakout).toBe('none');
    expect(r.n).toBe(26);
  });

  it('flags an upside breakout above the channel', () => {
    const r = computeKeltner(spikeUp, 20, 2)!;
    expect(r.breakout).toBe('up');
    expect(r.pos).toBeGreaterThan(100); // close above the upper band
    expect(r.upper).toBeGreaterThan(r.middle);
    expect(r.middle).toBeGreaterThan(r.lower);
  });

  it('flags a downside breakout below the channel', () => {
    const r = computeKeltner(spikeDown, 20, 2)!;
    expect(r.breakout).toBe('down');
    expect(r.pos).toBeLessThan(0);
  });

  it('returns null with too little history', () => {
    expect(computeKeltner(flatN(10, 100), 20)).toBeNull(); // < period + 1
    expect(computeKeltner([], 20)).toBeNull();
  });
});

describe('keltnerBoard', () => {
  const series = [
    { symbol: 'UP', candles: spikeUp },
    { symbol: 'DOWN', candles: spikeDown },
  ];

  it('defaults to sorting by channel position descending', () => {
    const rows = keltnerBoard(series, 'pos', 20, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['UP', 'DOWN']);
    expect(rows[0].breakout).toBe('up');
    expect(rows[1].breakout).toBe('down');
  });

  it('sorts by symbol', () => {
    const rows = keltnerBoard(series, 'symbol', 20, 2);
    expect(rows.map((r) => r.symbol)).toEqual(['DOWN', 'UP']);
  });

  it('skips symbols with too little history', () => {
    const rows = keltnerBoard(
      [
        { symbol: 'OK', candles: spikeUp },
        { symbol: 'THIN', candles: flatN(5, 100) },
      ],
      'pos',
      20,
      2,
    );
    expect(rows.map((r) => r.symbol)).toEqual(['OK']);
  });
});

describe('sortKeltner', () => {
  it('orders by width descending', () => {
    const rows = [
      { symbol: 'A', width: 3 },
      { symbol: 'B', width: 9 },
      { symbol: 'C', width: 1 },
    ] as KeltRow[];
    expect(sortKeltner(rows, 'width').map((r) => r.symbol)).toEqual(['B', 'A', 'C']);
  });
});
