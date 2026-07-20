import { describe, it, expect } from 'vitest';
import type { LiquidationEvent } from '@midas/shared';
import {
  liquidationsFeedBadge,
  liquidationsFeedIsLive,
  liquidationsFeedLabel,
  summarizeLiquidations,
} from '@/lib/liquidations';

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

describe('liquidationsFeedLabel — never LIVE for synthetic/mock', () => {
  it('labels synthetic demo even when available', () => {
    expect(
      liquidationsFeedLabel({ source: 'mock', available: true, synthetic: true }),
    ).toBe('demo');
    expect(
      liquidationsFeedIsLive({ source: 'mock', available: true, synthetic: true }),
    ).toBe(false);
  });

  it('treats source=mock without synthetic flag as demo (defense in depth)', () => {
    expect(liquidationsFeedLabel({ source: 'mock', available: true })).toBe('demo');
    expect(liquidationsFeedIsLive({ source: 'mock', available: true })).toBe(false);
  });

  it('labels unavailable sources as no-feed, not live', () => {
    expect(
      liquidationsFeedLabel({
        source: 'ccxt:binance',
        available: false,
        synthetic: false,
      }),
    ).toBe('no-feed');
  });

  it('labels real available non-synthetic feeds as live', () => {
    expect(
      liquidationsFeedLabel({
        source: 'ccxt:okx',
        available: true,
        synthetic: false,
      }),
    ).toBe('live');
    expect(
      liquidationsFeedIsLive({
        source: 'ccxt:okx',
        available: true,
        synthetic: false,
      }),
    ).toBe(true);
  });

  it('badge never uses liveTone for demo or no-feed', () => {
    const demo = liquidationsFeedBadge({
      source: 'mock',
      available: true,
      synthetic: true,
      note: 'Synthetic liquidations',
    });
    expect(demo.label).toBe('demo');
    expect(demo.liveTone).toBe(false);
    expect(demo.title).toMatch(/synthetic/i);

    const none = liquidationsFeedBadge({
      source: 'yahoo',
      available: false,
      note: 'No feed',
    });
    expect(none.label).toBe('no-feed');
    expect(none.liveTone).toBe(false);
  });
});
