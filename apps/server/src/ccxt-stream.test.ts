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

  it('unsubscribes the symbol on stop when the exchange exposes unWatch', () => {
    const unWatchTrades = vi.fn(async () => {});
    const fake = {
      watchTrades: () => new Promise(() => {}), // pending forever — the loop parks on it
      unWatchTrades,
    } as unknown as ProExchange;
    const stop = createCcxtStreamSource(fake).start('trades', 'BTC/USDT', () => {});
    stop();
    // Without this the exchange-side subscription + per-symbol cache leak for
    // the process lifetime; close() must NOT be used (it kills the shared socket).
    expect(unWatchTrades).toHaveBeenCalledWith('BTC/USDT');
  });

  it('does not throw on stop when the exchange lacks unWatch (older ccxt / test fakes)', () => {
    const fake = { watchTrades: () => new Promise(() => {}) } as unknown as ProExchange;
    const stop = createCcxtStreamSource(fake).start('trades', 'BTC/USDT', () => {});
    expect(() => stop()).not.toThrow();
  });

  it('reports onFatal exactly once when the exchange does not list the symbol', async () => {
    vi.useFakeTimers();
    class BadSymbol extends Error {}
    const fake = {
      watchTrades: async () => {
        throw new BadSymbol('binance does not have market symbol JUNK/USDT');
      },
    } as unknown as ProExchange;
    const onFatal = vi.fn();
    const stop = createCcxtStreamSource(fake).start('trades', 'JUNK/USDT', () => {}, onFatal);
    await vi.advanceTimersByTimeAsync(100);
    stop();
    expect(onFatal).toHaveBeenCalledTimes(1);
  });
});
