import { describe, it, expect } from 'vitest';
import { quickSizeAmount, capBlockReason } from './quickSize';

describe('quickSizeAmount', () => {
  it('sizes a buy from the free quote balance at the reference price', () => {
    expect(quickSizeAmount('buy', 0.25, 0, 10_000, 50_000)).toBeCloseTo(0.05); // $2.5k of BTC @ 50k
    expect(quickSizeAmount('buy', 1, 0, 10_000, 50_000)).toBeCloseTo(0.2); // MAX
  });

  it('sizes a sell from the free base balance (price irrelevant)', () => {
    expect(quickSizeAmount('sell', 0.5, 4, 0, 0)).toBe(2);
  });

  it('returns null when it cannot size', () => {
    expect(quickSizeAmount('buy', 0.5, 0, 0, 50_000)).toBeNull(); // no quote balance
    expect(quickSizeAmount('buy', 0.5, 0, 1000, 0)).toBeNull(); // no price
    expect(quickSizeAmount('sell', 0.5, 0, 1000, 50_000)).toBeNull(); // no base balance
    expect(quickSizeAmount('buy', 0, 1, 1000, 50_000)).toBeNull(); // zero fraction
  });
});

describe('capBlockReason', () => {
  const status = { maxOrderUsd: 1000, dailyCapUsd: 5000, dailyUsedUsd: 4500 };

  it('flags a per-order cap breach first', () => {
    expect(capBlockReason(1500, status)).toMatch(/per-order cap/);
  });

  it('flags a daily-cap breach with the remaining budget', () => {
    expect(capBlockReason(900, status)).toMatch(/remaining \$500/);
  });

  it('passes orders that fit, unknown notionals, and uncapped configs', () => {
    expect(capBlockReason(400, status)).toBeNull(); // 4500+400 ≤ 5000
    expect(capBlockReason(null, status)).toBeNull(); // server prices it
    expect(capBlockReason(99_999, { maxOrderUsd: null, dailyCapUsd: null, dailyUsedUsd: 0 })).toBeNull();
    expect(capBlockReason(400, null)).toBeNull();
  });
});
