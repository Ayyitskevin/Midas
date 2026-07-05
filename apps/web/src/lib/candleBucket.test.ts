import { describe, it, expect } from 'vitest';
import { INTERVAL_SECONDS, candleBucketStart } from './candleBucket';

describe('candleBucketStart', () => {
  it('floors a timestamp to the start of its interval bucket', () => {
    // 5m buckets: a print anywhere in [start, start+5m) shares one bucket; the
    // next 5m boundary starts a fresh one. Derive an aligned start from the fn.
    const step = INTERVAL_SECONDS['5m']; // 300
    const start = candleBucketStart(1_780_000_000_000, step);
    const startMs = start * 1000;
    expect(candleBucketStart(startMs, step)).toBe(start); // idempotent at the boundary
    expect(candleBucketStart(startMs + 299_000, step)).toBe(start); // 4m59s in → same bucket
    expect(candleBucketStart(startMs + 300_000, step)).toBe(start + 300); // next bucket
  });

  it('rolls exactly one bucket per interval step', () => {
    const step = INTERVAL_SECONDS['1d']; // 86400
    const t0 = candleBucketStart(1_780_000_000_000, step);
    const t1 = candleBucketStart(1_780_000_000_000 + 86_400_000, step);
    expect(t1 - t0).toBe(86_400);
  });

  it('covers every interval the chart presets use', () => {
    for (const iv of ['5m', '30m', '1d', '1wk'] as const) {
      expect(INTERVAL_SECONDS[iv]).toBeGreaterThan(0);
    }
  });
});
