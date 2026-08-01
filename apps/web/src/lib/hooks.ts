import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataReceipt } from '@midas/shared';
import { createLatestGate } from './latestGate';
import { effectiveReceiptFreshness } from './receiptView';
import { stream } from './stream';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Epoch ms of the last successful fetch; null until the first success and
   * after any dep change, disable, or current fetch failure. */
  fetchedAt: number | null;
  refresh: () => void;
}

/**
 * Run an async function on mount and whenever `deps` change, with optional
 * polling. Aborts in-flight requests on unmount / dep change via the provided
 * AbortSignal. Polled refreshes do not toggle `loading`, so the UI doesn't
 * flicker on every tick. When `deps` change (e.g. a linked-group symbol
 * switch), the previous params' data is dropped so panels render their
 * loading/unavailable state instead of stale values under the new header.
 *
 * `fallbackIntervalMs` polls only while the live stream is not open (static
 * demo, WS outage); when the socket is open the stream keeps panels fresh and
 * REST stays quiet.
 */
export function useFetch<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  deps: unknown[],
  options: { intervalMs?: number; fallbackIntervalMs?: number; enabled?: boolean } = {},
): AsyncState<T> {
  const { intervalMs, fallbackIntervalMs, enabled = true } = options;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

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
        setFetchedAt(Date.now());
      }
    } catch (err) {
      if (isCurrent() && (err as Error).name !== 'AbortError') {
        // Fail closed: a failed refresh cannot leave the prior observation
        // visible/actionable under a frozen receipt.
        setData(null);
        setError((err as Error).message || 'Request failed');
        setFetchedAt(null);
      }
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  // Re-render when the earliest fresh receipt in the current payload crosses
  // its max-age boundary, even if no new response arrives.
  useEffect(() => {
    const now = Date.now();
    const expiry = earliestReceiptExpiry(data, now);
    if (expiry === null) return;
    const remaining = expiry - now + 1;
    if (remaining <= 0) return;
    const timer = setTimeout(() => {
      // Persist the elapsed state and clone every changed ancestor. This also
      // invalidates nested memo dependencies such as `data.rows`, not only the
      // response root, while leaving unrelated branches referentially stable.
      setData((current) => refreshReceiptFreshness(current, Date.now()));
    }, Math.min(remaining, 2_000_000_000));
    return () => clearTimeout(timer);
  }, [data, fetchedAt]);

  const manualRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) {
      setData(null);
      setError(null);
      setLoading(false);
      setFetchedAt(null);
      return;
    }
    // Drop the previous params' data (and error) so a dep change never renders
    // the old values under the new header while the refetch is in flight.
    setData(null);
    setError(null);
    setFetchedAt(null);
    const controller = new AbortController();
    run(controller.signal, true);

    manualRef.current = () => run(controller.signal, false);

    let timer: ReturnType<typeof setInterval> | undefined;
    if (intervalMs && intervalMs > 0) {
      timer = setInterval(() => run(controller.signal, false), intervalMs);
    }
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    if (fallbackIntervalMs && fallbackIntervalMs > 0) {
      fallbackTimer = setInterval(() => {
        if (stream.getStatus() !== 'open') run(controller.signal, false);
      }, fallbackIntervalMs);
    }
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, intervalMs, fallbackIntervalMs, enabled]);

  const refresh = useCallback(() => manualRef.current(), []);

  return { data, error, loading, fetchedAt, refresh };
}

function refreshReceiptFreshness<T>(value: T, nowMs: number): T {
  return refreshReceiptFreshnessValue(value, nowMs, new WeakMap()) as T;
}

function refreshReceiptFreshnessValue(
  value: unknown,
  nowMs: number,
  seen: WeakMap<object, unknown>,
): unknown {
  if (value === null || typeof value !== 'object') return value;
  const existing = seen.get(value);
  if (existing !== undefined) return existing;

  const record = value as Record<string, unknown>;
  if (isReceiptRecord(record)) {
    const nextFreshness = effectiveReceiptFreshness(record as unknown as DataReceipt, nowMs);
    const currentFreshness = record.freshness as DataReceipt['freshness'];
    if (
      nextFreshness.state === currentFreshness.state &&
      nextFreshness.ageMs === currentFreshness.ageMs
    ) return value;
    const next = { ...record, freshness: nextFreshness };
    seen.set(value, next);
    return next;
  }

  if (Array.isArray(value)) {
    const next: unknown[] = [];
    seen.set(value, next);
    let changed = false;
    for (const child of value) {
      const refreshed = refreshReceiptFreshnessValue(child, nowMs, seen);
      next.push(refreshed);
      if (refreshed !== child) changed = true;
    }
    if (!changed) {
      seen.set(value, value);
      return value;
    }
    return next;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  const next: Record<string, unknown> = {};
  seen.set(value, next);
  let changed = false;
  for (const [key, child] of Object.entries(record)) {
    const refreshed = refreshReceiptFreshnessValue(child, nowMs, seen);
    next[key] = refreshed;
    if (refreshed !== child) changed = true;
  }
  if (!changed) {
    seen.set(value, value);
    return value;
  }
  return next;
}

function isReceiptRecord(record: Record<string, unknown>): boolean {
  const freshness = record.freshness;
  return (
    record.schemaVersion === '1.0' &&
    typeof record.receiptId === 'string' &&
    (typeof record.sourceAsOf === 'string' || record.sourceAsOf === null) &&
    (typeof record.maxAgeMs === 'number' || record.maxAgeMs === null) &&
    freshness !== null &&
    typeof freshness === 'object' &&
    typeof (freshness as Record<string, unknown>).state === 'string'
  );
}

function earliestReceiptExpiry(
  value: unknown,
  nowMs: number,
  seen = new Set<object>(),
): number | null {
  if (value === null || typeof value !== 'object') return null;
  if (seen.has(value)) return null;
  seen.add(value);
  const record = value as Record<string, unknown>;
  let earliest: number | null = null;
  if (
    record.schemaVersion === '1.0' &&
    typeof record.sourceAsOf === 'string' &&
    typeof record.maxAgeMs === 'number' &&
    Number.isFinite(record.maxAgeMs) &&
    record.freshness !== null &&
    typeof record.freshness === 'object' &&
    (record.freshness as Record<string, unknown>).state === 'fresh'
  ) {
    const sourceAsOf = Date.parse(record.sourceAsOf);
    const expiry = sourceAsOf + record.maxAgeMs;
    // Stored receipt freshness is an observation-time claim. Once its timer
    // fires, skip that elapsed boundary so a later receipt in the same payload
    // gets its own re-render instead of being starved by the first expiry.
    if (Number.isFinite(sourceAsOf) && expiry >= nowMs) earliest = expiry;
  }
  for (const child of Array.isArray(value) ? value : Object.values(record)) {
    const candidate = earliestReceiptExpiry(child, nowMs, seen);
    if (candidate !== null && (earliest === null || candidate < earliest)) earliest = candidate;
  }
  return earliest;
}
