import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { volumeProfile } from './volumeProfile';

/** Zero-range candle — its whole volume lands in one price bin. */
const flat = (price: number, volume: number): Candle => ({
  time: 0,
  open: price,
  high: price,
  low: price,
  close: price,
  volume,
});

/** A candle spanning a price range. */
const bar = (low: number, high: number, close: number, volume: number): Candle => ({
  time: 0,
  open: low,
  high,
  low,
  close,
  volume,
});

describe('volumeProfile', () => {
  it('bins flat candles into the right price buckets and finds the POC', () => {
    const candles = [flat(10, 1), flat(11, 2), flat(12, 10), flat(13, 3), flat(14, 1)];
    const p = volumeProfile(candles, 5)!;
    expect(p).not.toBeNull();
    expect(p.bins).toHaveLength(5);
    expect(p.totalVolume).toBeCloseTo(17, 10);
    expect(p.priceLow).toBe(10);
    expect(p.priceHigh).toBe(14);
    // Bin 2 ([11.6, 12.4)) holds the price-12 candle's volume and is the POC.
    expect(p.pocIndex).toBe(2);
    expect(p.bins[2].volume).toBeCloseTo(10, 10);
    expect(p.poc).toBeCloseTo(12, 10);
  });

  it('grows a value area around the POC toward the heavier side', () => {
    const candles = [flat(10, 1), flat(11, 2), flat(12, 10), flat(13, 3), flat(14, 1)];
    const p = volumeProfile(candles, 5)!;
    // Target 70% of 17 = 11.9; POC(10) + upper neighbor(3) = 13 ≥ target.
    expect(p.valueAreaVolume).toBeCloseTo(13, 10);
    expect(p.val).toBeCloseTo(11.6, 10);
    expect(p.vah).toBeCloseTo(13.2, 10);
    // POC sits inside the value area, which clears the 70% floor.
    expect(p.poc).toBeGreaterThanOrEqual(p.val);
    expect(p.poc).toBeLessThanOrEqual(p.vah);
    expect(p.valueAreaVolume / p.totalVolume).toBeGreaterThanOrEqual(0.7);
  });

  it('spreads a wide candle evenly across the bins it covers', () => {
    // candle1 covers the whole [10,20] range, candle2 concentrates in [14,15].
    const p = volumeProfile([bar(10, 20, 15, 10), bar(14, 15, 14.5, 5)], 10)!;
    expect(p.bins).toHaveLength(10);
    expect(p.totalVolume).toBeCloseTo(15, 10);
    // Each of 10 bins gets 1 from the wide candle; bin 4 ([14,15)) also gets all 5.
    expect(p.bins[4].volume).toBeCloseTo(6, 10);
    expect(p.pocIndex).toBe(4);
    expect(p.poc).toBeCloseTo(14.5, 10);
    expect(p.bins[0].volume).toBeCloseTo(1, 10);
  });

  it('collapses to a single bin spanning the full range when binCount = 1', () => {
    const p = volumeProfile([flat(10, 4), flat(20, 6)], 1)!;
    expect(p.bins).toHaveLength(1);
    expect(p.totalVolume).toBeCloseTo(10, 10);
    expect(p.val).toBe(p.priceLow);
    expect(p.vah).toBe(p.priceHigh);
    expect(p.pocIndex).toBe(0);
  });

  it('returns null when there is nothing to profile', () => {
    expect(volumeProfile([], 10)).toBeNull();
    expect(volumeProfile([flat(10, 5)], 10)).toBeNull(); // need ≥2 candles
    expect(volumeProfile([flat(10, 5), flat(10, 5)], 10)).toBeNull(); // degenerate range
    expect(volumeProfile([flat(10, 0), flat(12, 0)], 10)).toBeNull(); // no volume
  });
});
