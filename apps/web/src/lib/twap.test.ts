import { describe, it, expect } from 'vitest';
import { planTwap } from '@/lib/twap';
import type { Level } from '@/lib/slippage';

// A simple ascending-ask / descending-bid book, 1 unit per level.
const asks: Level[] = [
  { price: 100, size: 1 },
  { price: 101, size: 1 },
  { price: 102, size: 1 },
  { price: 103, size: 1 },
];
const bids: Level[] = [
  { price: 99, size: 1 },
  { price: 98, size: 1 },
  { price: 97, size: 1 },
  { price: 96, size: 1 },
];

describe('planTwap', () => {
  it('slices the order and schedules it over time', () => {
    const p = planTwap({ levels: asks, side: 'buy', totalBase: 4, slices: 4, intervalSec: 60 });
    expect(p.valid).toBe(true);
    expect(p.sliceSize).toBe(1);
    expect(p.schedule).toHaveLength(4);
    expect(p.schedule[0]).toMatchObject({ index: 1, tOffsetSec: 0, size: 1, cumSize: 1 });
    expect(p.schedule[3]).toMatchObject({ index: 4, tOffsetSec: 180, size: 1, cumSize: 4 });
    expect(p.durationSec).toBe(180);
  });

  it('models TWAP filling cheaper than an aggressive block on a buy', () => {
    const p = planTwap({ levels: asks, side: 'buy', totalBase: 4, slices: 4, intervalSec: 60 });
    expect(p.aggressive.avgPrice).toBeCloseTo(101.5, 6); // (100+101+102+103)/4
    expect(p.twapAvgPrice).toBeCloseTo(100, 6); // each 1-unit slice lifts only the touch
    expect(p.savingsPerUnit).toBeCloseTo(1.5, 6);
    expect(p.savingsQuote).toBeCloseTo(6, 6); // 1.5 × 4 filled
    expect(p.aggressiveBps).toBeCloseTo(150, 4); // 1.5% vs touch
    expect(p.twapBps).toBeCloseTo(0, 6);
    expect(p.savingsBps).toBeGreaterThan(0);
  });

  it('mirrors the comparison on a sell (TWAP sells higher)', () => {
    const p = planTwap({ levels: bids, side: 'sell', totalBase: 4, slices: 4, intervalSec: 30 });
    expect(p.aggressive.avgPrice).toBeCloseTo(97.5, 6); // (99+98+97+96)/4
    expect(p.twapAvgPrice).toBeCloseTo(99, 6);
    expect(p.savingsPerUnit).toBeCloseTo(1.5, 6); // sells 1.5 higher per unit
  });

  it('lets TWAP fill what an aggressive block cannot (book exhausted)', () => {
    // Only 4 units of depth; ask for 10.
    const p = planTwap({ levels: asks, side: 'buy', totalBase: 10, slices: 4, intervalSec: 60 });
    expect(p.aggressive.exhausted).toBe(true); // 10 > 4 available now
    expect(p.sliceSize).toBe(2.5);
    expect(p.twapExhausted).toBe(false); // 2.5 ≤ 4 fits each refreshed book
    expect(p.twapFilledBase).toBeCloseTo(10, 6);
  });

  it('clamps slices to ≥1 and is invalid for non-positive size or an empty book', () => {
    expect(planTwap({ levels: asks, side: 'buy', totalBase: 3, slices: 0, intervalSec: 60 }).slices).toBe(1);
    expect(planTwap({ levels: asks, side: 'buy', totalBase: 0, slices: 4, intervalSec: 60 }).valid).toBe(false);
    expect(planTwap({ levels: [], side: 'buy', totalBase: 3, slices: 4, intervalSec: 60 }).valid).toBe(false);
  });
});
