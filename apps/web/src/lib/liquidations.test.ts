import { describe, it, expect } from 'vitest';
import type { LiquidationEvent } from '@midas/shared';
import { summarizeLiquidations } from '@/lib/liquidations';

const ev = (side: 'buy' | 'sell', value: number): LiquidationEvent => ({
  symbol: 'BTC/USDT',
  side,
  price: 100,
  amount: value / 100,
  value,
  timestamp: 0,
});

describe('summarizeLiquidations', () => {
  it('splits notional and counts by long (sell) vs short (buy)', () => {
    const s = summarizeLiquidations([ev('sell', 100), ev('sell', 50), ev('buy', 200)]);
    expect(s.longValue).toBe(150);
    expect(s.shortValue).toBe(200);
    expect(s.total).toBe(350);
    expect(s.longCount).toBe(2);
    expect(s.shortCount).toBe(1);
    expect(s.count).toBe(3);
  });

  it('is all zeros for an empty feed', () => {
    expect(summarizeLiquidations([])).toEqual({
      longValue: 0,
      shortValue: 0,
      total: 0,
      count: 0,
      longCount: 0,
      shortCount: 0,
    });
  });
});
