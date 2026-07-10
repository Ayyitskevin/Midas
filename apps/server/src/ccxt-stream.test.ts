import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCcxtStreamSource, type ProExchange } from './ccxt-stream';

afterEach(() => {
  vi.useRealTimers();
});

describe('createCcxtStreamSource retry policy', () => {
  it('stops retrying a symbol the exchange does not list (no perpetual 1s loop)', async () => {
    vi.useFakeTimers();
    // ccxt raises BadSymbol for an unlisted market — detected by class name.
    class BadSymbol extends Error {}
    let calls = 0;
    const fake = {
      watchTrades: async () => {
        calls += 1;
        throw new BadSymbol('binance does not have market symbol JUNK/USDT');
      },
    } as unknown as ProExchange;

    const stop = createCcxtStreamSource(fake).start('trades', 'JUNK/USDT', () => {});
    // Advance well past several 1s backoffs. Old code would retry ~5×; the fix
    // stops after the first BadSymbol, so exactly one call is made.
    await vi.advanceTimersByTimeAsync(5000);
    stop();
    expect(calls).toBe(1);
  });

  it('keeps retrying a transient error after a backoff', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fake = {
      watchTrades: async () => {
        calls += 1;
        throw new Error('websocket disconnected'); // generic Error, not BadSymbol
      },
    } as unknown as ProExchange;

    const stop = createCcxtStreamSource(fake).start('trades', 'BTC/USDT', () => {});
    await vi.advanceTimersByTimeAsync(3500); // ~3 backoffs elapse
    stop();
    expect(calls).toBeGreaterThan(1); // a transient error still re-tries
  });

  it('is a no-op when no live exchange is available (injected null)', () => {
    let emitted = 0;
    const stop = createCcxtStreamSource(null).start('trades', 'BTC/USDT', () => {
      emitted += 1;
    });
    expect(typeof stop).toBe('function');
    stop();
    expect(emitted).toBe(0);
  });
});
