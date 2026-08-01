// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useMemo } from 'react';
import { useFetch } from './hooks';
import { stream } from './stream';
import { createDataReceipt } from '@midas/shared';
import { isReceiptActionable } from './receiptView';

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

  it('fails closed by clearing prior data when a current refresh fails', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<string>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const { result } = renderHook(() => useFetch(fn, ['BTC/USDT']));

    await act(async () => {
      first.resolve('fresh-data');
      await first.promise;
    });
    expect(result.current.data).toBe('fresh-data');

    await act(async () => {
      result.current.refresh();
    });
    await act(async () => {
      second.reject(new Error('poll failed'));
      await second.promise.catch(() => {});
    });
    expect(result.current.data).toBeNull();
    expect(result.current.fetchedAt).toBeNull();
    expect(result.current.error).toBe('poll failed');
  });

  it('re-renders receipted data when its wall-clock freshness expires', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    vi.setSystemTime(now);
    const payload = {
      receipt: createDataReceipt(
        {
          providerId: 'test',
          providerVersion: '1',
          source: 'test',
          datasetFamily: 'quote',
          instrument: 'BTC/USDT',
          provenance: 'live',
          sourceAsOf: now,
          observedAt: now,
          maxAgeMs: 1_000,
        },
        now,
      ),
    };
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<typeof payload>>()
      .mockResolvedValue(payload);
    const { result } = renderHook(() => {
      const state = useFetch(fn, ['BTC/USDT']);
      return {
        ...state,
        actionable: useMemo(
          () => isReceiptActionable(state.data?.receipt),
          [state.data],
        ),
      };
    });
    await act(async () => Promise.resolve());
    expect(result.current.actionable).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(result.current.data?.receipt.receiptId).toBe(payload.receipt.receiptId);
    expect(result.current.data?.receipt.sourceAsOf).toBe(payload.receipt.sourceAsOf);
    expect(result.current.data?.receipt.freshness).toEqual({ state: 'stale', ageMs: 1_001 });
    expect(result.current.data).not.toBe(payload);
    expect(result.current.actionable).toBe(false);
  });

  it('expires a zero-max-age receipt immediately after its exact boundary', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    vi.setSystemTime(now);
    const payload = {
      receipt: createDataReceipt({
        providerId: 'test',
        providerVersion: '1',
        source: 'test',
        datasetFamily: 'quote',
        instrument: 'BTC/USDT',
        provenance: 'live',
        sourceAsOf: now,
        observedAt: now,
        maxAgeMs: 0,
      }, now),
    };
    const { result } = renderHook(() => useFetch(() => Promise.resolve(payload), ['quote']));
    await act(async () => Promise.resolve());
    expect(isReceiptActionable(result.current.data?.receipt)).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(result.current.data?.receipt.freshness).toEqual({ state: 'stale', ageMs: 1 });
    expect(isReceiptActionable(result.current.data?.receipt)).toBe(false);
  });

  it('schedules each future freshness boundary in a payload', async () => {
    vi.useFakeTimers();
    const now = Date.parse('2026-08-01T12:00:00.000Z');
    vi.setSystemTime(now);
    const payload = {
      receipts: [
        createDataReceipt({
          providerId: 'test',
          providerVersion: '1',
          source: 'test',
          datasetFamily: 'quote',
          instrument: 'BTC/USDT',
          provenance: 'live',
          sourceAsOf: now,
          observedAt: now,
          maxAgeMs: 1_000,
        }, now),
        createDataReceipt({
          providerId: 'test',
          providerVersion: '1',
          source: 'test',
          datasetFamily: 'quote',
          instrument: 'ETH/USDT',
          provenance: 'live',
          sourceAsOf: now,
          observedAt: now,
          maxAgeMs: 2_000,
        }, now),
      ],
    };
    const fn = vi
      .fn<(signal: AbortSignal) => Promise<typeof payload>>()
      .mockResolvedValue(payload);
    const { result } = renderHook(() => {
      const state = useFetch(fn, ['quotes']);
      return {
        ...state,
        actionable: useMemo(
          () => state.data?.receipts.map((receipt) => isReceiptActionable(receipt)) ?? [],
          [state.data?.receipts],
        ),
      };
    });
    await act(async () => Promise.resolve());
    expect(result.current.actionable).toEqual([true, true]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
    });
    expect(result.current.actionable).toEqual([false, true]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(result.current.actionable).toEqual([false, false]);
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
