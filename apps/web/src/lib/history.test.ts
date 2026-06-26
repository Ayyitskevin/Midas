import { describe, it, expect } from 'vitest';
import type { Candle } from '@midas/shared';
import { buildHistory, historyRows, historySummary, sortHistory, toMs, type HistoryRow } from './history';

// time in seconds (UTC); open, high, low, close, volume
const c = (time: number, open: number, high: number, low: number, close: number, volume: number): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

// 4 daily bars with hand-computable changes.
const bars: Candle[] = [
  c(1, 100, 110, 95, 100, 1000), // day 1
  c(2, 100, 120, 100, 110, 2000), // day 2: +10 (+10%)
  c(3, 110, 115, 90, 99, 1500), // day 3: −11 (−10%)
  c(4, 99, 130, 99, 121, 3000), // day 4: +22 (+22.22%)
];

describe('toMs', () => {
  it('scales seconds to ms but leaves ms untouched', () => {
    expect(toMs(1)).toBe(1000);
    expect(toMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toMs(1_700_000_000_000)).toBe(1_700_000_000_000);
  });
});

describe('historyRows', () => {
  const rows = historyRows(bars);

  it('computes change vs the prior close, with a null first bar', () => {
    expect(rows[0].change).toBeNull();
    expect(rows[0].changePct).toBeNull();
    expect(rows[1].change).toBe(10);
    expect(rows[1].changePct).toBeCloseTo(10, 6);
    expect(rows[2].change).toBe(-11);
    expect(rows[2].changePct).toBeCloseTo(-10, 6);
    expect(rows[3].change).toBe(22);
    expect(rows[3].changePct).toBeCloseTo(22.2222, 4);
  });

  it('computes range and range% off the close, and normalizes time to ms', () => {
    expect(rows[1].range).toBe(20); // 120 − 100
    expect(rows[1].rangePct).toBeCloseTo((20 / 110) * 100, 6);
    expect(rows[0].time).toBe(1000);
    expect(rows[3].time).toBe(4000);
  });
});

describe('sortHistory / buildHistory', () => {
  it('defaults to newest-first (time desc)', () => {
    const rows = buildHistory(bars);
    expect(rows.map((r) => r.time)).toEqual([4000, 3000, 2000, 1000]);
  });

  it('sorts time ascending', () => {
    const rows = buildHistory(bars, 'time', 'asc');
    expect(rows.map((r) => r.time)).toEqual([1000, 2000, 3000, 4000]);
  });

  it('sorts by change% descending, nulls last', () => {
    const rows = buildHistory(bars, 'change', 'desc');
    // +22.22 (t4), +10 (t2), −10 (t3), null (t1)
    expect(rows.map((r) => r.time)).toEqual([4000, 2000, 3000, 1000]);
    expect(rows[3].changePct).toBeNull();
  });

  it('sorts by volume descending', () => {
    const rows = buildHistory(bars, 'volume', 'desc');
    expect(rows.map((r) => r.volume)).toEqual([3000, 2000, 1500, 1000]);
  });

  it('sorts by range% descending', () => {
    const rows = buildHistory(bars, 'range', 'desc');
    // rangePct: t1 15, t2 18.18, t3 25.25, t4 25.62 → t4, t3, t2, t1
    expect(rows.map((r) => r.time)).toEqual([4000, 3000, 2000, 1000]);
  });

  it('does not mutate the input array', () => {
    const rows = historyRows(bars);
    const snapshot = rows.map((r) => r.time);
    sortHistory(rows, 'volume', 'desc');
    expect(rows.map((r) => r.time)).toEqual(snapshot);
  });
});

describe('historySummary', () => {
  it('rolls the window into one line', () => {
    const s = historySummary(bars)!;
    expect(s.n).toBe(4);
    expect(s.startClose).toBe(100);
    expect(s.endClose).toBe(121);
    expect(s.periodHigh).toBe(130);
    expect(s.periodLow).toBe(90);
    expect(s.totalChange).toBe(21);
    expect(s.totalChangePct).toBeCloseTo(21, 6);
    expect(s.totalVolume).toBe(7500);
    expect(s.avgVolume).toBe(1875);
    expect(s.upDays).toBe(2);
    expect(s.downDays).toBe(1);
    expect(s.bestPct).toBeCloseTo(22.2222, 4);
    expect(s.worstPct).toBeCloseTo(-10, 6);
  });

  it('handles a single bar without ±Infinity', () => {
    const s = historySummary([c(1, 100, 105, 95, 102, 500)])!;
    expect(s.n).toBe(1);
    expect(s.startClose).toBe(102);
    expect(s.endClose).toBe(102);
    expect(s.upDays).toBe(0);
    expect(s.downDays).toBe(0);
    expect(s.bestPct).toBe(0);
    expect(s.worstPct).toBe(0);
    expect(s.avgVolume).toBe(500);
  });

  it('returns null for an empty series', () => {
    expect(historySummary([])).toBeNull();
    expect(buildHistory([])).toEqual([] as HistoryRow[]);
  });
});
