// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useFetch } from './hooks';
import { stream } from './stream';

/** A promise resolved/rejected from the test, to control response ordering. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('useFetch', () => {
  it('clears data when deps change so stale values never render under the new header', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ dep }) => useFetch(fn, [dep]), {
      initialProps: { dep: 'BTC/USDT' },
    });

    await act(async () => {
      first.resolve('btc-data');
      await first.promise;
    });
    expect(result.current.data).toBe('btc-data');
    expect(result.current.loading).toBe(false);

    // Linked-group symbol switch: the old data must be dropped immediately,
    // while the refetch is still in flight.
    rerender({ dep: 'ETH/USDT' });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => {
      second.resolve('eth-data');
      await second.promise;
    });
    expect(result.current.data).toBe('eth-data');
    expect(result.current.loading).toBe(false);
  });

  it('clears data and error when disabled', async () => {
    const first = deferred<string>();
    const fn = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementation(() => first.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) => useFetch(fn, ['BTC/USDT'], { enabled }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      first.resolve('btc-data');
      await first.promise;
    });
    expect(result.current.data).toBe('btc-data');

    rerender({ enabled: false });
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('clears a previous error when disabled', async () => {
    const first = deferred<string>();
    const fn = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementation(() => first.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) => useFetch(fn, ['BTC/USDT'], { enabled }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      first.reject(new Error('boom'));
      await first.promise.catch(() => {});
    });
    expect(result.current.error).toBe('boom');

    rerender({ enabled: false });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('discards an out-of-order earlier response (latest wins)', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ dep }) => useFetch(fn, [dep]), {
      initialProps: { dep: 'BTC/USDT' },
    });

    // Dep change starts a second request before the first one resolves.
    rerender({ dep: 'ETH/USDT' });

    await act(async () => {
      second.resolve('eth-data');
      await second.promise;
    });
    expect(result.current.data).toBe('eth-data');

    // The stale earlier request lands late — it must not overwrite the newer data.
    await act(async () => {
      first.resolve('btc-data');
      await first.promise;
    });
    expect(result.current.data).toBe('eth-data');
  });

  it('sets fetchedAt on success, resets it on dep change and on disable', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_234);
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { result, rerender } = renderHook(({ dep }) => useFetch(fn, [dep]), {
      initialProps: { dep: 'BTC/USDT' },
    });
    expect(result.current.fetchedAt).toBeNull();

    await act(async () => {
      first.resolve('btc-data');
      await first.promise;
    });
    expect(result.current.fetchedAt).toBe(1_234);

    // Dep change: the freshness clock resets with the data.
    nowSpy.mockReturnValue(5_678);
    rerender({ dep: 'ETH/USDT' });
    expect(result.current.fetchedAt).toBeNull();

    await act(async () => {
      second.resolve('eth-data');
      await second.promise;
    });
    expect(result.current.fetchedAt).toBe(5_678);
    nowSpy.mockRestore();
  });

  it('resets fetchedAt when disabled', async () => {
    const first = deferred<string>();
    const fn = vi.fn<(signal: AbortSignal) => Promise<string>>().mockImplementation(() => first.promise);

    const { result, rerender } = renderHook(
      ({ enabled }) => useFetch(fn, ['BTC/USDT'], { enabled }),
      { initialProps: { enabled: true } },
    );

    await act(async () => {
      first.resolve('btc-data');
      await first.promise;
    });
    expect(result.current.fetchedAt).not.toBeNull();

    rerender({ enabled: false });
    expect(result.current.fetchedAt).toBeNull();
  });

  it('fallback polling fires only while the stream is not open', async () => {
    vi.useFakeTimers();
    const status = vi.spyOn(stream, 'getStatus').mockReturnValue('closed');
    const fn = vi.fn<(signal: AbortSignal) => Promise<string>>().mockResolvedValue('tick');

    renderHook(() => useFetch(fn, ['BTC/USDT'], { fallbackIntervalMs: 1_000 }));
    expect(fn).toHaveBeenCalledTimes(1); // initial load

    // Stream closed (static demo / WS outage): fallback ticks poll REST.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fn).toHaveBeenCalledTimes(4);

    // Stream open: the live feed owns freshness, fallback stays quiet.
    status.mockReturnValue('open');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(fn).toHaveBeenCalledTimes(4);

    // Stream drops again: fallback resumes.
    status.mockReturnValue('closed');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(fn).toHaveBeenCalledTimes(6);
  });
});
