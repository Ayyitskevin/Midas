import { useCallback, useEffect, useRef, useState } from 'react';

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

  const run = useCallback(async (signal: AbortSignal, isInitial: boolean) => {
    if (isInitial) setLoading(true);
    try {
      const result = await fnRef.current(signal);
      if (!signal.aborted) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (!signal.aborted && (err as Error).name !== 'AbortError') {
        setError((err as Error).message || 'Request failed');
      }
    } finally {
      if (!signal.aborted) setLoading(false);
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
