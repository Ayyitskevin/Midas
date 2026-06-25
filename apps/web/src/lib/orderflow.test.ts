import { describe, it, expect } from 'vitest';
import { signedVolume, bucketFlow, flowSummary } from '@/lib/orderflow';
import type { Trade } from '@midas/shared';

function trade(side: 'buy' | 'sell', amount: number, timestamp: number, price = 100): Trade {
  return { side, amount, price, timestamp };
}

describe('signedVolume', () => {
  it('is positive for buys and negative for sells', () => {
    expect(signedVolume(trade('buy', 3, 0))).toBe(3);
    expect(signedVolume(trade('sell', 3, 0))).toBe(-3);
  });
});

describe('bucketFlow', () => {
  it('returns nothing for empty input or a non-positive window', () => {
    expect(bucketFlow([], 1000)).toEqual([]);
    expect(bucketFlow([trade('buy', 1, 0)], 0)).toEqual([]);
  });

  it('groups trades by window and nets buy − sell per bucket', () => {
    const buckets = bucketFlow(
      [
        trade('buy', 5, 100),
        trade('sell', 2, 900), // same 0–999 window
        trade('buy', 4, 1500), // next 1000–1999 window
      ],
      1000,
    );
    expect(buckets).toHaveLength(2);
    expect(buckets[0]).toMatchObject({ t: 0, buy: 5, sell: 2, delta: 3, trades: 2 });
    expect(buckets[1]).toMatchObject({ t: 1000, buy: 4, sell: 0, delta: 4, trades: 1 });
  });

  it('carries a running CVD across buckets', () => {
    const buckets = bucketFlow(
      [trade('buy', 5, 100), trade('sell', 2, 900), trade('buy', 4, 1500)],
      1000,
    );
    expect(buckets[0].cvd).toBe(3); // +3
    expect(buckets[1].cvd).toBe(7); // +3 then +4
  });

  it('sorts unordered input before bucketing', () => {
    const ordered = bucketFlow([trade('buy', 5, 100), trade('buy', 4, 1500)], 1000);
    const shuffled = bucketFlow([trade('buy', 4, 1500), trade('buy', 5, 100)], 1000);
    expect(shuffled.map((b) => b.cvd)).toEqual(ordered.map((b) => b.cvd));
    expect(shuffled[0].t).toBe(0);
    expect(shuffled[1].t).toBe(1000);
  });
});

describe('flowSummary', () => {
  it('sums volume, nets delta and computes the buy ratio', () => {
    const s = flowSummary([trade('buy', 6, 0), trade('sell', 2, 0), trade('buy', 2, 0)]);
    expect(s.buyVol).toBe(8);
    expect(s.sellVol).toBe(2);
    expect(s.delta).toBe(6);
    expect(s.trades).toBe(3);
    expect(s.buyRatio).toBeCloseTo(0.8, 6);
  });

  it('defaults the buy ratio to 0.5 when there are no trades', () => {
    const s = flowSummary([]);
    expect(s).toMatchObject({ buyVol: 0, sellVol: 0, delta: 0, buyRatio: 0.5, trades: 0 });
  });

  it('matches the last bucket CVD', () => {
    const trades = [trade('buy', 5, 100), trade('sell', 2, 900), trade('buy', 4, 1500)];
    const buckets = bucketFlow(trades, 1000);
    expect(flowSummary(trades).delta).toBe(buckets[buckets.length - 1].cvd);
  });
});
