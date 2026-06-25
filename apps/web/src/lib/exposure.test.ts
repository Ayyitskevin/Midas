import { describe, it, expect } from 'vitest';
import { computeExposure, type ExposurePosition } from '@/lib/exposure';

const P = (symbol: string, quantity: number, price: number | null): ExposurePosition => ({
  symbol,
  quantity,
  price,
});

describe('computeExposure', () => {
  const book = [P('BTC/USDT', 1, 100), P('ETH/USDT', 1, 50), P('SOL/USDT', -2, 25)];

  it('sums net / gross / long / short notional', () => {
    const e = computeExposure(book, 100);
    expect(e.gross).toBe(200); // 100 + 50 + 50
    expect(e.net).toBe(100); // 100 + 50 − 50
    expect(e.long).toBe(150);
    expect(e.short).toBe(50);
    expect(e.longPct).toBeCloseTo(75, 9);
    expect(e.shortPct).toBeCloseTo(25, 9);
  });

  it('computes gross & net leverage against account equity', () => {
    const e = computeExposure(book, 100);
    expect(e.grossLeverage).toBeCloseTo(2, 9);
    expect(e.netLeverage).toBeCloseTo(1, 9);
  });

  it('weights each asset by gross notional and scores concentration', () => {
    const e = computeExposure(book, 100);
    expect(e.weights.map((w) => w.symbol)).toEqual(['BTC/USDT', 'ETH/USDT', 'SOL/USDT']);
    expect(e.weights[0].weight).toBeCloseTo(0.5, 9);
    expect(e.topWeight).toBeCloseTo(0.5, 9);
    expect(e.hhi).toBeCloseTo(0.25 + 0.0625 + 0.0625, 9); // 0.375
    expect(e.weights[2].side).toBe('short');
  });

  it('aggregates the same symbol across entries and skips unpriced ones', () => {
    const e = computeExposure([P('BTC/USDT', 1, 100), P('BTC/USDT', -0.5, 100), P('ETH/USDT', 1, null)], 1000);
    expect(e.weights).toHaveLength(1); // ETH unpriced → dropped
    expect(e.weights[0].signedNotional).toBe(50); // (1 − 0.5) × 100
    expect(e.priced).toBe(2);
    expect(e.total).toBe(3);
  });

  it('is empty-safe and leaves leverage null without account equity', () => {
    const empty = computeExposure([], 0);
    expect(empty).toMatchObject({ gross: 0, net: 0, hhi: 0, topWeight: 0 });
    expect(empty.weights).toEqual([]);
    expect(computeExposure([P('BTC/USDT', 1, 100)], 0).grossLeverage).toBeNull();
  });
});
