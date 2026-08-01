import { describe, it, expect, vi, afterEach } from 'vitest';
import { createCcxtStreamSource, retryDelay, type ProExchange } from './ccxt-stream';

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

  it('unsubscribes the symbol on stop when the exchange exposes unWatch', async () => {
    const unWatchTrades = vi.fn(async () => {});
    const fake = {
      watchTrades: () => new Promise(() => {}), // pending forever — the loop parks on it
      unWatchTrades,
    } as unknown as ProExchange;
    const stop = createCcxtStreamSource(fake).start('trades', 'BTC/USDT', () => {});
    stop();
    await Promise.resolve(); // unwatch is deferred one microtask (sync-throw safety)
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

describe('retryDelay (exponential backoff with jitter and a cap)', () => {
  it('doubles per consecutive failure and never exceeds the cap', () => {
    // Jitter is 50–100% of the base — assert ranges, not exact values.
    for (let i = 0; i < 100; i++) {
      const first = retryDelay(0, 1000, 30_000);
      expect(first).toBeGreaterThanOrEqual(500);
      expect(first).toBeLessThanOrEqual(1000);
      const second = retryDelay(1, 1000, 30_000);
      expect(second).toBeGreaterThanOrEqual(1000);
      expect(second).toBeLessThanOrEqual(2000);
      const sixth = retryDelay(5, 1000, 30_000);
      expect(sixth).toBeGreaterThanOrEqual(15_000);
      expect(sixth).toBeLessThanOrEqual(30_000); // capped at 30s, not 32s
      const huge = retryDelay(100, 1000, 30_000);
      expect(huge).toBeGreaterThanOrEqual(15_000);
      expect(huge).toBeLessThanOrEqual(30_000); // the cap holds at any depth
    }
  });
});

describe('createCcxtStreamSource stall watchdog', () => {
  /** A fake whose watch parks forever — a silently dead upstream websocket. */
  const parkedForever = () => {
    let calls = 0;
    const fake = {
      watchTrades: async () => {
        calls += 1;
        return new Promise(() => {});
      },
      unWatchTrades: vi.fn(async () => {}),
    } as unknown as ProExchange;
    return { fake, calls: () => calls, unWatchTrades: fake.unWatchTrades as ReturnType<typeof vi.fn> };
  };

  it('restarts the watch loop after stallMs of upstream silence', async () => {
    vi.useFakeTimers();
    const { fake, calls, unWatchTrades } = parkedForever();
    const stop = createCcxtStreamSource(fake, { stallMs: 1000, retryMinMs: 100, retryMaxMs: 1000 })
      .start('trades', 'BTC/USDT', () => {});
    await vi.advanceTimersByTimeAsync(999);
    expect(calls()).toBe(1); // still inside the stall window — no false positive
    await vi.advanceTimersByTimeAsync(1); // the stall watchdog fires
    // Stall → drop the cached subscription → backoff (≤100ms) → re-watch.
    await vi.advanceTimersByTimeAsync(150);
    expect(calls()).toBe(2); // the loop restarted instead of parking forever
    expect(unWatchTrades).toHaveBeenCalledWith('BTC/USDT');
    stop();
  });

  it('reports onFatal after repeated stalls instead of restarting forever', async () => {
    vi.useFakeTimers();
    const { fake, calls } = parkedForever();
    const onFatal = vi.fn();
    const stop = createCcxtStreamSource(fake, { stallMs: 1000, retryMinMs: 10, retryMaxMs: 50 })
      .start('trades', 'BTC/USDT', () => {}, onFatal);
    // 5 consecutive stalls (MAX_CONSECUTIVE_STALLS) of ~1s + ≤50ms backoff each.
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0]).toMatch(/silent|stalled/i);
    const callsAtFatal = calls();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls()).toBe(callsAtFatal); // the loop stopped — no perpetual restart
    stop();
  });
});

describe('createCcxtStreamSource data honesty (no fabricated zeros)', () => {
  /** Run the source's async loop until the first watch batch has been emitted. */
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('drops trades with a missing price or amount instead of emitting 0 prints', async () => {
    let first = true;
    const fake = {
      watchTrades: () => {
        if (!first) return new Promise(() => {}); // park after the first batch
        first = false;
        return Promise.resolve([
          { price: 100, amount: 2, side: 'buy', timestamp: 1 },
          { price: undefined, amount: 3, side: 'sell', timestamp: 2 }, // no price
          { price: 101, side: 'buy', timestamp: 3 }, // no amount
          { price: NaN, amount: 1, side: 'buy', timestamp: 4 }, // non-finite
          { price: 0, amount: 0, side: 'sell', timestamp: 5 }, // a REAL 0 stays
        ]);
      },
    } as unknown as ProExchange;
    const emitted: Array<{ price: number; amount: number }> = [];
    const stop = createCcxtStreamSource(fake).start('trades', 'BTC/USDT', (d) =>
      emitted.push(d as { price: number; amount: number }),
    );
    await flush();
    stop();
    expect(emitted).toEqual([
      { price: 100, amount: 2, side: 'buy', timestamp: 1 },
      { price: 0, amount: 0, side: 'sell', timestamp: 5 },
    ]);
  });

  it('drops order-book levels with a missing price or amount instead of 0 levels', async () => {
    let first = true;
    const fake = {
      watchOrderBook: () => {
        if (!first) return new Promise(() => {});
        first = false;
        return Promise.resolve({
          bids: [[100, 1], [undefined as unknown as number, 2], [99, NaN]],
          asks: [[101, 1], [102]],
          timestamp: 7,
        });
      },
    } as unknown as ProExchange;
    const emitted: Array<{ bids: unknown[]; asks: unknown[] }> = [];
    const stop = createCcxtStreamSource(fake).start('orderbook', 'BTC/USDT', (d) =>
      emitted.push(d as { bids: unknown[]; asks: unknown[] }),
    );
    await flush();
    stop();
    expect(emitted).toEqual([
      {
        symbol: 'BTC/USDT',
        bids: [{ price: 100, amount: 1 }],
        asks: [{ price: 101, amount: 1 }],
        timestamp: 7,
      },
    ]);
  });

  it('emits nothing for a ticker with no usable price (never a $0 live tick)', async () => {
    let first = true;
    const fake = {
      watchTicker: () => {
        if (!first) return new Promise(() => {});
        first = false;
        return Promise.resolve({ last: undefined, close: undefined, percentage: 1.5 });
      },
    } as unknown as ProExchange;
    const emitted: unknown[] = [];
    const stop = createCcxtStreamSource(fake).start('ticker', 'BTC/USDT', (d) => emitted.push(d));
    await flush();
    stop();
    expect(emitted).toEqual([]);
  });
});
