import type { Candle, Interval } from '@midas/shared';
import { INTERVAL_SECONDS } from '../util';

/**
 * Pure numeric coercion and candle-rollup helpers moved verbatim out of
 * `providers/ccxt.ts` (step 1 of the ccxt decomposition). Nothing here touches
 * provider instance state, and this module must never import `../ccxt` — the
 * provider imports one-way from `ccxt/*` so the graph stays acyclic.
 */

/**
 * Aggregate fine-grained candles into larger buckets — standard OHLCV rollup
 * (open=first, high=max, low=min, close=last, volume=sum, time=bucket start).
 * Input must be time-ascending (ccxt's fetchOHLCV contract).
 */
export function aggregateCandles(candles: Candle[], bucketSec: number): Candle[] {
  const out: Candle[] = [];
  for (const c of candles) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec;
    const last = out[out.length - 1];
    if (last && last.time === bucket) {
      last.high = Math.max(last.high, c.high);
      last.low = Math.min(last.low, c.low);
      last.close = c.close;
      last.volume += c.volume;
    } else {
      out.push({ time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    }
  }
  return out;
}

/** The Interval whose length is exactly `sec` (INTERVAL_SECONDS values are unique), or null. */
export function intervalForSeconds(sec: number): Interval | null {
  for (const [key, value] of Object.entries(INTERVAL_SECONDS)) {
    if (value === sec) return key as Interval;
  }
  return null;
}

export function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function nonNegativeFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function positiveFiniteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function sourceTimestampOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
