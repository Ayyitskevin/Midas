import { describe, it, expect } from 'vitest';
import { computeSeasonality } from '@/lib/seasonality';

const HOUR = 3_600_000;

describe('computeSeasonality', () => {
  it('attributes a return to the UTC day/hour of the closing candle', () => {
    const t1 = Date.UTC(2026, 0, 5, 13, 0, 0);
    const day = new Date(t1).getUTCDay();
    const s = computeSeasonality([
      { time: t1 - HOUR, close: 100 },
      { time: t1, close: 110 },
    ]);
    expect(s.totalSamples).toBe(1);
    expect(s.grid[day][13].avg).toBeCloseTo(10);
    expect(s.grid[day][13].n).toBe(1);
    expect(s.byHour[13].avg).toBeCloseTo(10);
    expect(s.byDay[day].avg).toBeCloseTo(10);
    expect(s.maxAbsAvg).toBeCloseTo(10);
    expect(s.grid[(day + 1) % 7][0].avg).toBeNull(); // untouched cell
  });

  it('averages returns that share an hour-of-day bucket', () => {
    const start = Date.UTC(2026, 0, 5, 0, 0, 0);
    const closes = Array<number>(48).fill(100);
    closes[13] = 110; // +10 return at hour 13 (day 1)
    closes[37] = 110; // +10 return at hour 13 (day 2)
    const s = computeSeasonality(closes.map((c, i) => ({ time: start + i * HOUR, close: c })));
    expect(s.byHour[13].n).toBe(2);
    expect(s.byHour[13].avg).toBeCloseTo(10);
  });

  it('skips returns spanning a non-positive close', () => {
    const t = Date.UTC(2026, 0, 5, 5, 0, 0);
    const s = computeSeasonality([
      { time: t - HOUR, close: 100 },
      { time: t, close: 0 },
      { time: t + HOUR, close: 100 },
    ]);
    expect(s.totalSamples).toBe(0);
  });

  it('returns an all-null grid for an empty or single-candle series', () => {
    const empty = computeSeasonality([]);
    expect(empty.totalSamples).toBe(0);
    expect(empty.maxAbsAvg).toBe(0);
    expect(empty.grid[0][0].avg).toBeNull();
    expect(empty.byHour[0].avg).toBeNull();
    expect(computeSeasonality([{ time: 0, close: 100 }]).totalSamples).toBe(0);
  });
});
