import type { Candle } from '@midas/shared';
import type { LinePoint } from './indicators';

export type RatioMode = 'ratio' | 'spread';

/**
 * Align two candle series by timestamp and combine their closes into one
 * series: the ratio A/B (default) or the spread A−B. Only timestamps present in
 * both series produce a point; for the ratio, points where B ≤ 0 are dropped.
 */
export function combineSeries(a: Candle[], b: Candle[], mode: RatioMode): LinePoint[] {
  const bByTime = new Map(b.map((c) => [c.time, c.close]));
  const out: LinePoint[] = [];
  for (const ca of a) {
    const cb = bByTime.get(ca.time);
    if (cb == null) continue;
    if (mode === 'ratio') {
      if (!(cb > 0)) continue;
      out.push({ time: ca.time, value: ca.close / cb });
    } else {
      out.push({ time: ca.time, value: ca.close - cb });
    }
  }
  return out;
}
