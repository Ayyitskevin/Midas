import { describe, it, expect } from 'vitest';
import { classifyOiDelta } from '@midas/shared';
import { MockProvider } from '../mock';

/**
 * Determinism + coherence for the mock OI-delta history: reproducible for a
 * (symbol, window) pair, coherent with the mock's own price quote (the last
 * price point IS the current mid), honestly labeled synthetic, and the
 * classification is always a true quadrant of the returned series.
 */

describe('mock getOiDelta', () => {
  it('is deterministic for a (symbol, window) pair', async () => {
    const provider = new MockProvider();
    const a = await provider.getOiDelta('BTC/USDT', '24h');
    const b = await provider.getOiDelta('BTC/USDT', '24h');
    const { receipt: _aReceipt, ...aData } = a;
    const { receipt: _bReceipt, ...bData } = b;
    expect({ ...aData, asOf: 0, points: [] }).toEqual({ ...bData, asOf: 0, points: [] });
    expect(a.points.map((p) => [p.openInterestValue, p.price])).toEqual(
      b.points.map((p) => [p.openInterestValue, p.price]),
    );
  });

  it('is coherent: the last price point is the current quote mid', async () => {
    const provider = new MockProvider();
    const d = await provider.getOiDelta('ETH/USDT', '4h');
    const quote = await provider.getQuote('ETH/USDT');
    const last = d.points[d.points.length - 1];
    expect(last.price).toBeCloseTo(quote.price, 2);
    expect(d.oiNow).toBe(last.openInterestValue);
    expect(d.oiThen).toBe(d.points[0].openInterestValue);
  });

  it('always reports a true quadrant of its own series', async () => {
    const provider = new MockProvider();
    for (const symbol of ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'DOGE/USDT']) {
      for (const window of ['1h', '4h', '24h', '7d'] as const) {
        const d = await provider.getOiDelta(symbol, window);
        expect(d.provenance).toBe('synthetic');
        expect(typeof d.note).toBe('string');
        expect(d.points.length).toBeGreaterThan(1);
        // The classification must be the quadrant the endpoints imply — the
        // mock's per-symbol regime keeps both changes non-flat.
        expect(d.classification).toBe(classifyOiDelta(d.oiChangePct, d.priceChangePct));
        expect(d.classification).not.toBeNull();
      }
    }
  });

  it('labels the perp form of the symbol', async () => {
    const provider = new MockProvider();
    const d = await provider.getOiDelta('BTC/USDT', '24h');
    expect(d.symbol).toBe('BTC/USDT:USDT');
    expect(d.source).toBe('mock');
  });
});
