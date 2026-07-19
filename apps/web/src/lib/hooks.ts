import { useCallback, useEffect, useRef, useState } from 'react';
import { createLatestGate } from './latestGate';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/**
 * Run an async function on mount and whenever `deps` change, with optional
 * polling. Aborts in-flight requests on unmount / dep change via the provided
 * AbortSignal. Polled refreshes do not toggle `loading`, so the UI doesn't
 * flicker on every tick.
 */
export function useFetch<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { intervalMs?: number; enabled?: boolean } = {},
): AsyncState<T> {
  const { intervalMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  // One "latest wins" gate shared by every run of this hook instance — the
  // initial load, each interval tick, and manual refresh. When an interval laps
  // a slow earlier request, the stale earlier response is no longer the latest,
  // so it is discarded instead of overwriting the fresher data (out-of-order
  // response race). `signal.aborted` still guards effect teardown on its own.
  const gateRef = useRef(createLatestGate());

  const run = useCallback(async (signal: AbortSignal, isInitial: boolean) => {
    const runId = gateRef.current.start();
    const isCurrent = () => gateRef.current.isLatest(runId) && !signal.aborted;
    if (isInitial) setLoading(true);
    try {
      const result = await fnRef.current(signal);
      if (isCurrent()) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (isCurrent() && (err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Request failed');
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  const manualRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    run(controller.signal, true);

    manualRef.current = () => run(controller.signal, false);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(() => run(controller.signal, false), intervalMs);
    }
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, enabled]);

  const refresh = useCallback(() => manualRef.current(), []);

  return { data, error, loading, refresh };
}
